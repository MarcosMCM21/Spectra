import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, screen, shell } from "electron";
import path from "node:path";

const webUrl = process.env.SPECTRA_WEB_URL ?? "http://localhost:5173";
const selectedSources = new Map<number, string>();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function showWebLoadError(window: BrowserWindow, cause: unknown, retryUrl?: string): void {
  const canOpenInBrowser = retryUrl !== undefined && /^https?:\/\//i.test(retryUrl);
  const retryLink = retryUrl === undefined ? "" : escapeHtml(retryUrl);
  const interfaceDescription = retryUrl === undefined
    ? "Os arquivos da interface do aplicativo não foram encontrados. Reinstale o Spectra."
    : `A interface Web não respondeu em <strong>${retryLink}</strong>. Inicie o servidor Web ou verifique o endereço configurado e tente novamente.`;
  const openLink = canOpenInBrowser
    ? `<a class="secondary" href="${retryLink}" target="_blank" rel="noreferrer">Abrir interface Web no navegador</a>`
    : "";
  const detail = cause instanceof Error ? cause.message : "Não foi possível carregar a interface.";
  const retryButton = retryUrl === undefined ? "" : `<a href="${retryLink}">Tentar novamente</a>`;
  const page = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spectra indisponível</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080b12;color:#e8edf8;font:15px "Segoe UI",sans-serif}.card{width:min(560px,calc(100% - 32px));padding:32px;border:1px solid #293346;border-radius:16px;background:#111925}h1{margin:0 0 10px;font-size:23px}p{color:#aab5c5;line-height:1.6}.detail{overflow-wrap:anywhere;color:#7f8da2;font-size:12px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 14px;border:1px solid #4d9eae;border-radius:9px;color:#071116;background:#73dce3;text-decoration:none;font-weight:700}.secondary{border-color:#374459;color:#dce5f1;background:#172130}
    </style><main class="card"><h1>Não foi possível abrir o Spectra</h1><p>${interfaceDescription}</p><p class="detail">${escapeHtml(detail)}</p><div class="actions">${retryButton}${openLink}</div></main></html>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
}

async function loadWebApp(window: BrowserWindow): Promise<void> {
  if (app.isPackaged && process.env.SPECTRA_WEB_URL === undefined) {
    try {
      await window.loadFile(path.join(process.resourcesPath, "web", "index.html"));
    } catch (error) {
      if (!window.isDestroyed()) showWebLoadError(window, error);
    }
    return;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (window.isDestroyed()) return;
    try {
      await window.loadURL(webUrl);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!window.isDestroyed()) showWebLoadError(window, lastError, webUrl);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 600,
    title: "Spectra",
    backgroundColor: "#080b12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);

  window.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const selected = selectedSources.get(window.webContents.id);
      if (selected === undefined) {
        callback({});
        return;
      }
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const source = sources.find((candidate) => candidate.id === selected);
      if (source === undefined || window.isDestroyed()) {
        callback({});
        return;
      }

      callback({
        video: source,
      });
    } catch (error) {
      console.error("Could not provide the selected display source", error);
      callback({});
    }
  });
  window.on("closed", () => selectedSources.delete(window.webContents.id));

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  void loadWebApp(window);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle("spectra:list-screen-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    const displays = screen.getAllDisplays();
    const monitorSources = sources.filter((source) => source.id.startsWith("screen:"));

    return sources.map((source) => {
      const isMonitor = source.id.startsWith("screen:");
      const display = isMonitor
        ? displays.find((candidate) => String(candidate.id) === source.display_id)
        : undefined;
      const monitorNumber = display === undefined
        ? monitorSources.findIndex((candidate) => candidate.id === source.id) + 1
        : displays.indexOf(display) + 1;
      const resolution = display === undefined
        ? ""
        : ` · ${display.bounds.width} × ${display.bounds.height}`;

      return {
        id: source.id,
        kind: isMonitor ? "monitor" : "window",
        label: source.name,
        description: isMonitor
          ? `Monitor ${monitorNumber}${resolution} · captura a tela inteira.`
          : "Somente esta janela; outros aplicativos e monitores não serão capturados.",
        thumbnailDataUrl: source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL(),
      };
    });
  });
  ipcMain.handle("spectra:select-screen-source", (event, sourceId: unknown) => {
    if (typeof sourceId !== "string") {
      throw new TypeError("Invalid screen capture selection");
    }
    selectedSources.set(event.sender.id, sourceId);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
