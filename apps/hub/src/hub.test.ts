import assert from "node:assert/strict";
import test from "node:test";
import { TrackSource } from "@livekit/protocol";
import { type RoomServiceClient } from "livekit-server-sdk";
import { assertNoMicrophoneGrant, LiveKitService, MicrophoneGrantError } from "./livekit.js";
import { buildHub } from "./index.js";
import { AccountService } from "./services/accounts.js";
import { ModerationService } from "./services/moderation.js";
import { RoomService } from "./services/rooms.js";
import { createRoomServiceMock, insertMember, testDb, testEnv } from "./test-helpers.js";

test("RoomService cria salas fixas e permite entrada por slug, senha, código e secret_token", async () => {
  const db = testDb();
  const env = testEnv();
  const rooms = new RoomService(db, env);

  const publicRoom = await rooms.createRoom({
    name: "Sala Pública",
    slug: "sala-publica",
    visibility: "public",
    display_name: "Host",
    layout_preset: "standard",
    addon_control_mode: "host_only",
  });

  const publicGuest = await rooms.enterRoom(publicRoom.room.slug, {
    method: "slug",
    slug: publicRoom.room.slug,
    credentials: { display_name: "Visitante" },
  });
  assert.equal(publicGuest.is_guest, true);
  assert.equal(publicGuest.can_share_screen, true);

  const privateRoom = await rooms.createRoom({
    name: "Sala Privada",
    slug: "sala-privada",
    visibility: "private",
    display_name: "Moderador",
    password: "senha123",
    layout_preset: "standard",
    addon_control_mode: "host_only",
  });

  const passwordGuest = await rooms.enterRoom(privateRoom.room.slug, {
    method: "password",
    slug: privateRoom.room.slug,
    credentials: { display_name: "Convidado" },
    password: "senha123",
  });
  assert.equal(passwordGuest.is_guest, true);
  assert.equal(passwordGuest.can_share_screen, true);

  const accessCode = rooms.issueAccessCode(privateRoom.room.slug, 60, true);
  const accessGuest = await rooms.enterRoom(privateRoom.room.slug, {
    method: "access_code",
    slug: privateRoom.room.slug,
    credentials: { display_name: "Visitante de código" },
    access_code: accessCode.access_code,
  });
  assert.equal(accessGuest.is_guest, true);
  assert.equal(accessGuest.can_share_screen, true);

  const ownerGuest = await rooms.enterRoom(privateRoom.room.slug, {
    method: "slug",
    slug: privateRoom.room.slug,
    credentials: {
      display_name: "Moderador",
      secret_token: privateRoom.secret_token,
    },
  });
  assert.equal(ownerGuest.is_guest, false);
  assert.equal(ownerGuest.userId, privateRoom.room.owner_user_id);

  assert.equal(rooms.resolveOwner(privateRoom.room.slug, privateRoom.secret_token)?.id, privateRoom.room.id);
  db.close();
});

test("RoomService reutiliza a Chave de Criador e não lista salas privadas sem ela", async () => {
  const db = testDb();
  const env = testEnv();
  const rooms = new RoomService(db, env);
  const secretToken = "creator-key-for-multiple-fixed-rooms-123456";
  const request = {
    visibility: "private" as const,
    display_name: "Dono",
    password: "senha1234",
    layout_preset: "standard" as const,
    addon_control_mode: "host_only" as const,
    secret_token: secretToken,
  };
  const firstRoom = await rooms.createRoom({ ...request, name: "Primeira sala", slug: "primeira-sala" });
  const secondRoom = await rooms.createRoom({ ...request, name: "Segunda sala", slug: "segunda-sala" });

  assert.equal(firstRoom.room.owner_user_id, secondRoom.room.owner_user_id);
  assert.deepEqual(rooms.listSummaries().map((room) => room.slug), []);
  assert.deepEqual(
    rooms.listSummaries(false, secretToken).map((room) => room.slug).sort(),
    ["primeira-sala", "segunda-sala"],
  );
  assert.equal(rooms.summaryFor("primeira-sala"), undefined);
  assert.equal(rooms.summaryFor("primeira-sala", secretToken)?.slug, "primeira-sala");
  db.close();
});

