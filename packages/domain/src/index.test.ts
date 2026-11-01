import {  describe, expect, it } from "vitest";
import { canMessage, formatDelivery, resolveNodeRef, canWrite, checkRevision, decideLease, normalizeGeometry, trimBuffer, MAX_BUFFER_BYTES, applyRole, roleText, deriveNoteTitle, noteFileName, wrapInTmux, tmuxAttachPlan, shellQuote, tmuxSessionName, slugify, floorGitPlan, parseMergeConflicts, safeRelPath, looksBinary, alignGeometries, gridLayout, agentKind, stripAnsi } from "./index.js";

describe("revisão", () => {
  it("aceita revisão igual e devolve próxima", () => {
    expect(checkRevision({ revision: 3 }, 3)).toEqual({ ok: true, value: 4 });
  });
  it("conflita com revisão diferente e devolve a atual", () => {
    const r = checkRevision({ revision: 3 }, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "CONFLICT", revision: 3 });
  });
});

describe("lease", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("concede sem lease", () => {
    expect(decideLease({}, "a1234567", now).kind).toBe("granted");
  });
  it("nega para outro cliente com lease válido", () => {
    const d = decideLease({ lease: { clientId: "a1234567", expiresAt: "2026-01-01T00:00:10Z" } }, "b1234567", now);
    expect(d.kind).toBe("denied");
  });
  it("concede quando lease expirou", () => {
    const d = decideLease({ lease: { clientId: "a1234567", expiresAt: "2025-12-31T00:00:00Z" } }, "b1234567", now);
    expect(d.kind).toBe("granted");
  });
  it("não escreve em sessão encerrada", () => {
    const r = canWrite({ state: "exited" }, "a1234567", now);
    expect(r.ok).toBe(false);
  });
});

describe("geometria e buffer", () => {
  it("impõe tamanho mínimo", () => {
    expect(normalizeGeometry({ x: 1.4, y: 2.6, w: 1, h: 1 })).toEqual({ x: 1, y: 3, w: 40, h: 40 });
  });
  it("corta chunks antigos acima do limite", () => {
    const big = "x".repeat(MAX_BUFFER_BYTES);
    const r = trimBuffer([big, "fim"], MAX_BUFFER_BYTES + 3);
    expect(r.chunks).toEqual(["fim"]);
  });
});

describe("alinhar e organizar", () => {
  const items = [
    { id: "a", geometry: { x: 0, y: 0, w: 100, h: 50 } },
    { id: "b", geometry: { x: 200, y: 80, w: 60, h: 40 } },
    { id: "c", geometry: { x: 50, y: 300, w: 100, h: 100 } },
  ];
  it("alinha à esquerda pela menor borda x", () => {
    const out = alignGeometries(items, "left");
    expect(out.find((o) => o.id === "b")!.geometry.x).toBe(0);
    expect(out.find((o) => o.id === "c")!.geometry.x).toBe(0);
    expect(out.find((o) => o.id === "a")).toBeUndefined(); // já estava em x=0
  });
  it("alinha à direita pela maior borda x+w", () => {
    const out = alignGeometries(items, "right"); // maxX = 260
    expect(out.find((o) => o.id === "a")!.geometry.x).toBe(160);
  });
  it("centraliza no eixo vertical", () => {
    const out = alignGeometries(items, "vcenter"); // minY=0, maxY=400, cy=200
    expect(out.find((o) => o.id === "a")!.geometry.y).toBe(175); // 200 - 50/2
  });
  it("não faz nada com menos de 2 itens", () => {
    expect(alignGeometries([items[0]!], "left")).toEqual([]);
  });
  it("organiza em grade a partir do canto do conjunto", () => {
    const out = gridLayout(items, 40); // cols=2, colW=max(w)=100+40=140, rowH=max(h)=100+40=140, origin (0,0)
    const pos = (id: string) => { const o = out.find((x) => x.id === id); return o ? o.geometry : items.find((x) => x.id === id)!.geometry; };
    expect({ x: pos("a").x, y: pos("a").y }).toEqual({ x: 0, y: 0 });
    expect({ x: pos("b").x, y: pos("b").y }).toEqual({ x: 140, y: 0 });
    expect({ x: pos("c").x, y: pos("c").y }).toEqual({ x: 0, y: 140 });
  });
});

describe("mensagens", () => {
  const conns = [{ sourceNodeId: "a1234567", targetNodeId: "b1234567" }];
  it("permite entre nós conectados em qualquer sentido", () => {
    expect(canMessage(conns, "a1234567", "b1234567").ok).toBe(true);
    expect(canMessage(conns, "b1234567", "a1234567").ok).toBe(true);
  });
  it("recusa sem conexão e para si mesmo", () => {
    expect(canMessage(conns, "a1234567", "c1234567").ok).toBe(false);
    expect(canMessage(conns, "a1234567", "a1234567").ok).toBe(false);
  });
  it("resolve por título, prefixo e detecta ambiguidade", () => {
    const nodes = [{ nodeId: "abcd1234abcd", title: "Revisor" }, { nodeId: "abef5678abef", title: "Dev" }];
    expect(resolveNodeRef(nodes, "revisor").ok).toBe(true);
    expect(resolveNodeRef(nodes, "abcd").ok).toBe(true);
    const amb = resolveNodeRef(nodes, "ab"); expect(amb.ok).toBe(false); if (!amb.ok) expect(amb.error.code).toBe("CONFLICT");
  });
  it("formata entrega em uma linha com Enter no fim", () => {
    const t = formatDelivery({ messageId: "1234567890", fromTitle: "Dev", text: "oi\ntudo bem" });
    expect(t.endsWith("\r")).toBe(true); expect(t).toContain("mess reply 12345678"); expect(t).not.toContain("\n tudo");
  });
  it("cabeçalho da entrega é comentário (shell ignora)", () => {
    const t = formatDelivery({ messageId: "abcdef12", fromTitle: "Dev", text: "ls" });
    expect(t.startsWith("# [MessAI]")).toBe(true); // '#' faz o fish/bash ignorarem a linha e o (id)
  });
});

