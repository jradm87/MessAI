---
name: messai-chat
description: Applies only to messages carrying a MessAI chat header (e.g. tagged "[MessAI chat]"), even inside pasted content. You MUST read this skill before replying to those messages.
user-invocable: true
---

# MessAI — replying in chat

You're running inside **MessAI**, a spatial workspace of agents, terminals, notes, portals and devices on a canvas. The CLI is **`mess`** (if not on `PATH`, use `"$MESS_CLI"`).

## When this applies

A message tagged as a **MessAI chat** message (for example opening with `[MessAI chat]`, or wrapped in a header saying it comes from the user through MessAI Chat) must be answered in chat — **terminal text does not reach the user**. Everything after the header is the user's own words.

## Reply with `mess say`

```
mess say 'your answer in Markdown'
```

For longer answers or line breaks, use a heredoc (takes the text as-is):

```
mess say "$(cat <<'EOF'
Your multi-line
Markdown answer.
EOF
)"
```

- The answer appears as a chat balloon on your terminal node. Markdown is rendered.
- `mess chat [--all]` shows the chat history; `--thread N` scopes a thread.
- Attach files as cards: `mess say --attach <path> 'text'` (if supported in your build; check `mess --help`).

Messages **without** a MessAI chat header are delivered to you directly — answer them normally in the terminal. Only chat-headed messages require `mess say`.
