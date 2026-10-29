import { describe, expect, it } from "vitest";
import { renderUnit, unitPath } from "./systemd.js";

describe("unidade systemd --user", () => {
  it("gera ExecStart com node e entrada, reinício em falha e variáveis opcionais", () => {
    const u = renderUnit({ nodeBin: "/usr/bin/node", entry: "/opt/messy/apps/runtime/dist/index.js", dataDir: "/home/x/.messyai", port: 47821 });
    expect(u).toContain("ExecStart=/usr/bin/node /opt/messy/apps/runtime/dist/index.js");
    expect(u).toContain("Restart=on-failure"); expect(u).toContain("Environment=MESSY_DATA_DIR=/home/x/.messyai"); expect(u).toContain("Environment=MESSY_PORT=47821");
    expect(u).toContain("WantedBy=default.target");
    expect(renderUnit({ nodeBin: "node", entry: "x.js" })).not.toContain("MESSY_PORT");
    expect(unitPath("/home/x")).toBe("/home/x/.config/systemd/user/messyai-runtime.service");
  });
});
