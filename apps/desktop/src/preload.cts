import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("spectraDesktop", {
  hubUrl: process.env.SPECTRA_HUB_URL ?? "",
  listScreenSources: () => ipcRenderer.invoke("spectra:list-screen-sources"),
  selectScreenSource: (sourceId: string) =>
    ipcRenderer.invoke("spectra:select-screen-source", sourceId),
});
