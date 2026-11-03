/**
 * Helper de validação com Zod para as rotas do Hub (Fastify 5 aceita um
 * *schema compiler* por rota — `fastify/types/route.d.ts`), evitando plugins
 * adicionais no grafo de dependências.
 */
import type { z } from "zod";
import type { $ZodIssue } from "zod/v4/core";

/** Estrutura mínima de erro aceita pelo `FastifyValidationResult`. */
export interface ValidationIssue {
  keyword: string;
  instancePath: string;
  schemaPath: string;
  params: Record<string, unknown>;
  message?: string;
}

export interface ValidationResult<T> {
  /** Presente quando o payload é válido. */
  value?: T;
  /** Presente quando o payload é malformado. */
  issues?: ValidationIssue[];
}

/**
 * Erro de validação serializado no formato do Fastify (`statusCode`, `code`,
 * `error`, `message`) — a forma pública de todo erro de rota (DEC-17).
 */
export interface ValidationError {
  statusCode: number;
  code: string;
  error: string;
  message: string;
}

function toIssues(error: z.ZodError): ValidationIssue[] {
  return (error.issues as $ZodIssue[]).map((issue) => ({
    keyword: issue.code ?? "invalid",
    instancePath: `/${(issue.path ?? []).join("/")}`,
    schemaPath: `/#/${(issue.path ?? []).join("/")}`,
    params: { path: issue.path ?? [] },
    message: issue.message,
  }));
}

/** Valida `data` contra um schema Zod sem lançar exceção. */
export function validateWithZod<T>(schema: z.ZodType<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) return { value: result.data };
  return { issues: toIssues(result.error) };
}

/**
 * Produz o payload de falha de validação devolvido pelo Hub.
 *
 * O contrato confirmado (DEC-17) é `{ error, code: "validation_failed", issues }`:
 * `error` é uma mensagem legível estável (`code` fixo), enquanto `issues` preserva
 * o detalhamento por campo para o cliente corrigir o payload.
 */
export function validationFailure(issues: ValidationIssue[]): {
  error: string;
  code: "validation_failed";
  issues: ValidationIssue[];
} {
  return {
    error: "payload_inválido",
    code: "validation_failed",
    issues,
  };
}
