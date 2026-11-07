import {  describe, expect, it } from "vitest";
import { canMessage, formatDelivery, resolveNodeRef, parseCrossRef, resolveCrossNodeRef, parseGitRemote, buildPrCompareUrl, canWrite, checkRevision, decideLease, normalizeGeometry, trimBuffer, MAX_BUFFER_BYTES, applyRole, roleText, deriveNoteTitle, noteFileName, wrapInTmux, tmuxAttachPlan, shellQuote, tmuxSessionName, slugify, floorGitPlan, parseMergeConflicts, safeRelPath, looksBinary, alignGeometries, gridLayout, agentKind, agentResume, stripAnsi, normalizePortalUrl, parsePortal, portalKey, serializePortal, androidInputText, androidKey, isAdbSerial, isAndroidActivity, isAndroidPackage, isAvdName, parseAdbDevices, parseAndroidFocus, parseAndroidPackages, parseUiDump, parseWmSize, pngSize, uiNodeAt, withClaudeAutonomy, withAgentAutonomy, rectBorderToward, floatingEnds, borderSide, treeLayout, pushOutsideRect } from "./index.js";

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
    expect(agentKind("opencode", [])).toMatchObject({ isAgent: true, agentType: "openCode" });
    expect(agentKind("agy", [])).toMatchObject({ isAgent: true, agentType: "antigravityCLI" }); // antigravity = binário agy
    expect(agentKind("fish", [])).toMatchObject({ isAgent: false, agentType: "genericShell" });
    expect(agentKind("/bin/bash", ["-l"]).isAgent).toBe(false);
    expect(agentKind("cat", []).isAgent).toBe(false);
  });
});

