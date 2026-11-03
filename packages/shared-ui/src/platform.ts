/**
 * Contrato de plataforma consumido por toda a UI compartilhada.
 *
 * Hard constraint (AGENTS.md §2): `packages/shared-ui` jamais importa
 * `electron`, `node:*` ou `livekit-client`. Todo acesso a recurso de sistema
 * (seleção de tela/monitor, PiP, janelas overlay, atalhos) chega exclusivamente
 * por esta interface, injetada pela aplicação (`apps/web`, `apps/desktop`).
 */

/** Perfil de captura escolhido no modal de compartilhamento de tela. */
export type CaptureProfile = "fluidity" | "sharpness";

/** Resolução alvo pedida ao dispositivo de captura. */
export type CaptureResolution = "720p" | "1080p" | "1440p" | "4k";

/** Codec principal pedido para a faixa compartilhada (fallback H.264 automático). */
export type PreferredCodec = "av1" | "vp9" | "h264";

export interface ScreenCaptureSource {
  id: string;
  kind: "window" | "monitor" | "application";
  label: string;
  description?: string;
  thumbnailDataUrl?: string;
}

export interface ScreenShareSelection {
  source: ScreenCaptureSource;
  profile: CaptureProfile;
  resolution: CaptureResolution;
  codec: PreferredCodec;
  captureSystemAudio: boolean;
}

/** Fallback Web puro quando a plataforma não expõe `desktopCapturer`. */
export type WebScreenSharePicker = () => Promise<ScreenShareSelection | null>;

export interface PlatformStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface PlatformBridge {
  /** Identificador da plataforma para diagnósticos e rótulos de UI. */
  readonly platformName: string;
  /** true quando a plataforma oferece captura rica (janela/monitor). */
  readonly supportsNativeCapture: boolean;
  /** true quando PiP nativo sempre-no-topo está disponível. */
  readonly supportsPersistentPiP: boolean;
  /** Copia texto na área de transferência (auto-paste / cópia de convite). */
  copyToClipboard(text: string): Promise<void>;

  /** Enumera janelas/monitores capturáveis. */
  listScreenSources(): Promise<ScreenCaptureSource[]>;
  /** Converte a escolha do modal em `getDisplayMedia` constraints. */
  screenShareConstraints(selection: ScreenShareSelection): MediaStreamConstraints | Promise<MediaStreamConstraints>;
  /** Define a fonte escolhida antes de iniciar `getDisplayMedia` no Electron. */
  selectScreenSource?(sourceId: string): Promise<void>;
  /** Caminho Web puro para o seletor de tela. */
  pickWebScreenShare?: WebScreenSharePicker;

  /** PiP nativo sempre no topo (desktop). */
  setPersistentPiP?(enabled: boolean): Promise<void>;
  /** Camada overlay click-through (HUD de telemetria, toasts de addon). */
  setOverlayClickThrough?(clickThrough: boolean): Promise<void>;

  /** Persistência local de salas frequentes e da credencial interna da conta. */
  storage: PlatformStorage;
}

/** Dimensões ideais pedidas por rótulo de resolução. */
export const RESOLUTION_DIMENSIONS: Record<CaptureResolution, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
};

