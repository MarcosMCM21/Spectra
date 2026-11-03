/**
 * Rotas HTTP de Sala Fixa (`/api/rooms*`).
 * Corpo, parâmetros e respostas são validados por Zod de `@spectra/contracts`.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { TrackSource } from "@livekit/protocol";
import {
  CreateRoomRequestSchema,
  EnterRoomRequestSchema,
  DeleteRoomRequestSchema,
  DeleteRoomResponseSchema,
  IssueAccessCodeRequestSchema,
  ModerationRequestSchema,
  RoomCodeSchema,
  RoomCodeLookupResponseSchema,
  RoomSlugSchema,
} from "@spectra/contracts";
import { livekitSessionIdentity, userIdentity } from "../crypto.js";
import type { LiveKitService } from "../livekit.js";
import { ModerationError, ModerationService } from "../services/moderation.js";
import { RoomService, RoomServiceError } from "../services/rooms.js";
import type { ZodRouteSchema } from "./zod-compiler.js";

export interface RoomsRoutesOptions {
  rooms: RoomService;
  moderation: ModerationService;
  livekit: LiveKitService;
  livekitUrl: string;
}

const slugParams = { params: RoomSlugSchema } satisfies ZodRouteSchema;

const ERROR_STATUS: Record<string, number> = {
  room_not_found: 404,
  target_not_found: 404,
  slug_taken: 409,
  banned: 403,
  not_admin: 403,
  password_required: 401,
  invalid_password: 401,
  invalid_access_code: 401,
  access_code_expired: 401,
};

function replyFor(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof RoomServiceError || error instanceof ModerationError) {
    const status = ERROR_STATUS[error.code] ?? 400;
    return { status, body: { error: error.message, code: error.code } };
  }

  throw error;
}

const ACTIVE_ONLY_QUERY = z.object({ active_only: z.boolean().optional() });

export const roomsRoutes: FastifyPluginAsync<RoomsRoutesOptions> = async (
  app: FastifyInstance,
  { rooms, moderation, livekit, livekitUrl },
) => {
  app.get("/rooms", async (request, reply) => {
    const parsed = ACTIVE_ONLY_QUERY.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "query inválida", code: "invalid_request" });
    }
    const secretHeader = request.headers["x-spectra-secret-token"];
    const secretToken = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
    const summaries = rooms.listSummaries(false, secretToken);
    if (summaries.length === 0) return { rooms: [], presence_available: true };

    try {
      const activeRooms = await livekit.rooms.listRooms(summaries.map((room) => room.slug));
      const activeByName = new Map(activeRooms.map((room) => [room.name, room]));
      const liveSummaries = await Promise.all(
        summaries.map(async (summary) => {
          const activeRoom = activeByName.get(summary.slug);
          if (activeRoom === undefined) {
            return { ...summary, is_active: false, participants: 0, active_streams: 0 };
          }
          const participants = await livekit.rooms.listParticipants(summary.slug);
          return {
            ...summary,
            is_active: true,
            participants: participants.length,
            active_streams: participants.filter((participant) =>
              participant.tracks.some((track) => track.source === TrackSource.SCREEN_SHARE),
            ).length,
          };
        }),
      );
      return {
        rooms: (parsed.data.active_only === true
          ? liveSummaries.filter((room) => room.is_active)
          : liveSummaries).map((room) => ({
            ...room,
            is_owner: secretToken !== undefined && rooms.isOwner(room.slug, secretToken),
          })),
        presence_available: true,
      };
    } catch (error) {
      request.log.warn({ err: error }, "LiveKit presence unavailable; returning saved room summaries");
      return {
        rooms: parsed.data.active_only === true
          ? []
          : summaries.map((room) => ({
              ...room,
              is_active: false,
              participants: 0,
              active_streams: 0,
              is_owner: secretToken !== undefined && rooms.isOwner(room.slug, secretToken),
            })),
        presence_available: false,
      };
    }
  });

  app.post(
    "/rooms",
    { schema: { body: CreateRoomRequestSchema } satisfies ZodRouteSchema },
    async (request, reply: FastifyReply) => {
      const body = CreateRoomRequestSchema.parse(request.body);
      try {
        const created = await rooms.createRoom(body);
        return {
          room: { ...rooms.toSummary(created.room), is_owner: true },
          secret_token: created.secret_token,
          identity: userIdentity(created.room.owner_user_id),
        };
      } catch (error) {
        const mapped = replyFor(error);
        return reply.status(mapped.status).send(mapped.body);
      }
    },
  );

  app.get(
    "/rooms/code/:roomCode",
    { schema: { params: z.object({ roomCode: RoomCodeSchema }) } satisfies ZodRouteSchema },
    async (request: FastifyRequest<{ Params: { roomCode: string } }>, reply: FastifyReply) => {
      const room = rooms.roomByCode(request.params.roomCode);
      if (room === undefined) {
        return reply.status(404).send({ error: "sala não encontrada", code: "room_not_found" });
      }
      return RoomCodeLookupResponseSchema.parse({ room: rooms.toSummary(room) });
    },
  );

  app.delete(
    "/rooms/:slug",
    { schema: { ...slugParams, body: DeleteRoomRequestSchema } satisfies ZodRouteSchema },
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { secret_token: secretToken } = DeleteRoomRequestSchema.parse(request.body);

      try {
        rooms.deleteOwnedRoom(request.params.slug, secretToken);
      } catch (error) {
        const mapped = replyFor(error);
        return reply.status(mapped.status).send(mapped.body);
      }

      let livekitSessionClosed = false;
      try {
        const activeRooms = await livekit.rooms.listRooms([request.params.slug]);
        if (activeRooms.some((room) => room.name === request.params.slug)) {
          await livekit.rooms.deleteRoom(request.params.slug);
        }
        livekitSessionClosed = true;
      } catch (error) {
        request.log.warn({ err: error, room: request.params.slug }, "Room deleted, but LiveKit session cleanup failed");
      }
      return reply.send(DeleteRoomResponseSchema.parse({
        deleted: true,
        livekit_session_closed: livekitSessionClosed,
      }));
    },
  );

  app.post(
    "/rooms/:slug/enter",
    { schema: { ...slugParams, body: EnterRoomRequestSchema } satisfies ZodRouteSchema },
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const body = EnterRoomRequestSchema.parse(request.body);
      try {
        const entry = await rooms.enterRoom(request.params.slug, body);
        const participantIdentity = livekitSessionIdentity(entry.identity);
        const issued = await livekit.issueRoomToken({
          roomName: request.params.slug,
          identity: participantIdentity,
          displayName: entry.display_name,
          canShareScreen: entry.can_share_screen,
          metadata: {
            account_identity: entry.identity,
            role: entry.role,
            can_share_screen: String(entry.can_share_screen),
          },
        });
        rooms.markActive(request.params.slug, true);
        return {
          token: issued.token,
          livekit_url: livekitUrl,
          room_name: request.params.slug,
          room: rooms.toSummary(entry.room),
          identity: participantIdentity,
          role: entry.role,
          can_share_screen: entry.can_share_screen,
          display_name: entry.display_name,
          expires_at: issued.expiresAt,
        };
      } catch (error) {
        const mapped = replyFor(error);
        return reply.status(mapped.status).send(mapped.body);
      }
    },
  );

  app.post(
    "/rooms/:slug/moderation",
    { schema: { ...slugParams, body: ModerationRequestSchema } satisfies ZodRouteSchema },
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const body = ModerationRequestSchema.parse(request.body);
      try {
        return await moderation.apply({
          slug: request.params.slug,
          action: body.action,
          targetIdentity: body.target_identity,
          actorSecretToken: body.actor_secret_token,
        });
      } catch (error) {
        const mapped = replyFor(error);
        return reply.status(mapped.status).send(mapped.body);
      }
    },
  );

  app.post(
    "/rooms/:slug/access-codes",
    { schema: { ...slugParams, body: IssueAccessCodeRequestSchema } satisfies ZodRouteSchema },
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const body = IssueAccessCodeRequestSchema.parse(request.body);
      try {
        return rooms.issueAccessCode(request.params.slug, body.ttl_seconds, body.single_use);
      } catch (error) {
        const mapped = replyFor(error);
        return reply.status(mapped.status).send(mapped.body);
      }
    },
  );

  app.get(
    "/rooms/:slug",
    { schema: slugParams },
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const secretHeader = request.headers["x-spectra-secret-token"];
      const secretToken = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
      const summary = rooms.summaryFor(request.params.slug, secretToken);
      if (summary === undefined) {
        return reply.status(404).send({ error: "sala não encontrada", code: "room_not_found" });
      }
      return { room: summary };
    },
  );

  app.post(
    "/rooms/:slug/heartbeat",
    { schema: slugParams },
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const summary = rooms.summaryFor(request.params.slug);
      if (summary === undefined) {
        return reply.status(404).send({ error: "sala não encontrada", code: "room_not_found" });
      }
      return rooms.markActive(request.params.slug, true);
    },
  );
};
