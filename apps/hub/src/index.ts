/**
 * @spectra/hub — servidor Fastify (:3001) das Salas Fixas.
 *
 * Bootstrap completo da Fase 1: ambiente validado (`loadEnv`), SQLite (`db.ts`),
 * camada LiveKit sem `microphone` (`livekit.ts`), serviços de regra de negócio
 * (`services/*`) e rotas HTTP montadas sob `/api` com validação Zod.
 *
 * Erros de contrato (Zod) retornam `{ error, code: "validation_failed", issues }`
 * (DEC-17); erros de negócio retornam `{ error, code }` com o status mapeado.
 *
 * Hard constraint: nenhum token emitido por este Hub habilita a fonte
 * "microphone" (DEC-01 — voz permanece 100% no Discord).
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { ValidationIssue } from "@spectra/contracts";
import { PACKAGES, ROOM_GRACE_PERIOD_SECONDS } from "@spectra/contracts";
import { openDatabase, type Db } from "./db.js";
import { loadEnv, type HubEnv } from "./env.js";
import { LiveKitService } from "./livekit.js";
import { ModerationService } from "./services/moderation.js";
import { RoomService } from "./services/rooms.js";
import { roomsRoutes } from "./routes/rooms.js";
import { authRoutes } from "./routes/auth.js";
import { routeValidationFailure, validationIssuesFromError, zodSchemaCompiler } from "./routes/zod-compiler.js";
import { AccountService } from "./services/accounts.js";

/** Dependências injetáveis: permite subir o Hub em testes com mocks. */
export interface HubDependencies {
  env?: HubEnv;
  db?: Db;
  livekit?: LiveKitService;
}

export interface HubHandle {
  app: any;
  env: HubEnv;
  db: Db;
  livekit: LiveKitService;
  rooms: RoomService;
  moderation: ModerationService;
  accounts: AccountService;
  /** Fecha o servidor e o banco (usado nos testes e no encerramento do processo). */
  close(): Promise<void>;
}

export function buildHub(dependencies: HubDependencies = {}): HubHandle {
  const env = dependencies.env ?? loadEnv();
  const db = dependencies.db ?? openDatabase(env.databasePath);
  const livekit = dependencies.livekit ?? new LiveKitService(env);
  const rooms = new RoomService(db, env);
  const moderation = new ModerationService(db, rooms, livekit);
  const accounts = new AccountService(db, env);

  const app = Fastify({
    logger: env.nodeEnv === "test" ? false : env.logRequests,
  } as any);

  app.setValidatorCompiler(zodSchemaCompiler as any);

  app.get("/healthz", async () => {
    return {
      status: "ok",
      service: "@spectra/hub",
      packages: PACKAGES,
      roomGracePeriodSeconds: env.roomGracePeriodSeconds ?? ROOM_GRACE_PERIOD_SECONDS,
    };
  });

  await_register_routes(app, { rooms, moderation, livekit, livekitUrl: env.livekitUrl });
  void app.register(async (instance: any) => {
    await instance.register(authRoutes, { accounts });
  }, { prefix: "/api" });

  // Contrato público único de erro (DEC-17): falhas do validador Zod e falhas
  // internas do Fastify são normalizadas para `{ error, code, issues }`.
  app.setErrorHandler((error, request, reply) => {
    const fromValidator = validationIssuesFromError(error as any);
    if (fromValidator !== null) {
      return reply.status(400).send(routeValidationFailure(fromValidator));
    }

    const attached = (request as any).validationError;
    if (attached !== undefined) {
      const issues = validationIssuesFromError(attached as any);
      if (issues !== null) {
        return reply.status(400).send(routeValidationFailure(issues));
      }
      return reply
        .status(400)
        .send(routeValidationFailure([{ keyword: "invalid", instancePath: "", schemaPath: "", params: {}, message: attached.message }]));
    }

    const failure = error as { statusCode?: number; code?: string; message?: string };
    if (typeof failure.code === "string" && failure.code.startsWith("FST_ERR_")) {
      return reply.status(failure.statusCode ?? 400).send({
        error: failure.message ?? "requisição_inválida",
        code: "invalid_request",
      });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "erro_interno", code: "internal_error" });
  });

  app.get("/error-demo", async () => {
    // Rota interna de diagnóstico: exercita o handler de validação do Hub.
    return routeValidationFailure([
      { keyword: "invalid", instancePath: "", schemaPath: "", params: {}, message: "payload_inválido" },
    ]);
  });

  const close = async (): Promise<void> => {
    await app.close();
    db.close();
  };

  return { app, env, db, livekit, rooms, moderation, accounts, close };
}

/** Montagem das rotas sob o prefixo `/api` (mesma URL usada pelo Web/Desktop). */
function await_register_routes(
  app: any,
  options: Parameters<typeof roomsRoutes>[1],
): void {
  void app.register(async (instance: any) => {
    await instance.register(roomsRoutes, options);
  }, { prefix: "/api" });
}

/** Sobe o Hub: usado apenas quando o módulo é executado como processo principal. */
export async function startHub(dependencies: HubDependencies = {}): Promise<HubHandle> {
  const hub = buildHub(dependencies);
  await hub.app.listen({ host: hub.env.host, port: hub.env.port });
  return hub;
}

const isMainModule = process.argv[1] !== undefined
  && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMainModule) {
  const env = loadEnv();
  const hub = buildHub({ env });
  hub.app.listen({ host: env.host, port: env.port }).catch((error: unknown) => {
    hub.app.log.error(error);
    process.exit(1);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void hub.close().then(() => process.exit(0));
    });
  }
}
