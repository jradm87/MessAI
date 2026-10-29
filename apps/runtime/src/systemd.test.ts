import { describe, expect, it } from "vitest";
import { renderUnit, unitPath } from "./systemd.js";

describe("unidade systemd --user", () => {
  it("gera ExecStart com node e entrada, reinício em falha e variáveis opcionais", () => {
    const u = renderUnit({ nodeBin: "/usr/bin/node", entry: "/opt/mess/apps/runtime/dist/index.js", dataDir: "/home/x/.messai", port: 47821 });
    expect(u).toContain("ExecStart=/usr/bin/node /opt/mess/apps/runtime/dist/index.js");
    expect(u).toContain("Restart=on-failure"); expect(u).toContain("Environment=MESS_DATA_DIR=/home/x/.messai"); expect(u).toContain("Environment=MESS_PORT=47821");
    expect(u).toContain("WantedBy=default.target");
    expect(renderUnit({ nodeBin: "node", entry: "x.js" })).not.toContain("MESS_PORT");
    expect(unitPath("/home/x")).toBe("/home/x/.config/systemd/user/messai-runtime.service");
  });
});
