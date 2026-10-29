// ResizeObserver dispara um "loop" inofensivo quando o xterm/React Flow redimensionam em cascata; silencia só isso.
window.addEventListener("error", (e) => { if (e.message && e.message.includes("ResizeObserver loop")) { e.stopImmediatePropagation(); } });
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
window.messai.connection().then((conn) => {
  if (!conn || !conn.token) { root.render(<div style={{ padding: 24 }}>Runtime indisponível. Veja o log do processo principal.</div>); return; }
  root.render(<App conn={conn} />);
});
