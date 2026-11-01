/**
 * #77 — desfazer/refazer do canvas: pilha por espaço de entradas com operações DIRETAS e INVERSAS descritas como
 * dados (não closures), executadas por um `Executor` que fala com a API. Ids criados durante undo/redo mudam; o
 * executor devolve o id real e o `remap` traduz referências antigas nas operações seguintes. Puro e testável.
 */
import type { Geometry, TermTheme } from "@messai/contracts";

export type NodeSpec = { kind: "terminal" | "note" | "text" | "tree"; title: string; geometry: Geometry; content?: string; color?: string; icon?: string; termTheme?: TermTheme; roleId?: string; skillIds?: string[]; command?: string; args?: string[]; cwd?: string; persistent?: boolean };
export type ConnSpec = { sourceNodeId: string; targetNodeId: string; style?: string };
export type DrawingSpec = { kind: string; points: [number, number][]; color: string; width: number; text?: string; groupId?: string };
export type Op =
  | { type: "createNode"; ref: string; spec: NodeSpec }            // ref: id "lógico" (o antigo ou um temp) que passa a apontar para o id real criado
  | { type: "deleteNode"; id: string }
  | { type: "patchNode"; id: string; patch: Record<string, unknown> }
  | { type: "layout"; moves: { nodeId: string; geometry: Geometry }[] }
  | { type: "createConnection"; ref: string; spec: ConnSpec }
  | { type: "deleteConnection"; id: string }
  | { type: "patchConnection"; id: string; patch: Record<string, unknown> }
  | { type: "createDrawing"; ref: string; spec: DrawingSpec }
  | { type: "deleteDrawing"; id: string }
  | { type: "patchDrawing"; id: string; points: [number, number][] }
  | { type: "groupDrawings"; ids: string[]; grouped: boolean };
export type Entry = { label: string; forward: Op[]; inverse: Op[]; key?: string; at: number };
export type Executor = (op: Op) => Promise<string | void>; // devolve o id real quando cria algo

export const HISTORY_MAX = 100;
export const COALESCE_MS = 1500;

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private remap = new Map<string, string>();
  private group: Entry | null = null;
  constructor(private readonly exec: Executor, private readonly now: () => number = () => Date.now()) {}
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }
  get size() { return this.undoStack.length; }

  /** Registra uma ação já executada. `key` iguais dentro de COALESCE_MS fundem (ex.: digitação numa nota): o forward
   *  passa a ser o mais novo e o inverse continua o mais antigo. Qualquer ação nova apaga o redo. */
  record(e: Omit<Entry, "at">): void {
    const at = this.now();
    if (this.group) { this.group.forward.push(...e.forward); this.group.inverse.unshift(...e.inverse); return; }
    const last = this.undoStack[this.undoStack.length - 1];
    if (e.key && last?.key === e.key && at - last.at < COALESCE_MS) { last.forward = e.forward; last.at = at; this.redoStack = []; return; }
    this.undoStack.push({ ...e, at });
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
  }
  /** Agrupa tudo que for registrado até endGroup numa única etapa (um arrasto múltiplo, um "excluir 5 nós"). */
  beginGroup(label: string): void { if (!this.group) this.group = { label, forward: [], inverse: [], at: this.now() }; }
  endGroup(): void {
    const g = this.group; this.group = null;
    if (!g || !g.forward.length) return;
    this.undoStack.push({ ...g, at: this.now() });
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
  }
  /** Chamado quando algo que a pilha referencia é recriado fora dela (ex.: duplicação) — ou pelo próprio executor. */
  alias(oldId: string, newId: string): void { if (oldId !== newId) this.remap.set(oldId, newId); }
  resolve(id: string): string { let cur = id; for (let i = 0; i < 20 && this.remap.has(cur); i++) cur = this.remap.get(cur)!; return cur; }

  async undo(): Promise<Entry | null> {
    const e = this.undoStack.pop(); if (!e) return null;
    try { await this.run(e.inverse); this.redoStack.push(e); }
    catch (err) { this.undoStack.push(e); throw err; } // falhou no meio: deixa para tentar de novo (o estado do servidor é a verdade)
    return e;
  }
  async redo(): Promise<Entry | null> {
    const e = this.redoStack.pop(); if (!e) return null;
    try { await this.run(e.forward); this.undoStack.push(e); }
    catch (err) { this.redoStack.push(e); throw err; }
    return e;
  }
  clear(): void { this.undoStack = []; this.redoStack = []; this.group = null; }

  private async run(ops: Op[]): Promise<void> {
    for (const op of ops) {
      const r = this.resolveOp(op);
      const made = await this.exec(r);
      if ((op.type === "createNode" || op.type === "createConnection" || op.type === "createDrawing") && typeof made === "string") this.alias(op.ref, made);
    }
  }
  /** Traduz ids pelo remap antes de executar. */
  private resolveOp(op: Op): Op {
    const R = (id: string) => this.resolve(id);
    switch (op.type) {
      case "deleteNode": case "deleteConnection": case "deleteDrawing": return { ...op, id: R(op.id) };
      case "patchNode": case "patchConnection": return { ...op, id: R(op.id) };
      case "patchDrawing": return { ...op, id: R(op.id) };
      case "layout": return { ...op, moves: op.moves.map((m) => ({ ...m, nodeId: R(m.nodeId) })) };
      case "createConnection": return { ...op, spec: { ...op.spec, sourceNodeId: R(op.spec.sourceNodeId), targetNodeId: R(op.spec.targetNodeId) } };
      case "groupDrawings": return { ...op, ids: op.ids.map(R) };
      case "createDrawing": return op.spec.groupId ? { ...op, spec: { ...op.spec, groupId: R(op.spec.groupId) } } : op;
      default: return op;
    }
  }
}

/** Rótulos curtos em pt-BR para o toast "Desfeito: …". */
export const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
