// ResizeObserver dispara um "loop" inofensivo quando o xterm/React Flow redimensionam em cascata; silencia só isso.
window.addEventListener("error", (e) => { if (e.message && e.message.includes("ResizeObserver loop")) { e.stopImmediatePropagation(); } });
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Hud } from "./Hud.js";
import { initTheme, onTheme, getEffectiveTheme } from "./theme.js";
import { initUiPrefs } from "./ui-prefs.js";
import { store, themeAtom } from "./atoms.js";
import "./styles.css";

// #67: o mesmo bundle serve a janela principal e a flutuante; a rota é o hash (`index.html#hud`).
const isHud = window.location.hash === "#hud";
if (isHud) { document.documentElement.dataset["hud"] = "1"; document.title = "MessAI — Companheiro"; }

// Tema antes do primeiro render (sem flash): aplica `data-theme` já aqui e espelha no átomo para quem reage (xterm).
initTheme();
store.set(themeAtom, getEffectiveTheme());
onTheme((t) => store.set(themeAtom, t));
if (!isHud) initUiPrefs(); // #55: cursor + prefs que vivem no processo principal (energia, saída, bandeja)

// Remove o splash estático (index.html) com um fade curto quando o conteúdo React já está pronto.
const dropSplash = () => { const s = document.getElementById("splash"); if (s) { s.style.opacity = "0"; setTimeout(() => s.remove(), 250); } };

const root = createRoot(document.getElementById("root")!);
window.messai.connection().then((conn) => {
  if (!conn || !conn.token) { root.render(<div style={{ padding: 24 }}>Runtime indisponível. Veja o log do processo principal.</div>); dropSplash(); return; }
  root.render(isHud ? <Hud conn={conn} /> : <App conn={conn} />);
  requestAnimationFrame(dropSplash);
});
