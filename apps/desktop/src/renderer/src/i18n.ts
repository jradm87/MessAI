import { getPref, setPref, usePref } from "./prefs.js";

export type LanguagePref = "system" | "pt-BR" | "en-US";
export type Locale = "pt-BR" | "en-US";

export const LANGUAGES: { id: LanguagePref; label: string }[] = [
  { id: "system", label: "Padrão do sistema" },
  { id: "pt-BR", label: "Português (Brasil)" },
  { id: "en-US", label: "English (US)" },
];

export function resolveLocale(pref: string | undefined): Locale {
  if (pref === "en-US") return "en-US";
  return "pt-BR";
}

export const MESSAGES: Record<Locale, Record<string, string>> = {
  "pt-BR": {
    "prefs.title": "Preferências",
    "prefs.tab.general": "Geral",
    "prefs.tab.terminal": "Terminal",
    "prefs.tab.agents": "Agentes",
    "prefs.tab.shortcuts": "Atalhos",
    "prefs.tab.remote": "Controle remoto",
    "prefs.tab.updates": "Atualizações",
    "prefs.tab.data": "Dados",
    "prefs.tab.opensource": "Código aberto",
    "prefs.tab.about": "Sobre",
    "prefs.system": "Sistema",
    "prefs.language": "Idioma",
    "prefs.language.hint": "Idioma da interface (Português ou Inglês).",
    "prefs.theme": "Tema",
    "prefs.power": "Energia",
    "prefs.notifications": "Notificações",
    "prefs.exit": "Saída do app",
    "side.filter": "Filtrar",
    "side.folder": " Pasta",
    "side.group": " Grupo",
    "app.add": "+ Adicionar",
  },
  "en-US": {
    "prefs.title": "Preferences",
    "prefs.tab.general": "General",
    "prefs.tab.terminal": "Terminal",
    "prefs.tab.agents": "Agents",
    "prefs.tab.shortcuts": "Shortcuts",
    "prefs.tab.remote": "Remote control",
    "prefs.tab.updates": "Updates",
    "prefs.tab.data": "Data",
    "prefs.tab.opensource": "Open source",
    "prefs.tab.about": "About",
    "prefs.system": "System",
    "prefs.language": "Language",
    "prefs.language.hint": "Interface language (Portuguese or English).",
    "prefs.theme": "Theme",
    "prefs.power": "Power",
    "prefs.notifications": "Notifications",
    "prefs.exit": "App exit",
    "side.filter": "Filter",
    "side.folder": " Folder",
    "side.group": " Group",
    "app.add": "+ Add",
  },
};

export function t(key: string, locale?: Locale): string {
  const loc = locale ?? resolveLocale(getPref("language"));
  return MESSAGES[loc]?.[key] ?? MESSAGES["pt-BR"][key] ?? key;
}

export function useI18n() {
  const raw = usePref("language");
  const langPref: LanguagePref = raw === "pt-BR" || raw === "en-US" ? raw : "system";
  const locale = resolveLocale(langPref);
  return {
    langPref,
    locale,
    setLanguage: (l: LanguagePref) => setPref("language", l),
    t: (key: string) => t(key, locale),
  };
}
