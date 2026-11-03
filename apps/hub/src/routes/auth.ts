import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  AccountLoginResponseSchema,
  AccountRecoveryResponseSchema,
  AccountRegistrationResponseSchema,
  AccountUserResponseSchema,
  AcknowledgeRecoveryCodeRequestSchema,
  LoginAccountRequestSchema,
  RecoverAccountRequestSchema,
  RegisterAccountRequestSchema,
  RecoveryAcknowledgmentResponseSchema,
  SecretTokenSchema,
} from "@spectra/contracts";
import { AccountError, AccountService } from "../services/accounts.js";
import type { ZodRouteSchema } from "./zod-compiler.js";

export interface AuthRoutesOptions {
  accounts: AccountService;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app: FastifyInstance,
  { accounts },
) => {
  app.post(
    "/auth/register",
    { schema: { body: RegisterAccountRequestSchema } satisfies ZodRouteSchema },
    async (request, reply: FastifyReply) => {
      const body = RegisterAccountRequestSchema.parse(request.body);
      try {
        return AccountRegistrationResponseSchema.parse(await accounts.register(body.nickname, body.password));
      } catch (error) {
        if (error instanceof AccountError) {
          return reply.status(error.code === "username_taken" ? 409 : 400).send({
            error: error.code === "username_taken" ? "Esse apelido já está em uso." : error.code,
            code: error.code,
          });
        }
        throw error;
      }
    },
  );

  app.post(
    "/auth/login",
    { schema: { body: LoginAccountRequestSchema } satisfies ZodRouteSchema },
    async (request, reply: FastifyReply) => {
      const body = LoginAccountRequestSchema.parse(request.body);
      try {
        return AccountLoginResponseSchema.parse(await accounts.login(body.nickname, body.password));
      } catch (error) {
        if (error instanceof AccountError) {
          return reply.status(401).send({ error: "Apelido ou senha incorretos.", code: error.code });
        }
        throw error;
      }
    },
  );

  app.post(
    "/auth/recover",
    { schema: { body: RecoverAccountRequestSchema } satisfies ZodRouteSchema },
    async (request, reply: FastifyReply) => {
      const body = RecoverAccountRequestSchema.parse(request.body);
      try {
        return AccountRecoveryResponseSchema.parse(
          await accounts.recoverPassword(body.nickname, body.recovery_code, body.new_password),
        );
      } catch (error) {
        if (error instanceof AccountError) {
          return reply.status(401).send({
            error: "Apelido ou código de recuperação inválido.",
            code: "invalid_recovery_code",
          });
        }
        throw error;
      }
    },
  );

  app.post(
    "/auth/recovery/acknowledge",
    { schema: { body: AcknowledgeRecoveryCodeRequestSchema } satisfies ZodRouteSchema },
    async (request, reply: FastifyReply) => {
      const header = request.headers["x-spectra-secret-token"];
      const token = Array.isArray(header) ? header[0] : header;
      const parsedToken = SecretTokenSchema.safeParse(token);
      if (!parsedToken.success || accounts.resolve(parsedToken.data) === undefined) {
        return reply.status(401).send({ error: "Faça login para continuar.", code: "invalid_credentials" });
      }
      const body = AcknowledgeRecoveryCodeRequestSchema.parse(request.body);
      if (!accounts.acknowledgeRecoveryCode(parsedToken.data, body.recovery_code)) {
        return reply.status(409).send({
          error: "O código mudou. Entre novamente para obter o código atual.",
          code: "recovery_code_changed",
        });
      }
      return RecoveryAcknowledgmentResponseSchema.parse({ acknowledged: true });
    },
  );

  app.get("/auth/me", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers["x-spectra-secret-token"];
    const token = Array.isArray(header) ? header[0] : header;
    const parsed = SecretTokenSchema.safeParse(token);
    if (!parsed.success) {
      return reply.status(401).send({ error: "Faça login para continuar.", code: "invalid_credentials" });
    }
    const account = accounts.resume(parsed.data);
    if (account === undefined) {
      return reply.status(401).send({ error: "Faça login para continuar.", code: "invalid_credentials" });
    }
    return AccountUserResponseSchema.parse(account);
  });
};
