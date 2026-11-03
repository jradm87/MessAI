import { getPrefs, onPrefs } from "./prefs.js";
import { resolveLocale } from "./i18n.js";

/** #55/#51 — aplica as preferências de UI que têm efeito fora do React: cursor (CSS), lang do documento e as que vivem no processo principal. */
export function applyCursor(web: boolean): void { document.documentElement.dataset["cursor"] = web ? "web" : "native"; }
export function applyLanguage(lang: string): void {
  const loc = resolveLocale(lang);
  document.documentElement.lang = loc;
  document.documentElement.dataset["lang"] = loc;
}
export function syncUiPrefs(): void {
  const p = getPrefs();
  applyCursor(p.webCursor);
  applyLanguage(p.language);
  void window.messai.setUiPrefs?.({ powerMode: p.powerMode, confirmExit: p.confirmExit, closeToTray: p.closeToTray, updateAuto: p.updateAuto });
}
/** Aplica agora e a cada mudança; devolve o cancelamento. */
export function initUiPrefs(): () => void { syncUiPrefs(); return onPrefs(syncUiPrefs); }
