/**
 * Tipos internos do wrapper de mídia.
 *
 * Nada aqui vaza para `packages/shared-ui`: as formas abaixo já são puras
 * (strings/numbers/plain objects), então a UI consome estes tipos sem jamais
 * importar `livekit-client` (Regra de Ouro do desacoplamento).
 */

/** Camadas de qualidade que o showroom requisitará ao SFU (nunca microfone). */
export const QUALITY_LAYERS = ["auto", "original", "1080p", "720p", "360p"] as const;

export type QualityLayer = (typeof QUALITY_LAYERS)[number];

/** Estado da conexão com a sessão LiveKit da sala. */
export const MEDIA_CONNECTION_STATES = [
  "idle",
  "connecting",
  "connected",
  "reconnecting",
  "disconnected",
] as const;

export type MediaConnectionState = (typeof MEDIA_CONNECTION_STATES)[number];

/** Origem da faixa de vídeo exibida no Showroom. */
export type MediaTrackSource = "screen_share" | "camera" | "unknown";

/** Faixa local publicada pelo próprio cliente (compartilhamento de tela). */
export interface LocalMediaTrack {
  trackSid: string;
  trackName: string;
  source: MediaTrackSource;
  /** true quando a faixa está mutada no lado do publicador. */
  isMuted: boolean;
  width: number;
  height: number;
}

/** Faixa remota recebida pelo Showroom, com controle de camada de qualidade. */
export interface RemoteMediaTrack {
  identity: string;
  trackSid: string;
  trackName: string;
  source: MediaTrackSource;
  isMuted: boolean;
  /** false quando o espectador optou por não assinar esta faixa. */
  isSubscribed: boolean;
  width: number;
  height: number;
}

/** Membro da sala na visão do Showroom/Dock (nunca contém dados de voz). */
export interface MediaParticipant {
  identity: string;
  displayName: string;
  isSelf: boolean;
  /** true quando o membro publica uma faixa de tela no momento. */
  isStreaming: boolean;
  totalTracks: number;
}

/** Métricas mínimas para o HUD de diagnóstico (Ctrl+Shift+S). */
export interface MediaMetrics {
  connectionState: MediaConnectionState;
  /** RTT da engine em ms quando disponível. */
  rttMs: number | null;
  participants: number;
  publishedTracks: number;
  subscribedTracks: number;
}

/** Filtros de assinatura que controlam AdaptiveStream/Dynacast por faixa. */
export interface TrackFilterOptions {
  spatialLayer?: number;
  temporalLayer?: number;
}

/** Parâmetros de publicação da faixa de tela derivados do modal de captura. */
export interface ScreenSharePublishOptions {
  /** `contentHint` pedido ao codificador: fluidez vs. nitidez. */
  contentHint: "motion" | "detail" | "text";
  width: number;
  height: number;
  maxBitrate: number;
  maxFramerate: number;
  /** true quando o navegador deve capturar o áudio do sistema junto da tela. */
  systemAudio: boolean;
  displaySurface?: "window" | "monitor" | "browser";
}

/** Assinatura mínima que `shared-ui` consome via hook abstrato (`useMediaClient`). */
export interface MediaClientView {
  connectionState: MediaConnectionState;
  participants: MediaParticipant[];
  /** Faixas remotas ordenadas de forma estável (identidade, depois trackSid). */
  remoteTracks: RemoteMediaTrack[];
  localTracks: LocalMediaTrack[];
  metrics: MediaMetrics;
  lastError: string | null;
}

/** Camada de qualidade aplicada a uma faixa remota. */
export interface TrackQuality {
  quality: QualityLayer;
  filter?: TrackFilterOptions;
}
