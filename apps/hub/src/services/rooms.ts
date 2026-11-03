/**
 * Regras de negócio de Sala Fixa (`rooms`).
 *
 * Modelo de acesso (DEC-17):
 * - `public`:  entrada por slug/link **ou** código de acesso temporário.
 * - `private`: slug/código **e** senha.
 * - códigos temporários são rotacionáveis, com TTL e opção de uso único.
 */
import type {
  CreateRoomRequest,
  EnterRoomRequest,
  ParticipantRole,
  RoomSummary,
} from "@spectra/contracts";
import { ACCESS_CODE_DEFAULT_TTL_SECONDS } from "@spectra/contracts";
import type { Db } from "../db.js";
import { fromInt, toInt } from "../db.js";
import {
  AccessCodeHasher,
  generateAccessCode,
  generateRoomCode,
  generateSecretToken,
  guestIdentity,
  hashPassword,
  hashSecretToken,
  newId,
  userIdentity,
  verifyPassword,
} from "../crypto.js";
import type { HubEnv } from "../env.js";

export type RoomErrorCode =
  | "room_not_found"
  | "slug_taken"
  | "not_admin"
  | "password_required"
  | "invalid_password"
  | "invalid_access_code"
  | "access_code_expired"
  | "banned";

export class RoomServiceError extends Error {
  constructor(public readonly code: RoomErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RoomServiceError";
  }
}

export interface RoomRow {
  id: string;
  room_code: string;
  slug: string;
  name: string;
  visibility: "public" | "private";
  password_hash: string | null;
  access_code_hash: string | null;
  access_code_expires_at: number | null;
  access_code_single_use: number;
  owner_user_id: string;
  layout_preset: "standard" | "rpg_theater";
  addon_control_mode: "democratic" | "host_only";
  is_active: number;
  created_at: number;
  owner_display_name: string;
}

export interface IssuedAccessCode {
  access_code: string;
  expires_at: number;
  single_use: boolean;
}

export interface EntryOutcome {
  room: RoomRow;
  userId: string | null;
  identity: string;
  display_name: string;
  role: ParticipantRole;
  can_share_screen: boolean;
  /** true quando a entrada foi feita por convidado sem Chave de Criador. */
  is_guest: boolean;
}

export class RoomService {
  /** HMAC determinístico sobre o segredo do Hub (DEC-09). */
  private readonly tokens: AccessCodeHasher;

  constructor(
    private readonly db: Db,
    private readonly env: HubEnv,
  ) {
    this.tokens = new AccessCodeHasher(env.livekitApiSecret);
  }

  /** Hashers expostos para testes de rotação e verificação de chave. */
  get accessHasher(): AccessCodeHasher {
    return this.tokens;
  }

  private generateAvailableRoomCode(): string {
    let roomCode = generateRoomCode();
    while (this.db.raw.prepare("SELECT 1 FROM rooms WHERE room_code = ?").get(roomCode) !== undefined) {
      roomCode = generateRoomCode();
    }
    return roomCode;
  }

  private selectRoom(slug: string): RoomRow | undefined {
    return this.db.raw
      .prepare(
        `SELECT r.*, u.display_name AS owner_display_name
           FROM rooms r
           JOIN users u ON u.id = r.owner_user_id
          WHERE r.slug = ?`,
      )
      .get(slug) as RoomRow | undefined;
  }

  private counters(roomId: string): { participants: number; active_streams: number } {
    const row = this.db.raw
      .prepare(
        `SELECT
            (SELECT COUNT(*) FROM room_permissions WHERE room_id = ? AND is_banned = 0) AS members,
            (SELECT COUNT(*) FROM guest_sessions WHERE room_id = ? AND is_banned = 0) AS guests`,
      )
      .get(roomId, roomId) as { members: number; guests: number };
    return { participants: row.members + row.guests, active_streams: 0 };
  }

  /** Resumo público consumido pelo Lobby e pelo cabeçalho da sala. */
  toSummary(row: RoomRow, counters?: { participants: number; active_streams: number }): RoomSummary {
    const counts = counters ?? this.counters(row.id);
    return {
      id: row.id,
      room_code: row.room_code,
      slug: row.slug,
      name: row.name,
      visibility: row.visibility,
      owner_display_name: row.owner_display_name,
      layout_preset: row.layout_preset,
      addon_control_mode: row.addon_control_mode,
      is_active: fromInt(row.is_active),
      active_streams: counts.active_streams,
      participants: counts.participants,
      addons_enabled: [],
      created_at: row.created_at,
    };
  }

  roomBySlug(slug: string): RoomRow | undefined {
    return this.selectRoom(slug);
  }

