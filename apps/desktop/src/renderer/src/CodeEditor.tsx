import { useEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";

/** #30 — linguagem pelo nome do arquivo (destaque de sintaxe). Sem correspondência: texto puro. */
export function languageFor(path: string): Extension | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  switch (ext) {
    case "js": case "mjs": case "cjs": return javascript();
    case "jsx": return javascript({ jsx: true });
    case "ts": case "mts": case "cts": return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "json": return json();
    case "md": case "markdown": return markdown();
    case "py": return python();
    case "css": return css();
    case "html": case "htm": return html();
    case "yml": case "yaml": return yaml();
    default: return null;
  }
}

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--fg, #ddd)" },
});

/** Editor de código (CodeMirror 6): destaque, busca (Ctrl+F), desfazer, Tab indenta, Ctrl+S salva. Controlado só na entrada: o pai guarda o texto via onChange. */
export function CodeEditor({ value, path, readOnly, dark, onChange, onSave }: { value: string; path: string; readOnly: boolean; dark: boolean; onChange: (text: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onSave }); cb.current = { onChange, onSave };
  const themeC = useRef(new Compartment());
  useEffect(() => {
    const lang = languageFor(path);
    const ext: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), indentOnInput(), bracketMatching(), highlightSelectionMatches(), EditorView.lineWrapping,
      search({ top: true }), baseTheme, themeC.current.of(dark ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true })),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { cb.current.onSave(); return true; } }, indentWithTab, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
    ];
    if (lang) ext.push(lang);
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions: ext }), parent: host.current! });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // recria só quando muda o arquivo/modo; o texto digitado não volta por `value` (evita perder cursor)
  }, [path, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { view.current?.dispatch({ effects: themeC.current.reconfigure(dark ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true })) }); }, [dark]);
  // recarga externa (ex.: "Recarregar do disco"): troca o documento inteiro
  useEffect(() => { const v = view.current; if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } }); }, [value]);
  return <div ref={host} className="code-editor" data-testid="code-editor" />;
}
