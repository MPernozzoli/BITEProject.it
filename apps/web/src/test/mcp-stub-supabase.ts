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

  insert(values: Record<string, unknown>): this {
    this.op = "insert";
    this.values = values;
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

  // Filtri che i test non devono distinguere: registrati e ignorati.
  neq(): this { return this; }
  gte(): this { return this; }
  lte(): this { return this; }
  in(): this { return this; }
  or(): this { return this; }
  is(): this { return this; }
  not(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }

  private rows(): Record<string, unknown>[] {
    const rows = this.fixtures.tables?.[this.table] ?? [];
    const entries = Object.entries(this.filters);
    if (entries.length === 0) return rows;
    return rows.filter((row) => entries.every(([column, value]) => row[column] === value));
  }

  private resolve(single: boolean): Result {
    if (this.op === "select") {
      const rows = this.rows();
      if (this.headOnly) return { data: null, error: null, count: rows.length };
      return { data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
    }

    this.writes.push({ table: this.table, op: this.op, values: this.values, filters: { ...this.filters } });

    if (this.op === "insert") {
      const inserted = { id: `stub-${this.table}-${this.writes.length}`, ...(this.values ?? {}) };
      return { data: this.returning ? (single ? inserted : [inserted]) : null, error: null };
    }
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

export function createStubSupabase(fixtures: StubFixtures = {}) {
  const writes: StubWrite[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];

  const client = {
    from(table: string) {
      return new StubQuery(table, fixtures, writes);
    },
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      const value = fixtures.rpc?.[name];
      return Promise.resolve({ data: value === undefined ? true : value, error: null });
    },
    auth: {
      admin: {
        getUserById: () => Promise.resolve({ data: { user: { email: "admin@biteproject.it" } }, error: null }),
      },
    },
  };

  return { client: client as never, writes, rpcCalls };
}
