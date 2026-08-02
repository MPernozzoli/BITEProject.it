/**
 * Stub del client Supabase per i test dei tool MCP.
 *
 * Non è un finto database: filtra solo sugli `eq` e restituisce le righe messe
 * nelle fixture. Serve a verificare la logica dei tool — scope, confirm,
 * validazioni, forma della risposta — senza toccare la rete.
 */

export interface StubFixtures {
  /** Righe per tabella, usate dalle select. */
  tables?: Record<string, Record<string, unknown>[]>;
  /** Valori di ritorno per `rpc(name)`. */
  rpc?: Record<string, unknown>;
}

export interface StubWrite {
  table: string;
  op: "insert" | "update" | "delete";
  values?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

type Result = { data: unknown; error: { message: string } | null; count?: number | null };

class StubQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private values: Record<string, unknown> | undefined;
  private filters: Record<string, unknown> = {};
  private comparators: { column: string; op: string; value: string }[] = [];
  private returning = false;
  private headOnly = false;

  constructor(
    private readonly table: string,
    private readonly fixtures: StubFixtures,
    private readonly writes: StubWrite[],
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    if (this.op === "select") this.op = "select";
    else this.returning = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.op = "insert";
    this.values = values as Record<string, unknown>;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.op = "update";
    this.values = values;
    return this;
  }

  delete(): this {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters[column] = value;
    return this;
  }

  /** Case-insensitive esatto: basta per `resolveTagIds`, che cerca un nome preciso. */
  ilike(column: string, value: unknown): this {
    this.comparators.push({ column, op: "ilike", value: String(value).toLowerCase() });
    return this;
  }

  /**
   * I confronti sono veri, non decorativi: una `delete().lt("expires_at", …)`
   * che ignorasse il filtro svuoterebbe la tabella e farebbe passare test che
   * in produzione fallirebbero.
   */
  gte(column: string, value: unknown): this {
    return this.compare(column, ">=", value);
  }
  lte(column: string, value: unknown): this {
    return this.compare(column, "<=", value);
  }
  gt(column: string, value: unknown): this {
    return this.compare(column, ">", value);
  }
  lt(column: string, value: unknown): this {
    return this.compare(column, "<", value);
  }

  // Filtri e modificatori che i test non devono distinguere: accettati e ignorati.
  neq(): this { return this; }
  in(): this { return this; }
  or(): this { return this; }
  is(): this { return this; }
  not(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  range(): this { return this; }

  private compare(column: string, op: string, value: unknown): this {
    this.comparators.push({ column, op, value: String(value) });
    return this;
  }

  private rows(): Record<string, unknown>[] {
    const rows = this.fixtures.tables?.[this.table] ?? [];
    const entries = Object.entries(this.filters);
    return rows.filter((row) => {
      if (!entries.every(([column, value]) => row[column] === value)) return false;
      return this.comparators.every(({ column, op, value }) => {
        const actual = String(row[column] ?? "");
        if (op === ">=") return actual >= value;
        if (op === "<=") return actual <= value;
        if (op === ">") return actual > value;
        if (op === "<") return actual < value;
        if (op === "ilike") return actual.toLowerCase() === value;
        return true;
      });
    });
  }

  private table_(): Record<string, unknown>[] {
    if (!this.fixtures.tables) this.fixtures.tables = {};
    if (!this.fixtures.tables[this.table]) this.fixtures.tables[this.table] = [];
    return this.fixtures.tables[this.table];
  }

  /**
   * Le scritture non sono solo registrate ma anche applicate alle fixture: i
   * flussi in più passi (OAuth su tutti) leggono ciò che il passo precedente ha
   * scritto, e uno stub che dimentica renderebbe il test una finzione.
   */
  private resolve(single: boolean): Result {
    if (this.op === "select") {
      const rows = this.rows();
      if (this.headOnly) return { data: null, error: null, count: rows.length };
      return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
    }

    this.writes.push({ table: this.table, op: this.op, values: this.values, filters: { ...this.filters } });
    const rows = this.table_();

    if (this.op === "insert") {
      const incoming = Array.isArray(this.values) ? (this.values as Record<string, unknown>[]) : [this.values ?? {}];
      const inserted = incoming.map((values, index) => ({
        id: `stub-${this.table}-${this.writes.length}-${index}`,
        ...values,
      }));
      rows.push(...inserted);
      return { data: this.returning ? (single ? inserted[0] : inserted) : null, error: null };
    }

    if (this.op === "update") {
      for (const row of this.rows()) Object.assign(row, this.values ?? {});
      return { data: null, error: null };
    }

    const matching = new Set(this.rows());
    this.fixtures.tables![this.table] = rows.filter((row) => !matching.has(row));
    return { data: null, error: null };
  }

  maybeSingle(): Promise<Result> {
    return Promise.resolve(this.resolve(true));
  }

  single(): Promise<Result> {
    return Promise.resolve(this.resolve(true));
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve(false)).then(onfulfilled, onrejected);
  }
}

/** Un file per bucket/percorso: basta a provare che il tool ha chiamato upload e getPublicUrl correttamente. */
export interface StubUpload {
  bucket: string;
  path: string;
  bytes: number;
  contentType?: string;
}

export function createStubSupabase(fixtures: StubFixtures = {}) {
  const writes: StubWrite[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const uploads: StubUpload[] = [];

  const client = {
    from(table: string) {
      return new StubQuery(table, fixtures, writes);
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      const value = fixtures.rpc?.[name];
      return Promise.resolve({ data: value === undefined ? true : value, error: null });
    },
    storage: {
      from(bucket: string) {
        return {
          upload: (path: string, body: Buffer, options?: { contentType?: string }) => {
            uploads.push({ bucket, path, bytes: body.byteLength, contentType: options?.contentType });
            return Promise.resolve({ data: { path }, error: null });
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://stub.supabase.co/storage/v1/object/public/${bucket}/${path}` },
          }),
        };
      },
    },
    auth: {
      admin: {
        getUserById: () => Promise.resolve({ data: { user: { email: "admin@biteproject.it" } }, error: null }),
      },
    },
  };

  return { client: client as never, writes, rpcCalls, uploads };
}
