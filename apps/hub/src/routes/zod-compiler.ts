/**
 * Ponte de tipos entre Zod e Fastify 5.
 *
 * O Hub não usa JSON Schema: cada rota declara `schema: { body, params, ... }`
 * com schemas Zod de `@spectra/contracts`. Como esses schemas não são
 * `FastifySchema`, os genéricos do Fastify precisam de três peças:
 *
 * 1. `HubRouteSchema` — shape aceito pelos genéricos (`extends Record<string, unknown>`);
 * 2. `ZodTypeProvider` — propaga `z.infer<...>` para `request.body` / `request.params`;
 * 3. `zodValidatorCompiler` — executa o `safeParse` da parte pedida por `httpPart`.
 *
 * Toda falha de payload sai com o contrato único `{ error, code: "validation_failed",
 * issues }` (DEC-17), instalado por `hubValidationPlugin`.
 *
 * Referências: `fastify/types/schema.d.ts`, `fastify/types/type-provider.d.ts`,
 * `fastify/types/route.d.ts`, `fastify/types/request.d.ts`.
 */
import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import type {
  FastifyRouteSchemaDef,
  FastifySchemaCompiler,
  FastifyValidationResult,
} from "fastify/types/schema.js";
import type { FastifyTypeProvider } from "fastify/types/type-provider.js";
import type { z, ZodTypeAny } from "zod";
import { validationFailure, type ValidationIssue, type ValidationError } from "@spectra/contracts";

/** Código de erro estável devolvido para payloads malformados (DEC-17). */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** Schema Zod declarado como `schema` de rota — nunca JSON Schema. */
export interface HubRouteSchema extends Record<string, unknown> {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  querystring?: ZodTypeAny;
  headers?: ZodTypeAny;
}

/** Nome usado por `routes/rooms.ts`. */
export type ZodRouteSchema = HubRouteSchema;

/** Partes do payload validadas pelo Zod nas rotas do Hub. */
const VALIDATION_ENTRY = {
  body: "body",
  params: "params",
  querystring: "querystring",
  query: "querystring",
  headers: "headers",
} as const;

/**
 * Type guard para um schema de rota do Hub.
 *
 * `HubRouteSchema` é uma interface e não pode ser usada em `satisfies`; esta
 * função faz a mesma verificação estática (apenas chaves de contrato Zod, todas
 * `ZodTypeAny`) mantendo o type provider inferível.
 */
export function zodRouteSchema<S extends HubRouteSchema>(schema: S): S {
  return schema;
}

/**
 * Type provider do Hub.
 *
 * A resolução de entrada é feita em tempo de execução pelo
 * `zodValidatorCompiler`; estaticamente as entradas validadas ficam como
 * `unknown` e os handlers usam casts explícitos (`request.body as CreateRoomRequest`).
 * `output: never` mantém as respostas tipadas pelo retorno explícito dos handlers.
 */
export interface ZodTypeProvider extends FastifyTypeProvider {
  validator: unknown;
  serializer: never;
  output: never;
}

/** Shape mínimo de uma issue de `ZodError` (independente da versão do Zod). */
interface ZodLikeIssue {
  code?: string;
  path?: readonly (string | number)[];
  message: string;
}

/** Reconhece um `ZodError` vindo de qualquer cópia resolvida do Zod no workspace. */
function isZodLikeError(error: unknown): error is { issues: readonly ZodLikeIssue[] } {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as { issues?: unknown };
  return Array.isArray(candidate.issues);
}

/** Conversão de `ZodError` para o formato de issue do contrato (DEC-17). */
function toIssues(error: { issues: readonly ZodLikeIssue[] }): ValidationIssue[] {
  return error.issues.map((issue) => ({
    keyword: String(issue.code ?? "invalid"),
    instancePath: `/${(issue.path ?? []).join("/")}`,
    schemaPath: `/#/${(issue.path ?? []).join("/")}`,
    params: { path: issue.path ?? [] },
    message: issue.message,
  }));
}

/** Payload de falha devolvido ao cliente: `{ error, code, issues }` (DEC-17). */
export function routeValidationFailure(issues: ValidationIssue[]): {
  error: string;
  code: "validation_failed";
  issues: ValidationIssue[];
} {
  return validationFailure(issues);
}

/** Normaliza um erro qualquer para o payload de falha do contrato. */
function fallbackIssues(error: unknown): ValidationIssue[] {
  const message = error instanceof Error && error.message !== "" ? error.message : "payload_inválido";
  return [{ keyword: "invalid", instancePath: "", schemaPath: "", params: {}, message }];
}

/** Erro de payload lançado pelo validador Zod do Hub. */
export interface HubValidationError extends Error, ValidationError {
  statusCode: number;
  code: "validation_failed";
  validationContext: string;
  issues: ValidationIssue[];
}

function hubValidationError(issues: ValidationIssue[], context: string): HubValidationError {
  const failure = validationFailure(issues);
  const error = new Error(`request ${context} validation failed`) as HubValidationError;
  error.name = "HubValidationError";
  error.statusCode = 400;
  error.code = VALIDATION_FAILED_CODE;
  error.validationContext = context;
  error.issues = failure.issues;
  return error;
}

