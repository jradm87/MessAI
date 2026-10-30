// ResizeObserver dispara um "loop" inofensivo quando o xterm/React Flow redimensionam em cascata; silencia só isso.
window.addEventListener("error", (e) => { if (e.message && e.message.includes("ResizeObserver loop")) { e.stopImmediatePropagation(); } });
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

function Boot() {
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "#0a0a0b", color: "#e7e9ee", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>MessAI</div>
      <div style={{ fontSize: 13, color: "#9aa0ab", animation: "pulse 1.4s ease-in-out infinite" }}>conectando ao runtime…</div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<Boot />); // aparece na hora, enquanto a conexão (que aguarda o runtime) resolve
window.messai.connection().then((conn) => {
  if (!conn || !conn.token) { root.render(<div style={{ padding: 24 }}>Runtime indisponível. Veja o log do processo principal.</div>); return; }
  root.render(<App conn={conn} />);
});
