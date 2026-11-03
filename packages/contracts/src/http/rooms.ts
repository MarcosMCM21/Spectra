/**
 * DTOs HTTP das rotas de Sala Fixa (`/api/rooms*`).
 *
 * Modelo de acesso confirmado (DEC-17):
 * - `public`:  entra por slug/link **ou** por código de acesso temporário.
 * - `private`: exige o identificador da sala **e** a senha definida.
 * - códigos de acesso são temporários/rotacionáveis e podem ser de uso único.
 */
import { z } from "zod";
import { AdminCredentialsSchema, ParticipantCredentialsSchema, SecretTokenSchema } from "../auth.js";
import { IdentitySchema } from "../common.js";
import {
  AccessCodeSchema,
  AddonControlModeSchema,
  LayoutPresetSchema,
  RoomPasswordSchema,
  RoomCodeSchema,
  RoomSlugSchema,
  RoomSummarySchema,
  RoomVisibilitySchema,
} from "../rooms.js";

/** `POST /api/rooms` — cria uma Sala Fixa e o usuário criador. */
export const CreateRoomRequestSchema = z
  .object({
    name: z.string().trim().min(3).max(64),
    /** Identificador personalizado opcional, mantido por compatibilidade com clientes antigos. */
    slug: RoomSlugSchema.optional(),
    visibility: RoomVisibilitySchema,
    display_name: ParticipantCredentialsSchema.shape.display_name,
    /** Obrigatória apenas quando `visibility === "private"`. */
    password: RoomPasswordSchema.optional(),
    layout_preset: LayoutPresetSchema.default("standard"),
    addon_control_mode: AddonControlModeSchema.default("host_only"),
    /** Omitida => o Hub gera uma nova Chave de Criador Persistente. */
    secret_token: SecretTokenSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.visibility === "private" && value.password === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "password_required_for_private_room",
      });
    }
  });
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

/** Resposta de criação: resumo da sala + chave do criador (exibida uma única vez). */
export const CreateRoomResponseSchema = z.object({
  room: RoomSummarySchema,
  secret_token: SecretTokenSchema,
  /** Identidade LiveKit atribuída ao criador nesta primeira entrada. */
  identity: IdentitySchema,
});
export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>;

/** Resposta de `GET /api/rooms/:slug`. */
export const RoomSummaryResponseSchema = z.object({ room: RoomSummarySchema });
export type RoomSummaryResponse = z.infer<typeof RoomSummaryResponseSchema>;

/** `GET /api/rooms/code/:roomCode` — resolve o código permanente compartilhável. */
export const RoomCodeLookupResponseSchema = z.object({ room: RoomSummarySchema });
export type RoomCodeLookupResponse = z.infer<typeof RoomCodeLookupResponseSchema>;

/** `DELETE /api/rooms/:slug` — resultado da remoção permanente da sala. */
export const DeleteRoomRequestSchema = z.object({
  secret_token: SecretTokenSchema,
});
export type DeleteRoomRequest = z.infer<typeof DeleteRoomRequestSchema>;

export const DeleteRoomResponseSchema = z.object({
  deleted: z.literal(true),
  livekit_session_closed: z.boolean(),
});
export type DeleteRoomResponse = z.infer<typeof DeleteRoomResponseSchema>;

/** Método de entrada utilizado pelo cliente (DEC-17). */
export const RoomEntryMethodSchema = z.enum(["slug", "access_code", "password"]);
export type RoomEntryMethod = z.infer<typeof RoomEntryMethodSchema>;

const enterBase = {
  slug: RoomSlugSchema,
  credentials: ParticipantCredentialsSchema,
};

/**
 * `POST /api/rooms/:slug/enter` — union discriminada pelo método de entrada.
 * O Hub ainda valida a compatibilidade entre método e visibilidade da sala.
 */
export const EnterRoomRequestSchema = z.discriminatedUnion("method", [
  /** Entrada por slug/link: permitida somente para salas `public`. */
  z.object({ ...enterBase, method: z.literal("slug") }),
  /** Entrada por código de acesso temporário: válida para qualquer visibilidade. */
  z.object({ ...enterBase, method: z.literal("access_code"), access_code: AccessCodeSchema }),
  /** Entrada por senha: obrigatória para salas `private`. */
  z.object({ ...enterBase, method: z.literal("password"), password: RoomPasswordSchema }),
]);
export type EnterRoomRequest = z.infer<typeof EnterRoomRequestSchema>;

/** Resposta de entrada: JWT LiveKit + identidade única desta conexão. */
export const RoomEntryResponseSchema = z.object({
  /** JWT assinado para o LiveKit (jamais habilita a fonte "microphone"). */
  token: z.string().min(1),
  livekit_url: z.string(),
  room_name: z.string().min(1),
  room: RoomSummarySchema,
  identity: IdentitySchema,
  role: z.enum(["admin", "member"]),
  can_share_screen: z.boolean(),
  display_name: z.string().min(1).max(32),
  expires_at: z.number().int().nonnegative(),
});
export type RoomEntryResponse = z.infer<typeof RoomEntryResponseSchema>;

/** Corpo de `POST /api/rooms/:slug/access-code` (rotação do código temporário). */
export const IssueAccessCodeRequestSchema = AdminCredentialsSchema.extend({
  ttl_seconds: z.number().int().positive().optional(),
  single_use: z.boolean().default(false),
});
export type IssueAccessCodeRequest = z.infer<typeof IssueAccessCodeRequestSchema>;

/** Resposta com o novo código de acesso vigente. */
export const AccessCodeResponseSchema = z.object({
  access_code: AccessCodeSchema,
  expires_at: z.number().int().nonnegative(),
  single_use: z.boolean(),
});
export type AccessCodeResponse = z.infer<typeof AccessCodeResponseSchema>;

/** Códigos de erro estáveis devolvidos pelo Hub nas rotas de sala. */
export const RoomErrorCodeSchema = z.enum([
  "room_not_found",
  "slug_taken",
  "password_required",
  "invalid_password",
  "invalid_access_code",
  "access_code_expired",
  "banned",
  "not_admin",
  "invalid_request",
]);
export type RoomErrorCode = z.infer<typeof RoomErrorCodeSchema>;
