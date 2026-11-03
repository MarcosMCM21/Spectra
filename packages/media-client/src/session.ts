import {
  ConnectionState,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  VideoPreset,
  getBrowser,
  supportsAV1,
  supportsVP9,
  type LocalTrackPublication,
  type RemoteTrackPublication,
} from "livekit-client";
import { publishWithH264Fallback } from "./codec.js";
import { allocateScreenShareBitrate, createScreenCaptureConstraints } from "./screen-share-encoding.js";

export type ScreenTrackQuality = "auto" | "high" | "medium" | "low";
export type ScreenShareCodec = "h264" | "vp9" | "av1";

export interface TrackMediaDiagnostics {
  resolution?: string;
  framesPerSecond?: number;
  bitrateKbps?: number;
  packetsLost?: number;
  jitterMs?: number;
  roundTripTimeMs?: number;
  codec?: string;
}

export interface ScreenShareStartResult {
  codec: ScreenShareCodec;
  fellBackToH264: boolean;
}

export interface MediaScreenTrack {
  sid: string;
  participantIdentity: string;
  participantName: string;
  source: "screen_share" | "screen_share_audio";
  isLocal: boolean;
  quality: ScreenTrackQuality;
}

export interface MediaParticipantState {
  identity: string;
  displayName: string;
  isLocal: boolean;
  isStreaming: boolean;
  accountIdentity?: string;
  role?: "admin" | "member";
  canShareScreen?: boolean;
}

export interface MediaSessionView {
  connectionState: "connecting" | "connected" | "reconnecting" | "disconnected";
  participants: MediaParticipantState[];
  tracks: MediaScreenTrack[];
}

export interface ScreenShareOptions {
  captureSystemAudio: boolean;
  profile: "fluidity" | "sharpness";
  resolution: "720p" | "1080p" | "1440p" | "4k";
  maxBitrateKbps: number;
  maxFramerate: 15 | 30 | 60;
}

export interface MediaSession {
  getView(): MediaSessionView;
  subscribe(listener: (view: MediaSessionView) => void): () => void;
  attachTrack(sid: string, element: HTMLMediaElement): () => void;
  setTrackQuality(sid: string, quality: ScreenTrackQuality): void;
  getTrackMediaDiagnostics(sid: string): Promise<TrackMediaDiagnostics | undefined>;
  startScreenShare(options: ScreenShareOptions & { codec: ScreenShareCodec }): Promise<ScreenShareStartResult>;
  updateScreenShareSettings(
    options: Pick<ScreenShareOptions, "profile" | "resolution" | "maxBitrateKbps" | "maxFramerate">,
  ): Promise<void>;
  stopScreenShare(): Promise<void>;
  disconnect(): Promise<void>;
}

function displayName(participant: { name?: string; identity: string }): string {
  return participant.name?.trim() || participant.identity;
}

