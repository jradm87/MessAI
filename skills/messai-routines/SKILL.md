---
name: messai-routines
description: Schedule recurring or one-off routines on the MessAI canvas — a prompt delivered to an agent terminal, or a shell command, on an interval. Use when the user asks to schedule a task, set a reminder, run something every N seconds/minutes, or automate a timed job. This is MessAI; the command is `mess routine` (never `maestri`).
user-invocable: true
---

# MessAI — scheduled routines

Routines run a **prompt** (delivered to a terminal) or a **shell command** on a schedule. The command is **`mess routine`** (if `mess` is not on `PATH`, use `"$MESS_CLI" routine ...`). There is **no `maestri` command** here.

## Manage routines

```
mess routine list                                  # all routines in the workspace
mess routine create "<Name>" --command "<cmd>" --every <seconds>
mess routine create "<Name>" --prompt "<text>" --node <id|title> --every <seconds>
mess routine create "<Name>" --prompt "<text>" --once        # run a single time
mess routine run <id|name>                         # run it now
mess routine enable|disable <id|name>              # pause / resume
mess routine delete <id|name>
```

- `--command` runs a shell command on the schedule.
- `--prompt` + `--node` delivers the text to that terminal (as if the user typed it); add `--no-wake` to skip waking an unloaded terminal.
- `--every <seconds>` sets the interval; `--once` makes it fire a single time.

## Examples

```
mess routine create "Pull a cada 5min" --command "git -C /proj pull" --every 300
mess routine create "Resumo diário" --prompt "resuma o que mudou hoje" --node Analista --every 86400
```

Keep names short and human. Use `mess routine list` to get ids before enabling/disabling/deleting.
