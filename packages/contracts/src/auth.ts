/**
 * Contratos de conta, papéis de participante e credenciais internas do Hub.
 */
import { z } from "zod";
import { DisplayNameSchema, IdentitySchema } from "./common.js";

/**
 * Credencial persistente interna do usuário (`secret_token`).
 * O cliente a armazena localmente; o Hub persiste apenas o hash.
 */
export const SecretTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "secret_token_inválido");
export type SecretToken = z.infer<typeof SecretTokenSchema>;

/** Papel efetivo do participante dentro da sala. */
export const ParticipantRoleSchema = z.enum(["admin", "member"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

/**
 * Identificação do participante enviada em toda rota autenticada do Hub.
 * - `secret_token` + `display_name`: usuário autenticado (pode ser admin).
 * - apenas `display_name`: convidado sem conta (identidade gerada pelo Hub).
 */
export const ParticipantCredentialsSchema = z.object({
  display_name: DisplayNameSchema,
  secret_token: SecretTokenSchema.optional(),
});
export type ParticipantCredentials = z.infer<typeof ParticipantCredentialsSchema>;

/** Credenciais exigidas pelas rotas administrativas (moderação e rotação de código). */
export const AdminCredentialsSchema = z.object({
  secret_token: SecretTokenSchema,
});
export type AdminCredentials = z.infer<typeof AdminCredentialsSchema>;

const AccountNicknameSchema = z.string().trim().min(2).max(32);
const AccountPasswordSchema = z.string().min(8).max(128);
export const RecoveryCodeSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/);
export type RecoveryCode = z.infer<typeof RecoveryCodeSchema>;

export const RegisterAccountRequestSchema = z.object({
  nickname: AccountNicknameSchema,
  password: AccountPasswordSchema,
  password_confirmation: AccountPasswordSchema,
}).refine((value) => value.password === value.password_confirmation, {
  path: ["password_confirmation"],
  message: "password_confirmation_mismatch",
});
export type RegisterAccountRequest = z.infer<typeof RegisterAccountRequestSchema>;

export const LoginAccountRequestSchema = z.object({
  nickname: AccountNicknameSchema,
  password: AccountPasswordSchema,
});
export type LoginAccountRequest = z.infer<typeof LoginAccountRequestSchema>;

export const RecoverAccountRequestSchema = z.object({
  nickname: AccountNicknameSchema,
  recovery_code: RecoveryCodeSchema,
  new_password: AccountPasswordSchema,
  new_password_confirmation: AccountPasswordSchema,
}).refine((value) => value.new_password === value.new_password_confirmation, {
  path: ["new_password_confirmation"],
  message: "password_confirmation_mismatch",
});
export type RecoverAccountRequest = z.infer<typeof RecoverAccountRequestSchema>;

export const AcknowledgeRecoveryCodeRequestSchema = z.object({
  recovery_code: RecoveryCodeSchema,
});
export type AcknowledgeRecoveryCodeRequest = z.infer<typeof AcknowledgeRecoveryCodeRequestSchema>;

export const AccountUserSchema = z.object({
  id: z.string().min(1),
  display_name: DisplayNameSchema,
});
export type AccountUser = z.infer<typeof AccountUserSchema>;

export const AccountResponseSchema = z.object({
  secret_token: SecretTokenSchema,
  user: AccountUserSchema,
});
export type AccountResponse = z.infer<typeof AccountResponseSchema>;

export const AccountRegistrationResponseSchema = AccountResponseSchema.extend({
  recovery_code: RecoveryCodeSchema,
});
export type AccountRegistrationResponse = z.infer<typeof AccountRegistrationResponseSchema>;

export const AccountLoginResponseSchema = AccountResponseSchema.extend({
  recovery_code: RecoveryCodeSchema.optional(),
});
export type AccountLoginResponse = z.infer<typeof AccountLoginResponseSchema>;

export const AccountRecoveryResponseSchema = AccountResponseSchema.extend({
  recovery_code: RecoveryCodeSchema,
});
export type AccountRecoveryResponse = z.infer<typeof AccountRecoveryResponseSchema>;

export const RecoveryAcknowledgmentResponseSchema = z.object({ acknowledged: z.literal(true) });
export type RecoveryAcknowledgmentResponse = z.infer<typeof RecoveryAcknowledgmentResponseSchema>;

export const AccountUserResponseSchema = z.object({
  user: AccountUserSchema,
  recovery_code: RecoveryCodeSchema.optional(),
});
export type AccountUserResponse = z.infer<typeof AccountUserResponseSchema>;

export { IdentitySchema };
