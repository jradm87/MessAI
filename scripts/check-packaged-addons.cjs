// Conferência pós-empacotamento (Windows/CI): roda com o Electron empacotado (ELECTRON_RUN_AS_NODE=1) e carrega
// os addons de <resources>/node_modules: better-sqlite3 abre um banco, node-pty abre um terminal ConPTY.
// Uso: MessAI.exe scripts/check-packaged-addons.cjs <pasta resources>
const res = (process.argv[2] ?? "").replace(/\\/g, "/").replace(/\/?$/, "/");
const r = require("module").createRequire(res);
new (r("better-sqlite3"))(":memory:").exec("select 1");
const pty = r("node-pty");
const p = pty.spawn(process.platform === "win32" ? "cmd.exe" : "/bin/sh", process.platform === "win32" ? ["/c", "echo pty-ok"] : ["-c", "echo pty-ok"], {});
let out = "";
const timer = setTimeout(() => { console.error("node-pty sem resposta em 15 s"); process.exit(1); }, 15_000);
p.onData((d) => (out += d));
p.onExit(() => {
  clearTimeout(timer);
  console.log("addons ok", process.versions.electron, out.includes("pty-ok") ? "pty-ok" : "pty sem saida");
  process.exit(out.includes("pty-ok") ? 0 : 1);
});
