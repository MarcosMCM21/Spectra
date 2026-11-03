/**
 * Contratos de moderação em tempo real (Backend.md, seção 3.2).
 * Toda ação administrativa exige a Chave de Criador Persistente e o `identity`
 * do participante-alvo no LiveKit.
 */
import { z } from "zod";
import { IdentitySchema } from "./common.js";
import { SecretTokenSchema } from "./auth.js";

export const ModerationActionSchema = z.enum([
  /** Remove a track publicada sem desconectar o membro. */
  "end_stream",
  /** Revoga `can_share_screen` e aplica `canPublish: false` no LiveKit. */
  "block_screen_share",
  /** Restaura `can_share_screen` para o membro. */
  "allow_screen_share",
  /** Remove o participante da sessão LiveKit (sem banir). */
  "kick",
  /** Remove o participante e grava `is_banned = true` no SQLite. */
  "ban",
  /** Reverte um ban em `room_permissions`. */
  "unban",
  /** Transferência de host para outro membro autenticado. */
  "transfer_host",
]);
export type ModerationAction = z.infer<typeof ModerationActionSchema>;

/** Corpo de `POST /api/rooms/:slug/moderate`. */
export const ModerationRequestSchema = z.object({
  action: ModerationActionSchema,
  /** Identidade LiveKit do participante-alvo. */
  target_identity: IdentitySchema,
  /** Chave de Criador Persistente do administrador que executa a ação (Backend.md 3.1). */
  actor_secret_token: SecretTokenSchema,
});
export type ModerationRequest = z.infer<typeof ModerationRequestSchema>;

/** Estado efetivo de um participante após a ação administrativa. */
export const ParticipantStateSchema = z.object({
  identity: IdentitySchema,
  display_name: z.string().min(1).max(32),
  role: z.enum(["admin", "member"]),
  can_share_screen: z.boolean(),
  is_banned: z.boolean(),
});
export type ParticipantState = z.infer<typeof ParticipantStateSchema>;

/** Resposta de `POST /api/rooms/:slug/moderate`. */
export const ModerationResultSchema = z.object({
  action: ModerationActionSchema,
  target: ParticipantStateSchema,
  /** false quando a ação foi persistida mas o alvo não estava na sessão LiveKit. */
  livekit_applied: z.boolean(),
});
export type ModerationResult = z.infer<typeof ModerationResultSchema>;

/** Payload de Data Channel para notificar ações de moderação aos demais membros. */
export const ModerationEventSchema = z.object({
  type: z.literal("moderation"),
  action: ModerationActionSchema,
  target_identity: IdentitySchema,
  actor_identity: IdentitySchema,
});
export type ModerationEvent = z.infer<typeof ModerationEventSchema>;
