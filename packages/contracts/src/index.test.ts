/**
 * Testes unitários dos contratos Zod (`packages/contracts`).
 *
 * Cobre casos válidos e payloads malformados de: identificadores comuns,
 * envelope de Data Channel de Addons, DTOs HTTP de Salas Fixas (DEC-17),
 * credenciais de conta e payloads de moderação.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_CODE_DEFAULT_TTL_SECONDS,
  AccountLoginResponseSchema,
  AccountRecoveryResponseSchema,
  AccountRegistrationResponseSchema,
  AccessCodeSchema,
  ApiErrorSchema,
  CreateRoomRequestSchema,
  DeleteRoomRequestSchema,
  DeleteRoomResponseSchema,
  DataChannelEnvelopeSchema,
  EnterRoomRequestSchema,
  IdentitySchema,
  IssueAccessCodeRequestSchema,
  ModerationEventSchema,
  ModerationRequestSchema,
  ParticipantCredentialsSchema,
  RecoverAccountRequestSchema,
  RecoveryCodeSchema,
  RegisterAccountRequestSchema,
  RoomEntryResponseSchema,
  RoomCodeSchema,
  RoomListResponseSchema,
  RoomSlugSchema,
  RoomSummarySchema,
  SecretTokenSchema,
  validateWithZod,
  validationFailure,
} from "./index.js";

const VALID_SECRET_TOKEN = "a".repeat(32);
const VALID_ACCESS_CODE = "ABCD2345";

const validRoomSummary = {
  id: "room-1",
  room_code: "ABCD2345EF",
  slug: "sala-fixed",
  name: "Sala Fixa",
  visibility: "public",
  owner_display_name: "Criador",
  layout_preset: "standard",
  addon_control_mode: "host_only",
  is_active: true,
  active_streams: 2,
  participants: 5,
  addons_enabled: ["music-bot"],
  created_at: 1_730_000_000_000,
} as const;

test("RoomSlugSchema aceita slugs válidos e rejeita formatos malformados", () => {
  assert.equal(RoomSlugSchema.safeParse("sala-fixed").success, true);
  assert.equal(RoomSlugSchema.safeParse("abc").success, true);

  for (const invalid of ["ab", "Sala-Fixed", "-sala", "sala-", "sala--fixed", "sala_fixed"]) {
    const result = RoomSlugSchema.safeParse(invalid);
    assert.equal(result.success, false, `slug inválido aceito: ${invalid}`);
  }
});

test("RoomCodeSchema valida o código permanente da sala", () => {
  assert.equal(RoomCodeSchema.safeParse("ABCD2345EF").success, true);
  assert.equal(RoomCodeSchema.safeParse("ABCD2345E0").success, false);
  assert.equal(RoomCodeSchema.safeParse("ABCD2345").success, false);
});

test("SecretTokenSchema e ParticipantCredentialsSchema validam a credencial interna de conta", () => {
  assert.equal(SecretTokenSchema.safeParse(VALID_SECRET_TOKEN).success, true);
  assert.equal(SecretTokenSchema.safeParse("short").success, false);
  assert.equal(SecretTokenSchema.safeParse(`${"a".repeat(32)}!`).success, false);

  assert.equal(ParticipantCredentialsSchema.safeParse({ display_name: "Guest" }).success, true);
  assert.equal(
    ParticipantCredentialsSchema.safeParse({ display_name: "Owner", secret_token: VALID_SECRET_TOKEN }).success,
    true,
  );
  assert.equal(ParticipantCredentialsSchema.safeParse({ display_name: "" }).success, false);
  assert.equal(ParticipantCredentialsSchema.safeParse({}).success, false);
});

test("contratos de conta exigem confirmação de senha e validam códigos de recuperação", () => {
  const recoveryCode = "R".repeat(43);
  assert.equal(RecoveryCodeSchema.safeParse(recoveryCode).success, true);
  assert.equal(RecoveryCodeSchema.safeParse("código-curto").success, false);
  assert.equal(RegisterAccountRequestSchema.safeParse({
    nickname: "Conta teste",
    password: "senha-segura-123",
    password_confirmation: "senha-segura-123",
  }).success, true);
  assert.equal(RegisterAccountRequestSchema.safeParse({
    nickname: "Conta teste",
    password: "senha-segura-123",
    password_confirmation: "senha-diferente",
  }).success, false);
  assert.equal(RecoverAccountRequestSchema.safeParse({
    nickname: "Conta teste",
    recovery_code: recoveryCode,
    new_password: "senha-nova-456",
    new_password_confirmation: "senha-nova-456",
  }).success, true);
  assert.equal(RecoverAccountRequestSchema.safeParse({
    nickname: "Conta teste",
    recovery_code: recoveryCode,
    new_password: "senha-nova-456",
    new_password_confirmation: "outra-senha",
  }).success, false);

  const session = {
    secret_token: VALID_SECRET_TOKEN,
    user: { id: "user-1", display_name: "Conta teste" },
  };
  assert.equal(AccountRegistrationResponseSchema.safeParse({ ...session, recovery_code: recoveryCode }).success, true);
  assert.equal(AccountRecoveryResponseSchema.safeParse({ ...session, recovery_code: recoveryCode }).success, true);
  assert.equal(AccountLoginResponseSchema.safeParse(session).success, true);
});

test("DataChannelEnvelopeSchema exige o prefixo 'addon:' e payload JSON", () => {
  const valid = DataChannelEnvelopeSchema.safeParse({
    channel: "addon:music-bot",
    payload: { queue: [{ title: "faixa", duration: 120 }], muted: false, volume: null },
  });
  assert.equal(valid.success, true);

  const missingPrefix = DataChannelEnvelopeSchema.safeParse({ channel: "music-bot", payload: {} });
  assert.equal(missingPrefix.success, false);

  const malformedPayload = DataChannelEnvelopeSchema.safeParse({
    channel: "addon:music-bot",
    payload: () => undefined,
  });
  assert.equal(malformedPayload.success, false);
});
test("CreateRoomRequestSchema aplica a regra de senha para salas privadas (DEC-17)", () => {
  const publicRoom = CreateRoomRequestSchema.safeParse({
    name: "Sala Fixa",
    visibility: "public",
    display_name: "Criador",
  });
  assert.equal(publicRoom.success, true);
  if (!publicRoom.success) return;
  assert.equal(publicRoom.data.layout_preset, "standard");
  assert.equal(publicRoom.data.addon_control_mode, "host_only");

  const privateWithoutPassword = CreateRoomRequestSchema.safeParse({
    name: "Sala Privada",
    visibility: "private",
    display_name: "Criador",
  });
  assert.equal(privateWithoutPassword.success, false);
  if (privateWithoutPassword.success) return;
  const passwordIssue = privateWithoutPassword.error.issues.find(
    (issue) => issue.code === "custom" && issue.message === "password_required_for_private_room",
  );
  assert.ok(passwordIssue, "superRefine deve exigir senha em salas privadas");

  const privateWithPassword = CreateRoomRequestSchema.safeParse({
    name: "Sala Privada",
    visibility: "private",
    display_name: "Criador",
    password: "senha123",
  });
  assert.equal(privateWithPassword.success, true);

  const weakPassword = CreateRoomRequestSchema.safeParse({
    name: "Sala Privada",
    visibility: "private",
    display_name: "Criador",
    password: "senhasemdigito",
  });
  assert.equal(weakPassword.success, false);

  const malformed = CreateRoomRequestSchema.safeParse({
    name: "x",
    visibility: "publica",
    display_name: "",
  });
  assert.equal(malformed.success, false);
});

test("EnterRoomRequestSchema é uma union discriminada pelo método de entrada", () => {
  const credentials = { display_name: "Guest" };

  const bySlug = EnterRoomRequestSchema.safeParse({ method: "slug", slug: "sala-fixed", credentials });
  assert.equal(bySlug.success, true);

  const byAccessCode = EnterRoomRequestSchema.safeParse({
    method: "access_code",
    slug: "sala-fixed",
    credentials,
    access_code: VALID_ACCESS_CODE,
  });
  assert.equal(byAccessCode.success, true);

  const byPassword = EnterRoomRequestSchema.safeParse({
    method: "password",
    slug: "sala-fixed",
    credentials,
    password: "senha123",
  });
  assert.equal(byPassword.success, true);

  // Método desconhecido e método válido sem o campo obrigatório correspondente.
  assert.equal(EnterRoomRequestSchema.safeParse({ method: "invite", slug: "sala-fixed", credentials }).success, false);
  assert.equal(EnterRoomRequestSchema.safeParse({ method: "access_code", slug: "sala-fixed", credentials }).success, false);
  assert.equal(
    EnterRoomRequestSchema.safeParse({
      method: "access_code",
      slug: "sala-fixed",
      credentials,
      access_code: "abcd1234", // minúsculas não fazem parte do charset sem ambiguidade
    }).success,
    false,
  );
});

test("AccessCodeSchema aceita apenas o charset sem ambiguidade (8 caracteres)", () => {
  assert.equal(AccessCodeSchema.safeParse(VALID_ACCESS_CODE).success, true);
  for (const invalid of ["ABCDEFG", "ABCDEFGHI", "ABCD IO1", "abcd2345"]) {
    assert.equal(AccessCodeSchema.safeParse(invalid).success, false, `código inválido aceito: ${invalid}`);
  }
});

test("RoomSummarySchema e RoomListResponseSchema validam o resumo do Lobby", () => {
  assert.equal(RoomSummarySchema.safeParse(validRoomSummary).success, true);
  assert.equal(
    RoomSummarySchema.safeParse({ ...validRoomSummary, participants: -1 }).success,
    false,
    "participantes negativos não são aceitos",
  );
  assert.equal(RoomSummarySchema.safeParse({ ...validRoomSummary, visibility: "unlisted" }).success, false);

  const list = RoomListResponseSchema.safeParse({ rooms: [validRoomSummary] });
  assert.equal(list.success, true);
  assert.equal(RoomListResponseSchema.safeParse({ rooms: [{ ...validRoomSummary, slug: "SLUG" }] }).success, false);
});

test("contratos de exclusão de sala exigem Chave de Criador e resultado explícito", () => {
  assert.equal(DeleteRoomRequestSchema.safeParse({ secret_token: VALID_SECRET_TOKEN }).success, true);
  assert.equal(DeleteRoomRequestSchema.safeParse({ secret_token: "inválida" }).success, false);
  assert.equal(
    DeleteRoomResponseSchema.safeParse({ deleted: true, livekit_session_closed: false }).success,
    true,
  );
  assert.equal(
    DeleteRoomResponseSchema.safeParse({ deleted: false, livekit_session_closed: true }).success,
    false,
  );
});

test("RoomEntryResponseSchema rejeita JWT vazio e identidade malformada", () => {
  const base = {
    token: "jwt-opaco",
    livekit_url: "wss://livekit.example",
    room_name: "sala-fixed",
    identity: "u-1234",
    role: "member",
    can_share_screen: true,
    display_name: "Guest",
    room: validRoomSummary,
    expires_at: 1_730_000_360_000,
  } as const;

  assert.equal(RoomEntryResponseSchema.safeParse(base).success, true);
  assert.equal(RoomEntryResponseSchema.safeParse({ ...base, token: "" }).success, false);
  assert.equal(RoomEntryResponseSchema.safeParse({ ...base, identity: "identidade com espaço" }).success, false);
  assert.equal(RoomEntryResponseSchema.safeParse({ ...base, role: "moderator" }).success, false);
});

test("IssueAccessCodeRequestSchema exige a chave do admin e aplica default de single_use", () => {
  const result = IssueAccessCodeRequestSchema.safeParse({ secret_token: VALID_SECRET_TOKEN });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.single_use, false);

  assert.equal(IssueAccessCodeRequestSchema.safeParse({}).success, false);
  assert.equal(
    IssueAccessCodeRequestSchema.safeParse({ secret_token: VALID_SECRET_TOKEN, ttl_seconds: -5 }).success,
    false,
  );
});

test("Payloads de moderação validam ação, identidade e chave do ator", () => {
  const moderation = ModerationRequestSchema.safeParse({
    action: "ban",
    target_identity: "u-1234",
    actor_secret_token: VALID_SECRET_TOKEN,
  });
  assert.equal(moderation.success, true);

  assert.equal(
    ModerationRequestSchema.safeParse({
      action: "mute_microphone",
      target_identity: "u-1234",
      actor_secret_token: VALID_SECRET_TOKEN,
    }).success,
    false,
    "nenhuma ação de voz/microfone existe (DEC-01)",
  );
  assert.equal(
    ModerationRequestSchema.safeParse({ action: "kick", target_identity: "id inválida" }).success,
    false,
  );

  const event = ModerationEventSchema.safeParse({
    type: "moderation",
    action: "end_stream",
    target_identity: "u-1234",
    actor_identity: "u-owner",
  });
  assert.equal(event.success, true);
  assert.equal(
    ModerationEventSchema.safeParse({
      type: "chat",
      action: "kick",
      target_identity: "u-1",
      actor_identity: "u-2",
    }).success,
    false,
  );

  assert.equal(IdentitySchema.safeParse("g-sala-fixed-abc123").success, true);
});

test("validateWithZod devolve value/issues e validationFailure produz o formato do Fastify", () => {
  const ok = validateWithZod(RoomSlugSchema, "sala-fixed");
  assert.equal(ok.issues, undefined);
  assert.equal(ok.value, "sala-fixed");

  const bad = validateWithZod(ApiErrorSchema, { error: "" });
  assert.equal(bad.value, undefined);
  assert.ok(bad.issues && bad.issues.length > 0);
  const payload = validationFailure(bad.issues ?? []);
  assert.equal(payload.code, "validation_failed");
  assert.ok(Array.isArray(payload.issues));

  // TTL padrão de códigos de acesso (DEC-17) permanece 1 hora.
  assert.equal(ACCESS_CODE_DEFAULT_TTL_SECONDS, 3600);
});