function participantMetadata(raw: string | undefined): Record<string, string> {
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function participantState(participant: {
  identity: string;
  name?: string;
  metadata?: string;
  trackPublications: Map<string, LocalTrackPublication | RemoteTrackPublication>;
  isLocal: boolean;
}): MediaParticipantState {
  const metadata = participantMetadata(participant.metadata);
  const role = metadata.role;
  const canShareScreen = metadata.can_share_screen;
  return {
    identity: participant.identity,
    displayName: displayName(participant),
    isLocal: participant.isLocal,
    isStreaming: [...participant.trackPublications.values()].some(
      (publication) => publication.source === Track.Source.ScreenShare,
    ),
    ...(metadata.account_identity
      ? { accountIdentity: metadata.account_identity }
      : {}),
    ...(role === "admin" || role === "member" ? { role } : {}),
    ...(canShareScreen === "true" || canShareScreen === "false"
      ? { canShareScreen: canShareScreen === "true" }
      : {}),
  };
}

function toConnectionState(state: ConnectionState): MediaSessionView["connectionState"] {
  switch (state) {
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Reconnecting:
      return "reconnecting";
    case ConnectionState.Disconnected:
      return "disconnected";
    default:
      return "connecting";
  }
}

function isScreenSource(source: Track.Source): source is Track.Source.ScreenShare | Track.Source.ScreenShareAudio {
  return source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio;
}

function makeSession(room: Room): MediaSession {
  const listeners = new Set<(view: MediaSessionView) => void>();
  const tracks = new Map<string, Track>();
  const publications = new Map<string, RemoteTrackPublication>();
  const qualityPreferences = new Map<string, ScreenTrackQuality>();
  const previousStats = new Map<string, { bytesReceived: number; framesDecoded: number; timestamp: number }>();
  let closed = false;
  let screenShareStream: MediaStream | undefined;
  let activeScreenShareCodec: ScreenShareCodec | undefined;
  const resolutionByLabel: Record<ScreenShareOptions["resolution"], { width: number; height: number }> = {
    "720p": { width: 1280, height: 720 },
    "1080p": { width: 1920, height: 1080 },
    "1440p": { width: 2560, height: 1440 },
    "4k": { width: 3840, height: 2160 },
  };

  const getView = (): MediaSessionView => {
    const participants: MediaParticipantState[] = [participantState({
      ...room.localParticipant,
      isLocal: true,
    })];

    for (const participant of room.remoteParticipants.values()) {
      participants.push(participantState({ ...participant, isLocal: false }));
    }

    const screenTracks: MediaScreenTrack[] = [];
    publications.clear();
    const addPublication = (
      publication: LocalTrackPublication | RemoteTrackPublication,
      participant: { identity: string; name?: string },
      isLocal: boolean,
    ) => {
      if (!isScreenSource(publication.source) || publication.track === undefined || publication.track.sid === undefined) return;
      tracks.set(publication.track.sid, publication.track);
      if ("setVideoQuality" in publication) {
        publications.set(publication.track.sid, publication);
      }
      screenTracks.push({
        sid: publication.track.sid,
        participantIdentity: participant.identity,
        participantName: displayName(participant),
        source: publication.source === Track.Source.ScreenShare ? "screen_share" : "screen_share_audio",
        isLocal,
        quality: qualityPreferences.get(publication.track.sid) ?? "auto",
      });
    };

    for (const publication of room.localParticipant.trackPublications.values()) {
      addPublication(publication, room.localParticipant, true);
    }
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        addPublication(publication, participant, false);
      }
    }

    return {
      connectionState: toConnectionState(room.state),
      participants,
      tracks: screenTracks,
    };
  };

  const emit = () => {
    if (closed) return;
    const view = getView();
    for (const listener of listeners) listener(view);
  };

  const stopScreenShare = async (): Promise<void> => {
    const stream = screenShareStream;
    screenShareStream = undefined;
    activeScreenShareCodec = undefined;
    try {
      for (const publication of room.localParticipant.trackPublications.values()) {
        if (!isScreenSource(publication.source) || publication.track === undefined) continue;
        await room.localParticipant.unpublishTrack(publication.track, true);
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      emit();
    }
  };

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (publication.source === Track.Source.Microphone) return;
    if (isScreenSource(publication.source) && track.sid !== undefined) tracks.set(track.sid, track);
    emit();
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track.sid !== undefined) {
      tracks.delete(track.sid);
      publications.delete(track.sid);
      qualityPreferences.delete(track.sid);
      previousStats.delete(track.sid);
    }
    emit();
  });
  room.on(RoomEvent.TrackPublished, emit);
  room.on(RoomEvent.TrackUnpublished, emit);
  room.on(RoomEvent.LocalTrackPublished, emit);
  room.on(RoomEvent.LocalTrackUnpublished, emit);
  room.on(RoomEvent.ParticipantConnected, emit);
  room.on(RoomEvent.ParticipantDisconnected, emit);
  room.on(RoomEvent.ConnectionStateChanged, emit);

  return {
    getView,
    subscribe(listener) {
      listeners.add(listener);
      listener(getView());
      return () => listeners.delete(listener);
    },
    attachTrack(sid, element) {
      const track = tracks.get(sid);
      if (track === undefined) return () => undefined;
      track.attach(element);
      return () => {
        track.detach(element);
      };
    },
    setTrackQuality(sid, quality) {
      const publication = publications.get(sid);
      if (publication === undefined) {
        throw new Error("A transmissão não está disponível para ajustar a qualidade.");
      }
      const liveKitQuality = quality === "low"
        ? VideoQuality.LOW
        : quality === "medium"
          ? VideoQuality.MEDIUM
          : VideoQuality.HIGH;
      publication.setVideoQuality(liveKitQuality);
      qualityPreferences.set(sid, quality);
      emit();
    },
    async getTrackMediaDiagnostics(sid) {
      const track = tracks.get(sid);
      if (track === undefined || track.isLocal || track.kind !== Track.Kind.Video) return undefined;
      const report = await track.getRTCStatsReport();
      if (report === undefined) return undefined;
      const reportStats: RTCStats[] = [];
      report.forEach((stat) => reportStats.push(stat));
      const inbound = reportStats.find((stat) => {
        if (stat.type !== "inbound-rtp") return false;
        const videoStats = stat as RTCInboundRtpStreamStats;
        return videoStats.kind === "video";
      }) as RTCInboundRtpStreamStats | undefined;
      if (inbound === undefined || typeof inbound.bytesReceived !== "number" || typeof inbound.framesDecoded !== "number") return undefined;

      const sample = {
        bytesReceived: inbound.bytesReceived,
        framesDecoded: inbound.framesDecoded,
        timestamp: inbound.timestamp,
      };
      const previous = previousStats.get(sid);
      previousStats.set(sid, sample);
      const elapsedSeconds = previous === undefined
        ? 0
        : (sample.timestamp - previous.timestamp) / 1_000;
      const codec = inbound.codecId === undefined
        ? undefined
        : reportStats.find((stat) => stat.id === inbound.codecId) as (RTCStats & { mimeType?: string }) | undefined;
      const candidatePair = reportStats.find((stat) => {
        if (stat.type !== "candidate-pair") return false;
        const pairStats = stat as RTCIceCandidatePairStats;
        return pairStats.state === "succeeded" && typeof pairStats.currentRoundTripTime === "number";
      }) as RTCIceCandidatePairStats | undefined;
      const stats: TrackMediaDiagnostics = {};
      if (typeof inbound.frameWidth === "number" && typeof inbound.frameHeight === "number") {
        stats.resolution = `${inbound.frameWidth} × ${inbound.frameHeight}`;
      }
      if (typeof inbound.framesPerSecond === "number") {
        stats.framesPerSecond = Math.round(inbound.framesPerSecond);
      } else if (previous !== undefined && elapsedSeconds > 0) {
        stats.framesPerSecond = Math.round((sample.framesDecoded - previous.framesDecoded) / elapsedSeconds);
      }
      if (previous !== undefined && elapsedSeconds > 0) {
        stats.bitrateKbps = Math.round(((sample.bytesReceived - previous.bytesReceived) * 8) / elapsedSeconds / 1_000);
      }
      if (typeof inbound.packetsLost === "number") stats.packetsLost = inbound.packetsLost;
      if (typeof inbound.jitter === "number") stats.jitterMs = Math.round(inbound.jitter * 1_000);
      if (candidatePair?.currentRoundTripTime !== undefined) {
        stats.roundTripTimeMs = Math.round(candidatePair.currentRoundTripTime * 1_000);
      }
      if (codec?.mimeType !== undefined) stats.codec = codec.mimeType.replace(/^video\//, "").toUpperCase();
      return stats;
    },
    async startScreenShare(options) {
      if (screenShareStream !== undefined) throw new Error("Já existe uma transmissão ativa.");
      const resolution = resolutionByLabel[options.resolution];
      const captureOptions: DisplayMediaStreamOptions & {
        selfBrowserSurface: "exclude";
        surfaceSwitching: "include";
        systemAudio: "exclude";
        windowAudio: "exclude" | "window";
      } = {
        video: {
          ...createScreenCaptureConstraints(resolution, options.maxFramerate),
        },
        audio: options.captureSystemAudio,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "exclude",
        windowAudio: options.captureSystemAudio ? "window" : "exclude",
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(captureOptions);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack === undefined) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("A captura não forneceu uma faixa de vídeo.");
      }
      const displaySurface = videoTrack.getSettings().displaySurface;
      if (displaySurface !== "window" && displaySurface !== "browser") {
        stream.getAudioTracks().forEach((track) => track.stop());
      }
      videoTrack.contentHint = options.profile === "fluidity" ? "motion" : "detail";
      screenShareStream = stream;
      videoTrack.addEventListener("ended", () => {
        if (screenShareStream !== stream) return;
        void stopScreenShare().catch((error: unknown) => {
          console.error("Could not stop the ended screen share", error);
        });
      }, { once: true });
      let result: ScreenShareStartResult;
      try {
        const publishOptions = {
          name: "spectra-screen",
          source: Track.Source.ScreenShare,
        };
        const codecSupported = options.codec === "h264"
          || (options.codec === "vp9" && supportsVP9())
          || (options.codec === "av1" && supportsAV1());
        const initialCodec = codecSupported ? options.codec : "h264";
        const totalBitrate = options.maxBitrateKbps * 1_000;
        const captureSettings = videoTrack.getSettings();
        const captureWidth = captureSettings.width ?? resolution.width;
        const captureHeight = captureSettings.height ?? resolution.height;
        const h264SimulcastSupported = getBrowser()?.name !== "Firefox";
        result = await publishWithH264Fallback(initialCodec, async (codec) => {
          const useSimulcast = codec === "h264" && h264SimulcastSupported;
          const layerBitrates = allocateScreenShareBitrate(totalBitrate, useSimulcast ? [2, 1] : [1]);
          const lowLayerBitrate = layerBitrates[0];
          const mainLayerBitrate = useSimulcast ? layerBitrates[1] : totalBitrate;
          if (lowLayerBitrate === undefined || mainLayerBitrate === undefined) {
            throw new Error("Não foi possível calcular o bitrate das camadas da transmissão.");
          }
          await room.localParticipant.publishTrack(videoTrack, {
            ...publishOptions,
            videoCodec: codec,
            screenShareEncoding: {
              maxBitrate: codec === "h264" ? mainLayerBitrate : totalBitrate,
              maxFramerate: options.maxFramerate,
              priority: "high",
            },
            degradationPreference: "maintain-resolution",
            ...(useSimulcast
              ? {
                  simulcast: true,
                  screenShareSimulcastLayers: [
                    new VideoPreset(
                      Math.max(1, Math.floor(captureWidth / 2)),
                      Math.max(1, Math.floor(captureHeight / 2)),
                      lowLayerBitrate,
                      options.maxFramerate,
                      "medium",
                    ),
                  ],
                }
              : {
                  simulcast: false,
                  ...(codec === "h264" ? {} : { scalabilityMode: "L1T3" }),
                }),
          });
        }, async () => {
          const partiallyPublished = [...room.localParticipant.trackPublications.values()].find(
            (publication) => publication.source === Track.Source.ScreenShare && publication.track !== undefined,
          );
          const partiallyPublishedTrack = partiallyPublished?.track;
          if (partiallyPublishedTrack !== undefined) {
            await room.localParticipant.unpublishTrack(partiallyPublishedTrack, false);
          }
        });
        if (initialCodec !== options.codec) result.fellBackToH264 = true;
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack !== undefined) {
          await room.localParticipant.publishTrack(audioTrack, {
            name: "spectra-window-audio",
            source: Track.Source.ScreenShareAudio,
          });
        }
      } catch (error) {
        screenShareStream = undefined;
        try {
          for (const publication of room.localParticipant.trackPublications.values()) {
            if (!isScreenSource(publication.source) || publication.track === undefined) continue;
            await room.localParticipant.unpublishTrack(publication.track, true);
          }
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }
        throw error;
      }
      activeScreenShareCodec = result.codec;
      emit();
      return result;
    },
    async updateScreenShareSettings(options) {
      const publication = [...room.localParticipant.trackPublications.values()].find(
        (item) => item.source === Track.Source.ScreenShare,
      );
      if (!(publication?.track instanceof LocalVideoTrack)) {
        throw new Error("Não há transmissão ativa para atualizar.");
      }
      const senders = new Set([
        publication.track.sender,
        ...[...publication.track.simulcastCodecs.values()].map((codec) => codec.sender),
      ].filter((sender): sender is RTCRtpSender => sender !== undefined));
      if (senders.size === 0) {
        throw new Error("O navegador não permite atualizar as configurações desta transmissão.");
      }
      const resolution = resolutionByLabel[options.resolution];
      await publication.track.mediaStreamTrack.applyConstraints(
        createScreenCaptureConstraints(resolution, options.maxFramerate),
      );
      publication.track.mediaStreamTrack.contentHint = activeScreenShareCodec !== undefined
        && activeScreenShareCodec !== "h264"
        ? "motion"
        : options.profile === "fluidity" ? "motion" : "detail";
      const senderParameters = [...senders].map((sender) => ({
        sender,
        parameters: sender.getParameters(),
      }));
      const encodings = senderParameters.flatMap(({ parameters }) => parameters.encodings);
      if (encodings.length === 0) {
        throw new Error("O navegador não expôs parâmetros de codificação para esta transmissão.");
      }
      const bitrateLimits = allocateScreenShareBitrate(
        options.maxBitrateKbps * 1_000,
        encodings.map((encoding) => encoding.scaleResolutionDownBy ?? 1),
      );
      encodings.forEach((encoding, index) => {
        encoding.maxBitrate = bitrateLimits[index];
        encoding.maxFramerate = options.maxFramerate;
      });
      for (const { sender, parameters } of senderParameters) {
        await sender.setParameters(parameters);
      }
    },
    stopScreenShare,
    async disconnect() {
      if (closed) return;
      closed = true;
      listeners.clear();
      tracks.clear();
      publications.clear();
      qualityPreferences.clear();
      previousStats.clear();
      await room.disconnect();
    },
  };
}

export async function connectMediaRoom(url: string, token: string): Promise<MediaSession> {
  let lastError: unknown = new Error("Não foi possível conectar à sala de mídia.");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    try {
      await room.connect(url, token);
      return makeSession(room);
    } catch (error) {
      lastError = error;
      await room.disconnect();
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 300 * (2 ** attempt)));
      }
    }
  }
  throw lastError;
}
