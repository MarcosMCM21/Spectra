/**
 * Regras de negócio de moderação em tempo real (Backend.md 3.2).
 * Toda ação exige a Chave de Criador Persistente e atualiza o SQLite antes de
 * refletir no LiveKit via `RoomServiceClient` (mockável nos testes).
 */
import type { ModerationAction, ParticipantState } from "@spectra/contracts";
import { TrackSource } from "@livekit/protocol";
import type { Db } from "../db.js";
import { fromInt } from "../db.js";
import { userIdentity } from "../crypto.js";
import type { LiveKitService } from "../livekit.js";
import type { RoomRow } from "./rooms.js";
import { RoomService } from "./rooms.js";

export class ModerationError extends Error {
  constructor(
    public readonly code: "not_admin" | "room_not_found" | "target_not_found",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ModerationError";
  }
}

interface TargetRow {
  kind: "user" | "guest";
  identity: string;
  display_name: string;
  user_id: string | null;
  role: "admin" | "member";
  can_share_screen: number;
  is_banned: number;
}

export interface ModerationOutcome {
  action: ModerationAction;
  target: ParticipantState;
  /** false quando persistido mas o alvo não estava na sessão LiveKit ativa. */
  livekit_applied: boolean;
}

export class ModerationService {
  constructor(
    private readonly db: Db,
    private readonly rooms: RoomService,
    private readonly livekit: LiveKitService,
  ) {}

  /** Identidade LiveKit do admin derivada da Chave de Criador Persistente. */
  private actorIdentityFor(slug: string, secretToken: string): { room: RoomRow; identity: string } {
    const room = this.rooms.resolveOwner(slug, secretToken);
    if (room === undefined) throw new ModerationError("room_not_found");
    return { room, identity: userIdentity(room.owner_user_id) };
  }

  /** Barreira de posse: o ator precisa ter papel `admin` na sala. */
  private assertAdmin(room: RoomRow, actorIdentity: string): void {
    if (!actorIdentity.startsWith("u-")) throw new ModerationError("not_admin");
    const permission = this.rooms.permissionFor(room.id, actorIdentity.slice(2));
    if (permission === undefined || permission.role !== "admin") {
      throw new ModerationError("not_admin");
    }
  }

  private findTarget(roomId: string, identity: string): TargetRow {
    const user = this.db.raw
      .prepare(
        `SELECT p.user_id, u.display_name, p.role, p.can_share_screen, p.is_banned
           FROM room_permissions p
           JOIN users u ON u.id = p.user_id
          WHERE p.room_id = ? AND (u.identity = ? OR ? LIKE u.identity || ':%')`,
      )
      .get(roomId, identity, identity) as
      | Omit<TargetRow, "kind" | "identity"> & { user_id: string }
      | undefined;
    if (user !== undefined) return { ...user, identity, kind: "user" };

    const guest = this.db.raw
      .prepare(
        `SELECT identity, display_name, can_share_screen, is_banned
           FROM guest_sessions WHERE room_id = ? AND identity = ?`,
      )
      .get(roomId, identity) as
      | { identity: string; display_name: string; can_share_screen: number; is_banned: number }
      | undefined;
    if (guest !== undefined) return { ...guest, kind: "guest", user_id: null, role: "member" };

    throw new ModerationError("target_not_found");
  }

  private async liveKitIdentitiesFor(
    roomName: string,
    target: TargetRow,
  ): Promise<{ identities: string[]; complete: boolean }> {
    if (target.kind !== "user" || target.user_id === null) {
      return { identities: [target.identity], complete: true };
    }
    const listParticipants = this.livekit.rooms.listParticipants;
    if (typeof listParticipants !== "function") {
      return { identities: [target.identity], complete: false };
    }

    try {
      const baseIdentity = userIdentity(target.user_id);
      const participants = await listParticipants.call(this.livekit.rooms, roomName);
      return {
        identities: [...new Set([
          target.identity,
          ...participants
            .map((participant) => participant.identity)
            .filter((identity) => identity.startsWith(`${baseIdentity}:`)),
        ])],
        complete: true,
      };
    } catch {
      return { identities: [target.identity], complete: false };
    }
  }

  private async applyLiveKitPermissionToTarget(
    roomName: string,
    target: TargetRow,
    canShareScreen: boolean,
  ): Promise<boolean> {
    const { identities, complete } = await this.liveKitIdentitiesFor(roomName, target);
    const results = await Promise.all(
      identities.map((identity) => this.applyLiveKitPermission(roomName, identity, canShareScreen)),
    );
    return complete && results.every(Boolean);
  }

  private async removeLiveKitTarget(roomName: string, target: TargetRow): Promise<boolean> {
    const { identities, complete } = await this.liveKitIdentitiesFor(roomName, target);
    const results = await Promise.all(
      identities.map((identity) => this.removeLiveKitParticipant(roomName, identity)),
    );
    return complete && results.every(Boolean);
  }

