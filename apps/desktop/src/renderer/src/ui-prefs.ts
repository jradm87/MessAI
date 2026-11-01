import { getPrefs, onPrefs } from "./prefs.js";

/** #55 — aplica as preferências de UI que têm efeito fora do React: cursor (CSS) e as que vivem no processo principal. */
export function applyCursor(web: boolean): void { document.documentElement.dataset["cursor"] = web ? "web" : "native"; }
export function syncUiPrefs(): void {
  const p = getPrefs();
  applyCursor(p.webCursor);
  void window.messai.setUiPrefs?.({ powerMode: p.powerMode, confirmExit: p.confirmExit, closeToTray: p.closeToTray, updateAuto: p.updateAuto });
}
/** Aplica agora e a cada mudança; devolve o cancelamento. */
export function initUiPrefs(): () => void { syncUiPrefs(); return onPrefs(syncUiPrefs); }
