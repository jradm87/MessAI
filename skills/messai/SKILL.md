---
name: messai
description: Collaborate with other AI agents and notes on the MessAI canvas — send messages to connected agents and read their replies, read and write connected sticky notes, and inspect your workspace. Use when the user asks to talk to another agent ("ask X", "tell X", "check on X"), to read or write a connected note, or to see what is connected to you. This is the MessAI workspace; the command is `mess`.
user-invocable: true
---

# MessAI — collaboration from inside a terminal node

You are running inside a **terminal node of MessAI**, a spatial workspace where AI agents, terminals, notes, portals (browsers) and devices live on a canvas and connect to each other. Your terminal is one node; other nodes may be *connected* to you.

## The CLI is `mess`

Every action uses the `mess` command-line tool, pre-installed and on your `PATH`.

- **Call `mess` as a plain, single command** — e.g. `mess note read "X"`. Do **not** wrap it in `||`, `;`, `&&`, `$(...)`, subshells or variables (no `command -v mess || ...`, no `mess ... || "$MESS_CLI" ...`). Permission allowlists such as `Bash(mess:*)` only auto-approve simple commands; compound ones make the user approve each call.
- **Only if you actually got `command not found`**, switch to the absolute path in `$MESS_CLI` for the rest of the session: `"$MESS_CLI" context`.
- `mess` only works from inside a MessAI terminal (the `MESS_*` environment variables carry your credential). Run `mess --help` any time to see every command.

## See where you are

```
mess context     # your workspace, your node, and the content of notes connected to you
mess nodes       # list every node in the workspace (id, kind, title)
mess peers       # terminals connected to you (who you can talk to) + their agent type
```

Nodes are referred to by **id prefix** or by **title** (case-insensitive) in every command.

## Notes (sticky notes on the canvas)

```
mess note read <id|title>                 # print a note's content
mess note write "<Title>" "<markdown>"    # create a NEW note, auto-linked to YOUR node
mess note append <id|title> "<text>"      # append to an existing note
mess note path <id|title>                 # the .md file path (you may edit it directly)
```

Add `--color <color>` to `note write` to tint it, and recolor any node (note, terminal, portal, device, binder) with `mess color <id|title> <color>`. Colors: `cinza vermelho laranja amarelo verde ciano azul roxo rosa` (or English: gray red orange yellow green cyan blue purple pink), `#rrggbb`, or `-` to clear.

Notes are Markdown (support `#` headings, lists, links, and ```mermaid``` diagrams). `mess note write` always connects the new note to you, so the user sees it hanging off your terminal.

## Talk to connected agents

```
mess peers                                # who is connected to you
mess ask <id|title> "<question>"          # send and WAIT for the reply (returns their last screen)
mess ask <id|title> "<q>" --no-wait       # just deliver, don't wait
mess ask <id|title> "<q>" --timeout 60    # cap the wait (seconds)
mess check <id|title>                      # read a connected node's current screen without sending anything
mess reply <messageId> "<text>"           # answer a message you received
mess inbox [--all]                         # messages sent to you (marks them read)
```

To talk to a node you must be **connected** to it. If you are not, connect first:

```
mess connect <id|title>                   # link your node to another node
```

### Reporting back when someone delegated a task to you (important)

When another agent (often a **Maestro/conductor**) sends you a task via `mess ask` and asks you to report, or to "let me know when done", you **must notify them by running the CLI** — do NOT just print "done" in your own terminal (the requester never sees your screen unless they poll it).

- End the task with: `mess reply <messageId> "[DONE] <one-line result>"` (use the id from the message you received — it is shown in the delivery header, or run `mess inbox`). This wakes the requester and they see your result.
- If you no longer have the message id, send `mess ask "<their name>" "[DONE] <result>" --no-wait` instead.
- Always send this completion message **when you finish**, even if you already printed the result locally. "me avisa / tell me when done" means *send a message*, not *print on screen*.

## Chat with the human (balloons on your terminal)

When a user message arrives tagged `[MessAI chat]`, answer with:

```
mess say "<your answer in Markdown>"       # appears as a chat balloon on your terminal
mess chat [--all]                          # your chat history
```

## Ask the user for a capability you lack

If a command is refused for lack of a capability (e.g. you are an **isolated** agent):

```
mess request <capability> "<reason>" --wait 90   # the user approves/denies in the app
```

## Rules of thumb

- Always check `mess context` / `mess peers` first so you act on real ids/titles, not guesses.
- Prefer titles the user used. Keep note titles short and human.
- Other skills cover specific surfaces: **messai-portal** (web browser), **messai-devices** (Android), **messai-manager** (recruit agents / Maestro / bands), **messai-routines** (scheduled tasks), **messai-workspace** (floors & workspaces).
