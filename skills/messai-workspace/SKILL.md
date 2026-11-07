---
name: messai-workspace
description: Manage MessAI workspaces and floors from the command line — create a floor (isolated worktree) for a task, post its status, land it back when done, export/import/duplicate a workspace, and manage per-workspace environment variables. Use when the user asks to provision a new environment, spin up an isolated floor, land/merge a floor, or set env vars.
user-invocable: true
---

# MessAI — floors, workspaces and environments

The command is **`mess`** (call it as a plain single command — no `||`, `;`, `$(...)` or variables — so allowlists approve it; only after an actual `command not found`, use `"$MESS_CLI"`).

## Floors (isolated worktrees of the workspace)

A **floor** is an isolated copy (git worktree by default) of the ground workspace, for doing a task without touching the main code. When you work on a floor, keep its status current.

```
mess floor list                                   # floors of this ground workspace
mess floor create "<Name>" [--branch <b>] [--base <ref>] [--no-git | --copy]
mess floor status <working|blocked|review|done> ["text"]   # update the current floor's status
mess floor land [--squash] [--keep] [--delete-branch]      # merge the current floor back into the ground
mess floor delete <id|name> [--delete-branch]
```

### Floor hooks (setup / run / teardown)

```
mess floor hooks set <setup|run|teardown> "<command>"
mess floor hooks run [section]      # run · stop [section] · logs [section]
```

## Workspaces (export / import / duplicate)

```
mess workspace export [file.messai]               # export the current workspace to a .messai bundle
mess workspace preview <file.messai>              # inspect a bundle before importing
mess workspace import <file.messai> [--name n] [--cwd d]
mess workspace duplicate [--name n]               # clone the current workspace as a starting point
```

## Environment variables (per workspace / global)

```
mess env list [--global] [--reveal]
mess env set KEY=VALUE [--global] [--secret]      # --secret hides the value in listings
mess env unset KEY [--global]
```

Per-workspace env is injected into every terminal of that workspace. Use `--global` for values shared across all workspaces. Mark credentials `--secret`.

## Good practice

- When told to work on a task in isolation, create a floor and set its status to `working`; update to `review`/`done` as you progress; `land` it when the user approves.
- Use `mess env` for config the agents need, `--secret` for tokens/keys.