/** Persistência em `localStorage` usada pelo fallback Web. */
export function createLocalStorageStorage(): PlatformStorage {
  const unavailable = (): PlatformStorage => ({
    get: (_key, fallback) => fallback,
    set: () => undefined,
    remove: () => undefined,
  });

  let store: Storage | undefined;
  try {
    store = globalThis.localStorage;
  } catch {
    return unavailable();
  }
  if (store === undefined) return unavailable();

  return {
    get<T>(key: string, fallback: T): T {
      const raw = store.getItem(key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown): void {
      try {
        store.setItem(key, JSON.stringify(value));
      } catch {
        // Quota excedida ou modo privado: a UI continua funcionando sem persistência.
      }
    },
    remove(key: string): void {
      try {
        store.removeItem(key);
      } catch {
        // Ignorado: ausência de persistência não derruba a aplicação.
      }
    },
  };
}

async function webScreenShareConstraints(selection: ScreenShareSelection): Promise<MediaStreamConstraints> {
  const resolution = RESOLUTION_DIMENSIONS[selection.resolution];
  return {
    video: {
      ...(selection.source.kind === "monitor" ? { displaySurface: "monitor" } : { displaySurface: "window" }),
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
      frameRate: { ideal: 60, max: 60 },
    },
    audio: selection.captureSystemAudio,
  };
}

async function pickWebScreenShare(): Promise<ScreenShareSelection | null> {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (mediaDevices === undefined || typeof mediaDevices.getDisplayMedia !== "function") return null;

  const stream = await mediaDevices.getDisplayMedia({ video: true, audio: true });
  const track = stream.getVideoTracks()[0];
  if (track === undefined) {
    stream.getTracks().forEach((item) => item.stop());
    return null;
  }

  const settings = track.getSettings();
  const height = settings.height ?? 1080;
  const resolution: CaptureResolution =
    height >= 2000 ? "4k" : height >= 1300 ? "1440p" : height >= 1000 ? "1080p" : "720p";

  return {
    source: {
      id: track.id || "display",
      kind: settings.displaySurface === "monitor" ? "monitor" : "window",
      label: track.label || "Tela compartilhada",
    },
    profile: "sharpness",
    resolution,
    codec: "vp9",
    captureSystemAudio: stream.getAudioTracks().length > 0,
  };
}

/**
 * Monta uma `PlatformBridge` a partir do objeto exposto por `contextBridge` no
 * preload do Electron. Métodos ausentes ou que lancem erro caem para o
 * comportamento Web correspondente, mantendo `shared-ui` desacoplado.
 */
export function createElectronPlatformBridge(exposed: Record<string, unknown> | undefined): PlatformBridge {
  const web = createWebPlatformBridge();
  if (exposed === undefined) return web;

  const asFunction = (key: string): ((...args: unknown[]) => unknown) | undefined => {
    const value = exposed[key];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown) : undefined;
  };

  const bridge: PlatformBridge = {
    platformName: "electron",
    supportsNativeCapture: asFunction("listScreenSources") !== undefined
      && asFunction("selectScreenSource") !== undefined,
    supportsPersistentPiP: asFunction("setPersistentPiP") !== undefined,
    async copyToClipboard(text: string): Promise<void> {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return;
        }
      } catch {
        // Ignora falha de clipboard no shell desktop.
      }
      if (typeof exposed.copyToClipboard === "function") {
        await (exposed.copyToClipboard as (value: string) => Promise<void>)(text);
      }
    },
    async listScreenSources() {
      const fn = asFunction("listScreenSources");
      if (fn === undefined) return [];
      const raw = (await fn()) as unknown;
      return Array.isArray(raw) ? (raw as ScreenCaptureSource[]) : [];
    },
    async screenShareConstraints(selection) {
      const fn = asFunction("screenShareConstraints");
      if (fn === undefined) return web.screenShareConstraints(selection);
      try {
        const raw = (await fn(selection)) as unknown;
        if (raw !== null && typeof raw === "object") return raw as MediaStreamConstraints;
      } catch {
        // Falha no shell: mantém o caminho Web.
      }
      return web.screenShareConstraints(selection);
    },
    async selectScreenSource(sourceId) {
      const fn = asFunction("selectScreenSource");
      if (fn === undefined) throw new Error("O seletor de captura nativo não está disponível.");
      await fn(sourceId);
    },
    storage: createLocalStorageStorage(),
  };

  const setPersistentPiP = asFunction("setPersistentPiP");
  if (setPersistentPiP !== undefined) {
    bridge.setPersistentPiP = async (enabled: boolean) => {
      await setPersistentPiP(enabled);
    };
  }

  const setOverlayClickThrough = asFunction("setOverlayClickThrough");
  if (setOverlayClickThrough !== undefined) {
    bridge.setOverlayClickThrough = async (clickThrough: boolean) => {
      await setOverlayClickThrough(clickThrough);
    };
  }

  return bridge;
}

/** Fallback Web: APIs web puras, sem qualquer dependência de Electron. */
export function createWebPlatformBridge(): PlatformBridge {
  return {
    platformName: "web",
    supportsNativeCapture: false,
    supportsPersistentPiP: false,
    async copyToClipboard(text: string): Promise<void> {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      console.info("Clipboard unavailable", text);
    },
    async listScreenSources() {
      return [];
    },
    screenShareConstraints: webScreenShareConstraints,
    pickWebScreenShare,
    storage: createLocalStorageStorage(),
  };
}
