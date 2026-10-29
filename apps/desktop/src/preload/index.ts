import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld("messyai", {
  connection: (): Promise<{ baseUrl: string; wsUrl: string; token: string } | null> => ipcRenderer.invoke("messy:connection"),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("messy:pickDirectory"),
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
});
