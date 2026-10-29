<div align="center">

# MessAI

### Many agents. One organized mess.

**A visual canvas where you run, wire together, and talk to a whole team of AI coding agents — each one a live terminal you can see.**

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-desktop-2c2e3b?logo=electron&logoColor=9feaf9)
![React Flow](https://img.shields.io/badge/React%20Flow-canvas-ff4785)
![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)
![status](https://img.shields.io/badge/status-alpha-orange)
![license](https://img.shields.io/badge/license-MIT-brightgreen)

</div>

---

## What is MessAI?

MessAI turns a swarm of AI agents into something you can actually **see and steer**.

Every agent — Claude Code, Codex, Gemini, OpenCode, or any plain shell — lives on an **infinite canvas** as its own terminal. You drop them where you want, draw cables between them, give each one a role, and let them work in parallel while you keep the whole board in view. Notes, file trees and prompts sit right next to the terminals, so the context an agent needs is always one connection away.

And it stays out of your way: **close the window and nothing stops.** The agents keep running in the background and are right where you left them when you come back.

> One board. Many minds. The mess, finally organized.

---

## Why

Running agents in separate tabs means you lose the plot: who is doing what, what they can see, how to pass a result from one to the next. MessAI makes that **spatial**. The layout *is* the plan — a reviewer wired to a builder, a notes card feeding three workers, a floor spun off for a risky refactor. You stop juggling terminals and start conducting them.

---

## Features

### 🎛️ A canvas of live terminals
Real PTYs rendered as nodes you can move, resize, rename and connect. Pan, zoom, minimap, a drawing layer, and the same muscle-memory shortcuts throughout. Drop a Shell, Claude Code, Codex, Gemini or OpenCode — availability is detected from your `PATH`.

### 🔗 Agents that talk to each other
Connect two terminals and they can message across the wire: `mess ask`, `mess reply`, `mess inbox`. An agent reads the notes wired to it, writes back, and hands results to its neighbors — no copy-paste.

### 💬 Chat & prompt composer
A chat layer over any terminal (threads, Markdown, Mermaid) so you talk to an agent like a messaging app, and it answers with `mess say`. The floating composer adds `@`-mentions of nearby nodes, a `#` file picker scoped to the terminal's directory, pasted-image attachments, and a per-terminal draft.

### 📝 Notes as real files
Every note is a real `.md` on disk — rendered Markdown and Mermaid, lockable (agents read-only), colorable, and auto-titled. Drag a `.md`/`.txt` onto the canvas to link it in place. Edit it in your editor and the canvas follows.

### 🌲 File tree with Git
A file-tree node confined to the workspace: list or icon-grid view, per-file git status, name/content search, and create/rename/delete — all sandboxed to the project directory. Open a file as a note or in a quick preview.

### 🏢 Floors (git worktrees)
Spin off a **floor** — a child canvas on its own git branch and worktree — to try something risky in isolation. Track its status, then **land** it back into the trunk with a local merge; conflicts abort cleanly and are listed. A perspective overview (`Ctrl+Shift+\`) stacks your floors above the ground.

### 🧩 Roles
Reusable responsibilities (name, badge, instructions) injected at launch — into Claude Code's system prompt and as `MESS_ROLE` for any CLI. Reassign a role and only that process restarts. Portable as `role.json`.

### ♻️ Sessions that survive
Terminals run inside their own tmux server by default, so they **survive closing the window and restarting the runtime** — reattached, process and scrollback intact. Optionally install a `systemd --user` unit so the runtime comes back on its own.

### 🔒 Local-first
Your data lives in `~/.messai` (SQLite + notes + attachments). The runtime listens only on loopback behind a token, plus a Unix socket for agents. Nothing leaves your machine.

---

## How it works

MessAI is split into a thin client and a runtime that outlives it.

```
┌───────────────────────────┐        ┌───────────────────────────────────────┐
│ Desktop (Electron + React) │  ⇄ WS  │ Runtime (Node, one per user)           │
│ the canvas — just a view   │  HTTP  │ owns PTYs · notes · files · agent API  │
└───────────────────────────┘loopback└───────────────┬───────────────────────┘
                                                      │ Unix socket + token
                                        ┌─────────────┴──────────────┐
                                        │ agents use the `mess` CLI  │
                                        └────────────────────────────┘
```

- **Desktop** (`apps/desktop`) — Electron + React + React Flow + xterm. It only draws the board; it starts the runtime if needed and leaves it running on exit.
- **Runtime** (`apps/runtime`) — a Node service that owns the terminals, notes, files, git worktrees and the local agent API. Independent of any window.
- **Domain** (`packages/domain`) — pure rules (optimistic revisions, input leases, geometry). No I/O, fully unit-tested.
- **Storage** (`packages/storage`) — SQLite with migrations. **Contracts** (`packages/contracts`) — the typed protocol shared by everyone.

---

## Quickstart

**Requirements:** Node 22 (the runtime runs on system Node, not inside Electron), a C/C++ toolchain + make + Python for native addons, `git`, and `tmux` for persistent sessions.

```bash
npm install
npm run build                      # contracts · domain · storage · runtime
npm run build -w @messai/desktop  # the Electron app

# run it (the runtime boots itself into ~/.messai)
cd apps/desktop && npx electron-vite preview --skipBuild
```

**Tests**

```bash
npm test                                          # everything (incl. Electron e2e)
npx vitest run packages apps tests/integration    # deterministic only (no e2e)
```

**Handy env:** `MESS_DATA_DIR` · `MESS_PORT` · `MESS_SHELL` (defaults to your login shell) · `MESS_TMUX_SOCKET` · `MESS_NODE`.

---

## Agents on the canvas

Every terminal gets the `mess` CLI on its `PATH` and the context it needs via environment (`MESS_SOCKET`, `MESS_TOKEN`, `MESS_WORKSPACE_ID`, `MESS_NODE_ID`, …). An agent can inspect and shape its own board:

```bash
mess context                 # your node, the workspace, and connected notes (with content)
mess nodes                   # list nodes
mess note read  <id|title>   # read a note
mess note write <title> …    # create a note wired to you
mess connect    <id|title>   # wire yourself to another node

mess peers                   # terminals connected to you
mess ask   <name> "…"        # message a connected agent
mess reply <id>   "…"        # reply to a message
mess inbox                   # your received messages

mess say   "…"               # answer in the terminal's chat (Markdown)
mess floor create|status|land|delete   # manage floors
```

---

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `V` · `H` | select · pan |
| `T` `N` `L` `F` `B` | terminal · note · text · file tree · draw |
| `Ctrl+T` · `Ctrl+Shift+D` | new terminal · new note |
| `Ctrl+L` · `Ctrl+Alt+←/→` | connect · walk the wire |
| `Ctrl+Tab` · `Ctrl+Shift+A` | cycle nodes · next needs-attention |
| `Ctrl+Shift+P` · `Ctrl+J` | prompt composer · chat |
| `Ctrl+Shift+\` | floors overview |
| `Ctrl+↑/↓` | switch workspace |
| `Delete` | remove selected node |

---

## Tech

TypeScript (strict) monorepo · Electron · React + React Flow · xterm.js · node-pty · better-sqlite3 · Fastify + WebSocket · tmux · Vitest + Playwright.

```
packages/contracts   typed protocol (TypeBox)
packages/domain      pure rules, no I/O
packages/storage     SQLite + migrations
apps/runtime         the machine service (PTYs, notes, files, agent API)
apps/desktop         Electron canvas
apps/cli             the `mess` CLI for agents
```

---

## Status

Alpha, and moving fast. The core loop — workspaces, agent terminals, notes, connections, chat, file tree and floors — works today. Portals, routines, remote machines and a multi-machine hub are on the way.

## License

MIT.
