import { useEffect, useState } from "react";
import { Columns2 } from "lucide-react";
import { useAtom } from "jotai";
import type { WinState } from "./api.js";
import { uiScreenAtom } from "./screens.js";

/**
 * Barra de título própria da janela sem moldura (Windows): arrastar move a janela, duplo clique maximiza (nativo do
 * `app-region: drag`) e os três botões ficam à esquerda no estilo macOS (fechar · minimizar · maximizar).
 * Os símbolos aparecem ao passar o mouse; sem foco, os botões ficam cinza.
 */
export function TitleBar() {
  const [st, setSt] = useState<WinState>({ maximized: false, focused: true });
  const [ui, setUi] = useAtom(uiScreenAtom);
  useEffect(() => {
    void window.messai.winControl?.("state").then((s) => { if (s) setSt(s); });
    return window.messai.onWinState?.(setSt);
  }, []);
  const act = (a: "close" | "min" | "max" | "span") => void window.messai.winControl?.(a).then((s) => { if (s) setSt(s); });
  return (
    <div className={`titlebar ${st.focused ? "" : "blur"}`} data-testid="titlebar">
      <div className="lights">
        <button className="light close" title="Fechar" aria-label="Fechar" onClick={() => act("close")}>
          <svg viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" /></svg>
        </button>
        <button className="light min" title="Minimizar" aria-label="Minimizar" onClick={() => act("min")}>
          <svg viewBox="0 0 10 10"><path d="M2.5 5h5" /></svg>
        </button>
        <button className="light max" title={st.maximized ? "Restaurar" : "Maximizar"} aria-label={st.maximized ? "Restaurar" : "Maximizar"} onClick={() => act("max")}>
          {st.maximized
            ? <svg viewBox="0 0 10 10"><path d="M5 2.5v2.5h2.5M5 7.5V5H2.5" /></svg>
            : <svg viewBox="0 0 10 10"><path d="M3 7V3h4M7 3v4H3" /></svg>}
        </button>
      </div>
      <div className="tb-title">MessAI</div>
      {(st.screens?.length ?? 1) > 1 && (
        <button className="tb-zone" data-testid="ui-screen" onClick={() => setUi(ui === "left" ? "primary" : "left")}
          title="Monitor onde ficam a paleta, a barra de baixo, o minimapa e a barra de seleção (clique alterna)">
          {ui === "left" ? "Controles: monitor esquerdo" : "Controles: monitor principal"}
        </button>
      )}
      {(st.displays ?? 1) > 1 && (
        <button className={`tb-span ${st.spanned ? "on" : ""}`} data-testid="win-span" onClick={() => act("span")}
          title={st.spanned ? "Voltar ao tamanho anterior" : `Esticar em todas as telas (${st.displays} monitores)`}>
          <Columns2 size={14} />
        </button>
      )}
    </div>
  );
}