test("contas isolam salas e passam a ver salas públicas em que entraram", async () => {
  const db = testDb();
  const env = testEnv();
  const accounts = new AccountService(db, env);
  const rooms = new RoomService(db, env);
  const alice = await accounts.register("Alice", "senha-segura-123");
  const bob = await accounts.register("Bob", "outra-senha-segura");

  const aliceRoom = await rooms.createRoom({
    name: "Sala da Alice",
    slug: "sala-da-alice",
    visibility: "public",
    display_name: "Alice",
    secret_token: alice.secret_token,
    layout_preset: "standard",
    addon_control_mode: "host_only",
  });
  const bobRoom = await rooms.createRoom({
    name: "Sala do Bob",
    slug: "sala-do-bob",
    visibility: "public",
    display_name: "Bob",
    secret_token: bob.secret_token,
    layout_preset: "standard",
    addon_control_mode: "host_only",
  });

  assert.equal(aliceRoom.room.owner_user_id, alice.user.id);
  assert.deepEqual(rooms.listSummaries(false, alice.secret_token).map((room) => room.slug), ["sala-da-alice"]);
  await rooms.enterRoom("sala-da-alice", {
    method: "slug",
    slug: "sala-da-alice",
    credentials: { display_name: "Bob", secret_token: bob.secret_token },
  });
  assert.deepEqual(
    rooms.listSummaries(false, bob.secret_token).map((room) => room.slug).sort(),
    ["sala-da-alice", "sala-do-bob"],
  );
  assert.equal(bobRoom.room.owner_user_id, bob.user.id);
  db.close();
});