describe("agentResume", () => {
  it("claude: com id → --resume determinístico (troca --session-id); sem id → --continue da pasta", () => {
    const r = agentResume("claudeCode");
    expect(r.startArgs!("abc-123")).toEqual(["--session-id", "abc-123"]);
    expect(r.resume!("abc-123", ["--append-system-prompt", "x", "--session-id", "abc-123"]))
      .toEqual({ command: "claude", args: ["--append-system-prompt", "x", "--resume", "abc-123"] });
    expect(r.resume!(null, ["--append-system-prompt", "x"]))
      .toEqual({ command: "claude", args: ["--append-system-prompt", "x", "--continue"] });
  });
  it("codex/opencode/agy: continuam a última (sem id, sem startArgs)", () => {
    expect(agentResume("codex").startArgs).toBeUndefined();
    expect(agentResume("codex").resume!(null, [])).toEqual({ command: "codex", args: ["resume", "--last"] });
    expect(agentResume("openCode").resume!(null, [])).toEqual({ command: "opencode", args: ["--continue"] });
    expect(agentResume("antigravityCLI").resume!(null, [])).toEqual({ command: "agy", args: ["--continue"] });
  });
  it("shell não tem retomada", () => {
    expect(agentResume("genericShell").resume).toBeUndefined();
    expect(agentResume("genericShell").startArgs).toBeUndefined();
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

  it("resolve referências Nome @ Espaço entre andares e entre espaços (#82)", () => {
    expect(parseCrossRef("Worker @ Backend")).toEqual({ nodeRef: "Worker", workspaceRef: "Backend" });
    expect(parseCrossRef("Worker")).toEqual({ nodeRef: "Worker" });
    const workspaces = [
      { workspaceId: "ws-ground-1", name: "Principal" },
      { workspaceId: "ws-floor-1", name: "Andar Login", branch: "feat/login" },
      { workspaceId: "ws-other-1", name: "Backend API" },
    ];
    const allNodes = [
      { nodeId: "node-11111111", title: "Worker", workspaceId: "ws-ground-1" },
      { nodeId: "node-22222222", title: "Worker", workspaceId: "ws-floor-1" },
      { nodeId: "node-33333333", title: "API Server", workspaceId: "ws-other-1" },
    ];
    expect(resolveCrossNodeRef(allNodes, workspaces, "ws-ground-1", new Set(), "Worker")).toEqual({
      ok: true,
      value: allNodes[0],
    });
    expect(resolveCrossNodeRef(allNodes, workspaces, "ws-ground-1", new Set(), "Worker @ Andar Login")).toEqual({
      ok: true,
      value: allNodes[1],
    });
    expect(resolveCrossNodeRef(allNodes, workspaces, "ws-ground-1", new Set(), "Worker @ feat/login")).toEqual({
      ok: true,
      value: allNodes[1],
    });
    expect(resolveCrossNodeRef(allNodes, workspaces, "ws-ground-1", new Set(["node-33333333"]), "API Server")).toEqual({
      ok: true,
      value: allNodes[2],
    });
  });

  it("interpreta remotes git (SSH/HTTPS) e monta URLs de Pull Request para GitHub, GitLab, Gitea e hosts customizados (#31)", () => {
    expect(parseGitRemote("git@github.com:jradm87/MessAI.git")).toEqual({
      host: "github.com",
      repoSlug: "jradm87/MessAI",
      kind: "github",
    });
    expect(parseGitRemote("https://gitlab.empresa.com.br/time/api.git", [{ host: "gitlab.empresa.com.br", kind: "gitlab" }])).toEqual({
      host: "gitlab.empresa.com.br",
      repoSlug: "time/api",
      kind: "gitlab",
    });
    const customUrl = buildPrCompareUrl({
      host: "git.interno.local",
      repoSlug: "core/app",
      kind: "custom",
      baseBranch: "main",
      headBranch: "feat/pr",
      title: "Novo recurso",
      customTemplate: "https://{host}/projects/{repo}/pr?from={head}&to={base}&title={title}",
    });
    expect(customUrl).toBe("https://git.interno.local/projects/core/app/pr?from=feat%2Fpr&to=main&title=Novo%20recurso");
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

// ---------- #93 modo isolado: bubblewrap ----------
import { bwrapPlan, expandHome, isolationMounts, scrubEnv, validateIsolation, ISOLATED_APPROVABLE_CAPS, ISOLATED_DEFAULT_CAPS, type IsolationContext } from "./index.js";
const ictx = (o: Partial<IsolationContext> = {}): IsolationContext => ({ cwd: "/work/proj", home: "/home/agent", systemDirs: ["/usr", "/etc"], systemLinks: [["usr/bin", "/bin"], ["usr/lib", "/lib"]], roPaths: ["/opt/cli"], rwPaths: ["/home/u/.claude"], env: { PATH: "/usr/bin", MESS_TOKEN: "agt_x" }, ...o });
const base = { command: "claude", args: ["--x"], cwd: "/work/proj", env: { TERM: "xterm-256color" } };
describe("bwrapPlan (#93)", () => {
  it("rede none → --unshare-net; host → compartilha (sem a flag) e liga o resolv.conf real; sempre namespaces + cap-drop + die-with-parent", () => {
    const none = bwrapPlan(base, { network: "none" }, ictx()); expect(none.command).toBe("bwrap");
    for (const f of ["--die-with-parent", "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-net"]) expect(none.args).toContain(f);
    expect(none.args.join(" ")).toContain("--cap-drop ALL");
    const host = bwrapPlan(base, { network: "host" }, ictx({ resolvConf: "/run/systemd/resolve/stub-resolv.conf" }));
    expect(host.args).not.toContain("--unshare-net"); expect(host.args.join(" ")).toContain("--ro-bind /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf");
    expect(none.args.join(" ")).not.toContain("resolv.conf");
    // /etc/resolv.conf é link: o bwrap não monta SOBRE ele, então o arquivo real vai para o alvo do link
    const lnk = bwrapPlan(base, { network: "host" }, ictx({ resolvConf: "/run/systemd/resolve/resolv.conf", resolvDest: "/run/systemd/resolve/stub-resolv.conf" }));
    expect(lnk.args.join(" ")).toContain("--ro-bind /run/systemd/resolve/resolv.conf /run/systemd/resolve/stub-resolv.conf"); expect(lnk.args.join(" ")).not.toContain(" /etc/resolv.conf");
  });
  it("raiz vazia: só sistema RO + ro/rw explícitos + cwd gravável; /home nunca é montado; HOME vazio; ambiente limpo e só o declarado; comando no fim", () => {
    const p = bwrapPlan(base, { network: "none" }, ictx());
    const j = p.args.join(" ");
    expect(j).toContain("--ro-bind /usr /usr"); expect(j).toContain("--ro-bind /etc /etc"); expect(j).toContain("--symlink usr/bin /bin");
    expect(j).toContain("--ro-bind /opt/cli /opt/cli"); expect(j).toContain("--bind /work/proj /work/proj"); expect(j).toContain("--bind /home/u/.claude /home/u/.claude");
    expect(j).not.toMatch(/--(ro-)?bind \/home /); expect(j).not.toMatch(/--ro-bind \/ \//); // nunca a raiz inteira
    expect(j).toContain("--dir /home/agent"); expect(j).toContain("--tmpfs /tmp"); expect(j).toContain("--clearenv");
    expect(j).toContain("--setenv MESS_TOKEN agt_x"); expect(j).toContain("--setenv HOME /home/agent");
    expect(p.args.slice(-3)).toEqual(["--", "claude", "--x"]);
    expect(p.env["HOME"]).toBe("/home/agent"); expect(Object.keys(p.env).sort()).toEqual(["HOME", "PATH", "TERM"]); // o processo externo só tem o mínimo
  });
  it("protect: monta SOMENTE LEITURA depois dos gravávEIS (sobrepõe, ex.: .git/hooks)".replace("gravávEIS", "graváveis"), () => {
    const a = bwrapPlan(base, { network: "none" }, ictx({ protect: ["/work/proj/.git/hooks"] })).args;
    const iw = a.indexOf("/work/proj", a.indexOf("--bind")); const ip = a.findIndex((x, i) => x === "--ro-bind" && a[i + 1] === "/work/proj/.git/hooks");
    expect(iw).toBeGreaterThan(-1); expect(ip).toBeGreaterThan(iw); // o ro-bind vem depois do bind gravável
  });
  it("limites de cgroup só quando há systemd de usuário; senão rodam sem eles (o chamador avisa)", () => {
    const lim = { network: "none" as const, memoryMaxMb: 512, tasksMax: 100 };
    const w = bwrapPlan(base, lim, ictx({ cgroupScope: true, outerEnv: { XDG_RUNTIME_DIR: "/run/user/1000" } }));
    expect(w.command).toBe("systemd-run"); expect(w.args.slice(0, 3)).toEqual(["--user", "--scope", "--quiet"]);
    expect(w.args.join(" ")).toContain("-p MemoryMax=512M"); expect(w.args.join(" ")).toContain("-p TasksMax=100"); expect(w.args).toContain("bwrap"); expect(w.env["XDG_RUNTIME_DIR"]).toBe("/run/user/1000");
    expect(bwrapPlan(base, lim, ictx({ cgroupScope: false })).command).toBe("bwrap");
  });
  it("isolationMounts: cwd e rw ganham de ro igual; scrubEnv só deixa passar a lista segura; expandHome", () => {
    expect(isolationMounts(ictx({ roPaths: ["/work/proj", "/a"], rwPaths: [] }))).toEqual({ ro: ["/a"], rw: ["/work/proj"] });
    const e = scrubEnv({ PATH: "/usr/bin", LANG: "pt_BR", AWS_SECRET_ACCESS_KEY: "x", SSH_AUTH_SOCK: "/s", GITHUB_TOKEN: "t", TERM: "dumb" }, { MESS_TOKEN: "agt" });
    expect(e).toEqual({ PATH: "/usr/bin", LANG: "pt_BR", TERM: "xterm-256color", MESS_TOKEN: "agt" });
    expect(expandHome("~/x", "/home/u")).toBe("/home/u/x"); expect(expandHome("~", "/home/u")).toBe("/home/u"); expect(expandHome("/abs", "/home/u")).toBe("/abs"); expect(expandHome("~u/x", "/home/u")).toBe("~u/x");
  });
});
describe("validateIsolation (#93)", () => {
  const H = "/home/u";
  it("normaliza ~, remove barra final e duplicatas; mantém limites", () => {
    const r = validateIsolation({ network: "host", ro: ["~/tools/", "/opt/x", "~/tools"], rw: ["~/.claude"], memoryMaxMb: 512 }, H);
    expect(r).toEqual({ ok: true, value: { network: "host", ro: ["/home/u/tools", "/opt/x"], rw: ["/home/u/.claude"], memoryMaxMb: 512 } });
  });
  it("recusa relativo, '..', a raiz, o home e ancestrais do home (anula o isolamento)", () => {
    for (const bad of ["rel/dir", "/a/../b", "/", "/home/u", "~", "/home", "~/"]) { const r = validateIsolation({ network: "none", rw: [bad] }, H); expect(r.ok, bad).toBe(false); }
    expect(validateIsolation({ network: "none", ro: ["/home/u/sub"] }, H).ok).toBe(true); // subpasta específica pode
  });
  it("padrão do isolado não tem nenhuma capacidade que execute fora do sandbox, e nada disso é aprovável por pedido", () => {
    for (const c of ["workspace:manage", "terminal:control", "maestro:conduct"]) { expect(ISOLATED_DEFAULT_CAPS as readonly string[]).not.toContain(c); expect(ISOLATED_APPROVABLE_CAPS as readonly string[]).not.toContain(c); }
    expect(ISOLATED_APPROVABLE_CAPS as readonly string[]).toContain("nodes:write");
  });
});


describe("portais (#26)", () => {
  it("normalizePortalUrl: aceita http/https/host; completa o esquema; recusa file:, javascript:, data:, chrome:, view-source:, credenciais, espaços", () => {
    const ok = (i: string) => { const r = normalizePortalUrl(i); return r.ok ? r.url : `ERRO:${r.reason}`; };
    expect(ok("https://exemplo.com/a?b=1#c")).toBe("https://exemplo.com/a?b=1#c");
    expect(ok("exemplo.com")).toBe("https://exemplo.com/");
    expect(ok("localhost:3000/app")).toBe("http://localhost:3000/app"); // dev local: http
    expect(ok("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
    expect(ok("  http://a.b  ")).toBe("http://a.b/");
    expect(ok("about:blank")).toBe("about:blank");
    for (const bad of ["file:///etc/passwd", "FILE:///etc/passwd", "javascript:alert(1)", "javascript:1", "data:text/html,<script>1</script>", "chrome://settings", "view-source:https://a.b", "devtools://x", "ftp://a.b", "blob:https://a.b/x", "https://user:pw@a.b", "http://", "", "   ", "a b.com", "semponto", "https://a.b/x y", "\u0000http://a.b"]) expect(ok(bad), bad).toMatch(/^ERRO:/);
  });
  it("portalKey: nomes (Enter/Tab/setas/F5), caractere imprimível, desconhecida → null", () => {
    expect(portalKey("Enter")).toMatchObject({ key: "Enter", vk: 13, text: "\r" }); expect(portalKey("arrowdown")).toMatchObject({ key: "ArrowDown", vk: 40 });
    expect(portalKey("F5")).toMatchObject({ key: "F5", vk: 116 }); expect(portalKey("a")).toMatchObject({ key: "a", code: "KeyA", vk: 65, text: "a" }); expect(portalKey("7")).toMatchObject({ code: "Digit7", vk: 55 });
    expect(portalKey("NaoExiste")).toBeNull();
  });
  it("conteúdo do nó portal: round trip e tolerância a lixo", () => {
    expect(parsePortal(serializePortal({ url: "https://a.b/" }))).toEqual({ url: "https://a.b/" });
    for (const junk of ["", "x", "{", "[]", "{\"url\":3}", undefined]) expect(parsePortal(junk as string | undefined)).toEqual({ url: "" });
  });
});

describe("dispositivos Android (#73)", () => {
  it("parseAdbDevices: emulador, USB, rede, offline/unauthorized; ignora cabeçalho e avisos do daemon", () => {
    const out = `* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\nemulator-5554          device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:generic_x86_64 transport_id:1\nR58M123ABC             device usb:1-2 product:beyond1 model:SM_G973F device:beyond1 transport_id:2\n192.168.0.5:5555       device product:x model:Pixel_6 device:oriole transport_id:3\nZZZ                    unauthorized usb:1-3 transport_id:4\nOFF                    offline\n\n`;
    const d = parseAdbDevices(out);
    expect(d.map((x) => `${x.serial}|${x.state}|${x.kind}`)).toEqual(["emulator-5554|device|emulator", "R58M123ABC|device|usb", "192.168.0.5:5555|device|network", "ZZZ|unauthorized|usb", "OFF|offline|usb"]);
    expect(d[1]).toMatchObject({ model: "SM G973F", product: "beyond1" }); expect(parseAdbDevices("")).toEqual([]);
  });
  it("parseWmSize prefere o Override; parseAndroidPackages ordena; parseAndroidFocus acha pacote/atividade", () => {
    expect(parseWmSize("Physical size: 1080x1920\n")).toEqual({ w: 1080, h: 1920 }); expect(parseWmSize("Physical size: 1080x1920\nOverride size: 720x1280")).toEqual({ w: 720, h: 1280 }); expect(parseWmSize("erro")).toBeNull();
    expect(parseAndroidPackages("package:com.b\r\npackage:com.a.x\n\nlixo")).toEqual(["com.a.x", "com.b"]);
    expect(parseAndroidFocus("  mCurrentFocus=Window{2c0a107 u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}")).toBe("com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity");
    expect(parseAndroidFocus("  ResumedActivity: ActivityRecord{abc u0 com.android.settings/.Settings t12}")).toBe("com.android.settings/.Settings"); expect(parseAndroidFocus("nada")).toBeUndefined();
  });
  it("validadores: pacote, atividade, AVD e serial recusam o que não é nome (nada vai ao shell do aparelho)", () => {
    for (const ok of ["com.android.settings", "br.com.coamo.app.gestor.rural", "a.b"]) expect(isAndroidPackage(ok), ok).toBe(true);
    for (const bad of ["com", "com.evil; rm -rf /", "com.a b", "1com.a", "com..a", "$(id).x", "com.a\nb", ""]) expect(isAndroidPackage(bad), bad).toBe(false);
    expect(isAndroidActivity(".Settings")).toBe(true); expect(isAndroidActivity("com.a.Main$Inner")).toBe(true); expect(isAndroidActivity("a;b")).toBe(false);
    expect(isAvdName("avd-api30-playstore")).toBe(true); expect(isAvdName("-no-window")).toBe(false); expect(isAvdName("a b")).toBe(false);
    expect(isAdbSerial("emulator-5554")).toBe(true); expect(isAdbSerial("192.168.0.5:5555")).toBe(true); expect(isAdbSerial("-s")).toBe(false); expect(isAdbSerial("a;b")).toBe(false);
  });
  it("androidKey: nomes amigáveis, KEYCODE_ e números; texto livre recusado", () => {
    expect(androidKey("back")).toBe("KEYCODE_BACK"); expect(androidKey("HOME")).toBe("KEYCODE_HOME"); expect(androidKey("recents")).toBe("KEYCODE_APP_SWITCH"); expect(androidKey("KEYCODE_VOLUME_UP")).toBe("KEYCODE_VOLUME_UP"); expect(androidKey("66")).toBe("66");
    for (const bad of ["KEYCODE_HOME; reboot", "back && reboot", "$(id)", "keycode_home", "1234", ""]) expect(androidKey(bad), bad).toBeNull();
  });
  it("androidInputText: aspas simples escapadas, espaço vira %s, só ASCII imprimível", () => {
    expect(androidInputText("ola mundo")).toEqual({ ok: true, arg: "'ola%smundo'" });
    expect(androidInputText("it's $(id); `x` & \"q\"")).toEqual({ ok: true, arg: `'it'\\''s%s$(id);%s\`x\`%s&%s"q"'` });
    expect(androidInputText("olá")).toMatchObject({ ok: false }); expect(androidInputText("a\nb")).toMatchObject({ ok: false, reason: expect.stringContaining("enter") }); expect(androidInputText("😀")).toMatchObject({ ok: false });
  });
  it("parseUiDump: aninhamento, escapes XML, nós autofechados, bounds; uiNodeAt escolhe o menor; tolera lixo e limite", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="p" content-desc="" clickable="false" enabled="true" scrollable="false" checked="false" selected="false" focusable="false" bounds="[0,0][1080,1920]"><node index="0" text="Entrar &amp; sair" resource-id="p:id/btn" class="android.widget.Button" package="p" content-desc="Botão&#10;um" clickable="true" enabled="false" scrollable="false" checked="true" selected="false" focusable="true" bounds="[100,200][500,300]" /><node index="1" text="" resource-id="" class="android.widget.ScrollView" package="p" content-desc="" clickable="false" enabled="true" scrollable="true" checked="false" selected="false" focusable="false" bounds="[0,400][1080,1800]"><node index="0" text="x" class="android.widget.TextView" package="p" bounds="[10,410][200,460]" /></node></node></hierarchy>UI hierchary dumped to: /dev/tty`;
    const t = parseUiDump(xml); expect(t.nodes.map((n) => `${n.ref}:${n.depth}:${n.cls.split(".").pop()}`)).toEqual(["0:0:FrameLayout", "1:1:Button", "2:1:ScrollView", "3:2:TextView"]);
    expect(t.nodes[1]).toMatchObject({ text: "Entrar & sair", desc: "Botão\num", resourceId: "p:id/btn", clickable: true, enabled: false, checked: true, bounds: { x1: 100, y1: 200, x2: 500, y2: 300 } }); expect(t.nodes[2]!.scrollable).toBe(true); expect(t.truncated).toBe(false);
    expect(uiNodeAt(t.nodes, 300, 250)!.text).toBe("Entrar & sair"); expect(uiNodeAt(t.nodes, 50, 430)!.text).toBe("x"); expect(uiNodeAt(t.nodes, 900, 100)!.cls).toContain("FrameLayout"); expect(uiNodeAt(t.nodes, 5000, 5000)).toBeNull();
    expect(parseUiDump(xml, 2)).toMatchObject({ truncated: true }); expect(parseUiDump("lixo").nodes).toEqual([]); expect(parseUiDump("").nodes).toEqual([]);
  });
  it("pngSize lê o IHDR; recusa o que não é PNG", () => {
    const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); new DataView(png.buffer).setUint32(16, 1080); new DataView(png.buffer).setUint32(20, 1920);
    expect(pngSize(png)).toEqual({ w: 1080, h: 1920 }); expect(pngSize(new Uint8Array(40))).toBeNull(); expect(pngSize(new Uint8Array(3))).toBeNull();
  });
});

describe("Claude autônomo sempre (#29)", () => {
  it("adiciona --dangerously-skip-permissions p/ claude (mesmo fora do isolado); nunca p/ outros agentes", () => {
    expect(withClaudeAutonomy("claude", ["--append-system-prompt", "x"])).toContain("--dangerously-skip-permissions");
    expect(withClaudeAutonomy("claude", [])).toEqual(["--dangerously-skip-permissions"]); // autônomo mesmo fora do isolado
    expect(withClaudeAutonomy("codex", [])).toEqual([]); // outro agente: não mexe
    expect(withClaudeAutonomy("/bin/sh", [])).toEqual([]); // shell: não mexe
    expect(withClaudeAutonomy("claude", ["--dangerously-skip-permissions"])).toEqual(["--dangerously-skip-permissions"]); // não duplica
    expect(withClaudeAutonomy("claude", ["--allowedTools", "Read Grep"])).toEqual(["--allowedTools", "Read Grep"]); // controle explícito de permissões: não força bypass
    expect(withClaudeAutonomy("claude", ["--permission-mode", "default"])).toEqual(["--permission-mode", "default"]);
    expect(withClaudeAutonomy("claude", ["--disallowed-tools=Edit"])).toEqual(["--disallowed-tools=Edit"]);
  });
  it("autonomia para todo agente recrutado (codex/antigravity/opencode), respeitando controle explícito", () => {
    expect(withAgentAutonomy("claude", [])).toEqual(["--dangerously-skip-permissions"]);
    expect(withAgentAutonomy("codex", [])).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(withAgentAutonomy("codex", ["-a", "on-request"])).toEqual(["-a", "on-request"]);
    expect(withAgentAutonomy("codex", ["--sandbox=read-only"])).toEqual(["--sandbox=read-only"]);
    const preset = ["--dangerously-bypass-approvals-and-sandbox", "-c", "x=1"];
    expect(withAgentAutonomy("codex", preset)).toEqual(preset); // preset já autônomo: não duplica
    expect(withAgentAutonomy("agy", [])).toEqual(["--dangerously-skip-permissions"]);
    expect(withAgentAutonomy("agy", ["--mode", "plan"])).toEqual(["--mode", "plan"]);
    expect(withAgentAutonomy("/home/u/.opencode/bin/opencode", [])).toEqual(["--auto"]);
    expect(withAgentAutonomy("sh", ["-c", "codex"])).toEqual(["-c", "codex"]); // wrapper de shell: não mexe
    expect(withAgentAutonomy("aider", [])).toEqual([]);
    expect(withAgentAutonomy("/bin/bash", [])).toEqual([]);
  });
});

describe("fios flutuantes (ponto de borda mais próximo)", () => {
  it("rectBorderToward: sai pelo lado certo conforme a direção", () => {
    // retângulo centro (0,0), 100x100 → bordas em ±50
    expect(rectBorderToward(0, 0, 100, 100, 1000, 0)).toEqual({ x: 50, y: 0 });   // direita
    expect(rectBorderToward(0, 0, 100, 100, -1000, 0)).toEqual({ x: -50, y: 0 }); // esquerda
    expect(rectBorderToward(0, 0, 100, 100, 0, 1000)).toEqual({ x: 0, y: 50 });   // baixo
    expect(rectBorderToward(0, 0, 100, 100, 0, -1000)).toEqual({ x: 0, y: -50 }); // cima
  });
  it("floatingEnds: nó de baixo liga por baixo do de cima e por cima do de baixo", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };      // centro (50,50)
    const b = { x: 0, y: 300, w: 100, h: 100 };    // centro (50,350), direto abaixo
    const e = floatingEnds(a, b);
    expect(e.sx).toBe(50); expect(e.sy).toBe(100);  // ponta sai pela BASE de a
    expect(e.tx).toBe(50); expect(e.ty).toBe(300);  // chega no TOPO de b
  });
  it("borderSide classifica o lado do ponto", () => {
    const r = { x: 0, y: 0, w: 100, h: 100 };
    expect(borderSide(r, 50, 0)).toBe("top"); expect(borderSide(r, 50, 100)).toBe("bottom");
    expect(borderSide(r, 0, 50)).toBe("left"); expect(borderSide(r, 100, 50)).toBe("right");
  });
});

describe("arranjo em árvore (treeLayout)", () => {
  const g = (w = 200, h = 100) => ({ x: 0, y: 0, w, h });
  it("pai em cima, filhos embaixo no nível seguinte, centralizados", () => {
    const items = [{ id: "root", geometry: g() }, { id: "a", geometry: g() }, { id: "b", geometry: g() }];
    const edges = [{ source: "root", target: "a" }, { source: "root", target: "b" }];
    const out = treeLayout(items, edges);
    const m = Object.fromEntries(out.map((o) => [o.id, o.geometry]));
    expect(m.a!.y).toBeGreaterThan(m.root!.y); expect(m.b!.y).toBe(m.a!.y); // filhos no mesmo nível, abaixo da raiz
    expect(m.a!.x).not.toBe(m.b!.x); // irmãos lado a lado
    const rootCx = m.root!.x + 100, mid = (m.a!.x + m.b!.x + 200) / 2;
    expect(Math.abs(rootCx - mid)).toBeLessThan(2); // raiz centralizada sobre os filhos
  });
  it("neto desce mais um nível; mantém w/h; componentes desconexos não se sobrepõem", () => {
    const items = [{ id: "r", geometry: g() }, { id: "c", geometry: g() }, { id: "n", geometry: g() }, { id: "solo", geometry: g() }];
    const edges = [{ source: "r", target: "c" }, { source: "c", target: "n" }];
    const out = treeLayout(items, edges);
    const m = Object.fromEntries(out.map((o) => [o.id, o.geometry]));
    expect(m.c!.y).toBeGreaterThan(m.r!.y); expect(m.n!.y).toBeGreaterThan(m.c!.y); // 3 níveis
    expect(m.r!.w).toBe(200); expect(m.r!.h).toBe(100); // mantém tamanho
    const comp1Right = Math.max(m.r!.x + 200, m.c!.x + 200, m.n!.x + 200);
    expect(m.solo!.x).toBeGreaterThanOrEqual(comp1Right); // componente solto à direita, sem sobrepor
  });
});

describe("colisão da corda (pushOutsideRect)", () => {
  const r = { x: 100, y: 100, w: 100, h: 100 }; // inflado por 8 → [92,92]..[208,208]
  it("ponto fora não muda", () => { expect(pushOutsideRect(0, 0, r)).toEqual({ x: 0, y: 0 }); expect(pushOutsideRect(300, 150, r)).toEqual({ x: 300, y: 150 }); });
  it("ponto dentro vai para a borda mais próxima", () => {
    expect(pushOutsideRect(100, 150, r)).toEqual({ x: 92, y: 150 });   // perto da esquerda → x=92
    expect(pushOutsideRect(205, 150, r)).toEqual({ x: 208, y: 150 });  // perto da direita → x=208
    expect(pushOutsideRect(150, 100, r)).toEqual({ x: 150, y: 92 });   // perto do topo → y=92
    expect(pushOutsideRect(150, 205, r)).toEqual({ x: 150, y: 208 });  // perto da base → y=208
  });
});
