---
name: messai-portal
description: Use a browser portal on the MessAI canvas to navigate the web, interact with pages, fill forms, read content, and take screenshots. Use when the user asks to browse a URL, open a site, test a web UI, scrape headlines, or interact with a website.
user-invocable: true
---

# MessAI — browser portals

A **portal** is an embedded browser node on the MessAI canvas. Its Chromium session lives in the MessAI runtime, so you drive it from the command line and the user watches it live on the canvas. No window focus needed.

The command is **`mess portal`** (call it as a plain single command — no `||`, `;`, `$(...)` or variables — so allowlists approve it; only after an actual `command not found`, use `"$MESS_CLI" portal ...`).

## Create a portal (and it auto-links to you)

```
mess portal create <url> ["Name"]         # opens the url in a new portal, LINKED to your node
mess portal create https://example.com "Docs"
```

`create` (alias: `new`) makes the portal node, connects it to your terminal, and navigates to the url. Run `mess portal list` to see portal names.

## Read what's on the page (do this before clicking)

```
mess portal <portal> snapshot             # page text + interactive elements, each with a [N] ref
mess portal <portal> snapshot --full      # full page text (not truncated)
mess portal <portal> state                # current url, title, size, loading
```

The snapshot lists clickable/typeable elements as `[3] button "Entrar"`, `[7] input ...`. Use the **number** with `click`/`type`.

## Interact

```
mess portal <portal> open <url>           # navigate (also: back | forward | reload)
mess portal <portal> click <ref>          # click element [ref] (or `click x,y`, `--right`, `--double`)
mess portal <portal> type <ref> "<text>"  # type into element [ref] ( --submit to press Enter, --clear first)
mess portal <portal> key <Enter|Tab|ArrowDown|…>
mess portal <portal> scroll <dy> [dx]
mess portal <portal> wait-text "<text>" [--timeout 10]
mess portal <portal> eval "<javascript>"  # run JS, get the returned value (keep results small)
mess portal <portal> screenshot [file.png]
mess portal <portal> close                # close the browser (url is remembered; reopens on next use)
```

## Typical flow (e.g. collect headlines)

```
mess portal create https://news.example.com "News"
mess portal News snapshot --full          # read the page as text
# ... pull the items you need from the snapshot text ...
mess note write "Headlines" "- item 1\n- item 2\n..."   # save them to a note (auto-linked)
```

## Notes & limits

- Portal name is required for every command after creation. Both argument orders work: `mess portal snapshot News` and `mess portal News snapshot`.
- Only `http`/`https` (and `about:blank`). `file:`, `javascript:`, `data:`, `chrome:` are refused.
- Needs a Chromium-based browser installed on the machine (set `MESS_BROWSER` to override).
- An isolated agent cannot drive portals (that reaches the network) — ask the user if you need it.