/** Shape de erro aceito por `validationIssuesFromError` (`issues` ou `validation`). */
interface IssuesCarrier {
  issues?: unknown;
  validation?: unknown;
}

/** Tradução de um erro recebido no `onError` para o contrato público. */
export function validationIssuesFromError(error: IssuesCarrier): ValidationIssue[] | null {
  const raw = Array.isArray(error.issues) ? error.issues : Array.isArray(error.validation) ? error.validation : null;
  if (raw === null) return null;

  return (raw as readonly ZodLikeIssue[]).map((issue) => ({
    keyword: String(issue.code ?? "invalid"),
    instancePath: `/${(issue.path ?? []).join("/")}`,
    schemaPath: `/#/${(issue.path ?? []).join("/")}`,
    params: { path: issue.path ?? [] },
    message: issue.message,
  }));
}

/** Type guard: erro de validação pronto para o contrato público. */
export function isValidationFastifyError(error: unknown): error is HubValidationError {
  if (error instanceof Error === false) return false;
  const candidate = error as Partial<HubValidationError>;
  return candidate.code === VALIDATION_FAILED_CODE && Array.isArray(candidate.issues);
}

/** Erro do próprio Fastify (URL inválida, payload não-JSON, limite de corpo, etc.). */
interface FastifyRequestError extends Error {
  statusCode?: number;
  code?: string;
}

function isFastifyRequestError(error: FastifyRequestError): boolean {
  return typeof error.code === "string" && error.code.startsWith("FST_ERR_");
}


/** Valida uma parte do payload com o schema Zod declarado na rota. */
function parsePart(
  routeSchema: FastifyRouteSchemaDef<HubRouteSchema>,
  data: unknown,
  httpPart: string,
): { value?: unknown } {
  const part = VALIDATION_ENTRY[httpPart as keyof typeof VALIDATION_ENTRY];
  const schema = part === undefined ? undefined : routeSchema.schema[part];
  if (schema === undefined) return { value: data };

  const result = schema.safeParse(data);
  if (result.success) return { value: result.data };

  const issues = isZodLikeError(result.error) ? toIssues(result.error) : fallbackIssues(result.error);
  throw hubValidationError(issues, httpPart);
}

/**
 * Compilador de validação do Hub: o Zod resolve apenas a parte informada por
 * `httpPart`. Partes sem schema declarado (ex.: `/healthz`) passam direto.
 *
 * A falha é lançada como `HubValidationError` (e não devolvida em `errors`)
 * porque o contrato público `{ error, code, issues }` é montado no `errorHandler`.
 */
export const zodValidatorCompiler: FastifySchemaCompiler<HubRouteSchema> = (
  routeSchema: FastifyRouteSchemaDef<HubRouteSchema>,
): FastifyValidationResult => {
  const validate = (data: unknown): { value?: unknown } => parsePart(routeSchema, data, routeSchema.httpPart ?? "body");
  validate.errors = null;
  return validate as FastifyValidationResult;
};

/** Nome mantido para chamadas antigas. */
export const zodSchemaCompiler = zodValidatorCompiler;

const ROUTE_SCHEMA_KEYS = ["body", "querystring", "query", "params", "headers"] as const;

function hasZodSchemas(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const record = schema as Record<string, unknown>;
  return ROUTE_SCHEMA_KEYS.some((key) => typeof record[key] === "object" && record[key] !== null);
}

/**
 * Plugin de validação do Hub: instala o `validatorCompiler` Zod e o
 * `errorHandler` que devolve exclusivamente `{ error, code: "validation_failed",
 * issues }` (DEC-17). Qualquer outro erro vira `500` sem detalhes internos.
 *
 * O plugin é registrado na raiz para valer em toda a árvore de rotas (hooks
 * herdados pelas instâncias filhas montadas sob `/api`).
 */
export const hubValidationPlugin: FastifyPluginCallback = (instance, _opts, done) => {
  instance.addHook("onRequest", (request, _reply, hookDone) => {
    // `attachValidation` é incompatível com um validador que lança: a falha
    // chegaria ao `onError` embrulhada pelo Fastify. Desliga-se a opção por
    // rota para manter o payload público direto.
    const options = request.routeOptions as { attachValidation?: boolean; schema?: unknown };
    if (options.attachValidation === true || hasZodSchemas(options.schema)) {
      options.attachValidation = false;
    }
    hookDone();
  });

  instance.setValidatorCompiler<HubRouteSchema>(zodValidatorCompiler);

  instance.setErrorHandler((error, request, reply) => {
    const failure = error as FastifyRequestError & Partial<HubValidationError>;

    if (failure.code === VALIDATION_FAILED_CODE) {
      const issues = validationIssuesFromError(failure) ?? fallbackIssues(error);
      void reply.status(400).send(routeValidationFailure(issues));
      return;
    }

    if (isFastifyRequestError(failure)) {
      void reply
        .status(failure.statusCode ?? 400)
        .send({ error: failure.message === "" ? "requisição_inválida" : failure.message, code: "invalid_request" });
      return;
    }

    request.log.error({ err: error }, "erro_interno_no_hub");
    void reply.status(500).send({ error: "erro_interno", code: "internal_error" });
  });

  done();
};