  private logEvent(
    roomId: string,
    actorIdentity: string,
    targetIdentity: string,
    action: ModerationAction,
  ): void {
    this.db.raw
      .prepare(
        `INSERT INTO moderation_events (id, room_id, actor_identity, target_identity, action, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(`evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, roomId, actorIdentity, targetIdentity, action, Date.now());
  }

  /** Aplica a permissão no LiveKit sem desconectar o participante. */
  private async applyLiveKitPermission(
    roomName: string,
    identity: string,
    canShareScreen: boolean,
  ): Promise<boolean> {
    try {
      await this.livekit.rooms.updateParticipant(roomName, identity, undefined, {
        canPublish: canShareScreen,
        canSubscribe: true,
        canPublishData: true,
        // Jamais "microphone" (DEC-01): apenas fontes de tela.
        canPublishSources: canShareScreen ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [],
      });
      return true;
    } catch {
      // Sala hibernada no LiveKit: a permissão persistida vale na próxima sessão.
      return false;
    }
  }

  private async removeLiveKitParticipant(roomName: string, identity: string): Promise<boolean> {
    try {
      await this.livekit.rooms.removeParticipant(roomName, identity);
      return true;
    } catch {
      return false;
    }
  }


  /** Executa uma ação administrativa e devolve o estado efetivo do alvo. */
  async apply(input: {
    slug: string;
    action: ModerationAction;
    targetIdentity: string;
    actorSecretToken: string;
  }): Promise<ModerationOutcome> {
    const { room, identity: actorIdentity } = this.actorIdentityFor(input.slug, input.actorSecretToken);
    this.assertAdmin(room, actorIdentity);

    const target = this.findTarget(room.id, input.targetIdentity);
    if (target.user_id === room.owner_user_id && input.action !== "transfer_host") {
      throw new ModerationError("not_admin", "ação administrativa não pode recair sobre o próprio admin");
    }

    const setFlag = (column: "can_share_screen" | "is_banned", value: 0 | 1): void => {
      if (target.kind === "user" && target.user_id !== null) {
        this.db.raw
          .prepare(`UPDATE room_permissions SET ${column} = ? WHERE room_id = ? AND user_id = ?`)
          .run(value, room.id, target.user_id);
      } else {
        this.db.raw
          .prepare(`UPDATE guest_sessions SET ${column} = ? WHERE room_id = ? AND identity = ?`)
          .run(value, room.id, target.identity);
      }
    };

    let livekitApplied = false;

    switch (input.action) {
      case "end_stream": {
        // Revogar e re-conceder a publicação força o unpublish da tela sem
        // desconectar o membro (Backend.md 3.2).
        const { identities, complete } = await this.liveKitIdentitiesFor(room.slug, target);
        const revoked = await Promise.all(
          identities.map((identity) => this.applyLiveKitPermission(room.slug, identity, false)),
        );
        const restored = await Promise.all(
          identities.map((identity) =>
            this.applyLiveKitPermission(room.slug, identity, fromInt(target.can_share_screen)),
          ),
        );
        livekitApplied = complete && revoked.every(Boolean) && restored.every(Boolean);
        break;
      }
      case "block_screen_share": {
        setFlag("can_share_screen", 0);
        livekitApplied = await this.applyLiveKitPermissionToTarget(room.slug, target, false);
        break;
      }
      case "allow_screen_share": {
        setFlag("can_share_screen", 1);
        livekitApplied = await this.applyLiveKitPermissionToTarget(room.slug, target, true);
        break;
      }
      case "kick": {
        livekitApplied = await this.removeLiveKitTarget(room.slug, target);
        break;
      }
      case "ban": {
        setFlag("is_banned", 1);
        livekitApplied = await this.removeLiveKitTarget(room.slug, target);
        break;
      }
      case "unban": {
        setFlag("is_banned", 0);
        break;
      }
      case "transfer_host": {
        if (target.kind !== "user" || target.user_id === null) throw new ModerationError("target_not_found");
        const run = this.db.raw.transaction(() => {
          this.db.raw
            .prepare("UPDATE room_permissions SET role = 'member' WHERE room_id = ? AND user_id = ?")
            .run(room.id, room.owner_user_id);
          this.db.raw
            .prepare(
              "UPDATE room_permissions SET role = 'admin', can_share_screen = 1 WHERE room_id = ? AND user_id = ?",
            )
            .run(room.id, target.user_id);
          this.db.raw.prepare("UPDATE rooms SET owner_user_id = ? WHERE id = ?").run(target.user_id, room.id);
        });
        run();
        break;
      }
    }

    const updated = this.findTarget(room.id, target.identity);
    this.logEvent(room.id, actorIdentity, target.identity, input.action);

    return {
      action: input.action,
      target: {
        identity: updated.identity,
        display_name: updated.display_name,
        role: updated.role,
        can_share_screen: fromInt(updated.can_share_screen),
        is_banned: fromInt(updated.is_banned),
      },
      livekit_applied: livekitApplied,
    };
  }
}
