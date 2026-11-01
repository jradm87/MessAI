import { atom, getDefaultStore } from "jotai";
import { atomFamily, selectAtom } from "jotai/utils";

/** Store padrão do Jotai — para ler/escrever fora de componentes (handlers de stream, atalhos). */
export const store = getDefaultStore();
/** Tema efetivo ("light" | "dark"); quem precisa reagir (ex.: xterm) assina este átomo. */
export const themeAtom = atom<"light" | "dark">("dark");

/**
 * Estado volátil por nó, mantido FORA do rebuild do canvas: sessão e não-lidas.
 * Cada nó assina só o seu (via selectAtom), então um evento de PTY ou de mensagem
 * re-renderiza apenas aquele nó — não reconstrói o canvas inteiro.
 */
export const sessStateMapAtom = atom<Record<string, string>>({});
export const unreadMapAtom = atom<Record<string, number>>({});

export const sessStateAtom = atomFamily((id: string) => selectAtom(sessStateMapAtom, (m) => m[id]));
export const unreadAtom = atomFamily((id: string) => selectAtom(unreadMapAtom, (m) => m[id] ?? 0));

/** Atenção derivada: não-lidas pendentes ou processo encerrado/perdido. */
export const attentionAtom = atomFamily((id: string) =>
  atom((get) => {
    const s = get(sessStateAtom(id));
    return get(unreadAtom(id)) > 0 || s === "exited" || s === "lost";
  }),
);
