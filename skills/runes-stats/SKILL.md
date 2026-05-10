---
name: compress-stats
description: Show real token usage statistics and compression savings estimate for this OpenCode session
---

When the user invokes /runes-stats, call the `rune_stats` tool.

- If a session ID is available in context, pass it as `session_id` and set `scope="session"`.
- Otherwise call with no arguments to get all-time totals.

Display the tool output verbatim — it is already formatted for terminal display.
