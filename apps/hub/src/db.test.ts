import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { openDatabase } from "./db.js";

test("migração atribui códigos permanentes às salas existentes sem alterar seus slugs internos", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spectra-room-code-migration-"));
  const databasePath = path.join(directory, "hub.db");
  const legacy = new Database(databasePath);

  try {
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        identity TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        secret_token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        visibility TEXT NOT NULL,
        password_hash TEXT,
        access_code_hash TEXT,
        access_code_expires_at INTEGER,
        access_code_single_use INTEGER NOT NULL DEFAULT 0,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        layout_preset TEXT NOT NULL DEFAULT 'standard',
        addon_control_mode TEXT NOT NULL DEFAULT 'host_only',
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO users (id, identity, display_name, secret_token_hash, created_at)
      VALUES ('user-1', 'user-1', 'Criador', 'token-hash', 1);
      INSERT INTO rooms (id, slug, name, visibility, owner_user_id, created_at)
      VALUES
        ('room-1', 'sala-antiga', 'Sala Antiga', 'public', 'user-1', 1),
        ('room-2', 'mesa-antiga', 'Mesa Antiga', 'private', 'user-1', 2);
    `);
    legacy.close();

    const migrated = openDatabase(databasePath);
    try {
      const rooms = migrated.raw
        .prepare("SELECT slug, room_code FROM rooms ORDER BY slug")
        .all() as Array<{ slug: string; room_code: string }>;
      assert.deepEqual(rooms.map((room) => room.slug), ["mesa-antiga", "sala-antiga"]);
      assert.equal(rooms.every((room) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/.test(room.room_code)), true);
      assert.equal(new Set(rooms.map((room) => room.room_code)).size, rooms.length);
    } finally {
      migrated.close();
    }
  } finally {
    if (legacy.open) legacy.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