  roomByCode(roomCode: string): RoomRow | undefined {
    return this.db.raw
      .prepare(
        `SELECT r.*, u.display_name AS owner_display_name
           FROM rooms r
           JOIN users u ON u.id = r.owner_user_id
          WHERE r.room_code = ?`,
      )
      .get(roomCode.toUpperCase()) as RoomRow | undefined;
  }

  listSummaries(activeOnly = false, secretToken?: string): RoomSummary[] {
    const rows = this.db.raw
      .prepare(
        `SELECT r.*, u.display_name AS owner_display_name
           FROM rooms r
           JOIN users u ON u.id = r.owner_user_id
          ORDER BY r.created_at DESC`,
      )
      .all() as RoomRow[];
    const userId = secretToken === undefined
      ? undefined
      : (
          this.db.raw
            .prepare("SELECT id FROM users WHERE secret_token_hash = ? ORDER BY created_at ASC LIMIT 1")
            .get(hashSecretToken(secretToken, this.env.livekitApiSecret)) as { id: string } | undefined
        )?.id;
    const visible = rows.filter((row) => {
      if (activeOnly && row.is_active !== 1) return false;
      if (userId === undefined) return false;
      if (row.owner_user_id === userId) return true;
      return this.db.raw
        .prepare("SELECT 1 FROM room_permissions WHERE room_id = ? AND user_id = ? AND is_banned = 0")
        .get(row.id, userId) !== undefined;
    });
    return visible.map((row) => this.toSummary(row));
  }

  /** Resumo público de uma sala por slug (`undefined` quando a sala não existe). */
  summaryFor(slug: string, secretToken?: string): RoomSummary | undefined {
    const room = this.selectRoom(slug);
    if (room === undefined) return undefined;
    if (room.visibility === "private") {
      if (secretToken === undefined) return undefined;
      const user = this.db.raw
        .prepare("SELECT id FROM users WHERE secret_token_hash = ? ORDER BY created_at ASC LIMIT 1")
        .get(hashSecretToken(secretToken, this.env.livekitApiSecret)) as { id: string } | undefined;
      if (user === undefined) return undefined;
      const isMember =
        room.owner_user_id === user.id ||
        this.db.raw
          .prepare("SELECT 1 FROM room_permissions WHERE room_id = ? AND user_id = ? AND is_banned = 0")
          .get(room.id, user.id) !== undefined;
      if (!isMember) return undefined;
    }
    return this.toSummary(room);
  }

  /** Marca a sessão LiveKit da sala como ativa (criada sob demanda). */
  markActive(slug: string, active: boolean): void {
    const room = this.selectRoom(slug);
    if (room === undefined) return;
    this.db.raw.prepare("UPDATE rooms SET is_active = ? WHERE id = ?").run(toInt(active), room.id);
  }


