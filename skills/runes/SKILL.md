---
name: compress
description: Activate, switch, or deactivate opencode-runes compression mode (lite/full/ultra)
---

When the user invokes /runes, manage the compression mode by calling the `rune_activate` tool.

## Flag file

`~/.config/opencode/.runes-active` contains: `lite`, `full`, `ultra`, or `off` (missing = off).

## Logic

- `/runes` with no argument → read current state:
  - Missing or `off` → activate at `full` using rune_activate tool with mode="full"
  - Active → deactivate using rune_activate tool with mode="off"
- `/runes lite`  → rune_activate with mode="lite"
- `/runes full`  → rune_activate with mode="full"
- `/runes ultra` → rune_activate with mode="ultra"

## Response format

After calling the tool, echo the badge and a one-line confirmation:
  `[RUNES: FULL] Compression on (full).`

For full documentation: invoke rune_help tool or /runes-help
