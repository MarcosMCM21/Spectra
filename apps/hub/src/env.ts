/**
 * Configuração e validação do ambiente do Hub.
 * Falha rápida (fail-fast) em produção quando uma variável obrigatória estiver
 * ausente ou malformada — nunca sobe um Hub com permissões implícitas.
 */

/** Fonte de áudio permitida a bots de mídia (Soundpad / Bot de Música). */
const BOT_AUDIO_SOURCE = "screen_share_audio" as const;

export interface HubEnv {
  /** Ambiente da execução (development/test/production). */
  nodeEnv: string;
  /** Host de escuta do servidor Fastify. */
  host: string;
  /** Porta do Hub (:3001). */
  port: number;
  /** Chave de API do LiveKit self-hosted. */
  livekitApiKey: string;
  /** Segredo de API do LiveKit. */
  livekitApiSecret: string;
  /** URL pública do LiveKit (ws/wss) entregue ao cliente na entrada da sala. */
  livekitUrl: string;
  /** URL interna usada pelo `RoomServiceClient` para ações administrativas. */
  livekitInternalUrl: string;
  /** Caminho do banco SQLite (`:memory:` é aceito em testes). */
  databasePath: string;
  /** TTL padrão (segundos) dos códigos de acesso temporários (DEC-17). */
  accessCodeTtlSeconds: number;
  /** TTL (segundos) do JWT LiveKit emitido na entrada da sala. */
  roomTokenTtlSeconds: number;
  /** Grace period (segundos) antes de hibernar uma sala vazia. */
  roomGracePeriodSeconds: number;
  /** Habilita o logger do Fastify (desligado nos testes para manter a saída limpa). */
  logRequests: boolean;
}

export class HubEnvError extends Error {
  constructor(issues: string[]) {
    super(`ambiente_inválido: ${issues.join("; ")}`);
    this.name = "HubEnvError";
  }
}

function readString(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HubEnvError([`${name}_deve_ser_inteiro_positivo`]);
  }
  return parsed;
}

/**
 * Lê e valida `process.env`. Em produção a ausência de qualquer variável
 * obrigatória interrompe a inicialização do Hub.
 */
export function loadEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): HubEnv {
  const previous = process.env;
  if (Object.keys(overrides).length > 0) {
    Object.assign(process.env, overrides);
  }
  try {
    const issues: string[] = [];
    const isProduction = readString("NODE_ENV") === "production";

    const livekitApiKey = readString("LIVEKIT_API_KEY");
    const livekitApiSecret = readString("LIVEKIT_API_SECRET");
    if (isProduction && !livekitApiKey) issues.push("LIVEKIT_API_KEY_obrigatória");
    if (isProduction && !livekitApiSecret) issues.push("LIVEKIT_API_SECRET_obrigatória");

    const accessCodeTtlSeconds = readInteger("ACCESS_CODE_TTL_SECONDS", 3600);
    const roomTokenTtlSeconds = readInteger("ROOM_TOKEN_TTL_SECONDS", 3600);
    const roomGracePeriodSeconds = readInteger("ROOM_GRACE_PERIOD_SECONDS", 300);

    if (issues.length > 0) throw new HubEnvError(issues);

    return {
      nodeEnv: readString("NODE_ENV", "development") ?? "development",
      host: readString("HUB_HOST", "0.0.0.0") ?? "0.0.0.0",
      port: readInteger("HUB_PORT", 3001),
      livekitApiKey: livekitApiKey ?? "devkey",
      livekitApiSecret: livekitApiSecret ?? "devsecretdevsecretdevsecret123456",
      livekitUrl: readString("LIVEKIT_URL", "ws://localhost:7880") ?? "ws://localhost:7880",
      livekitInternalUrl:
        readString("LIVEKIT_INTERNAL_URL", readString("LIVEKIT_URL", "http://localhost:7880")) ??
        "http://localhost:7880",
      databasePath: readString("HUB_DB_PATH", "./data/hub.sqlite") ?? "./data/hub.sqlite",
      accessCodeTtlSeconds,
      roomTokenTtlSeconds,
      roomGracePeriodSeconds,
      logRequests: readString("HUB_LOG_REQUESTS") === "true",
    };
  } finally {
    if (Object.keys(overrides).length > 0) {
      // Restaura o ambiente original para não vazar estado entre testes.
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }
}

/** Fonte exclusiva dos bots de mídia: jamais `"microphone"` (DEC-01). */
export const BOT_ALLOWED_SOURCES: readonly [typeof BOT_AUDIO_SOURCE] = [BOT_AUDIO_SOURCE];