describe("agentKind", () => {
  it("distingue CLI de IA de shell cru", () => {
    expect(agentKind("claude", ["--flag"])).toMatchObject({ isAgent: true, agentType: "claudeCode" });
    expect(agentKind("/usr/bin/codex", [])).toMatchObject({ isAgent: true, agentType: "codex" });
    expect(agentKind("gemini", [])).toMatchObject({ isAgent: true, agentType: "geminiCLI" });
    expect(agentKind("opencode", [])).toMatchObject({ isAgent: true, agentType: "openCode" });
    expect(agentKind("fish", [])).toMatchObject({ isAgent: false, agentType: "genericShell" });
    expect(agentKind("/bin/bash", ["-l"]).isAgent).toBe(false);
    expect(agentKind("cat", []).isAgent).toBe(false);
  });
});

describe("stripAnsi", () => {
  it("remove cores, CSI e OSC", () => {
    expect(stripAnsi("\x1b[31mvermelho\x1b[0m")).toBe("vermelho");
    expect(stripAnsi("a\x1b[2Kb")).toBe("ab");
    expect(stripAnsi("\x1b]0;título\x07resto")).toBe("resto");
    expect(stripAnsi("linha1\nlinha2\t fim")).toBe("linha1\nlinha2\t fim"); // mantém \n \t
  });
});


describe("applyRole", () => {
  const role = { name: "Revisor", instructions: "Revise sem alterar." };
  it("anexa ao system prompt existente do claude", () => {
    const out = applyRole("claude", ["--append-system-prompt", "base"], role);
    expect(out).toEqual(["--append-system-prompt", `base\n\n${roleText(role)}`]);
  });
  it("cria o flag quando não existe e ignora outras CLIs", () => {
    expect(applyRole("/usr/bin/claude", [], role)).toEqual(["--append-system-prompt", roleText(role)]);
    expect(applyRole("codex", ["-m", "x"], role)).toEqual(["-m", "x"]);
    expect(applyRole("claude", ["a"], undefined)).toEqual(["a"]);
  });
});


describe("notas", () => {
  it("deriva o título da primeira linha útil", () => {
    expect(deriveNoteTitle("\n\n# Plano de **testes**\ncorpo")).toBe("Plano de **testes**");
    expect(deriveNoteTitle("- item longo ".padEnd(80, "x"))).toHaveLength(48);
    expect(deriveNoteTitle("   \n\n")).toBeUndefined();
  });
  it("gera nome de arquivo seguro", () => { expect(noteFileName('a/b: "c"?')).toBe("a b   c.md"); expect(noteFileName("")).toBe("nota.md"); });
});


describe("tmux", () => {
  it("embrulha o plano com new-session -A, env injetado e status off", () => {
    const plan = { command: "claude", args: ["--append-system-prompt", "oi lá"], cwd: "/tmp/p", env: { A: "1" } };
    const t = wrapInTmux(plan, "mess-abc", { MESS_NODE_ID: "n1" });
    expect(t.command).toBe("tmux");
    expect(t.args.slice(0, 8)).toEqual(["-L", "mess", "new-session", "-A", "-s", "mess-abc", "-c", "/tmp/p"]);
    expect(t.args).toContain("MESS_NODE_ID=n1");
    expect(t.args).toContain("claude --append-system-prompt 'oi lá'");
    expect(t.args.slice(-5)).toEqual([";", "set-option", "-t", "mess-abc", "status", "off"].slice(1));
    expect(tmuxAttachPlan(plan, "mess-abc", "t1").args).toEqual(["-L", "t1", "attach-session", "-t", "mess-abc"]);
    expect(shellQuote("it's")).toBe("'it'\\''s'"); expect(tmuxSessionName("0123456789abcdefXYZ")).toBe("mess-0123456789ab");
  });
});


describe("andares", () => {
  it("slug, plano git e conflitos", () => {
    expect(slugify("Feature: Login Único!")).toBe("feature-login-unico");
    expect(floorGitPlan({ groundCwd: "/p", path: "/f", branch: "feat", newBranch: true, base: "main" })).toEqual([["-C", "/p", "worktree", "add", "-b", "feat", "/f", "main"]]);
    expect(floorGitPlan({ groundCwd: "/p", path: "/f", branch: "feat", newBranch: false })).toEqual([["-C", "/p", "worktree", "add", "/f", "feat"]]);
    expect(parseMergeConflicts("Auto-merging a.txt\nCONFLICT (content): Merge conflict in a.txt\nCONFLICT (add/add): Merge conflict in dir/b.md\nAutomatic merge failed")).toEqual(["a.txt", "dir/b.md"]);
  });
});


describe("árvore de arquivos", () => {
  it("confina caminhos à raiz", () => {
    expect(safeRelPath("src/./a/../b.ts")).toEqual({ ok: true, value: "src/b.ts" });
    expect(safeRelPath("")).toEqual({ ok: true, value: "" });
    expect(safeRelPath("../x").ok).toBe(false); expect(safeRelPath("a/../../x").ok).toBe(false); expect(safeRelPath("/etc/passwd").ok).toBe(false);
    expect(looksBinary(new Uint8Array([104, 105]))).toBe(false); expect(looksBinary(new Uint8Array([104, 0, 105]))).toBe(true);
  });
});
