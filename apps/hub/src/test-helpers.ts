/**
 * Utilidades compartilhadas pelos testes do Hub (Testing.md 2):
 * SQLite em memória, ambiente determinístico e mock do `RoomServiceClient`
 * (nenhum container pesado é subido em testes unitários).
 */
import type { RoomServiceClient } from "livekit-server-sdk";
import { openDatabase, type Db } from "./db.js";
import { loadEnv, type HubEnv } from "./env.js";

/** Ambiente de teste: SQLite em memória + segredo fixo (HMAC determinístico). */
export function testEnv(overrides: Partial<HubEnv> = {}): HubEnv {
  return {
    ...loadEnv({
      NODE_ENV: "test",
      LIVEKIT_API_KEY: "testapikey",
      LIVEKIT_API_SECRET: "testapisecret-testapisecret-0123456789",
      HUB_DB_PATH: ":memory:",
    }),
    databasePath: ":memory:",
    ...overrides,
  };
}

export function testDb(): Db {
  return openDatabase(":memory:");
}

export interface LiveKitCall {
  method: "updateParticipant" | "removeParticipant";
  roomName: string;
  identity: string;
  options?: Record<string, unknown>;
}

/** Mock do `RoomServiceClient`: registra chamadas e falha quando `fail = true`. */
export function createRoomServiceMock(options: { fail?: boolean; participants?: string[] } = {}): {
  calls: LiveKitCall[];
  roomService: RoomServiceClient;
} {
  const calls: LiveKitCall[] = [];
  const fail = options.fail === true;

  const updateParticipant = async (
    roomName: string,
    identity: string,
    _updates?: unknown,
    opts?: Record<string, unknown>,
  ): Promise<unknown> => {
    calls.push({ method: "updateParticipant", roomName, identity, options: opts });
    if (fail) throw new Error("room_not_found_on_livekit");
    return {};
  };

  const removeParticipant = async (roomName: string, identity: string): Promise<unknown> => {
    calls.push({ method: "removeParticipant", roomName, identity });
    if (fail) throw new Error("room_not_found_on_livekit");
    return {};
  };

  const roomService = {
    updateParticipant,
    removeParticipant,
    listParticipants: async () => (options.participants ?? []).map((identity) => ({ identity })),
  } as unknown as RoomServiceClient;
  return { calls, roomService };
}

/** Insere um membro autenticado comum (`member`) numa sala, para testes de moderação. */
export function insertMember(
  db: Db,
  input: { roomId: string; secretTokenHash: string; displayName?: string },
): { userId: string; identity: string } {
  const userId = `user-${Math.random().toString(36).slice(2, 10)}`;
  const identity = `u-${userId}`;
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO users (id, identity, display_name, secret_token_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, identity, input.displayName ?? "Membro", input.secretTokenHash, now);
  db.raw
    .prepare(
      `INSERT INTO room_permissions (room_id, user_id, role, can_share_screen, is_banned, joined_at)
       VALUES (?, ?, 'member', 1, 0, ?)`,
    )
    .run(input.roomId, userId, now);
  return { userId, identity };
}
