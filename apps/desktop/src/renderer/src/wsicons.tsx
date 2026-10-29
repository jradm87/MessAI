import type { LucideIcon } from "lucide-react";
import { Folder, Code2, SquareTerminal, Globe, Rocket, Database, Server, Cloud, Cpu, Box, Package, Briefcase, BookOpen, FlaskConical, Bug, Wrench, Hammer, Layers, Zap, Star, Heart, Flag, Home, Gamepad2 } from "lucide-react";

/** Grade de 24 ícones do diálogo New Workspace (mesma proposta do Maestri). */
export const WS_ICONS: Record<string, LucideIcon> = {
  folder: Folder, code: Code2, terminal: SquareTerminal, globe: Globe, rocket: Rocket, database: Database,
  server: Server, cloud: Cloud, cpu: Cpu, box: Box, package: Package, briefcase: Briefcase,
  book: BookOpen, flask: FlaskConical, bug: Bug, wrench: Wrench, hammer: Hammer, layers: Layers,
  zap: Zap, star: Star, heart: Heart, flag: Flag, home: Home, game: Gamepad2,
};
/** 9 cores do seletor. */
export const WS_COLORS = ["#8a93a6", "#ef5350", "#ff9f43", "#f6c344", "#4cd964", "#2bc8b3", "#5aa9ff", "#a66bff", "#ff6bb5"] as const;

export function WsIcon({ icon, color, size = 16 }: { icon: string; color: string; size?: number }) {
  const I = WS_ICONS[icon] ?? Folder;
  return <span className="ws-ic" style={{ background: color }}><I size={size} color="#0b0e14" strokeWidth={2.2} /></span>;
}
