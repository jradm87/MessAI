import { useEffect, useState } from "react";
import type { Preset } from "@messyai/contracts";

export type AddChoice = { kind: "note" } | { kind: "tree" } | { kind: "terminal"; preset?: Preset; command?: string };

/** Menu "Adicionar" usado pela toolbar e pelo clique direito no canvas. */
export function AddMenu({ presets, onPick, onClose, x, y }: { presets: Preset[]; onPick: (c: AddChoice) => void; onClose: () => void; x: number; y: number }) {
  const [sub, setSub] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mi" onMouseEnter={() => setSub(true)}>▸ Terminal <span className="sp" />›</div>
        <div className="mi" onClick={() => onPick({ kind: "note" })}>▤ Nota</div>
        <div className="mi" onClick={() => onPick({ kind: "tree" })}>▦ Árvore de arquivos</div>
        {sub && (
          <div className="menu sub">
            {custom === null ? (
              <div className="mi" onClick={() => setCustom("")}>Novo terminal…</div>
            ) : (
              <form className="mi" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) onPick({ kind: "terminal", command: custom.trim() }); }}>
                <input autoFocus placeholder="comando" value={custom} onChange={(e) => setCustom(e.target.value)} />
              </form>
            )}
            <hr />
            {presets.map((p) => (
              <div key={p.id} className={`mi ${p.available ? "" : "off"}`} title={p.available ? p.command : `${p.command} não encontrado no PATH`}
                onClick={() => p.available && onPick({ kind: "terminal", preset: p })}>
                {p.label}{p.available ? "" : " · indisponível"}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
