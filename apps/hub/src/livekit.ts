/**
 * Camada LiveKit do Hub.
 *
 * Hard constraint (DEC-01 / Backend.md 2.3): **nenhum** token emitido aqui pode
 * habilitar a fonte `TrackSource.MICROPHONE`. A barreira é dupla:
 *   1. `FORBIDDEN_SOURCES` filtra qualquer fonte proibida antes da assinatura.
 *   2. `assertNoMicrophoneGrant` relança caso o grant final viole a regra.
 */
import { AccessToken, RoomServiceClient, TokenVerifier, type VideoGrant } from "livekit-server-sdk";
import { TrackSource } from "@livekit/protocol";
import type { HubEnv } from "./env.js";

/** Fontes que jamais podem aparecer em `canPublishSources` (DEC-01). */
export const FORBIDDEN_SOURCES: readonly TrackSource[] = [TrackSource.MICROPHONE, TrackSource.CAMERA];

/** Fontes concedidas a membros com `can_share_screen = true`. */
const MEMBER_SOURCES: readonly TrackSource[] = [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

export class MicrophoneGrantError extends Error {
  constructor() {
    super("livekit_grant_proibida: microfone");
    this.name = "MicrophoneGrantError";
  }
}

/** Barreira final: recusa grants que incluam fontes proibidas. */
export function assertNoMicrophoneGrant(grant: { canPublishSources?: TrackSource[] }): void {
  const sources = grant.canPublishSources ?? [];
  if (sources.some((source) => FORBIDDEN_SOURCES.includes(source))) {
    throw new MicrophoneGrantError();
  }
}

export interface RoomTokenInput {
  /** Nome da sessão LiveKit da Sala Fixa (o Hub usa o `slug`). */
  roomName: string;
  identity: string;
  displayName: string;
  /** true quando o participante pode publicar tela (Backend.md 2.3). */
  canShareScreen: boolean;
  /** true para bots de mídia isolados (somente áudio de loopback/bot). */
  isBot?: boolean;
  metadata?: Record<string, string>;
  ttlSeconds?: number;
}

export interface IssuedRoomToken {
  token: string;
  identity: string;
  expiresAt: number;
}

/** Serviço de tokens e administração de salas no LiveKit self-hosted. */
export class LiveKitService {
  private readonly accessTokenFactory: (identity: string, ttl: number) => AccessToken;
  /** Injetável em testes (mock do `RoomServiceClient`) ou criado sob demanda. */
  private injectedRoomService: RoomServiceClient | null = null;

  constructor(private readonly env: HubEnv) {
    this.accessTokenFactory = (identity, ttl) =>
      new AccessToken(env.livekitApiKey, env.livekitApiSecret, { identity, ttl });
  }

  /** Permite injetar um mock do `RoomServiceClient` em testes unitários. */
  static withRoomService(env: HubEnv, roomService: RoomServiceClient): LiveKitService {
    const service = new LiveKitService(env);
    service.injectedRoomService = roomService;
    return service;
  }

  /**
   * Emite o JWT de entrada numa Sala Fixa.
   * Membro com tela liberada recebe apenas `screen_share` + `screen_share_audio`;
   * espectador sem permissão recebe somente `canSubscribe`.
   */
  async issueRoomToken(input: RoomTokenInput): Promise<IssuedRoomToken> {
    const ttl = input.ttlSeconds ?? this.env.roomTokenTtlSeconds;
    const token = this.accessTokenFactory(input.identity, ttl);

    const grant: VideoGrant = {
      room: input.roomName,
      roomJoin: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
      canPublishSources: [],
    };

    if (input.isBot === true) {
      // Bot de mídia: publica apenas a faixa estéreo Opus como áudio de bot.
      grant.canPublish = true;
      grant.canPublishSources = [TrackSource.SCREEN_SHARE_AUDIO];
    } else if (input.canShareScreen) {
      grant.canPublish = true;
      grant.canPublishSources = [...MEMBER_SOURCES];
    } else {
      grant.canPublish = false;
      grant.canPublishSources = [];
    }

    assertNoMicrophoneGrant(grant);

    token.addGrant(grant);
    token.name = input.displayName;
    if (input.metadata !== undefined) token.metadata = JSON.stringify(input.metadata);

    const jwt = await token.toJwt();
    return {
      token: jwt,
      identity: input.identity,
      expiresAt: Date.now() + ttl * 1000,
    };
  }

  /** Cliente administrativo do LiveKit (singleton preguiçoso). */
  get rooms(): RoomServiceClient {
    const injected = this.injectedRoomService;
    if (injected !== null) return injected;
    const client = new RoomServiceClient(
      this.env.livekitInternalUrl,
      this.env.livekitApiKey,
      this.env.livekitApiSecret,
    );
    this.injectedRoomService = client;
    return client;
  }

  /** Verificador de tokens usado em webhooks e rotas administrativas. */
  get verifier(): TokenVerifier {
    return new TokenVerifier(this.env.livekitApiKey, this.env.livekitApiSecret);
  }
}
