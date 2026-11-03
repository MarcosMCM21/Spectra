/**
 * Contratos de Sala Fixa — visibilidade, layout, modo de controle de Addons e
 * credenciais de acesso (DEC-17).
 */
import { z } from "zod";
import { DisplayNameSchema, RoomSlugSchema } from "./common.js";
export { RoomSlugSchema };

/** Código permanente da sala; distinto do código temporário de acesso. */
export const RoomCodeSchema = z
  .string()
  .length(10)
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/, "room_code_inválido");
export type RoomCode = z.infer<typeof RoomCodeSchema>;

/**
 * Visibilidade da Sala Fixa:
 * - `public`:  entrada por slug/link OU por código de acesso temporário.
 * - `private`: exige o identificador da sala (slug/código) **e** a senha.
 */
export const RoomVisibilitySchema = z.enum(["public", "private"]);
export type RoomVisibility = z.infer<typeof RoomVisibilitySchema>;

/** Presets de layout do Showroom (Modo Grid padrão e Modo Teatro/RPG). */
export const LayoutPresetSchema = z.enum(["standard", "rpg_theater"]);
export type LayoutPreset = z.infer<typeof LayoutPresetSchema>;

/**
 * Quem pode habilitar/configurar Addons dentro da sala:
 * - `democratic`: qualquer membro ativo.
 * - `host_only`: somente o admin (criador/transferido).
 */
export const AddonControlModeSchema = z.enum(["democratic", "host_only"]);
export type AddonControlMode = z.infer<typeof AddonControlModeSchema>;

/**
 * Senha de salas privadas. Política mínima: 8 caracteres, ao menos uma letra e
 * um dígito (a complexidade maior fica a critério do criador).
 */
export const RoomPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Za-z]/, "senha_deve_conter_letra")
  .regex(/[0-9]/, "senha_deve_conter_digito");
export type RoomPassword = z.infer<typeof RoomPasswordSchema>;

/**
 * Código de acesso temporário e rotacionável (DEC-17).
 * Charset sem caracteres ambíguos (I/O/0/1) para leitura em voz alta e digitação.
 */
export const AccessCodeSchema = z
  .string()
  .length(8)
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/, "access_code_inválido");
export type AccessCode = z.infer<typeof AccessCodeSchema>;

/** Resumo público de uma Sala Fixa (cards do Lobby e cabeçalho da sala). */
export const RoomSummarySchema = z.object({
  id: z.string().min(1),
  room_code: RoomCodeSchema,
  slug: RoomSlugSchema,
  name: DisplayNameSchema,
  visibility: RoomVisibilitySchema,
  owner_display_name: DisplayNameSchema,
  layout_preset: LayoutPresetSchema,
  addon_control_mode: AddonControlModeSchema,
  /** true quando a sessão LiveKit da sala está ativa (não hibernada). */
  is_active: z.boolean(),
  /** Quantidade de membros transmitindo tela no momento. */
  active_streams: z.number().int().nonnegative(),
  /** Quantidade de participantes conectados (transmitindo ou apenas assistindo). */
  participants: z.number().int().nonnegative(),
  addons_enabled: z.array(z.string().min(1)),
  is_owner: z.boolean().optional(),
  created_at: z.number().int().nonnegative(),
});
export type RoomSummary = z.infer<typeof RoomSummarySchema>;

/** Lista de salas para o Lobby (salas frequentes + descoberta por slug). */
export const RoomListResponseSchema = z.object({
  rooms: z.array(RoomSummarySchema),
  presence_available: z.boolean().optional(),
});
export type RoomListResponse = z.infer<typeof RoomListResponseSchema>;
