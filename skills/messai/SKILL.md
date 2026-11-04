---
name: messai
description: Collaborate with other AI agents and notes on the MessAI canvas — send messages to connected agents and read their replies, read and write connected sticky notes, and inspect your workspace. Use when the user asks to talk to another agent ("ask X", "tell X", "check on X"), to read or write a connected note, or to see what is connected to you. This is the MessAI workspace; the command is `mess` (never `maestri`).
user-invocable: true
---

# MessAI — collaboration from inside a terminal node

You are running inside a **terminal node of MessAI**, a spatial workspace where AI agents, terminals, notes, portals (browsers) and devices live on a canvas and connect to each other. Your terminal is one node; other nodes may be *connected* to you.

## The CLI is `mess` (NOT `maestri`)

Every action uses the `mess` command-line tool, pre-installed and on your `PATH`.

- **If `mess` is not found**, use the absolute path in the `$MESS_CLI` environment variable: `"$MESS_CLI" context`.
- There is **no `maestri` command here**. If you see skills or habits that say `maestri ...`, that is a *different app* — translate to `mess ...`. Ignore `maestri-*` instructions.
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
- Never invent a `maestri` command. The tool is `mess` (or `$MESS_CLI`).
- Other skills cover specific surfaces: **messai-portal** (web browser), **messai-devices** (Android), **messai-manager** (recruit agents / Maestro / bands), **messai-routines** (scheduled tasks), **messai-workspace** (floors & workspaces).
