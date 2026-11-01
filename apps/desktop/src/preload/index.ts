import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
/** Assina um canal e devolve a função que remove o ouvinte (evita acumular em re-montagens). */
const on = <T,>(channel: string, cb: (data: T) => void): (() => void) => { const h = (_e: IpcRendererEvent, data: T) => cb(data); ipcRenderer.on(channel, h); return () => { ipcRenderer.removeListener(channel, h); }; };
contextBridge.exposeInMainWorld("messai", {
  connection: (): Promise<{ baseUrl: string; wsUrl: string; token: string } | null> => ipcRenderer.invoke("mess:connection"),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("mess:pickDirectory"),
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
  // Tela de encerramento
  onShutdownPrompt: (cb: (data: { running: { title: string; agentType: string; isAgent: boolean; workspace: string }[] }) => void): void => { ipcRenderer.on("mess:shutdown-prompt", (_e, data) => cb(data)); },
  shutdownDecision: (action: "background" | "all" | "cancel"): Promise<void> => ipcRenderer.invoke("mess:shutdown-decision", action),
  // #67 — janela flutuante do companheiro (HUD)
  hudToggle: (open?: boolean): Promise<boolean> => ipcRenderer.invoke("mess:hud-toggle", open),
  hudState: (): Promise<boolean> => ipcRenderer.invoke("mess:hud-state"),
  onHudState: (cb: (open: boolean) => void) => on<boolean>("mess:hud-state", cb),
  hudFocus: (target: { workspaceId: string; nodeId: string }): Promise<void> => ipcRenderer.invoke("mess:hud-focus", target),
  onFocusNode: (cb: (target: { workspaceId: string; nodeId: string }) => void) => on<{ workspaceId: string; nodeId: string }>("mess:focus-node", cb),
  hudDismiss: (nodeId: string): Promise<void> => ipcRenderer.invoke("mess:hud-dismiss", nodeId),
  onHudDismiss: (cb: (nodeId: string) => void) => on<string>("mess:hud-dismiss", cb),
  // #55 — preferências que vivem no processo principal (energia, confirmação ao sair, bandeja)
  setUiPrefs: (p: { powerMode: string; confirmExit: boolean; closeToTray: boolean }): Promise<unknown> => ipcRenderer.invoke("mess:ui-prefs", p),
  uiPrefsState: (): Promise<unknown> => ipcRenderer.invoke("mess:ui-prefs-state"),
  // #38 — abrir pasta (restrito a ~/.messai no processo principal)
  openPath: (p: string): Promise<string> => ipcRenderer.invoke("mess:openPath", p),
});
