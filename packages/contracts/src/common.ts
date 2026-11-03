/**
 * Contratos comuns da Fase 1 — identificadores e limites compartilhados entre
 * Hub, Web e Desktop.
 *
 * Regra arquitetural: este pacote é a BASE do grafo e NÃO pode depender de
 * nenhum outro pacote interno do monorepo (AGENTS.md, seção 2.3).
 */
import { z } from "zod";

/** Identificador interno de entidade (UUID v4 canônico). */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** Momento no tempo expresso em epoch milissegundos (UTC). */
export const TimestampSchema = z.number().int().nonnegative();
export type Timestamp = z.infer<typeof TimestampSchema>;

/**
 * Identificador interno da Sala Fixa (`rooms.slug`, único no SQLite),
 * preservado para rotas existentes; usuários compartilham `RoomCodeSchema`.
 * Minúsculas, alfanumérico, iniciando por letra/dígito, sem hífens consecutivos.
 * Comprimento mínimo de 3 caracteres (mesma política dos nomes de sala).
 */
export const RoomSlugSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug_inválido");
export type RoomSlug = z.infer<typeof RoomSlugSchema>;

/** Nome de exibição (participante ou sala). */
export const DisplayNameSchema = z.string().trim().min(1).max(32);
export type DisplayName = z.infer<typeof DisplayNameSchema>;

/**
 * Identidade exclusiva do participante/conexão no LiveKit para que a mesma
 * conta possa entrar pelo Web e Desktop sem uma conexão substituir a outra.
 */
export const IdentitySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.\-:]+$/, "identity_inválida");
export type Identity = z.infer<typeof IdentitySchema>;

/** URL base do servidor LiveKit self-hosted (ws/wss). */
export const LiveKitUrlSchema = z
  .string()
  .url()
  .refine((value) => /^wss?:\/\//.test(value), "livekit_url_deve_ser_ws_ou_wss");

/** URL base do Hub (http/https). */
export const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), "url_deve_ser_http_ou_https");

import { DATA_CHANNEL_PREFIX } from "./constants.js";

/** Payload JSON arbitrário aceito em Data Channels de Addons (`addon:<id>`). */
export const JsonValueSchema: z.ZodType<JsonValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.lazy(() => z.array(JsonValueSchema)),
  z.lazy(() => z.record(z.string(), JsonValueSchema)),
]);
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Envelope obrigatório de todo pacote enviado em Data Channels por Addons. */
export const DataChannelEnvelopeSchema = z.object({
  /** Sempre `addon:<id>` (DEC-05). O prefixo é imposto no schema, não só na doc. */
  channel: z
    .string()
    .min(DATA_CHANNEL_PREFIX.length + 1)
    .refine(
      (value) => value.startsWith(DATA_CHANNEL_PREFIX) && value.length > DATA_CHANNEL_PREFIX.length,
      "channel_deve_usar_o_prefixo_addon",
    ),
  payload: JsonValueSchema,
});

/**
 * Payload de erro padronizado devolvido pelo Hub em falhas de contrato.
 *
 * `error` aceita duas formas, dependendo do tipo de falha:
 * - **Erro de negócio** (`RoomServiceError`, `ModerationError`): string legível,
 *   acompanhada de `code` estável (ver `RoomErrorCodeSchema`).
 * - **Falha de validação Zod:** array de issues (`validationFailure`).
 */
export const ApiErrorSchema = z.object({
  error: z.union([z.string().min(1), z.array(z.unknown())]),
  code: z.string().min(1).optional(),
  /** Issues estruturadas produzidas por falhas de validação Zod (DEC-17). */
  issues: z.array(z.unknown()).optional(),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
