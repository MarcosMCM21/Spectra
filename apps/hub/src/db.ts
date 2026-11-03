/**
 * Camada de persistência do Hub (`better-sqlite3`).
 *
 * Salas Fixas são permanentes no SQLite; a sessão de mídia no LiveKit é efêmera.
 * `:memory:` é aceito para os testes de regra de negócio (Testing.md 2).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { generateRoomCode } from "./crypto.js";

/** Esquema declarativo do Hub (DEC-17: visibilidade, senha e código temporário). */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  identity              TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  secret_token_hash     TEXT NOT NULL,
  username_key          TEXT,
  password_hash         TEXT,
  recovery_code_hash    TEXT,
  recovery_code_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  room_code             TEXT,
  name                  TEXT NOT NULL,
  visibility            TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  password_hash         TEXT,
  access_code_hash      TEXT,
  access_code_expires_at INTEGER,
  access_code_single_use INTEGER NOT NULL DEFAULT 0,
  owner_user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout_preset         TEXT NOT NULL DEFAULT 'standard',
  addon_control_mode    TEXT NOT NULL DEFAULT 'host_only',
  is_active             INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_slug ON rooms (slug);

CREATE TABLE IF NOT EXISTS room_permissions (
  room_id               TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  can_share_screen      INTEGER NOT NULL DEFAULT 1,
  is_banned             INTEGER NOT NULL DEFAULT 0,
  joined_at             INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id                    TEXT PRIMARY KEY,
  room_id               TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  identity              TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  can_share_screen      INTEGER NOT NULL DEFAULT 1,
  is_banned             INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_events (
  id                    TEXT PRIMARY KEY,
  room_id               TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_identity        TEXT NOT NULL,
  target_identity       TEXT NOT NULL,
  action                TEXT NOT NULL,
  created_at            INTEGER NOT NULL
);
`;

export interface Db {
  raw: Database.Database;
  close(): void;
}

/** Abre (ou cria) o banco do Hub aplicando o schema idempotente. */
export function openDatabase(databasePath: string): Db {
  const isMemory = databasePath === ":memory:";
  if (!isMemory) {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const raw = new Database(databasePath);
  raw.exec(SCHEMA_SQL);
  const userColumns = raw.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "username_key")) {
    raw.exec("ALTER TABLE users ADD COLUMN username_key TEXT");
  }
  if (!userColumns.some((column) => column.name === "password_hash")) {
    raw.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
  }
  if (!userColumns.some((column) => column.name === "recovery_code_hash")) {
    raw.exec("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT");
  }
  if (!userColumns.some((column) => column.name === "recovery_code_confirmed")) {
    raw.exec("ALTER TABLE users ADD COLUMN recovery_code_confirmed INTEGER NOT NULL DEFAULT 0");
  }
  const roomColumns = raw.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>;
  if (!roomColumns.some((column) => column.name === "room_code")) {
    raw.exec("ALTER TABLE rooms ADD COLUMN room_code TEXT");
  }
  const missingRoomCodes = raw.prepare("SELECT id FROM rooms WHERE room_code IS NULL").all() as Array<{ id: string }>;
  const existingRoomCodes = new Set(
    (raw.prepare("SELECT room_code FROM rooms WHERE room_code IS NOT NULL").all() as Array<{ room_code: string }>)
      .map((row) => row.room_code),
  );
  const assignRoomCode = raw.prepare("UPDATE rooms SET room_code = ? WHERE id = ?");
  for (const room of missingRoomCodes) {
    let roomCode = generateRoomCode();
    while (existingRoomCodes.has(roomCode)) roomCode = generateRoomCode();
    assignRoomCode.run(roomCode, room.id);
    existingRoomCodes.add(roomCode);
  }
  raw.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_room_code ON rooms (room_code)");
  raw.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_key ON users (username_key) WHERE username_key IS NOT NULL");
  return {
    raw,
    close: () => raw.close(),
  };
}

/** Conversor booleano <-> INTEGER do SQLite. */
export const toInt = (value: boolean): 0 | 1 => (value ? 1 : 0);
export const fromInt = (value: number | null | undefined): boolean => value === 1;
