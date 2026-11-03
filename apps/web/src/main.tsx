import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiErrorSchema,
  AccountLoginResponseSchema,
  AccountRecoveryResponseSchema,
  AccountRegistrationResponseSchema,
  AccountUserResponseSchema,
  AcknowledgeRecoveryCodeRequestSchema,
  CreateRoomRequestSchema,
  CreateRoomResponseSchema,
  DeleteRoomResponseSchema,
  LoginAccountRequestSchema,
  ModerationResultSchema,
  RecoverAccountRequestSchema,
  RegisterAccountRequestSchema,
  RecoveryAcknowledgmentResponseSchema,
  RoomCodeLookupResponseSchema,
  RoomCodeSchema,
  RoomEntryResponseSchema,
  RoomListResponseSchema,
  type AccountUser,
  type ModerationAction,
  type ParticipantState,
  type RoomSummary,
  type RoomEntryResponse,
} from "@spectra/contracts";
import { connectMediaRoom, type MediaSession, type MediaSessionView, type ScreenShareCodec, type ScreenTrackQuality, type TrackMediaDiagnostics } from "@spectra/media-client";
import { createElectronPlatformBridge, type ScreenCaptureSource, RoomLobby } from "@spectra/shared-ui";
import "./styles.css";

declare global {
  interface Window {
    spectraDesktop?: Record<string, unknown> & { hubUrl?: string };
  }
}

const API_BASE = import.meta.env.VITE_HUB_URL
  ?? (window.spectraDesktop?.hubUrl || undefined)
  ?? (window.location.protocol === "file:" ? "http://localhost:3001" : "");
const platformBridge = createElectronPlatformBridge(window.spectraDesktop);
const PROFILE_KEY = "spectra.profile";
const CREATOR_KEY = "spectra.creator-key";
const FAVORITES_KEY = "spectra.favorites";
const OWNED_ROOMS_KEY = "spectra.owned-rooms";
const NOTICE_DURATION_MS = 4_000;
const audioContexts = new Set<AudioContext>();

class HubRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HubRequestError";
  }
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof HubRequestError) {
    const messages: Record<string, string> = {
      room_not_found: "Não encontramos essa sala. Confira o link e tente novamente.",
      slug_taken: "Esse endereço já está em uso. Escolha outro para sua sala.",
      password_required: "Esta sala é privada. Informe a senha para continuar.",
      invalid_password: "Senha incorreta. Confira e tente novamente.",
      invalid_access_code: "Esse código de acesso não é válido.",
      access_code_expired: "Esse código de acesso expirou. Peça um novo convite.",
      banned: "Seu acesso a esta sala foi bloqueado.",
      not_admin: "Esta ação só pode ser realizada pelo administrador da sala.",
      target_not_found: "Esse participante não está mais disponível para moderação.",
      username_taken: "Esse apelido já está em uso. Escolha outro.",
      invalid_credentials: "Apelido ou senha incorretos.",
      invalid_recovery_code: "Apelido ou código de recuperação inválido.",
      recovery_code_changed: "O código mudou. Entre novamente para obter o código atual.",
    };
    return messages[error.code ?? ""] ?? (error.status !== undefined && error.status >= 500
      ? "O serviço está temporariamente indisponível. Tente novamente em instantes."
      : error.message);
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return "Não foi possível falar com o Hub. Verifique sua conexão e tente novamente.";
  }
  if (error instanceof Error && error.name === "ZodError") {
    return "Alguns dados não foram aceitos. Confira os campos destacados e tente novamente.";
  }
  return error instanceof Error ? error.message : fallback;
}

function mediaConnectionError(error: unknown): string {
  if (error instanceof Error && /NotAllowedError|Permission denied/i.test(`${error.name} ${error.message}`)) {
    return "O navegador bloqueou a conexão ou a permissão necessária. Verifique as permissões e tente novamente.";
  }
  if (error instanceof Error && /token|unauthorized|permission/i.test(error.message)) {
    return "A autorização para entrar na sala expirou ou foi recusada. Saia e entre novamente pelo convite.";
  }
  return "Não foi possível conectar ao servidor de mídia. Verifique sua conexão e tente novamente. Se persistir, confira a disponibilidade do LiveKit.";
}

function screenShareError(error: unknown): string {
  if (error instanceof Error) {
    switch (error.name) {
      case "NotAllowedError":
        return "A captura foi cancelada ou bloqueada. Tente novamente e escolha uma tela ou janela.";
      case "NotFoundError":
        return "Nenhuma tela ou janela disponível para compartilhar.";
      case "NotReadableError":
        return "O sistema não conseguiu capturar essa tela. Feche outros aplicativos que possam estar usando a captura e tente novamente.";
      case "NotSupportedError":
        return "Este navegador ou ambiente não oferece captura de tela. Use uma versão atual do Chrome ou Edge em HTTPS/localhost, ou atualize o Desktop.";
      case "InvalidStateError":
        return "A captura precisa ser iniciada pelo botão desta janela. Volte à sala e tente novamente sem trocar de aba.";
      case "AbortError":
        return "A captura foi interrompida. Tente compartilhar a tela novamente.";
    }
    if (/permission|not authorized|publication/i.test(error.message)) {
      return "O servidor recusou a publicação da tela. Saia e entre novamente na sala para atualizar sua permissão.";
    }
  }
  return friendlyError(error, "Não foi possível iniciar o compartilhamento. Tente novamente.");
}

function technicalError(error: unknown): string {
  if (!(error instanceof Error)) return "Erro sem detalhes técnicos disponíveis.";
  const message = error.message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token ocultado]");
  return `${error.name}: ${message || "sem mensagem"}`;
}

function readStored<T>(key: string, fallback: T): T {
  return platformBridge.storage.get(key, fallback);
}

const BITRATE_OPTIONS_KBPS = [2_500, 4_000, 6_000, 8_000, 12_000, 16_000, 20_000, 25_000, 30_000, 35_000, 40_000, 50_000] as const;

function recommendedBitrateKbps(
  resolution: "720p" | "1080p" | "1440p" | "4k",
  framerate: 15 | 30 | 60,
  profile: "fluidity" | "sharpness",
): number {
  const recommendations: Record<typeof resolution, Record<typeof framerate, number>> = {
    "720p": { 15: 2_500, 30: 4_000, 60: 6_000 },
    "1080p": { 15: 4_000, 30: 8_000, 60: 12_000 },
    "1440p": { 15: 8_000, 30: 12_000, 60: 20_000 },
    "4k": { 15: 16_000, 30: 25_000, 60: 35_000 },
  };
  const target = recommendations[resolution][framerate] * (profile === "fluidity" ? 1.15 : 1);
  return BITRATE_OPTIONS_KBPS.reduce((closest, candidate) =>
    Math.abs(candidate - target) < Math.abs(closest - target) ? candidate : closest,
  );
}