  /** Cria a Sala Fixa permanente e o usuário criador (Chave de Criador). */
  async createRoom(
    input: CreateRoomRequest,
  ): Promise<{ room: RoomRow; secret_token: string }> {
    const now = Date.now();
    const roomId = newId();
    const roomCode = this.generateAvailableRoomCode();
    const slug = input.slug ?? `room-${roomCode.toLowerCase()}`;
    const secretToken = input.secret_token ?? generateSecretToken();
    const secretTokenHash = hashSecretToken(secretToken, this.env.livekitApiSecret);
    const passwordHash =
      input.visibility === "private" && input.password !== undefined
        ? await hashPassword(input.password)
        : null;

    const run = this.db.raw.transaction(() => {
      if (this.selectRoom(slug) !== undefined) throw new RoomServiceError("slug_taken");

      const existingUser = this.db.raw
        .prepare("SELECT id FROM users WHERE secret_token_hash = ? ORDER BY created_at ASC LIMIT 1")
        .get(secretTokenHash) as { id: string } | undefined;
      const userId = existingUser?.id ?? newId();

      if (existingUser === undefined) {
        this.db.raw
          .prepare(
            `INSERT INTO users (id, identity, display_name, secret_token_hash, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(userId, userIdentity(userId), input.display_name, secretTokenHash, now);
      } else {
        this.db.raw.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(input.display_name, userId);
      }

      this.db.raw
        .prepare(
          `INSERT INTO rooms (
              id, slug, room_code, name, visibility, password_hash, owner_user_id,
              layout_preset, addon_control_mode, is_active, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          roomId,
          slug,
          roomCode,
          input.name,
          input.visibility,
          passwordHash,
          userId,
          input.layout_preset,
          input.addon_control_mode,
          now,
        );

      this.db.raw
        .prepare(
          `INSERT INTO room_permissions (room_id, user_id, role, can_share_screen, is_banned, joined_at)
           VALUES (?, ?, 'admin', 1, 0, ?)
           ON CONFLICT (room_id, user_id) DO UPDATE SET role = 'admin', is_banned = 0`,
        )
        .run(roomId, userId, now);
    });
    run();

    const created = this.selectRoom(slug);
    if (created === undefined) throw new RoomServiceError("room_not_found");
    return { room: created, secret_token: secretToken };
  }

  /** Resolve a posse da sala pela Chave de Criador Persistente. */
  resolveOwner(slug: string, secretToken: string): RoomRow | undefined {
    const room = this.selectRoom(slug);
    if (room === undefined) return undefined;
    const candidate = hashSecretToken(secretToken, this.env.livekitApiSecret);
    const row = this.db.raw
      .prepare("SELECT id FROM users WHERE secret_token_hash = ?")
      .get(candidate) as { id: string } | undefined;
    if (row === undefined) return undefined;
    return room.owner_user_id === row.id ? room : undefined;
  }

  isOwner(slug: string, secretToken: string): boolean {
    return this.resolveOwner(slug, secretToken) !== undefined;
  }

  /** Remove a sala fixa e seus registros associados apenas para seu proprietário. */
  deleteOwnedRoom(slug: string, secretToken: string): void {
    if (this.resolveOwner(slug, secretToken) === undefined) {
      throw new RoomServiceError("not_admin");
    }
    this.db.raw.prepare("DELETE FROM rooms WHERE slug = ?").run(slug);
  }

  /**
   * Resolve o acesso conforme DEC-17 e devolve identidade + permissões.
   * Ordem de decisão: código temporário válido > Chave de Criador > senha > slug.
   */
  async enterRoom(slug: string, request: EnterRoomRequest): Promise<EntryOutcome> {
    const room = this.selectRoom(slug);
    if (room === undefined) throw new RoomServiceError("room_not_found");

    const now = Date.now();
    const credentials = request.credentials;

    let accessCodeValid = false;
    if (request.method === "access_code") {
      if (room.access_code_hash === null) throw new RoomServiceError("invalid_access_code");
      if (room.access_code_expires_at !== null && room.access_code_expires_at <= now) {
        throw new RoomServiceError("access_code_expired");
      }
      accessCodeValid = this.accessHasher.matches(request.access_code, room.access_code_hash);
      if (!accessCodeValid) throw new RoomServiceError("invalid_access_code");
    }

    // Slug puro só basta para salas públicas (DEC-17); quando a sala é privada,
    // a Chave de Criador Persistente ou a senha/code válidos são exigidos.
    if (request.method === "slug" && room.visibility !== "public" && credentials.secret_token === undefined) {
      throw new RoomServiceError("password_required");
    }
    if (request.method === "password") await this.verifyRoomPassword(room, request);

    // 1) Participante com Chave de Criador Persistente.
    if (credentials.secret_token !== undefined) {
      const owned = this.resolveOwner(slug, credentials.secret_token);
      if (owned !== undefined && owned.id === room.id) {
        const permission = this.db.raw
          .prepare(
            "SELECT role, can_share_screen, is_banned FROM room_permissions WHERE room_id = ? AND user_id = ?",
          )
          .get(room.id, owned.owner_user_id) as
          | { role: ParticipantRole; can_share_screen: number; is_banned: number }
          | undefined;

        if (permission !== undefined && permission.is_banned === 1) {
          throw new RoomServiceError("banned");
        }

        this.requirePrivateCredential(room, request, accessCodeValid, true);

        return {
          room,
          userId: owned.owner_user_id,
          identity: userIdentity(owned.owner_user_id),
          display_name: credentials.display_name,
          role: permission?.role ?? "admin",
          can_share_screen: permission === undefined ? true : fromInt(permission.can_share_screen),
          is_guest: false,
        };
      }

      // Chave válida de outro usuário que já é membro desta sala.
      const candidate = hashSecretToken(credentials.secret_token, this.env.livekitApiSecret);
      const userRow = this.db.raw
        .prepare("SELECT id FROM users WHERE secret_token_hash = ?")
        .get(candidate) as { id: string } | undefined;
      if (userRow !== undefined) {
        const permission = this.db.raw
          .prepare(
            "SELECT role, can_share_screen, is_banned FROM room_permissions WHERE room_id = ? AND user_id = ?",
          )
          .get(room.id, userRow.id) as
          | { role: ParticipantRole; can_share_screen: number; is_banned: number }
          | undefined;
        if (permission?.is_banned === 1) throw new RoomServiceError("banned");
        if (userRow !== undefined) {
          this.requirePrivateCredential(room, request, accessCodeValid, permission !== undefined);
          if (permission === undefined) {
            this.db.raw
              .prepare(
                `INSERT INTO room_permissions (room_id, user_id, role, can_share_screen, is_banned, joined_at)
                 VALUES (?, ?, 'member', 1, 0, ?)`,
              )
              .run(room.id, userRow.id, now);
          }
          return {
            room,
            userId: userRow.id,
            identity: userIdentity(userRow.id),
            display_name: credentials.display_name,
            role: permission?.role ?? "member",
            can_share_screen: permission === undefined ? true : fromInt(permission.can_share_screen),
            is_guest: false,
          };
        }
      }
    }

    // 2) Convidado sem conta (`guest_sessions`).
    this.requirePrivateCredential(room, request, accessCodeValid);

    const identity = guestIdentity(slug);
    this.db.raw
      .prepare(
        `INSERT INTO guest_sessions (id, room_id, identity, display_name, can_share_screen, is_banned, created_at)
         VALUES (?, ?, ?, ?, 1, 0, ?)`,
      )
      .run(newId(), room.id, identity, credentials.display_name, now);

    if (accessCodeValid && fromInt(room.access_code_single_use)) {
      this.db.raw
        .prepare("UPDATE rooms SET access_code_hash = NULL, access_code_expires_at = NULL WHERE id = ?")
        .run(room.id);
    }

    return {
      room,
      userId: null,
      identity,
      display_name: credentials.display_name,
      role: "member",
      can_share_screen: true,
      is_guest: true,
    };
  }

  /**
   * Salas `private` exigem senha (ou código vigente); slug puro só basta em
   * salas `public` (DEC-17).
   */
  private requirePrivateCredential(
    room: RoomRow,
    request: EnterRoomRequest,
    accessCodeValid: boolean,
    trustedIdentity = false,
  ): void {
    if (room.visibility !== "private") return;
    if (accessCodeValid) return;
    if (trustedIdentity) return;
    if (request.method === "password") return;
    throw new RoomServiceError("password_required");
  }

  /** Confirma a senha de uma sala `private` (assíncrona por causa do scrypt). */
  async verifyRoomPassword(room: RoomRow, request: EnterRoomRequest): Promise<void> {
    if (request.method !== "password") return;
    const ok = await verifyPassword(request.password, room.password_hash);
    if (!ok) throw new RoomServiceError("invalid_password");
  }

  /** Emite/rotaciona o código de acesso temporário da sala (DEC-17). */
  issueAccessCode(slug: string, ttlSeconds?: number, singleUse = false): IssuedAccessCode {
    const room = this.selectRoom(slug);
    if (room === undefined) throw new RoomServiceError("room_not_found");
    const ttl =
      ttlSeconds ?? this.env.accessCodeTtlSeconds ?? ACCESS_CODE_DEFAULT_TTL_SECONDS;
    const accessCode = generateAccessCode();
    const expiresAt = Date.now() + ttl * 1000;
    this.db.raw
      .prepare(
        `UPDATE rooms
            SET access_code_hash = ?, access_code_expires_at = ?, access_code_single_use = ?
          WHERE id = ?`,
      )
      .run(this.accessHasher.hash(accessCode), expiresAt, toInt(singleUse), room.id);
    return { access_code: accessCode, expires_at: expiresAt, single_use: singleUse };
  }

  /** Valida um código candidato contra a sala alvo — comparação O(1) por sala. */
  validateAccessCode(slug: string, accessCode: string): boolean {
    const room = this.selectRoom(slug);
    if (room === undefined) return false;
    if (room.access_code_expires_at !== null && room.access_code_expires_at <= Date.now()) {
      return false;
    }
    return this.accessHasher.matches(accessCode, room.access_code_hash);
  }

  /** Permissão persistida de um usuário em uma sala (`room_permissions`). */
  permissionFor(
    roomId: string,
    userId: string,
  ): { role: ParticipantRole; can_share_screen: boolean; is_banned: boolean } | undefined {
    const row = this.db.raw
      .prepare(
        "SELECT role, can_share_screen, is_banned FROM room_permissions WHERE room_id = ? AND user_id = ?",
      )
      .get(roomId, userId) as
      | { role: ParticipantRole; can_share_screen: number; is_banned: number }
      | undefined;
    if (row === undefined) return undefined;
    return {
      role: row.role,
      can_share_screen: fromInt(row.can_share_screen),
      is_banned: fromInt(row.is_banned),
    };
  }

  /** Registra a sessão LiveKit ativa de um convidado (para moderação/kick). */
  registerGuest(roomId: string, identity: string, displayName: string): void {
    this.db.raw
      .prepare(
        `INSERT INTO guest_sessions (id, room_id, identity, display_name, can_share_screen, is_banned, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?)
         ON CONFLICT (identity) DO NOTHING`,
      )
      .run(newId(), roomId, identity, displayName, Date.now());
  }
}
