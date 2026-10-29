import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld("messai", {
  connection: (): Promise<{ baseUrl: string; wsUrl: string; token: string } | null> => ipcRenderer.invoke("mess:connection"),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("mess:pickDirectory"),
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
});
