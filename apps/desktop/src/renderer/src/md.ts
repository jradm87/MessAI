import { marked } from "marked";
import DOMPurify from "dompurify";
import { useEffect } from "react";

marked.setOptions({ gfm: true, breaks: true });
/** Markdown → HTML saneado. Blocos ```mermaid ficam como <pre class="mermaid-src"> para o hook renderizar. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ["class"] });
}

let mermaidMod: Promise<typeof import("mermaid")["default"]> | null = null;
const loadMermaid = () => (mermaidMod ??= import("mermaid").then((m) => { m.default.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" }); return m.default; }));

/** Renderiza diagramas Mermaid dentro de `root` (code.language-mermaid) depois de cada mudança de `deps`. */
export function useMermaid(root: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  useEffect(() => {
    const el = root.current; if (!el) return;
    const blocks = [...el.querySelectorAll("pre > code.language-mermaid")] as HTMLElement[];
    if (!blocks.length) return;
    let alive = true;
    void loadMermaid().then(async (mermaid) => {
      for (const [i, code] of blocks.entries()) {
        const pre = code.parentElement!; const src = code.textContent ?? "";
        try {
          const { svg } = await mermaid.render(`mm-${Date.now().toString(36)}-${i}`, src);
          if (!alive) return;
          const box = document.createElement("div"); box.className = "mermaid-box"; box.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
          box.title = "clique para copiar a fonte"; box.dataset["src"] = src;
          pre.replaceWith(box);
        } catch { pre.classList.add("mermaid-error"); }
      }
    });
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