test("rotas de conta cadastram, autenticam e resolvem a sessão persistente", async () => {
  const db = testDb();
  const hub = buildHub({ db, env: testEnv() });
  try {
    await hub.app.ready();
    const registration = await hub.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        nickname: "Conta teste",
        password: "senha-segura-123",
        password_confirmation: "senha-segura-123",
      },
    });
    assert.equal(registration.statusCode, 200, registration.body);
    const created = registration.json() as {
      secret_token: string;
      recovery_code: string;
      user: { id: string; display_name: string };
    };
    assert.equal(created.user.display_name, "Conta teste");
    assert.equal(created.recovery_code.length, 43);

    const duplicate = await hub.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        nickname: "CONTA TESTE",
        password: "senha-segura-456",
        password_confirmation: "senha-segura-456",
      },
    });
    assert.equal(duplicate.statusCode, 409);

    const mismatchedConfirmation = await hub.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        nickname: "Outra conta",
        password: "senha-segura-789",
        password_confirmation: "senha-diferente",
      },
    });
    assert.equal(mismatchedConfirmation.statusCode, 400);

    const login = await hub.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { nickname: "conta teste", password: "senha-segura-123" },
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().user.id, created.user.id);
    const recoveryCode = login.json().recovery_code as string;
    assert.equal(recoveryCode.length, 43);
    assert.notEqual(recoveryCode, created.recovery_code);

    const resumedSession = await hub.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { "x-spectra-secret-token": created.secret_token },
    });
    assert.equal(resumedSession.statusCode, 200);
    const resumedRecoveryCode = resumedSession.json().recovery_code as string;
    assert.notEqual(resumedRecoveryCode, recoveryCode);

    const staleCodeAcknowledgment = await hub.app.inject({
      method: "POST",
      url: "/api/auth/recovery/acknowledge",
      headers: { "x-spectra-secret-token": created.secret_token },
      payload: { recovery_code: recoveryCode },
    });
    assert.equal(staleCodeAcknowledgment.statusCode, 409);

    const codeAcknowledgment = await hub.app.inject({
      method: "POST",
      url: "/api/auth/recovery/acknowledge",
      headers: { "x-spectra-secret-token": created.secret_token },
      payload: { recovery_code: resumedRecoveryCode },
    });
    assert.equal(codeAcknowledgment.statusCode, 200);

    const loginAfterBackup = await hub.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { nickname: "conta teste", password: "senha-segura-123" },
    });
    assert.equal(loginAfterBackup.statusCode, 200);
    assert.equal(loginAfterBackup.json().recovery_code, undefined);

    const invalidLogin = await hub.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { nickname: "Conta teste", password: "senha-incorreta" },
    });
    assert.equal(invalidLogin.statusCode, 401);

    const recovery = await hub.app.inject({
      method: "POST",
      url: "/api/auth/recover",
      payload: {
        nickname: "Conta teste",
        recovery_code: resumedRecoveryCode,
        new_password: "senha-nova-456",
        new_password_confirmation: "senha-nova-456",
      },
    });
    assert.equal(recovery.statusCode, 200, recovery.body);
    const recovered = recovery.json() as {
      secret_token: string;
      recovery_code: string;
      user: { id: string };
    };
    assert.equal(recovered.user.id, created.user.id);
    assert.notEqual(recovered.recovery_code, recoveryCode);

    const recoveredCodeAcknowledgment = await hub.app.inject({
      method: "POST",
      url: "/api/auth/recovery/acknowledge",
      headers: { "x-spectra-secret-token": recovered.secret_token },
      payload: { recovery_code: recovered.recovery_code },
    });
    assert.equal(recoveredCodeAcknowledgment.statusCode, 200);

    const oldPasswordLogin = await hub.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { nickname: "conta teste", password: "senha-segura-123" },
    });
    assert.equal(oldPasswordLogin.statusCode, 401);

    const newPasswordLogin = await hub.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { nickname: "conta teste", password: "senha-nova-456" },
    });
    assert.equal(newPasswordLogin.statusCode, 200, newPasswordLogin.body);
    assert.equal(newPasswordLogin.json().recovery_code, undefined);

    const invalidRecovery = await hub.app.inject({
      method: "POST",
      url: "/api/auth/recover",
      payload: {
        nickname: "Conta teste",
        recovery_code: recoveryCode,
        new_password: "senha-final-789",
        new_password_confirmation: "senha-final-789",
      },
    });
    assert.equal(invalidRecovery.statusCode, 401);

    const currentAccount = await hub.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { "x-spectra-secret-token": recovered.secret_token },
    });
    assert.equal(currentAccount.statusCode, 200, currentAccount.body);
    assert.equal(currentAccount.json().user.id, created.user.id);
  } finally {
    await hub.close();
  }
});

