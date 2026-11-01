import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld("messai", {
  connection: (): Promise<{ baseUrl: string; wsUrl: string; token: string } | null> => ipcRenderer.invoke("mess:connection"),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("mess:pickDirectory"),
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
  // Tela de encerramento
  onShutdownPrompt: (cb: (data: { running: { title: string; agentType: string; isAgent: boolean; workspace: string }[] }) => void): void => { ipcRenderer.on("mess:shutdown-prompt", (_e, data) => cb(data)); },
  shutdownDecision: (action: "background" | "all" | "cancel"): Promise<void> => ipcRenderer.invoke("mess:shutdown-decision", action),
});
