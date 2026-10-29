import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/** `window.prompt` não existe no Electron. `askText` abre um diálogo próprio e resolve com o texto ou null. */
export function askText(title: string, initial = "", placeholder = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null) => { root.unmount(); host.remove(); resolve(v); };
    function Dialog() {
      const [v, setV] = useState(initial);
      useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, []);
      return (
        <div className="modal-backdrop ask" onMouseDown={() => done(null)}>
          <div className="modal ask-modal" data-testid="ask-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h2>{title}</h2>
            <input autoFocus value={v} placeholder={placeholder} data-testid="ask-input" onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(v.trim() ? v.trim() : null); } }} />
            <div className="actions"><button type="button" onClick={() => done(null)}>Cancelar</button><button type="button" className="pri" disabled={!v.trim()} onClick={() => done(v.trim())}>OK</button></div>
          </div>
        </div>
      );
    }
    root.render(<Dialog />);
  });
}