async function hubRequest<T>(
  path: string,
  schema: { parse(value: unknown): T },
  options: { method?: string; body?: unknown; secretToken?: string } = {},
): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.secretToken !== undefined) headers.set("x-spectra-secret-token", options.secretToken);

  const response = await fetch(`${API_BASE}/api${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const responseText = await response.text();
  let payload: unknown = {};
  if (responseText.trim()) {
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      if (!response.ok) {
        throw new HubRequestError(`O Hub respondeu com erro HTTP ${response.status}.`, undefined, response.status);
      }
      throw new HubRequestError("O Hub devolveu uma resposta inválida.");
    }
  }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    const apiError = parsed.success ? parsed.data : undefined;
    const message = typeof apiError?.error === "string"
      ? apiError.error
      : apiError?.message ?? apiError?.code ?? `Falha do Hub (${response.status})`;
    throw new HubRequestError(message, apiError?.code, response.status);
  }

  return schema.parse(payload);
}

function roomIdentifierFromInput(raw: string): { identifier: string; accessCode?: string } {
  const value = raw.trim();
  if (!value) throw new Error("Cole o link ou informe o código da sala.");

  try {
    const url = new URL(value);
    const pathSlug = url.pathname.match(/\/(?:sala|room)\/([^/?#]+)/i)?.[1];
    const identifier = pathSlug ?? url.pathname.replace(/^\/+|\/+$/g, "");
    const accessCode = url.searchParams.get("access_code") ?? url.searchParams.get("code") ?? undefined;
    if (identifier) {
      const decodedIdentifier = decodeURIComponent(identifier);
      return {
        identifier: RoomCodeSchema.safeParse(decodedIdentifier.toUpperCase()).success
          ? decodedIdentifier.toUpperCase()
          : decodedIdentifier.toLowerCase(),
        ...(accessCode ? { accessCode } : {}),
      };
    }
  } catch {
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value)) return { identifier: value.toLowerCase() };
  }

  const parsedPath = value.match(/(?:^|\/)(?:sala|room)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\?[^#]*)?/i);
  if (parsedPath?.[1]) {
    const query = value.split("?")[1];
    const accessCode = query ? new URLSearchParams(query).get("access_code") ?? new URLSearchParams(query).get("code") ?? undefined : undefined;
    return { identifier: parsedPath[1].toLowerCase(), ...(accessCode ? { accessCode } : {}) };
  }
  if (RoomCodeSchema.safeParse(value.toUpperCase()).success) return { identifier: value.toUpperCase() };
  throw new Error("Link ou código inválido. Confira o convite recebido.");
}

function App() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<RoomSummary | null>(null);
  const [roomEntry, setRoomEntry] = useState<RoomEntryResponse | null>(null);
  const [creatorKey, setCreatorKey] = useState(() => readStored(CREATOR_KEY, ""));
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "recover">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState("");
  const [displayName, setDisplayName] = useState(() => readStored(PROFILE_KEY, { displayName: "" }).displayName);
  const [favorites, setFavorites] = useState<string[]>(() => readStored(FAVORITES_KEY, []));
  const [ownedSlugs, setOwnedSlugs] = useState<string[]>(() => readStored(OWNED_ROOMS_KEY, []));
  const [selectedSlug, setSelectedSlug] = useState(() => {
    const roomLink = window.location.pathname.match(/^\/(?:sala|room)\/([^/]+)/i)?.[1];
    return roomLink ? decodeURIComponent(roomLink) : "";
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoomSummary | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [pendingJoin, setPendingJoin] = useState<{ slug: string; roomCode?: string; accessCode?: string } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [roomVisibility, setRoomVisibility] = useState<"public" | "private">("private");
  const [roomPassword, setRoomPassword] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [search, setSearch] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hubOnline, setHubOnline] = useState(false);
  const [presenceAvailable, setPresenceAvailable] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [deleteDialogError, setDeleteDialogError] = useState("");
  const [joinDialogError, setJoinDialogError] = useState("");

  const refreshRooms = useCallback(async (secretToken = creatorKey) => {
    try {
      const response = await hubRequest(
        "/rooms",
        RoomListResponseSchema,
        { ...(secretToken ? { secretToken } : {}) },
      );
      setRooms(response.rooms);
      setPresenceAvailable(response.presence_available !== false);
      setHubOnline(true);
      setError("");
    } catch (requestError) {
      setHubOnline(false);
      setError(friendlyError(requestError, "Não foi possível carregar as salas."));
    } finally {
      setLoadingRooms(false);
    }
  }, [creatorKey]);

  useEffect(() => {
    let active = true;
    if (!creatorKey) {
      setAccount(null);
      setAuthReady(true);
      return () => { active = false; };
    }
    setAuthReady(false);
    void hubRequest("/auth/me", AccountUserResponseSchema, { secretToken: creatorKey })
      .then(({ user, recovery_code }) => {
        if (!active) return;
        setAccount(user);
        setDisplayName(user.display_name);
        setFavorites(readStored(`${FAVORITES_KEY}:${user.id}`, []));
        setOwnedSlugs(readStored(`${OWNED_ROOMS_KEY}:${user.id}`, []));
        setPendingRecoveryCode(recovery_code ?? "");
        setAuthError("");
      })
      .catch(() => {
        if (active) {
          setAccount(null);
          setAuthError("Sua sessão expirou. Entre novamente para continuar.");
        }
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => { active = false; };
  }, [creatorKey]);

  useEffect(() => {
    if (!account) {
      setRooms([]);
      setLoadingRooms(false);
      return;
    }
    void refreshRooms();
    const intervalId = window.setInterval(() => void refreshRooms(), 15_000);
    return () => window.clearInterval(intervalId);
  }, [account, refreshRooms]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(""), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (!presenceAvailable) {
      setNotice("Suas salas foram carregadas, mas a atividade e os participantes estão temporariamente indisponíveis.");
    }
  }, [presenceAvailable]);

  useEffect(() => {
    platformBridge.storage.set(CREATOR_KEY, creatorKey);
  }, [creatorKey]);

  useEffect(() => {
    platformBridge.storage.set(PROFILE_KEY, { displayName });
  }, [displayName]);

  useEffect(() => {
    if (account) platformBridge.storage.set(`${FAVORITES_KEY}:${account.id}`, favorites);
  }, [account, favorites]);

  useEffect(() => {
    if (account) platformBridge.storage.set(`${OWNED_ROOMS_KEY}:${account.id}`, ownedSlugs);
  }, [account, ownedSlugs]);

  const roomCards = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = query
      ? rooms.filter((room) => `${room.name} ${room.room_code} ${room.owner_display_name}`.toLocaleLowerCase().includes(query))
      : rooms;
    return [...filtered].sort((a, b) => Number(favorites.includes(b.slug)) - Number(favorites.includes(a.slug)));
  }, [favorites, rooms, search]);

  const enterRoom = useCallback(async (
    slug: string,
    options: {
      password?: string;
      accessCode?: string;
      roomCode?: string;
      method?: "slug" | "password" | "access_code";
      secretToken?: string;
      displayName?: string;
    } = {},
  ) => {
    const participantName = (options.displayName ?? displayName).trim();
    if (!participantName) {
      setError("Entre na sua conta para usar o apelido associado a ela.");
      return;
    }

    const method = options.method ?? (options.accessCode ? "access_code" : options.password ? "password" : "slug");
    const body = {
      method,
      slug,
      credentials: {
        display_name: participantName,
        ...((options.secretToken ?? creatorKey) ? { secret_token: options.secretToken ?? creatorKey } : {}),
      },
      ...(method === "password" && options.password ? { password: options.password } : {}),
      ...(method === "access_code" && options.accessCode ? { access_code: options.accessCode } : {}),
    };

    setBusy(true);
    setError("");
    setJoinDialogError("");
    try {
      const entry = await hubRequest(`/rooms/${encodeURIComponent(slug)}/enter`, RoomEntryResponseSchema, {
        method: "POST",
        body,
      });
      const room = entry.room;
      setRoomEntry(entry);
      setSelectedRoom(room);
      setSelectedSlug(slug);
      setDisplayName(participantName);
      setJoinOpen(false);
      setJoinPassword("");
      setPendingJoin(null);
      setFavorites((previous) => previous.includes(slug) ? previous : [...previous, slug]);
      setNotice("");
      await refreshRooms(options.secretToken ?? creatorKey);
    } catch (requestError) {
      if (requestError instanceof HubRequestError && ["password_required", "invalid_password"].includes(requestError.code ?? "")) {
        setPendingJoin({
          slug,
          ...(options.roomCode ? { roomCode: options.roomCode } : {}),
          ...(options.accessCode ? { accessCode: options.accessCode } : {}),
        });
        setJoinPassword("");
        setJoinDialogError(friendlyError(requestError, "Não foi possível validar o acesso."));
        setJoinOpen(true);
      } else {
        const message = friendlyError(requestError, "Não foi possível entrar na sala.");
        if (joinOpen) setJoinDialogError(message);
        else setError(message);
      }
    } finally {
      setBusy(false);
    }
  }, [creatorKey, displayName, refreshRooms, rooms]);

  const openRoom = (room: RoomSummary) => {
    setSelectedRoom(room);
    setSelectedSlug(room.slug);
    void enterRoom(room.slug, { roomCode: room.room_code });
  };

  const handleJoinLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const target = roomIdentifierFromInput(selectedSlug);
      const options = target.accessCode ? { accessCode: target.accessCode } : {};
      if (RoomCodeSchema.safeParse(target.identifier.toUpperCase()).success) {
        try {
          const response = await hubRequest(
            `/rooms/code/${encodeURIComponent(target.identifier.toUpperCase())}`,
            RoomCodeLookupResponseSchema,
          );
          await enterRoom(response.room.slug, { ...options, roomCode: response.room.room_code });
          return;
        } catch (requestError) {
          if (!(requestError instanceof HubRequestError) || requestError.code !== "room_not_found") throw requestError;
        }
      }
      await enterRoom(target.identifier.toLowerCase(), options);
    } catch (requestError) {
      setError(friendlyError(requestError, "Link inválido."));
    }
  };

  const recoverAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const parsed = RecoverAccountRequestSchema.safeParse({
      nickname: String(formData.get("nickname") ?? ""),
      recovery_code: String(formData.get("recovery_code") ?? "").trim(),
      new_password: String(formData.get("new_password") ?? ""),
      new_password_confirmation: String(formData.get("new_password_confirmation") ?? ""),
    });
    if (!parsed.success) {
      const newPassword = String(formData.get("new_password") ?? "");
      const confirmation = String(formData.get("new_password_confirmation") ?? "");
      setAuthError(newPassword !== confirmation
        ? "As senhas não coincidem. Confira a confirmação."
        : "Confira o apelido, o código de recuperação e a nova senha.");
      return;
    }

    setAuthBusy(true);
    setAuthError("");
    try {
      const result = await hubRequest("/auth/recover", AccountRecoveryResponseSchema, {
        method: "POST",
        body: parsed.data,
      });
      setCreatorKey(result.secret_token);
      setAccount(result.user);
      setDisplayName(result.user.display_name);
      setFavorites(readStored(`${FAVORITES_KEY}:${result.user.id}`, []));
      setOwnedSlugs(readStored(`${OWNED_ROOMS_KEY}:${result.user.id}`, []));
      setPendingRecoveryCode(result.recovery_code);
      setNotice("Senha redefinida. Guarde o novo código de recuperação antes de continuar.");
      setAuthReady(true);
    } catch (requestError) {
      setAuthError(friendlyError(requestError, "Não foi possível recuperar a conta."));
    } finally {
      setAuthBusy(false);
    }
  };

  const acknowledgeRecoveryCode = async (recoveryCode: string) => {
    if (!creatorKey) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    const payload = AcknowledgeRecoveryCodeRequestSchema.parse({ recovery_code: recoveryCode });
    await hubRequest("/auth/recovery/acknowledge", RecoveryAcknowledgmentResponseSchema, {
      method: "POST",
      body: payload,
      secretToken: creatorKey,
    });
    setPendingRecoveryCode("");
  };

  const handleDeleteRoom = async () => {
    if (!deleteTarget) return;
    if (!creatorKey) {
      setDeleteDialogError("Entre na conta que criou esta sala para excluí-la.");
      return;
    }

    setBusy(true);
    setDeleteDialogError("");
    try {
      const result = await hubRequest(
        `/rooms/${encodeURIComponent(deleteTarget.slug)}`,
        DeleteRoomResponseSchema,
        { method: "DELETE", body: { secret_token: creatorKey } },
      );
      setRooms((previous) => previous.filter((room) => room.slug !== deleteTarget.slug));
      setFavorites((previous) => previous.filter((slug) => slug !== deleteTarget.slug));
      setOwnedSlugs((previous) => previous.filter((slug) => slug !== deleteTarget.slug));
      setDeleteTarget(null);
      await refreshRooms();
      setNotice(result.livekit_session_closed
        ? "Sala excluída."
        : "Sala excluída; não foi possível confirmar o encerramento da sessão de mídia.");
    } catch (requestError) {
      setDeleteDialogError(friendlyError(requestError, "Não foi possível excluir a sala."));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setDialogError("");
    try {
      const parsedInput = CreateRoomRequestSchema.safeParse({
        name: nameInput,
        visibility: roomVisibility,
        display_name: displayName.trim(),
        ...(roomVisibility === "private" ? { password: roomPassword } : {}),
        layout_preset: "standard",
        addon_control_mode: "host_only",
        ...(creatorKey ? { secret_token: creatorKey } : {}),
      });
      if (!parsedInput.success) {
        const passwordIssue = parsedInput.error.issues.some((issue) => issue.path.includes("password"));
        setDialogError(passwordIssue
          ? "A senha precisa ter de 8 a 128 caracteres, incluindo pelo menos uma letra e um número."
          : "Confira o nome da sala e tente novamente.");
        return;
      }
      const input = parsedInput.data;
      const created = await hubRequest("/rooms", CreateRoomResponseSchema, { method: "POST", body: input });
      setCreatorKey(created.secret_token);
      setOwnedSlugs((previous) => previous.includes(created.room.slug) ? previous : [...previous, created.room.slug]);
      setDisplayName(input.display_name);
      setCreateOpen(false);
      setNameInput("");
      setRoomPassword("");
      setNotice(`Sala criada. Código ${created.room.room_code} pronto para compartilhar.`);
      await refreshRooms(created.secret_token);
      await enterRoom(created.room.slug, {
        method: "slug",
        secretToken: created.secret_token,
        displayName: input.display_name,
      });
    } catch (requestError) {
      const message = friendlyError(requestError, "Não foi possível criar a sala.");
      if (createOpen) setDialogError(message);
      else setError(`A sala pode ter sido criada, mas não foi possível entrar: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleJoinSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingJoin) return;
    setJoinDialogError("");
    await enterRoom(pendingJoin.slug, {
      ...(pendingJoin.roomCode ? { roomCode: pendingJoin.roomCode } : {}),
      ...(pendingJoin.accessCode
        ? { method: "access_code" as const, accessCode: pendingJoin.accessCode }
        : { method: "password" as const, password: joinPassword }),
    });
  };

  const toggleFavorite = (room: RoomSummary) => {
    setFavorites((previous) => previous.includes(room.slug)
      ? previous.filter((slug) => slug !== room.slug)
      : [...previous, room.slug]);
  };

  const copyRoomLink = async (roomCode: string) => {
    try {
      await platformBridge.copyToClipboard(`${window.location.origin}/sala/${roomCode}`);
      setNotice("Link copiado.");
    } catch (copyError) {
      setError(friendlyError(copyError, "Não foi possível copiar o link."));
    }
  };

  const authenticateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nickname = String(formData.get("nickname") ?? "");
    const password = String(formData.get("password") ?? "");
    const registering = authMode === "register";
    const confirmation = String(formData.get("password_confirmation") ?? "");
    const schema = registering ? RegisterAccountRequestSchema : LoginAccountRequestSchema;
    const parsed = schema.safeParse(registering
      ? { nickname, password, password_confirmation: confirmation }
      : { nickname, password });
    if (!parsed.success) {
      if (registering && password !== confirmation) {
        setAuthError("As senhas não coincidem. Confira a confirmação.");
        return;
      }
      setAuthError("Informe um apelido de 2 a 32 caracteres e uma senha de pelo menos 8 caracteres.");
      return;
    }

    setAuthBusy(true);
    setAuthError("");
    try {
      const path = registering ? "/auth/register" : "/auth/login";
      const result = await hubRequest(
        path,
        registering ? AccountRegistrationResponseSchema : AccountLoginResponseSchema,
        { method: "POST", body: parsed.data },
      );
      setCreatorKey(result.secret_token);
      setAccount(result.user);
      setDisplayName(result.user.display_name);
      setFavorites(readStored(`${FAVORITES_KEY}:${result.user.id}`, []));
      setOwnedSlugs(readStored(`${OWNED_ROOMS_KEY}:${result.user.id}`, []));
      setPendingRecoveryCode(result.recovery_code ?? "");
      setAuthReady(true);
    } catch (requestError) {
      setAuthError(friendlyError(requestError, "Não foi possível autenticar sua conta."));
    } finally {
      setAuthBusy(false);
    }
  };

  if (!authReady) {
    return <main className="auth-shell"><div className="loading-state"><span className="spinner" />Verificando sua conta...</div></main>;
  }

  if (pendingRecoveryCode && account) {
    return (
      <RecoveryCodeScreen
        code={pendingRecoveryCode}
        displayName={account.display_name}
        onContinue={acknowledgeRecoveryCode}
        onRestart={() => {
          setPendingRecoveryCode("");
          setCreatorKey("");
          setAccount(null);
          setAuthMode("login");
          setAuthError("");
        }}
      />
    );
  }

  if (!account) {
    return (
      <AuthScreen
        mode={authMode}
        busy={authBusy}
        error={authError}
        onSubmit={(event) => void (authMode === "recover" ? recoverAccount(event) : authenticateAccount(event))}
        onModeChange={(mode) => { setAuthMode(mode); setAuthError(""); }}
      />
    );
  }

  if (roomEntry && selectedRoom) {
    return (
      <RoomScreen
        room={selectedRoom}
        entry={roomEntry}
        secretToken={creatorKey}
        busy={busy}
        onLeave={() => {
          setRoomEntry(null);
          setSelectedRoom(null);
          setSelectedSlug("");
          void refreshRooms();
        }}
        onCopy={() => void copyRoomLink(selectedRoom.room_code)}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand-lockup" href="/" aria-label="Spectra início">
          <span className="brand-mark">S</span>
          <span><strong>SPECTRA</strong><small>Screen & media rooms</small></span>
        </a>
        <div className="header-right">
          <span className={`service-state${hubOnline ? " is-online" : ""}`}>
            <i aria-hidden="true" />{hubOnline ? "Salas atualizadas" : loadingRooms ? "Carregando salas" : "Falha ao carregar salas"}
          </span>
          <button className="profile-button" type="button" onClick={() => setProfileOpen(true)}>
            <span className="avatar">{displayName ? displayName[0]?.toUpperCase() : "?"}</span>
            <span className="profile-button-copy"><strong>{account.display_name}</strong><small>Conta conectada</small></span>
            <span className="chevron">⌄</span>
          </button>
        </div>
      </header>

      <div className="lobby-page">
        <div className="lobby-heading">
          <div>
            <div className="eyebrow">SEU ESPAÇO DE ENCONTRO</div>
            <h1>Suas salas</h1>
            <p>Entre para assistir, compartilhar sua tela e curtir mídia sincronizada com seu grupo.</p>
          </div>
          <button className="primary-button create-room-button" type="button" onClick={() => { setDialogError(""); setCreateOpen(true); }}>
            <span aria-hidden="true">＋</span> Criar nova sala
          </button>
        </div>

        <section className="join-strip" aria-label="Entrar em outra sala">
          <div className="join-strip-copy">
            <span className="join-icon" aria-hidden="true">↗</span>
            <span><strong>Tem um convite?</strong><small>Cole o link ou informe o código da sala.</small></span>
          </div>
          <form className="join-link-form" onSubmit={(event) => void handleJoinLink(event)}>
            <input
              aria-label="Link ou código da sala"
              autoComplete="url"
              onChange={(event) => setSelectedSlug(event.target.value)}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                if (pasted) {
                  event.preventDefault();
                  setSelectedSlug(pasted.trim());
                }
              }}
              placeholder="Cole o link ou digite o código da sala"
              value={selectedSlug}
            />
            <button type="submit" className="secondary-button" disabled={busy}>Encontrar sala <span aria-hidden="true">→</span></button>
          </form>
        </section>

        <div className="section-heading">
          <div>
            <div className="eyebrow" id="room-lobby-title">ACESSO RÁPIDO</div>
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Buscar salas" onChange={(event) => setSearch(event.target.value)} placeholder="Buscar sala ou host" value={search} />
            <kbd>⌘ K</kbd>
          </label>
        </div>

        {notice && <div className="notice-banner" role="status"><span>✓</span>{notice}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice("")}>×</button></div>}
        {error && <div className="error-banner" role="alert"><span>!</span>{error}<button type="button" aria-label="Fechar erro" onClick={() => setError("")}>×</button></div>}
        {!hubOnline && !loadingRooms && (
          <div className="connection-card">
            <div><strong>Não foi possível carregar as salas.</strong><p>Verifique sua conexão e tente novamente. Se persistir, o Hub ou o serviço de mídia pode estar indisponível.</p></div>
            <button className="secondary-button" type="button" onClick={() => { setLoadingRooms(true); void refreshRooms(); }}>Tentar novamente</button>
          </div>
        )}
        {deleteTarget && (
          <Modal
            title="Excluir sala?"
            subtitle={`“${deleteTarget.name}” e seus dados permanentes serão removidos. Esta ação não pode ser desfeita.`}
            onClose={() => { if (!busy) { setDeleteTarget(null); setDeleteDialogError(""); } }}
          >
            <div className="dialog-form">
              {deleteDialogError && <div className="dialog-error" role="alert">{deleteDialogError}</div>}
              <div className="dialog-actions">
                <button className="secondary-button" disabled={busy} onClick={() => setDeleteTarget(null)} type="button">Cancelar</button>
                <button className="danger-button" disabled={busy} onClick={() => void handleDeleteRoom()} type="button">{busy ? "Excluindo..." : "Excluir sala"}</button>
              </div>
            </div>
          </Modal>
        )}
        {loadingRooms && rooms.length === 0 && <div className="loading-state"><span className="spinner" />Conectando ao Hub e carregando salas...</div>}

        {hubOnline && (
          <RoomLobby
            rooms={roomCards}
            selectedRoomId={rooms.find((room) => room.slug === selectedSlug)?.id}
            favoriteRoomIds={new Set(favorites)}
            ownedRoomIds={new Set(ownedSlugs)}
            onSelectRoom={(room) => { setSelectedSlug(room.slug); setSelectedRoom(room as RoomSummary); }}
            onEnterRoom={openRoom}
            onCreateRoom={() => setCreateOpen(true)}
            onCopyRoomCode={(roomCode) => void copyRoomLink(roomCode)}
            onDeleteRoom={(room) => { setDeleteDialogError(""); setDeleteTarget(room); }}
            onToggleFavorite={toggleFavorite}
            platformBridge={platformBridge}
          />
        )}

        <footer className="lobby-footer">
          <span><span className="footer-orb" /> Compartilhamento de tela e mídia sincronizada.</span>
          <span>Códigos permanentes · Mídia iniciada quando alguém entra</span>
        </footer>
      </div>

      {createOpen && (
        <Modal title="Criar sala" subtitle={`Usando a conta ${displayName}. Um código permanente será gerado para compartilhar.`} onClose={() => { setCreateOpen(false); setDialogError(""); }}>
          <form className="dialog-form" onSubmit={(event) => void handleCreateRoom(event)}>
            <label>Nome da sala<input autoFocus maxLength={64} minLength={3} onChange={(event) => setNameInput(event.target.value)} placeholder="Ex.: Noite de jogos" required value={nameInput} /></label>
            <p className="dialog-note">Salas privadas continuam protegidas por senha.</p>
            <fieldset className="choice-group">
              <legend>Quem pode entrar?</legend>
              <label className={`choice-card${roomVisibility === "public" ? " selected" : ""}`}><input checked={roomVisibility === "public"} name="visibility" onChange={() => setRoomVisibility("public")} type="radio" /><span><strong>Pública</strong><small>Quem tiver o link pode entrar</small></span></label>
              <label className={`choice-card${roomVisibility === "private" ? " selected" : ""}`}><input checked={roomVisibility === "private"} name="visibility" onChange={() => setRoomVisibility("private")} type="radio" /><span><strong>Privada</strong><small>Exige uma senha para entrar</small></span></label>
            </fieldset>
            {roomVisibility === "private" && <label>Senha da sala<input autoComplete="new-password" minLength={8} onChange={(event) => setRoomPassword(event.target.value)} placeholder="Mínimo de 8 caracteres, com letra e número" required type="password" value={roomPassword} /></label>}
            {dialogError && <div className="dialog-error" role="alert">{dialogError}</div>}
            <div className="dialog-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)} type="button">Cancelar</button><button className="primary-button" disabled={busy} type="submit">{busy ? "Criando..." : "Criar e entrar"}</button></div>
          </form>
        </Modal>
      )}

      {joinOpen && pendingJoin && (
        <Modal title="Entrar na sala" subtitle={`${pendingJoin.roomCode ? `Código ${pendingJoin.roomCode} · ` : ""}Você entrará como ${displayName}.`} onClose={() => { setJoinOpen(false); setJoinDialogError(""); }}>
          <form className="dialog-form" onSubmit={(event) => void handleJoinSubmit(event)}>
            {pendingJoin.accessCode
              ? <label>Código de acesso<input autoComplete="one-time-code" maxLength={8} readOnly value={pendingJoin.accessCode} /></label>
              : <label>Senha da sala<input autoComplete="current-password" onChange={(event) => { setJoinPassword(event.target.value); setJoinDialogError(""); }} placeholder="Digite a senha da sala" required type="password" value={joinPassword} /></label>}
            {creatorKey && <p className="dialog-note">Sua conta será usada para recuperar suas permissões nesta sala.</p>}
            {joinDialogError && <div className="dialog-error" role="alert">{joinDialogError}</div>}
            <div className="dialog-actions"><button className="secondary-button" onClick={() => setJoinOpen(false)} type="button">Cancelar</button><button className="primary-button" disabled={busy} type="submit">{busy ? "Entrando..." : "Entrar na sala"}</button></div>
          </form>
        </Modal>
      )}

      {profileOpen && (
        <Modal title="Sua conta" subtitle="Seu perfil e suas salas ficam associados ao seu apelido em qualquer dispositivo." onClose={() => setProfileOpen(false)}>
          <div className="dialog-form">
            <div className="key-status"><span className="key-icon active">{account.display_name[0]?.toUpperCase()}</span><span><strong>{account.display_name}</strong><small>Conta Spectra · suas salas são vinculadas a esta conta</small></span></div>
            <div className="dialog-actions"><button className="secondary-button" onClick={() => setProfileOpen(false)} type="button">Fechar</button><button className="danger-button" onClick={() => { setCreatorKey(""); setAccount(null); setProfileOpen(false); setRooms([]); }} type="button">Sair da conta</button></div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function RoomScreen({
  room,
  entry,
  secretToken,
  onLeave,
  onCopy,
}: {
  room: RoomSummary;
  entry: RoomEntryResponse;
  secretToken: string;
  busy: boolean;
  onLeave: () => void;
  onCopy: () => void;
}) {
  const [addonsOpen, setAddonsOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureProfile, setCaptureProfile] = useState<"fluidity" | "sharpness">("sharpness");
  const [captureResolution, setCaptureResolution] = useState<"720p" | "1080p" | "1440p" | "4k">("1080p");
  const [captureBitrateKbps, setCaptureBitrateKbps] = useState(12_000);
  const [captureFramerate, setCaptureFramerate] = useState<15 | 30 | 60>(60);
  const [captureCodec, setCaptureCodec] = useState<ScreenShareCodec>("h264");
  const [activeCodec, setActiveCodec] = useState<ScreenShareCodec | null>(null);
  const [captureSystemAudio, setCaptureSystemAudio] = useState(!platformBridge.supportsNativeCapture);
  const [captureSources, setCaptureSources] = useState<ScreenCaptureSource[]>([]);
  const [selectedCaptureSourceId, setSelectedCaptureSourceId] = useState("");
  const [captureSourceReadyId, setCaptureSourceReadyId] = useState("");
  const [captureSourcesLoading, setCaptureSourcesLoading] = useState(false);
  const [captureSourceError, setCaptureSourceError] = useState("");
  const [mediaSession, setMediaSession] = useState<MediaSession | null>(null);
  const [mediaView, setMediaView] = useState<MediaSessionView>({
    connectionState: "connecting",
    participants: [],
    tracks: [],
  });
  const [mediaError, setMediaError] = useState("");
  const [mediaErrorDetails, setMediaErrorDetails] = useState("");
  const [qualityError, setQualityError] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [trackDiagnostics, setTrackDiagnostics] = useState<TrackMediaDiagnostics>({});
  const [mixerOpen, setMixerOpen] = useState(false);
  const [masterVolume, setMasterVolume] = useState(100);
  const [masterMuted, setMasterMuted] = useState(false);
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
  const [mutedParticipants, setMutedParticipants] = useState<Record<string, boolean>>({});
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [mediaNotice, setMediaNotice] = useState("");
  const [moderationError, setModerationError] = useState("");
  const [moderationNotice, setModerationNotice] = useState("");
  const [moderationBusyIdentity, setModerationBusyIdentity] = useState("");
  const [moderationTarget, setModerationTarget] = useState<string | null>(null);
  const [moderationStates, setModerationStates] = useState<Record<string, ParticipantState>>({});
  const [adminActionsAvailable, setAdminActionsAvailable] = useState(entry.role === "admin");
  const [focusedTrack, setFocusedTrack] = useState<string | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const videoTracks = mediaView.tracks.filter((track) => track.source === "screen_share");
  const audioTracks = mediaView.tracks.filter((track) => track.source === "screen_share_audio");
  const localIsStreaming = mediaView.tracks.some((track) => track.isLocal && track.source === "screen_share");

  useEffect(() => {
    if (!captureOpen || localIsStreaming || !platformBridge.supportsNativeCapture) return;
    let active = true;
    setCaptureSourcesLoading(true);
    setCaptureSourceError("");
    void platformBridge.listScreenSources().then((sources) => {
      if (!active) return;
      setCaptureSources(sources);
      setSelectedCaptureSourceId((selected) => sources.some((source) => source.id === selected) ? selected : "");
      if (sources.length === 0) setCaptureSourceError("Nenhuma tela ou janela disponível para compartilhar.");
    }).catch((error: unknown) => {
      if (active) setCaptureSourceError(friendlyError(error, "Não foi possível listar as telas disponíveis."));
    }).finally(() => {
      if (active) setCaptureSourcesLoading(false);
    });
    return () => { active = false; };
  }, [captureOpen, localIsStreaming]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let connectedSession: MediaSession | undefined;
    setMediaError("");
    setMediaErrorDetails("");
    setMediaView({ connectionState: "connecting", participants: [], tracks: [] });
    void connectMediaRoom(entry.livekit_url, entry.token).then((session) => {
      connectedSession = session;
      if (!active) {
        void session.disconnect();
        return;
      }
      unsubscribe = session.subscribe(setMediaView);
      setMediaSession(session);
    }).catch((connectionError: unknown) => {
      if (active) {
        setMediaView({ connectionState: "disconnected", participants: [], tracks: [] });
        setMediaError(mediaConnectionError(connectionError));
        setMediaErrorDetails(technicalError(connectionError));
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
      setMediaSession(null);
      if (connectedSession) void connectedSession.disconnect();
    };
  }, [connectionAttempt, entry.livekit_url, entry.token]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "f" && !event.repeat) {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.querySelector(".showroom-stage")?.requestFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (focusedTrack !== null && !videoTracks.some((track) => track.sid === focusedTrack)) {
      setFocusedTrack(null);
    }
  }, [focusedTrack, videoTracks]);
  useEffect(() => {
    if (!localIsStreaming) setActiveCodec(null);
  }, [localIsStreaming]);

  const diagnosticTrackSid = focusedTrack ?? videoTracks[0]?.sid;
  useEffect(() => {
    if (!statsOpen || mediaSession === null || diagnosticTrackSid === undefined) {
      setTrackDiagnostics({});
      return;
    }
    let active = true;
    const updateDiagnostics = () => {
      void mediaSession.getTrackMediaDiagnostics(diagnosticTrackSid).then((stats) => {
        if (active && stats !== undefined) setTrackDiagnostics(stats);
      }).catch((error: unknown) => {
        if (active) setQualityError(friendlyError(error, "Não foi possível ler as estatísticas desta transmissão."));
      });
    };
    updateDiagnostics();
    const interval = window.setInterval(updateDiagnostics, 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [diagnosticTrackSid, mediaSession, statsOpen]);
  useEffect(() => {
    if (!mediaNotice) return;
    const timeout = window.setTimeout(() => setMediaNotice(""), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [mediaNotice]);

  const startShare = async () => {
    if (!mediaSession) return;
    setMediaError("");
    setMediaErrorDetails("");
    try {
      if (platformBridge.supportsNativeCapture) {
        if (!selectedCaptureSourceId || captureSourceReadyId !== selectedCaptureSourceId) {
          setCaptureSourceError("Escolha uma tela ou janela antes de iniciar.");
          return;
        }
      }
      setCaptureOpen(false);
      const result = await mediaSession.startScreenShare({
        captureSystemAudio: platformBridge.supportsNativeCapture ? false : captureSystemAudio,
        profile: captureProfile,
        resolution: captureResolution,
        maxBitrateKbps: captureBitrateKbps,
        maxFramerate: captureFramerate,
        codec: captureCodec,
      });
      setActiveCodec(result.codec);
      setMediaNotice(result.fellBackToH264
        ? `O navegador não conseguiu iniciar ${captureCodec.toUpperCase()}; a transmissão começou em H.264.`
        : `Transmissão iniciada com ${result.codec.toUpperCase()}.`);
    } catch (shareError) {
      setMediaError(screenShareError(shareError));
      setMediaErrorDetails(technicalError(shareError));
    }
  };
  const updateShareSettings = async () => {
    if (!mediaSession) return;
    setMediaError("");
    setMediaErrorDetails("");
    try {
      await mediaSession.updateScreenShareSettings({
        profile: captureProfile,
        resolution: captureResolution,
        maxBitrateKbps: captureBitrateKbps,
        maxFramerate: captureFramerate,
      });
      setCaptureOpen(false);
    } catch (settingsError) {
      setMediaError(friendlyError(settingsError, "Não foi possível aplicar as configurações."));
      setMediaErrorDetails(technicalError(settingsError));
    }
  };
  const stopShare = async () => {
    if (!mediaSession) return;
    try {
      await mediaSession.stopScreenShare();
      setActiveCodec(null);
    } catch (shareError) {
      setMediaError(friendlyError(shareError, "Não foi possível encerrar o compartilhamento."));
    }
  };
  const moderateParticipant = async (target: MediaSessionView["participants"][number], action: ModerationAction) => {
    if (!secretToken || !adminActionsAvailable) return;
    const confirmations: Partial<Record<ModerationAction, string>> = {
      kick: `Remover ${target.displayName} desta sessão?`,
      ban: `Bloquear ${target.displayName} de retornar a esta sala?`,
      transfer_host: `Transferir a administração da sala para ${target.displayName}? Você precisará entrar novamente para atualizar seu acesso.`,
    };
    const confirmation = confirmations[action];
    if (confirmation !== undefined && !window.confirm(confirmation)) return;

    setModerationBusyIdentity(target.identity);
    setModerationError("");
    setModerationNotice("");
    try {
      const result = await hubRequest(
        `/rooms/${encodeURIComponent(room.slug)}/moderation`,
        ModerationResultSchema,
        {
          method: "POST",
          secretToken,
          body: { action, target_identity: target.identity, actor_secret_token: secretToken },
        },
      );
      setModerationStates((current) => {
        const next = { ...current };
        for (const participant of mediaView.participants) {
          if (
            participant.identity === target.identity
            || (target.accountIdentity !== undefined && participant.accountIdentity === target.accountIdentity)
          ) {
            next[participant.identity] = { ...result.target, identity: participant.identity };
          }
        }
        return next;
      });
      setModerationTarget(null);
      if (!result.livekit_applied) {
        setModerationError("A ação foi salva, mas não chegou ao LiveKit. Ela valerá quando o participante reconectar.");
        return;
      }
      const messages: Record<ModerationAction, string> = {
        end_stream: `Transmissão de ${target.displayName} encerrada.`,
        block_screen_share: `Compartilhamento de ${target.displayName} bloqueado.`,
        allow_screen_share: `Compartilhamento de ${target.displayName} liberado.`,
        kick: `${target.displayName} foi removido da sala.`,
        ban: `${target.displayName} foi bloqueado de retornar à sala.`,
        unban: `Acesso de ${target.displayName} restaurado.`,
        transfer_host: `Administração transferida para ${target.displayName}. O novo host deve entrar novamente para atualizar o perfil.`,
      };
      setModerationNotice(messages[action]);
      if (action === "transfer_host") setAdminActionsAvailable(false);
    } catch (error) {
      setModerationError(friendlyError(error, "Não foi possível aplicar a ação de moderação."));
    } finally {
      setModerationBusyIdentity("");
    }
  };
  const focused = videoTracks.find((track) => track.sid === focusedTrack);
  const changeTrackQuality = (sid: string, quality: ScreenTrackQuality) => {
    if (mediaSession === null) {
      setQualityError("A conexão de mídia ainda não está pronta para ajustar a qualidade.");
      return;
    }
    try {
      mediaSession.setTrackQuality(sid, quality);
      setQualityError("");
    } catch (error) {
      setQualityError(friendlyError(error, "Não foi possível alterar a qualidade desta transmissão."));
    }
  };
  const setParticipantVolume = (identity: string, volume: number) => {
    setParticipantVolumes((current) => ({ ...current, [identity]: volume }));
  };
  const toggleParticipantMute = (identity: string) => {
    setMutedParticipants((current) => ({ ...current, [identity]: !current[identity] }));
  };
  const enableAudioPlayback = () => {
    const contexts = [...audioContexts];
    if (contexts.length === 0) {
      setAudioError("O áudio da sala ainda não está disponível.");
      return;
    }
    void Promise.all(contexts.map((context) => context.resume())).then(() => {
      setAudioEnabled(true);
      setAudioError("");
    }).catch((error: unknown) => {
      setAudioError(friendlyError(error, "Não foi possível ativar o áudio da sala."));
    });
  };

  const chooseCaptureSource = async (sourceId: string) => {
    setSelectedCaptureSourceId(sourceId);
    setCaptureSourceReadyId("");
    setCaptureSourceError("");
    if (!platformBridge.supportsNativeCapture) return;
    try {
      await platformBridge.selectScreenSource?.(sourceId);
      setCaptureSourceReadyId(sourceId);
    } catch (selectionError) {
      setSelectedCaptureSourceId("");
      setCaptureSourceError(friendlyError(selectionError, "Não foi possível selecionar esta tela ou janela."));
    }
  };

  return (
    <main className={`room-shell${theaterMode ? " theater-mode" : ""}`}>
      <header className="room-header">
        <button className="brand-lockup compact" onClick={onLeave} type="button"><span className="brand-mark">S</span><span><strong>SPECTRA</strong><small>SAIR DA SALA</small></span></button>
        <div className="room-header-title"><span className={`room-header-live${mediaView.connectionState === "connected" ? "" : " waiting"}`}><i /> {mediaView.connectionState === "connected" ? "Ao vivo" : mediaView.connectionState === "reconnecting" ? "Reconectando" : mediaView.connectionState === "disconnected" ? "Desconectado" : "Conectando"}</span><strong>{room.name}</strong><span>Código {room.room_code}</span><button aria-label="Copiar link da sala" className="icon-button" onClick={onCopy} type="button">▢</button></div>
        <div className="room-header-right"><span className="connection-pill">{mediaView.connectionState === "connected" ? "Mídia conectada" : mediaView.connectionState === "disconnected" ? "Mídia desconectada" : "Conectando mídia"}</span><button className="icon-button" aria-label="Abrir perfil" type="button">⚙</button></div>
      </header>
      <div className="room-content">
        <section className="showroom-stage">
          <div className="stage-toolbar">
            <div><div className="eyebrow">{room.layout_preset === "rpg_theater" ? "MODO TEATRO" : "SALA"}</div><h1>{room.name}</h1></div>
            <div className="stage-tools">
              <span className="stream-count">{videoTracks.length} {videoTracks.length === 1 ? "transmissão ativa" : "transmissões ativas"}</span>
              {focused && <button className="secondary-button" onClick={() => setFocusedTrack(null)} type="button">Todas as transmissões</button>}
              <button aria-pressed={theaterMode} className="icon-button fullscreen-stage-button" onClick={() => setTheaterMode((enabled) => !enabled)} type="button" aria-label={theaterMode ? "Sair do modo teatro" : "Ativar modo teatro"} title={theaterMode ? "Sair do modo teatro" : "Modo teatro"}>▣</button>
              <button className="icon-button fullscreen-stage-button" onClick={() => document.fullscreenElement ? void document.exitFullscreen() : void document.querySelector(".showroom-stage")?.requestFullscreen()} type="button" aria-label="Tela cheia" title="Tela cheia">⛶</button>
            </div>
          </div>
          {mediaError && !captureOpen && <div className="media-error" role="alert">{mediaError}{mediaErrorDetails && <details><summary>Detalhes técnicos</summary><code>{mediaErrorDetails}</code></details>}</div>}
          {mediaView.connectionState === "disconnected" && <div className="connection-actions"><button className="primary-button" onClick={() => { setMediaError(""); setMediaErrorDetails(""); setMediaView({ connectionState: "connecting", participants: [], tracks: [] }); setConnectionAttempt((attempt) => attempt + 1); }} type="button">Tentar novamente</button><button className="secondary-button" onClick={onLeave} type="button">Voltar às salas</button></div>}
          {videoTracks.length === 0 ? (
            <div className="stage-empty">
              <div className="screen-orbit"><span className="screen-icon">▣</span><span className="orbit-dot one" /><span className="orbit-dot two" /><span className="orbit-dot three" /></div>
              <h2>{mediaView.connectionState === "connected" ? "A sala está pronta para a transmissão" : mediaView.connectionState === "disconnected" ? "Não foi possível conectar à mídia" : "Conectando à sala de mídia"}</h2>
              <p>{mediaView.connectionState === "connected"
                ? <>Você entrou como <strong>{entry.display_name}</strong>. Compartilhe a tela ou aguarde a transmissão de alguém.</>
                : mediaView.connectionState === "disconnected"
                  ? "Você continua na sala, mas não consegue ver ou compartilhar telas até a conexão ser restabelecida."
                  : "Sua entrada foi autorizada. Estamos estabelecendo a conexão segura com o servidor de mídia."}</p>
                  <div className="media-connection"><span className={`service-state${mediaView.connectionState === "connected" ? " is-online" : ""}`}><i /> {mediaView.connectionState === "connected" ? "Mídia conectada" : mediaView.connectionState === "disconnected" ? "Mídia desconectada" : "Conexão de mídia"}</span></div>
            </div>
          ) : (
            focused
              ? <div className="focus-layout">
                  <ScreenTile
                    key={focused.sid}
                    track={focused}
                    session={mediaSession}
                    focused
                    hasAudio={audioTracks.some((track) => track.participantIdentity === focused.participantIdentity)}
                    volumePercent={participantVolumes[focused.participantIdentity] ?? 100}
                    muted={mutedParticipants[focused.participantIdentity] ?? false}
                    onFocus={() => undefined}
                    onQualityChange={changeTrackQuality}
                    onVolumeChange={(volume) => setParticipantVolume(focused.participantIdentity, volume)}
                    onMuteToggle={() => toggleParticipantMute(focused.participantIdentity)}
                  />
                  <aside className="focus-rail" aria-label="Outras transmissões">
                    {videoTracks.filter((track) => track.sid !== focused.sid).map((track) => (
                      <ScreenTile
                        key={track.sid}
                        track={track}
                        session={mediaSession}
                        compact
                        hasAudio={audioTracks.some((audio) => audio.participantIdentity === track.participantIdentity)}
                        volumePercent={participantVolumes[track.participantIdentity] ?? 100}
                        muted={mutedParticipants[track.participantIdentity] ?? false}
                        onFocus={() => setFocusedTrack(track.sid)}
                        onQualityChange={changeTrackQuality}
                        onVolumeChange={(volume) => setParticipantVolume(track.participantIdentity, volume)}
                        onMuteToggle={() => toggleParticipantMute(track.participantIdentity)}
                      />
                    ))}
                  </aside>
                </div>
              : <div className="screen-grid">
                  {videoTracks.map((track) => (
                    <ScreenTile
                      key={track.sid}
                      track={track}
                      session={mediaSession}
                      hasAudio={audioTracks.some((audio) => audio.participantIdentity === track.participantIdentity)}
                      volumePercent={participantVolumes[track.participantIdentity] ?? 100}
                      muted={mutedParticipants[track.participantIdentity] ?? false}
                      onFocus={() => setFocusedTrack(track.sid)}
                      onQualityChange={changeTrackQuality}
                      onVolumeChange={(volume) => setParticipantVolume(track.participantIdentity, volume)}
                      onMuteToggle={() => toggleParticipantMute(track.participantIdentity)}
                    />
                  ))}
                </div>
          )}
          {audioTracks.map((track) => <AudioTrack
            key={track.sid}
            session={mediaSession}
            sid={track.sid}
            gain={masterMuted || mutedParticipants[track.participantIdentity]
              ? 0
              : (masterVolume / 100) * ((participantVolumes[track.participantIdentity] ?? 100) / 100)}
            onError={setAudioError}
          />)}
          {mediaNotice && <div className="media-notice" role="status">{mediaNotice}</div>}
          {qualityError && <div className="quality-feedback" role="alert">{qualityError}</div>}
          <div className="stage-bottom-bar"><span>Clique em uma transmissão para ampliar · Tela cheia expande a sala inteira</span><button aria-expanded={statsOpen} className="icon-button" onClick={() => setStatsOpen((open) => !open)} type="button" aria-label={statsOpen ? "Fechar diagnóstico de mídia" : "Abrir diagnóstico de mídia"} title="Diagnóstico de mídia">⌁</button></div>
          {statsOpen && <section className="media-diagnostics" aria-label="Diagnóstico de mídia" role="status">
            <div><span>Conexão</span><strong>{mediaView.connectionState === "connected" ? "Conectada" : mediaView.connectionState === "reconnecting" ? "Reconectando" : mediaView.connectionState === "disconnected" ? "Desconectada" : "Conectando"}</strong></div>
            <div><span>Participantes</span><strong>{mediaView.participants.length}</strong></div>
            <div><span>Transmissões de tela</span><strong>{videoTracks.length}</strong></div>
            <div><span>Faixas de áudio da sala</span><strong>{audioTracks.length}</strong></div>
            <div><span>Recepção</span><strong>{trackDiagnostics.resolution ?? "Aguardando dados"}{trackDiagnostics.framesPerSecond !== undefined ? ` · ${trackDiagnostics.framesPerSecond} FPS` : ""}</strong></div>
            <div><span>Bitrate recebido</span><strong>{trackDiagnostics.bitrateKbps !== undefined ? `${new Intl.NumberFormat("pt-BR").format(trackDiagnostics.bitrateKbps)} Kbps` : "Amostrando..."}</strong></div>
            <div><span>Codec / RTT</span><strong>{trackDiagnostics.codec ?? "—"}{trackDiagnostics.roundTripTimeMs !== undefined ? ` · ${trackDiagnostics.roundTripTimeMs} ms` : ""}</strong></div>
            <div><span>Jitter / pacotes perdidos</span><strong>{trackDiagnostics.jitterMs !== undefined ? `${trackDiagnostics.jitterMs} ms` : "—"}{trackDiagnostics.packetsLost !== undefined ? ` · ${trackDiagnostics.packetsLost}` : ""}</strong></div>
          </section>}
        </section>
        <aside className={`addon-drawer${addonsOpen ? " open" : ""}`}>
          <div className="drawer-heading"><span><span className="drawer-icon">♫</span><strong>Central de mídia</strong></span><button className="icon-button" type="button" aria-label="Fechar central de mídia" onClick={() => setAddonsOpen(false)}>×</button></div>
          <div className="addon-empty"><span>♫</span><strong>Nenhum addon ativo</strong><p>Os controles de música e vídeo sincronizado aparecerão aqui quando os addons da sala forem habilitados.</p></div>
          <div className="drawer-footer"><span>Controle de addons</span><strong>{room.addon_control_mode === "host_only" ? "Somente host" : "Democrático"}</strong></div>
        </aside>
      </div>
      <footer className="participant-dock">
        <div className="dock-members"><div className="dock-label">NA SALA <span>{mediaView.participants.length}</span></div>{mediaView.participants.map((participant) => {
          const moderationState = moderationStates[participant.identity];
          const participantCanShare = moderationState?.can_share_screen ?? participant.canShareScreen ?? true;
          const canModerate = adminActionsAvailable && entry.role === "admin" && !participant.isLocal && Boolean(secretToken);
          const accountParticipant = participant.identity.startsWith("u-");
          return <div className="participant-chip" key={participant.identity}>
            {canModerate
              ? <div className="moderation-menu">
                  <button
                    aria-expanded={moderationTarget === participant.identity}
                    aria-label={`Ações de moderação para ${participant.displayName}`}
                    className="avatar moderation-trigger"
                    onClick={() => setModerationTarget((current) => current === participant.identity ? null : participant.identity)}
                    type="button"
                  >{participant.displayName[0]?.toUpperCase()}</button>
                  {moderationTarget === participant.identity && <div className="moderation-popover" role="menu">
                    <strong>{participant.displayName}</strong>
                    {participant.isStreaming && <button disabled={moderationBusyIdentity === participant.identity} onClick={() => void moderateParticipant(participant, "end_stream")} role="menuitem" type="button">Encerrar transmissão</button>}
                    <button disabled={moderationBusyIdentity === participant.identity} onClick={() => void moderateParticipant(participant, participantCanShare ? "block_screen_share" : "allow_screen_share")} role="menuitem" type="button">{participantCanShare ? "Bloquear compartilhamento" : "Liberar compartilhamento"}</button>
                    <button disabled={moderationBusyIdentity === participant.identity} onClick={() => void moderateParticipant(participant, "kick")} role="menuitem" type="button">Remover da sala</button>
                    <button className="moderation-danger" disabled={moderationBusyIdentity === participant.identity} onClick={() => void moderateParticipant(participant, "ban")} role="menuitem" type="button">Bloquear acesso</button>
                    {accountParticipant && participant.role !== "admin" && <button disabled={moderationBusyIdentity === participant.identity} onClick={() => void moderateParticipant(participant, "transfer_host")} role="menuitem" type="button">Transferir administração</button>}
                  </div>}
                </div>
              : <span className="avatar">{participant.displayName[0]?.toUpperCase()}</span>}
            <strong>{participant.displayName}</strong>{participant.isLocal && entry.role === "admin" && <span className="crown" title="Host">♛</span>}{participant.isLocal && <span className="you-label">Você</span>}{participant.isStreaming && <span className="streaming-dot" title="Transmitindo" />}
          </div>;
        })}</div>
        {moderationError && <div className="moderation-feedback error" role="alert">{moderationError}</div>}
        {moderationNotice && <div className="moderation-feedback" role="status">{moderationNotice}</div>}
        <div className="dock-actions"><button className="share-screen-button" disabled={!entry.can_share_screen || mediaView.connectionState !== "connected"} onClick={() => setCaptureOpen(true)} title={!entry.can_share_screen ? "Você não tem permissão para compartilhar nesta sala." : localIsStreaming ? "Ajustar sua transmissão ativa." : "Compartilhe uma tela ou janela."} type="button"><span>▣</span> {localIsStreaming ? "Configurar transmissão" : "Compartilhar tela"}</button>{localIsStreaming && <button className="stop-share-button" onClick={() => void stopShare()} type="button"><span>■</span> Parar transmissão</button>}<button className={`dock-action${addonsOpen ? " active" : ""}`} onClick={() => setAddonsOpen((open) => !open)} type="button"><span>♬</span> Addons</button><button className={`dock-action${mixerOpen ? " active" : ""}`} disabled={audioTracks.length === 0} onClick={() => setMixerOpen(true)} title={audioTracks.length === 0 ? "Não há faixas de áudio de tela na sala." : "Ajustar volume geral e individual."} type="button"><span>◖</span> Mixer</button><button className="leave-button" onClick={onLeave} type="button"><span>↪</span> Sair</button></div>
      </footer>
      {mixerOpen && <Modal title="Mixer da sala" subtitle="Controles locais: as alterações de volume só afetam sua reprodução." onClose={() => setMixerOpen(false)}>
        <div className="dialog-form mixer-form">
          <div className="mixer-control">
            <label htmlFor="master-volume">Volume geral <strong>{masterVolume}%</strong></label>
            <input id="master-volume" max={200} min={0} onChange={(event) => setMasterVolume(Number(event.target.value))} type="range" value={masterVolume} />
            <button aria-pressed={masterMuted} className="secondary-button mixer-mute-button" onClick={() => setMasterMuted((muted) => !muted)} type="button">{masterMuted ? "Ativar volume geral" : "Silenciar tudo"}</button>
          </div>
          <button className="primary-button" onClick={enableAudioPlayback} type="button">{audioEnabled ? "Reativar áudio" : "Ativar áudio da sala"}</button>
          {audioEnabled && <p className="dialog-note">Áudio da sala ativado neste dispositivo.</p>}
          {audioError && <div className="dialog-error" role="alert">{audioError}</div>}
          {Array.from(new Map(audioTracks.map((track) => [track.participantIdentity, track.participantName])).entries()).map(([identity, name]) => <div className="mixer-control" key={identity}>
            <label htmlFor={`participant-volume-${identity}`}>{name}<strong>{participantVolumes[identity] ?? 100}%</strong></label>
            <input id={`participant-volume-${identity}`} max={200} min={0} onChange={(event) => setParticipantVolume(identity, Number(event.target.value))} type="range" value={participantVolumes[identity] ?? 100} />
            <button aria-pressed={mutedParticipants[identity] ?? false} className="secondary-button mixer-mute-button" onClick={() => toggleParticipantMute(identity)} type="button">{mutedParticipants[identity] ? `Ativar ${name}` : `Silenciar ${name}`}</button>
          </div>)}
          <div className="dialog-actions"><button className="secondary-button" onClick={() => setMixerOpen(false)} type="button">Fechar</button></div>
        </div>
      </Modal>}
      {captureOpen && <Modal className="capture-dialog" title={localIsStreaming ? "Configurar transmissão" : "Compartilhar tela"} subtitle={localIsStreaming ? "Ajuste a qualidade da transmissão em tempo real." : platformBridge.supportsNativeCapture ? "Escolha uma tela ou janela e defina a qualidade da transmissão." : "Defina a qualidade; o seletor seguro do navegador será aberto ao iniciar."} onClose={() => setCaptureOpen(false)}>
        <div className="dialog-form">
          {localIsStreaming && <p className="dialog-note">Esta conexão já está transmitindo. FPS, bitrate e perfil podem ser atualizados agora; codec só pode ser alterado reiniciando a transmissão.</p>}
          {!localIsStreaming && !platformBridge.supportsNativeCapture && <p className="dialog-note capture-picker-note">Na Web, o Chrome/Edge abre a janela “Escolher o que compartilhar” ao iniciar. Web e Desktop podem permanecer conectados; cada conexão usa uma identidade de mídia própria.</p>}
          {!localIsStreaming && platformBridge.supportsNativeCapture && <section className="capture-source-picker" aria-label="Telas e janelas disponíveis">
            <div className="capture-source-heading"><strong>O que deseja compartilhar?</strong>{captureSourcesLoading && <span className="spinner" />}</div>
            {captureSourceError && <div className="dialog-error" role="alert">{captureSourceError}</div>}
            {!captureSourcesLoading && captureSources.length > 0 && <div className="capture-source-list">
              {captureSources.map((source) => <button
                aria-pressed={selectedCaptureSourceId === source.id}
                className={`capture-source-card${selectedCaptureSourceId === source.id ? " selected" : ""}`}
                key={source.id}
                onClick={() => void chooseCaptureSource(source.id)}
                type="button"
              >
                {source.thumbnailDataUrl ? <img alt="" src={source.thumbnailDataUrl} /> : <span className="capture-source-placeholder">▣</span>}
                <span title={source.label}><strong>{source.label}</strong><small>{source.description ?? (source.kind === "monitor" ? "Captura a tela inteira deste monitor." : "Captura somente esta janela do aplicativo.")}</small></span>
              </button>)}
            </div>}
          </section>}
          <fieldset className="choice-group">
            <legend>Perfil de captura</legend>
            <label className={`choice-card${captureProfile === "fluidity" ? " selected" : ""}`}><input checked={captureProfile === "fluidity"} name="capture-profile" onChange={() => setCaptureProfile("fluidity")} type="radio" /><span><strong>Fluidez</strong><small>Movimento e maior taxa de quadros</small></span></label>
            <label className={`choice-card${captureProfile === "sharpness" ? " selected" : ""}`}><input checked={captureProfile === "sharpness"} name="capture-profile" onChange={() => setCaptureProfile("sharpness")} type="radio" /><span><strong>Nitidez</strong><small>Texto e detalhes com alta definição</small></span></label>
          </fieldset>
          {!localIsStreaming
            ? <label>Codec de transmissão<select value={captureCodec} onChange={(event) => {
                const codec = event.currentTarget.value;
                if (codec === "h264" || codec === "vp9" || codec === "av1") setCaptureCodec(codec);
              }}><option value="h264">H.264 · Compatibilidade</option><option value="vp9">VP9 · SVC</option><option value="av1">AV1 · SVC</option></select></label>
            : <p className="dialog-note">Codec atual: {(activeCodec ?? captureCodec).toUpperCase()}. Para trocar, encerre e inicie a transmissão novamente.</p>}
          {!localIsStreaming && captureCodec !== "h264" && <p className="dialog-note">SVC exige suporte do navegador e do encoder. Se a publicação não iniciar, o Spectra tentará novamente usando H.264.</p>}
          <label>Resolução<select value={captureResolution} onChange={(event) => setCaptureResolution(event.target.value as typeof captureResolution)}><option value="720p">1280 × 720 (720p)</option><option value="1080p">1920 × 1080 (1080p)</option><option value="1440p">2560 × 1440 (1440p)</option><option value="4k">3840 × 2160 (4K)</option></select></label>
          <div className="stream-options">
            <label>FPS<select value={captureFramerate} onChange={(event) => setCaptureFramerate(Number(event.target.value) as 15 | 30 | 60)}><option value={15}>15 FPS</option><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></label>
            <label>Bitrate<select value={captureBitrateKbps} onChange={(event) => setCaptureBitrateKbps(Number(event.target.value))}>{BITRATE_OPTIONS_KBPS.map((bitrate) => <option key={bitrate} value={bitrate}>{new Intl.NumberFormat("pt-BR").format(bitrate)} Kbps{bitrate === recommendedBitrateKbps(captureResolution, captureFramerate, captureProfile) ? " · Recomendado" : ""}</option>)}</select></label>
          </div>
          <label className={`system-audio-toggle${platformBridge.supportsNativeCapture ? " is-disabled" : ""}`}><input checked={captureSystemAudio} disabled={platformBridge.supportsNativeCapture} onChange={(event) => setCaptureSystemAudio(event.target.checked)} type="checkbox" /><span><strong>Áudio da janela selecionada</strong><small>{platformBridge.supportsNativeCapture ? "Indisponível no Desktop: o Electron oferece loopback global, não áudio isolado deste aplicativo. O controle fica desativado para evitar transmitir sons de outros aplicativos." : "A Web solicita áudio apenas para a janela/aba escolhida quando o navegador oferece suporte; monitores e fontes sem áudio não publicam uma faixa de áudio."}</small></span></label>
          {mediaError && <div className="media-error" role="alert">{mediaError}{mediaErrorDetails && <details><summary>Detalhes técnicos</summary><code>{mediaErrorDetails}</code></details>}</div>}
          <div className="dialog-actions"><button className="secondary-button" onClick={() => setCaptureOpen(false)} type="button">Cancelar</button><button className="primary-button" disabled={!localIsStreaming && platformBridge.supportsNativeCapture && (captureSourcesLoading || !selectedCaptureSourceId || captureSourceReadyId !== selectedCaptureSourceId)} onClick={() => void (localIsStreaming ? updateShareSettings() : startShare())} type="button">{localIsStreaming ? "Aplicar agora" : "Iniciar compartilhamento"}</button></div>
        </div>
      </Modal>}
    </main>
  );
}

function ScreenTile({
  track,
  session,
  compact = false,
  focused = false,
  hasAudio = false,
  volumePercent = 100,
  muted = false,
  onFocus,
  onQualityChange,
  onVolumeChange,
  onMuteToggle,
}: {
  track: MediaSessionView["tracks"][number];
  session: MediaSession | null;
  compact?: boolean;
  focused?: boolean;
  hasAudio?: boolean;
  volumePercent?: number;
  muted?: boolean;
  onFocus: () => void;
  onQualityChange: (sid: string, quality: ScreenTrackQuality) => void;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
}) {
  const [fitMode, setFitMode] = useState<"fit" | "fill" | "crop">("fit");
  const [crop, setCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [draftCrop, setDraftCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [sourceAspectRatio, setSourceAspectRatio] = useState(0);
  const [osdVisible, setOsdVisible] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const osdTimeout = useRef<number | null>(null);
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    if (element === null || session === null) return;
    return session.attachTrack(track.sid, element);
  }, [session, track.sid]);
  const onCropPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (fitMode !== "crop") return;
    if (event.target instanceof Element && event.target.closest("button, select, input, label")) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    pointerStart.current = point;
    setDraftCrop({ ...point, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onCropPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (fitMode !== "crop" || pointerStart.current === null) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const start = pointerStart.current;
    setDraftCrop({
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    });
  };
  const onCropPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (fitMode !== "crop" || pointerStart.current === null) return;
    event.preventDefault();
    event.stopPropagation();
    pointerStart.current = null;
    setCrop((selection) => draftCrop !== null && draftCrop.width > 0.03 && draftCrop.height > 0.03 ? draftCrop : selection);
    setDraftCrop(null);
  };
  const activeCrop = crop ?? draftCrop;
  const cropScale = activeCrop === null ? 1 : Math.max(1 / activeCrop.width, 1 / activeCrop.height);
  const videoStyle: CSSProperties = fitMode === "crop" && activeCrop !== null
    ? {
        objectFit: "cover",
        transform: `translate(${-activeCrop.x * cropScale * 100}%, ${-activeCrop.y * cropScale * 100}%) scale(${cropScale})`,
        transformOrigin: "top left",
      }
    : { objectFit: fitMode === "fill" ? "cover" : "contain", transform: "none" };
  const revealOSD = () => {
    setOsdVisible(true);
    if (osdTimeout.current !== null) window.clearTimeout(osdTimeout.current);
    osdTimeout.current = window.setTimeout(() => {
      osdTimeout.current = null;
      setOsdVisible(false);
    }, 2_500);
  };
  useEffect(() => () => {
    if (osdTimeout.current !== null) window.clearTimeout(osdTimeout.current);
  }, []);
  return (
    <article
      className={`screen-tile${compact ? " compact" : ""}${focused ? " is-focused" : ""}${osdVisible ? " osd-visible" : ""}`}
      onClick={() => { if (fitMode !== "crop") onFocus(); }}
      onPointerEnter={revealOSD}
      onPointerMove={(event) => {
        revealOSD();
        onCropPointerMove(event);
      }}
      onPointerDown={onCropPointerDown}
      onPointerUp={onCropPointerUp}
      onKeyDown={(event) => {
        if (fitMode !== "crop" && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onFocus();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <video autoPlay className="screen-video" muted playsInline ref={videoRef} style={videoStyle} onLoadedMetadata={(event) => {
        const { videoWidth, videoHeight } = event.currentTarget;
        if (videoHeight > 0) setSourceAspectRatio(videoWidth / videoHeight);
      }} />
      <div className="screen-osd-tools">
        <div className="screen-zoom-controls" aria-label="Modo de exibição">
          <button aria-pressed={fitMode === "fit"} onClick={(event) => { event.stopPropagation(); setFitMode("fit"); setCrop(null); }} type="button">Ajustar</button>
          <button aria-pressed={fitMode === "fill"} onClick={(event) => { event.stopPropagation(); setFitMode("fill"); setCrop(null); }} type="button">Preencher</button>
          <button aria-pressed={fitMode === "crop"} disabled={sourceAspectRatio < 2} onClick={(event) => { event.stopPropagation(); setFitMode("crop"); setCrop(null); }} title={sourceAspectRatio < 2 ? "Smart Zoom é destinado a transmissões Ultrawide." : "Arraste sobre a transmissão para selecionar uma área."} type="button">Recorte</button>
        </div>
        {!track.isLocal && track.source === "screen_share" && <select
          aria-label={`Qualidade máxima da transmissão de ${track.participantName}`}
          className="screen-quality-select"
          onChange={(event) => {
            event.stopPropagation();
            const quality = event.currentTarget.value;
            if (quality === "auto" || quality === "high" || quality === "medium" || quality === "low") {
              onQualityChange(track.sid, quality);
            }
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          title="O modo automático adapta a camada ao espaço disponível e à rede."
          value={track.quality}
        >
          <option value="auto">Automático</option>
          <option value="high">Original</option>
          <option value="medium">1080p</option>
          <option value="low">720p</option>
        </select>}
      </div>
      {fitMode === "crop" && <span className="crop-instruction">Arraste para selecionar a área · Escala Ultrawide</span>}
      {draftCrop !== null && <span className="crop-selection" style={{ left: `${draftCrop.x * 100}%`, top: `${draftCrop.y * 100}%`, width: `${draftCrop.width * 100}%`, height: `${draftCrop.height * 100}%` }} />}
      {hasAudio && <label className="screen-volume-control" onClick={(event) => event.stopPropagation()}>
        <button aria-label={muted ? `Ativar áudio de ${track.participantName}` : `Silenciar ${track.participantName}`} onClick={onMuteToggle} type="button">{muted ? "×" : "◖"}</button>
        <input aria-label={`Volume de ${track.participantName}`} max={200} min={0} onChange={(event) => onVolumeChange(Number(event.target.value))} onKeyDown={(event) => event.stopPropagation()} type="range" value={volumePercent} />
        <small>{volumePercent}%</small>
      </label>}
      <div className="screen-tile-overlay"><span>{track.participantName}{track.isLocal ? " · Você" : ""}</span><button className="icon-button" onClick={(event) => { event.stopPropagation(); const tile = event.currentTarget.closest(".screen-tile"); if (tile && document.fullscreenElement !== tile) void tile.requestFullscreen(); else if (document.fullscreenElement) void document.exitFullscreen(); }} type="button" aria-label={`Tela cheia da transmissão de ${track.participantName}`} title="Tela cheia">⛶</button></div>
      <span className="screen-tile-quality">{track.source === "screen_share" ? "Tela compartilhada" : "Áudio do sistema"}</span>
    </article>
  );
}

function AuthScreen({
  mode,
  busy,
  error,
  onModeChange,
  onSubmit,
}: {
  mode: "login" | "register" | "recover";
  busy: boolean;
  error: string;
  onModeChange: (mode: "login" | "register" | "recover") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const registering = mode === "register";
  const recovering = mode === "recover";
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <a className="brand-lockup" href="/" aria-label="Spectra início">
          <span className="brand-mark">S</span>
          <span><strong>SPECTRA</strong><small>Screen & media rooms</small></span>
        </a>
        <div className="auth-copy">
          <div className="eyebrow">{registering ? "CRIE SUA CONTA" : recovering ? "RECUPERE SUA CONTA" : "BEM-VINDO DE VOLTA"}</div>
          <h1>{registering ? "Seu espaço, do seu jeito." : recovering ? "Redefina sua senha." : "Entre para continuar."}</h1>
          <p>{recovering
            ? "Informe seu apelido e o código de recuperação salvo ao criar sua conta."
            : "Use seu apelido e senha para acessar suas salas em qualquer um dos seus dispositivos."}</p>
        </div>
        {recovering
          ? <button className="auth-back-button" onClick={() => onModeChange("login")} type="button">← Voltar para entrar</button>
          : <div className="auth-tabs" role="tablist" aria-label="Acesso à conta">
            <button aria-selected={!registering} className={!registering ? "active" : ""} onClick={() => onModeChange("login")} role="tab" type="button">Entrar</button>
            <button aria-selected={registering} className={registering ? "active" : ""} onClick={() => onModeChange("register")} role="tab" type="button">Criar conta</button>
          </div>}
        <form className="auth-form" onSubmit={onSubmit}>
          <label>Apelido
            <input autoComplete="username" autoFocus maxLength={32} minLength={2} name="nickname" placeholder="Como você quer ser chamado" required />
          </label>
          {recovering ? <>
            <label>Código de recuperação
              <input autoCapitalize="none" autoComplete="off" maxLength={43} minLength={43} name="recovery_code" placeholder="Cole o código salvo" required spellCheck={false} />
            </label>
            <label>Nova senha
              <input autoComplete="new-password" maxLength={128} minLength={8} name="new_password" placeholder="Mínimo de 8 caracteres" required type="password" />
            </label>
            <label>Confirmar nova senha
              <input autoComplete="new-password" maxLength={128} minLength={8} name="new_password_confirmation" placeholder="Digite a nova senha novamente" required type="password" />
            </label>
          </> : <>
            <label>Senha
              <input autoComplete={registering ? "new-password" : "current-password"} maxLength={128} minLength={8} name="password" placeholder="Mínimo de 8 caracteres" required type="password" />
            </label>
            {registering && <label>Confirmar senha
              <input autoComplete="new-password" maxLength={128} minLength={8} name="password_confirmation" placeholder="Digite a senha novamente" required type="password" />
            </label>}
          </>}
          {error && <div className="dialog-error" role="alert">{error}</div>}
          <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? "Aguarde..." : registering ? "Criar minha conta" : recovering ? "Redefinir senha" : "Entrar na minha conta"}<span aria-hidden="true">→</span></button>
        </form>
        {!registering && !recovering && <button className="auth-recovery-link" onClick={() => onModeChange("recover")} type="button">Esqueci minha senha</button>}
        <div className="auth-footnote"><span className="footer-orb" /> {registering ? "Guarde o código de recuperação em um lugar seguro." : "Suas salas e preferências são vinculadas à sua conta."}</div>
      </section>
    </main>
  );
}

function RecoveryCodeScreen({
  code,
  displayName,
  onContinue,
  onRestart,
}: {
  code: string;
  displayName: string;
  onContinue: (code: string) => Promise<void>;
  onRestart: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const copyCode = async () => {
    setError("");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const field = document.createElement("textarea");
        field.value = code;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("A cópia não foi confirmada pelo navegador.");
      }
      setSaved(true);
    } catch {
      setError("Não foi possível copiar automaticamente. Baixe o arquivo ou selecione o código para copiá-lo.");
    }
  };

  const downloadCode = () => {
    setError("");
    const contents = [
      "Spectra — código de recuperação",
      `Conta: ${displayName}`,
      "",
      code,
      "",
      "Guarde este código em um lugar seguro. Ele permite redefinir a senha da conta.",
      "Não compartilhe este código com ninguém.",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "spectra-codigo-de-recuperacao.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setSaved(true);
  };

  const continueToAccount = async () => {
    setBusy(true);
    setError("");
    try {
      await onContinue(code);
    } catch {
      setError("Não foi possível confirmar o salvamento. Verifique sua conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card recovery-card">
        <a className="brand-lockup" href="/" aria-label="Spectra início">
          <span className="brand-mark">S</span>
          <span><strong>SPECTRA</strong><small>Screen & media rooms</small></span>
        </a>
        <div className="auth-copy">
          <div className="eyebrow">GUARDE EM LOCAL SEGURO</div>
          <h1>Seu código de recuperação</h1>
          <p>Este código permite redefinir a senha de <strong>{displayName}</strong>. Ele não poderá ser consultado novamente depois desta etapa.</p>
        </div>
        <code className="recovery-code-value">{code}</code>
        <div className="recovery-actions">
          <button className="secondary-button" onClick={() => void copyCode()} type="button">Copiar código</button>
          <button className="secondary-button" onClick={downloadCode} type="button">Baixar arquivo .txt</button>
        </div>
        {saved && <div className="recovery-saved" role="status">Código copiado ou arquivo baixado. Guarde-o em um local seguro.</div>}
        <label className="recovery-confirm">
          <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
          <span>Salvei o código em um lugar seguro e entendo que ele permite redefinir minha senha.</span>
        </label>
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <button className="primary-button auth-submit" disabled={!saved || !confirmed || busy} onClick={() => void continueToAccount()} type="button">
          {busy ? "Confirmando..." : "Continuar"}<span aria-hidden="true">→</span>
        </button>
        <button className="auth-recovery-link" disabled={busy} onClick={onRestart} type="button">Voltar e gerar outro código</button>
      </section>
    </main>
  );
}

function AudioTrack({
  session,
  sid,
  gain,
  onError,
}: {
  session: MediaSession | null;
  sid: string;
  gain: number;
  onError: (message: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const graphRef = useRef<AudioContext | null>(null);
  const lifecycle = useRef(0);
  useEffect(() => {
    const element = audioRef.current;
    if (element === null || session === null) return;
    const detach = session.attachTrack(sid, element);
    let context = graphRef.current;
    if (context === null) {
      try {
        context = new AudioContext();
        const source = context.createMediaElementSource(element);
        const gainNode = context.createGain();
        source.connect(gainNode);
        gainNode.connect(context.destination);
        gainNodeRef.current = gainNode;
        graphRef.current = context;
        audioContexts.add(context);
      } catch (error) {
        onError(friendlyError(error, "O controle de volume amplificado não está disponível neste navegador."));
      }
    }
    const generation = ++lifecycle.current;
    return () => {
      detach();
      window.setTimeout(() => {
        if (lifecycle.current !== generation || graphRef.current === null) return;
        const oldContext = graphRef.current;
        graphRef.current = null;
        gainNodeRef.current = null;
        audioContexts.delete(oldContext);
        void oldContext.close().catch((error: unknown) => {
          onError(friendlyError(error, "Não foi possível encerrar o processamento de áudio."));
        });
      }, 0);
    };
  }, [onError, session, sid]);
  useEffect(() => {
    const gainNode = gainNodeRef.current;
    const context = graphRef.current;
    if (gainNode !== null && context !== null) {
      gainNode.gain.setTargetAtTime(Math.max(0, Math.min(4, gain)), context.currentTime, 0.02);
    }
  }, [gain]);
  return <audio autoPlay className="audio-track" ref={audioRef} />;
}

function Modal({ title, subtitle, onClose, children, className }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-modal="true" className={`dialog${className ? ` ${className}` : ""}`} role="dialog" aria-labelledby="dialog-title">
        <button aria-label="Fechar" className="dialog-close icon-button" onClick={onClose} type="button">×</button>
        <div className="eyebrow">SPECTRA · SALAS</div><h2 id="dialog-title">{title}</h2><p className="dialog-subtitle">{subtitle}</p>
        {children}
      </section>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Elemento #root ausente em index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