test("Hub cria salas com resposta pública e emite JWT na entrada conforme o contrato", async () => {
  const db = testDb();
  const hub = buildHub({ db, env: testEnv() });
  try {
    await hub.app.ready();
    const createResponse = await hub.app.inject({
      method: "POST",
      url: "/api/rooms",
      payload: {
        name: "Sala de teste",
        visibility: "private",
        password: "senha1234",
        display_name: "Criador",
      },
    });
    assert.equal(createResponse.statusCode, 200, createResponse.body);
    const created = createResponse.json() as {
      room: { slug: string; room_code: string };
      secret_token: string;
      identity: string;
      password_hash?: string;
    };
    assert.match(created.room.room_code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    assert.equal(created.room.slug, `room-${created.room.room_code.toLowerCase()}`);
    assert.equal(created.identity.startsWith("u-"), true);
    assert.equal(created.password_hash, undefined);

    const lookupResponse = await hub.app.inject({
      method: "GET",
      url: `/api/rooms/code/${created.room.room_code.toLowerCase()}`,
    });
    assert.equal(lookupResponse.statusCode, 200, lookupResponse.body);
    assert.equal(lookupResponse.json().room.room_code, created.room.room_code);

    const passwordRequiredResponse = await hub.app.inject({
      method: "POST",
      url: `/api/rooms/${created.room.slug}/enter`,
      payload: {
        method: "slug",
        slug: created.room.slug,
        credentials: { display_name: "Visitante" },
      },
    });
    assert.equal(passwordRequiredResponse.statusCode, 401);
    assert.equal(passwordRequiredResponse.json().code, "password_required");

    const entryResponse = await hub.app.inject({
      method: "POST",
      url: `/api/rooms/${created.room.slug}/enter`,
      payload: {
        method: "slug",
        slug: created.room.slug,
        credentials: { display_name: "Criador", secret_token: created.secret_token },
      },
    });
    assert.equal(entryResponse.statusCode, 200);
    const entry = entryResponse.json() as {
      token: string;
      livekit_url: string;
      room_name: string;
      identity: string;
      role: string;
      can_share_screen: boolean;
      room: { slug: string };
    };
    assert.equal(entry.room_name, created.room.slug);
    assert.equal(entry.room.slug, created.room.slug);
    assert.equal(entry.role, "admin");
    assert.equal(entry.can_share_screen, true);
    const tokenPayload = JSON.parse(Buffer.from(entry.token.split(".")[1]!, "base64url").toString("utf8"));
    assert.equal(tokenPayload.video.canPublishSources.includes("microphone"), false);
    assert.notEqual(entry.identity, created.identity);
    assert.equal(entry.identity.startsWith(`${created.identity}:`), true);
    assert.equal(tokenPayload.sub, entry.identity);
    assert.deepEqual(JSON.parse(tokenPayload.metadata), {
      account_identity: created.identity,
      role: "admin",
      can_share_screen: "true",
    });
    assert.equal(entry.livekit_url, hub.env.livekitUrl);

    const secondEntryResponse = await hub.app.inject({
      method: "POST",
      url: `/api/rooms/${created.room.slug}/enter`,
      payload: {
        method: "slug",
        slug: created.room.slug,
        credentials: { display_name: "Criador", secret_token: created.secret_token },
      },
    });
    assert.equal(secondEntryResponse.statusCode, 200);
    assert.notEqual(secondEntryResponse.json().identity, entry.identity);

    const guestEntryResponse = await hub.app.inject({
      method: "POST",
      url: `/api/rooms/${created.room.slug}/enter`,
      payload: {
        method: "password",
        slug: created.room.slug,
        credentials: { display_name: "Convidado" },
        password: "senha1234",
      },
    });
    assert.equal(guestEntryResponse.statusCode, 200, guestEntryResponse.body);
    const guestEntry = guestEntryResponse.json() as {
      token: string;
      can_share_screen: boolean;
      role: string;
    };
    const guestTokenPayload = JSON.parse(
      Buffer.from(guestEntry.token.split(".")[1]!, "base64url").toString("utf8"),
    );
    assert.equal(guestEntry.role, "member");
    assert.equal(guestEntry.can_share_screen, true);
    assert.deepEqual(guestTokenPayload.video.canPublishSources, ["screen_share", "screen_share_audio"]);
    assert.equal(guestTokenPayload.video.canPublishSources.includes("microphone"), false);
  } finally {
    await hub.close();
  }
});

test("Hub mantém salas privadas listáveis quando a presença do LiveKit está indisponível", async () => {
  const db = testDb();
  const env = testEnv();
  const roomService = {
    listRooms: async () => {
      throw new Error("livekit_unavailable");
    },
  } as unknown as RoomServiceClient;
  const hub = buildHub({
    db,
    env,
    livekit: LiveKitService.withRoomService(env, roomService),
  });
  try {
    await hub.app.ready();
    const secretToken = "creator-key-for-presence-fallback-test-123";
    await hub.rooms.createRoom({
      name: "Sala persistente",
      slug: "sala-presistente",
      visibility: "private",
      password: "senha1234",
      display_name: "Criador",
      layout_preset: "standard",
      addon_control_mode: "host_only",
      secret_token: secretToken,
    });

    const response = await hub.app.inject({
      method: "GET",
      url: "/api/rooms",
      headers: { "x-spectra-secret-token": secretToken },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      rooms: [{
        ...hub.rooms.toSummary(hub.rooms.roomBySlug("sala-presistente")!),
        is_active: false,
        participants: 0,
        active_streams: 0,
        is_owner: true,
      }],
      presence_available: false,
    });
  } finally {
    await hub.close();
  }
});

test("Hub exclui sala fixa somente com a Chave de Criador proprietária", async () => {
  const db = testDb();
  const env = testEnv();
  const roomService = {
    listRooms: async () => [],
    deleteRoom: async () => undefined,
  } as unknown as RoomServiceClient;
  const hub = buildHub({
    db,
    env,
    livekit: LiveKitService.withRoomService(env, roomService),
  });
  try {
    await hub.app.ready();
    const created = await hub.rooms.createRoom({
      name: "Sala removível",
      slug: "sala-removivel",
      visibility: "public",
      display_name: "Criador",
      layout_preset: "standard",
      addon_control_mode: "host_only",
    });

    const denied = await hub.app.inject({
      method: "DELETE",
      url: "/api/rooms/sala-removivel",
      payload: { secret_token: `${created.secret_token}-invalid` },
    });
    assert.equal(denied.statusCode, 403);
    assert.notEqual(hub.rooms.roomBySlug("sala-removivel"), undefined);

    const deleted = await hub.app.inject({
      method: "DELETE",
      url: "/api/rooms/sala-removivel",
      payload: { secret_token: created.secret_token },
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.deepEqual(deleted.json(), { deleted: true, livekit_session_closed: true });
    assert.equal(hub.rooms.roomBySlug("sala-removivel"), undefined);
  } finally {
    await hub.close();
  }
});

test("LiveKitService emite JWT sem microphone mas com screen share habilitado", async () => {
  const env = testEnv();
  const service = new LiveKitService(env);

  const issued = await service.issueRoomToken({
    roomName: "sala-livekit",
    identity: "u-123",
    displayName: "Alice",
    canShareScreen: true,
  });

  const tokenParts = issued.token.split(".");
  assert.equal(tokenParts.length >= 2, true);
  const payload = JSON.parse(Buffer.from(tokenParts[1]!, "base64url").toString("utf8"));
  assert.equal(payload.video.canPublish, true);
  assert.deepEqual(payload.video.canPublishSources, ["screen_share", "screen_share_audio"]);
  assert.equal(payload.video.canPublishSources.includes("microphone"), false);

  assert.doesNotThrow(() => assertNoMicrophoneGrant({ canPublishSources: [TrackSource.SCREEN_SHARE] }));
  assert.throws(() => assertNoMicrophoneGrant({ canPublishSources: [TrackSource.MICROPHONE] }), MicrophoneGrantError);
});

test("ModerationService aplica ações administrativas e chama o mock do LiveKit", async () => {
  const db = testDb();
  const env = testEnv();
  const rooms = new RoomService(db, env);
  const room = await rooms.createRoom({
    name: "Sala Moderada",
    slug: "sala-moderada",
    visibility: "public",
    display_name: "Host",
    layout_preset: "standard",
    addon_control_mode: "host_only",
  });

  const member = insertMember(db, {
    roomId: room.room.id,
    secretTokenHash: "hash-do-membro",
    displayName: "Membro",
  });
  const sessionIdentity = `${member.identity}:desktop`;
  const { calls, roomService } = createRoomServiceMock({
    participants: [sessionIdentity, `${member.identity}:web`],
  });
  const moderation = new ModerationService(
    db,
    rooms,
    LiveKitService.withRoomService(env, roomService as RoomServiceClient),
  );

  const result = await moderation.apply({
    slug: room.room.slug,
    action: "block_screen_share",
    targetIdentity: sessionIdentity,
    actorSecretToken: room.secret_token,
  });

  assert.equal(result.action, "block_screen_share");
  assert.equal(result.target.identity, sessionIdentity);
  assert.equal(result.target.can_share_screen, false);
  assert.deepEqual(calls.map((call) => call.identity).sort(), [
    `${member.identity}:desktop`,
    `${member.identity}:web`,
  ]);
  assert.equal(calls.every((call) => call.method === "updateParticipant"), true);
  assert.equal(rooms.permissionFor(room.room.id, member.userId)?.can_share_screen, false);
  db.close();
});
