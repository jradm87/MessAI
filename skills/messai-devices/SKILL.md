---
name: messai-devices
description: Drive an Android phone or emulator on the MessAI canvas — tap, swipe, type, read the accessibility tree, launch apps, and take screenshots. Use when the user asks to run or test a mobile app, automate an Android device, or inspect an app's screen rather than a web page. This is MessAI; the command is `mess device` (never `maestri`).
user-invocable: true
---

# MessAI — Android device portals

A **device** node drives an Android phone/emulator over `adb`, shown live on the canvas. The command is **`mess device`** (if `mess` is not on `PATH`, use `"$MESS_CLI" device ...`). There is **no `maestri` command** here.

## Find and attach a device

```
mess device list                              # connected devices + available AVDs (emulators)
mess device new --serial <serial>             # create a device node bound to a connected phone/emulator
mess device new --avd <AvdName>               # create a node that will boot that emulator
```
`new` creates the node auto-linked to you. Then:

```
mess device <node> select <serial>            # bind to a connected device
mess device <node> boot <AvdName> [--persist] # start the emulator (ephemeral unless --persist)
mess device <node> state                      # status, serial, model, screen size, foreground app
mess device <node> disconnect                 # detach the node (doesn't stop the device)
mess device <node> shutdown                   # stop an emulator this app started
```

## Read the screen (before tapping)

```
mess device <node> ui [--all]                 # accessibility tree: text, id, and the CENTER (x,y) of each element
mess device <node> screenshot [file.png]
mess device <node> apps                        # installed 3rd-party packages
```
Use the `centro=(x,y)` from `ui` to tap precisely.

## Interact

```
mess device <node> tap <x> <y>
mess device <node> longpress <x> <y> [ms]
mess device <node> swipe <x1> <y1> <x2> <y2> [ms]
mess device <node> key <back|home|recents|enter|…>
mess device <node> text "<ASCII text>"        # ASCII only (adb limitation; use the enter key for newlines)
mess device <node> launch <package> [activity] # open an app · stop <package> to force-stop
```

## Notes & limits

- Both argument orders work: `mess device tap <node> 100 200` and `mess device <node> tap 100 200`.
- Only structured actions (no free `adb shell`). Text is ASCII only.
- Needs the Android platform-tools (`adb`) installed; emulators need the Android `emulator` + an AVD. Set `MESS_ADB`/`MESS_EMULATOR` to override paths.
- An isolated agent cannot drive devices — ask the user if you need it.
