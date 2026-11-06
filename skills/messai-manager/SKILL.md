---
name: messai-manager
description: Recruit and manage other agent terminals on the MessAI canvas (Maestro mode), group them into bands to ask them in batch, and assign roles. Use when the user asks to assemble a team, delegate parallel work, spin up helper agents, or invoke Maestro mode.
user-invocable: true
---

# MessAI — Maestro mode, bands and roles

This skill is for **conducting other agents**: recruiting terminals, grouping them, and briefing them. The command is **`mess`** (if not on `PATH`, use `"$MESS_CLI"`).

## Maestro mode (recruit / dismiss / reassign)

You can only conduct if your terminal has the **Maestro** capability. Turn it on in the app (the crown toggle on your node, or the "Maestro" checkbox when creating the terminal). If a recruit is refused for lack of `maestro:conduct`, ask the user to enable Maestro on your node (or `mess request maestro:conduct "<reason>"`).

```
mess maestro recruit --preset <id> --name "<Name>"        # recruit a terminal from a preset (claude|codex|opencode|antigravity|shell)
mess maestro recruit --command "<cmd>" --arg a --arg b --name "<Name>"
mess maestro dismiss <id|title>                            # end and remove a TERMINAL you recruited
mess maestro assign <id|title> <roleName|->                # (re)assign a role; `-` removes it
mess maestro interrupt <id|title>                          # interrupt a recruit mid-action (Esc/Ctrl-C) WITHOUT killing it
mess maestro interrupt --all                               # emergency: interrupt ALL your recruits at once
mess close <id|title>                                      # delete a NON-terminal node (note / portal / device / binder)
```

Recruited terminals are **auto-linked to you** and placed in a free spot (no overlap). For a **long run that must survive closing/reopening the app**, recruit with **`--persist`** (wraps the agent in tmux); without it, the terminal dies when the app/runtime stops. To clean up: a **terminal** goes via `mess maestro dismiss`; a **note, portal or device** goes via `mess close` (terminals are refused by `close` on purpose).

### Roles must pre-exist

`--role <name>` only works if that role already exists (create roles in the app's Preferences → Agents → Roles first). If you don't have a role ready, **omit `--role`** — do not pass a name that doesn't exist, or recruit fails with `papel não encontrado`.

### Briefing recruited agents

After recruiting, brief each one with a message and let them work:

```
mess ask <name> "<clear, self-contained instructions>" --no-wait
```

Give **complete** instructions (the recruit only knows what you tell it). Tell it the exact `mess` commands to run. A recruited agent is cautious about orders coming from another agent — be explicit that you are its conductor and this is the task.

### Getting notified when a recruit finishes (important)

You are **not** auto-notified when a recruit finishes — you only find out if the recruit **sends you a message**. So, in every delegation, end the briefing with an explicit report-back instruction, e.g.:

> "When you finish, run `mess reply <the id of this message> \"[DONE] <short result>\"` so I'm notified — don't just print it on your screen."

Then, to receive it:
- Delegate with `mess ask <name> "...task... report back with mess reply" --no-wait` (don't block), and the recruit's `mess reply` will **arrive in your terminal and wake you** when it's done — relay it to the user (e.g. `mess say`).
- If a recruit goes quiet and you're unsure, **poll** it: `mess check <name>` (reads its screen without sending) or `mess ask <name> "status?"`.
- Never assume "done" just because you delegated — wait for the `[DONE]` message or check.

## Bands (groups you can ask in batch)

```
mess band list                                   # bands in the workspace and members
mess band create "<Name>" <node...>              # create a band with members
mess band add|remove "<Name>" <node>             # change membership
mess band ask "<Name>" "<question>" [--timeout S]  # ask ALL members, wait for replies
mess band say "<Name>" "<text>"                  # broadcast, don't wait
```

## Good orchestration shape

1. `mess maestro recruit --preset <id> --name <Name>` for each helper.
2. `mess peers` to confirm they're linked.
3. Brief each with `mess ask <Name> "<task>" --no-wait`, telling them exactly which `mess` commands to run (e.g. `mess portal create <url>`, `mess note write ...`).
4. Watch progress with `mess inbox`, `mess check <Name>`, or by reading the shared note.

### For fully autonomous helpers

A recruited Claude runs autonomously (no permission prompts) **only when the terminal is isolated** (turn on isolated mode on the node). A recruited Codex runs autonomously by default. For batch work, prefer isolated terminals so the helpers don't stop on approval prompts.
