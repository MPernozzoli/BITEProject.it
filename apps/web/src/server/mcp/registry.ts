/**
 * Registrazione dei tool.
 *
 * Ogni tool dichiara scope, classe di rate limit e handler; il resto —
 * autorizzazione, contatore, audit, idempotenza, formato della risposta — è
 * uguale per tutti e sta qui. Un tool nuovo che dimentica il controllo di scope
 * non è possibile: non c'è un percorso alternativo per registrarlo.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { beginAudit, consumeRateLimit, finishAudit, findIdempotentResult, rateLimitMessage, type RateLimitKind } from "./audit.js";
import { McpToolError, requireScope, type McpContext, type McpScope } from "./context.js";

/** Risultato di un tool: un riassunto leggibile più, se serve, i dati grezzi. */
export interface ToolOutcome {
  text: string;
  data?: unknown;
  targetId?: string | null;
  /** True quando il tool si è fermato al preview e non ha prodotto effetti. */
  preview?: boolean;
}

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  scope: McpScope;
  kind: RateLimitKind;
  annotations?: ToolAnnotations;
  handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>, ctx: McpContext) => Promise<ToolOutcome>;
}

/** Da aggiungere allo schema di ogni tool che scrive: rende i retry innocui. */
export const clientRequestIdShape = {
  client_request_id: z
    .string()
    .min(6)
    .max(120)
    .optional()
    .describe(
      "Identificatore scelto dal client per rendere idempotente questa chiamata: ripeterla con lo stesso valore non duplica l'effetto.",
    ),
};

/** Da aggiungere ai tool con effetti visibili all'esterno. */
export const confirmShape = {
  confirm: z
    .boolean()
    .optional()
    .describe("Senza confirm: true il tool restituisce solo l'anteprima di cosa farebbe, senza eseguire."),
};

function textContent(text: string) {
  return { type: "text" as const, text };
}

/**
 * `registerTool` dell'SDK tipizza la callback in funzione della *forma
 * concreta* dello schema; con uno `Shape` generico come il nostro il tipo
 * condizionale non si risolve e TypeScript non riesce a unificarli. Il cast è
 * confinato qui: a runtime la firma è esattamente quella attesa.
 */
type RegisterToolFn = (
  name: string,
  config: Record<string, unknown>,
  cb: (args: Record<string, unknown>) => Promise<unknown>,
) => void;

export function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  ctx: McpContext,
  def: ToolDefinition<Shape>,
): void {
  (server.registerTool as unknown as RegisterToolFn)(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: {
        title: def.title,
        readOnlyHint: def.kind === "read",
        ...def.annotations,
      },
    },
    async (rawArgs: Record<string, unknown>) => {
      const args = rawArgs as z.objectOutputType<Shape, z.ZodTypeAny>;
      const clientRequestId = (args as { client_request_id?: string }).client_request_id ?? null;

      try {
        requireScope(ctx, def.scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await finishAudit(ctx.service, await beginAudit(ctx.service, ctx.auth, def.name, args, clientRequestId), {
          outcome: "denied",
          error: message,
        });
        return { isError: true, content: [textContent(message)] };
      }

      if (!(await consumeRateLimit(ctx.service, ctx.auth, def.kind))) {
        return { isError: true, content: [textContent(rateLimitMessage(def.kind))] };
      }

      const cached = await findIdempotentResult(ctx.service, ctx.auth, def.name, clientRequestId);
      if (cached) {
        return {
          content: [
            textContent(
              `Già eseguito in precedenza con lo stesso client_request_id, nessun nuovo effetto.${
                cached.targetId ? ` Risorsa: ${cached.targetId}` : ""
              }`,
            ),
            textContent(JSON.stringify(cached.result ?? null, null, 2)),
          ],
        };
      }

      const audit = await beginAudit(ctx.service, ctx.auth, def.name, args, clientRequestId);

      try {
        const outcome = await def.handler(args, ctx);
        await finishAudit(ctx.service, audit, {
          outcome: "ok",
          targetId: outcome.targetId ?? null,
          result: outcome.preview ? null : (outcome.data ?? null),
          // Un'anteprima non ha prodotto effetti: se restasse indicizzata come
          // idempotente, la stessa chiamata con confirm: true verrebbe servita
          // dalla cache e non eseguirebbe mai.
          clearIdempotency: outcome.preview === true,
        });

        const content = [textContent(outcome.text)];
        if (outcome.data !== undefined) content.push(textContent(JSON.stringify(outcome.data, null, 2)));
        return { content };
      } catch (error) {
        const message =
          error instanceof McpToolError
            ? `${error.message} (${error.code})`
            : error instanceof Error
              ? error.message
              : String(error);
        console.error(`[mcp] tool ${def.name} failed`, error);
        await finishAudit(ctx.service, audit, { outcome: "error", error: message });
        return { isError: true, content: [textContent(message)] };
      }
    },
  );
}
