# opencode-runes — High-signal compression for OpenCode CLI

A production-quality compression plugin for [OpenCode CLI](https://opencode.ai). Four output-compression modes (lite/full/ultra/wenyan) + transparent input compression + automatic image shrinking + real token stats from SQLite + git tooling.

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee.

---

## What it does

- **Output compression** — injects mode-specific compression rules into the AI's system context on every turn. Outputs are shorter, denser, and free of filler.
- **Input compression** *(unique — no other CLI plugin does this)* — transparently strips filler from user input before it reaches the LLM. Zero information loss. You write naturally, the AI sees clean text.
- **Image shrinking** — when any tool reads an image file, it's automatically resized + converted to JPEG before the AI sees it. Mode-dependent quality presets save 60-85% of image tokens.
- **Token stats** — reads real token counts directly from OpenCode's SQLite database. Per-session and all-time views with compression savings estimates.
- **Auto-stats badge** — periodically enriches the status badge with live session stats: `[RUNES: LITE | ~55% | ~2.4K tokens spared]`
- **Git tooling** — generate Conventional Commits messages from staged diffs, review changes for issues.
- **Persists mode** across turns, tool calls, and session compaction via flag file (not in-memory).

---

## Modes

| Mode | Compression | Description |
|------|-------------|-------------|
| `lite` | ~30% | Drop filler/hedging. Keep articles and full sentences. Professional-tight. |
| `full` | ~55% | Drop articles. Fragments OK. Short synonyms. No pleasantries. **(default)** |
| `ultra` | ~75% | Abbreviate prose (DB/auth/cfg/fn/impl/ctx/err). Chain-of-Draft. → for causality. NOT→DO contrastive examples. |
| `wenyan` | 60-80% char | Classical Chinese literary style (文言). Particles (之/其/者/也/矣). Classical VO syntax. Pro-drop subjects. 成语 idioms. |

### Ultra mode — NOT→DO contrastive anchoring

Ultra mode uses **contrastive examples** (NOT→DO pairs) to teach compression. Research shows negative examples (what NOT to write) are more effective than positive rules alone.

```
NOT  "The function validates authentication by checking if the token exists in the database."
DO   "auth in cfg → token in res"

NOT  "Connection pooling reuses open database connections instead of creating new ones per request."
DO   "pool reuse DB conn. skip handshake → fast."

NOT  "The component re-renders because a new object reference is created on each render cycle."
DO   "inline obj → new ref → re-render. useMemo."
```

**Causality:** → is the ONLY allowed symbol. NEVER invent custom notation.

### Wenyan mode (文言)

Compresses via classical Chinese literary style:
- Particle grammar: 之 (possessive), 其 (its/their), 者 (one who), 也 (copula), 矣 (perfective)
- Pro-drop: omit subjects where contextually obvious
- Classical VO syntax: verb precedes object
- Replace multi-word descriptions with 成语 (classical idioms)
- Numbers as classical Chinese: 一, 二, 三, ...
- Technical terms (code, API, paths, URLs) preserved as-is

---

## Tools

All tools are callable via slash commands or natural language.

| Tool | Slash command | Purpose |
|------|---------------|---------|
| `rune_activate` | `/runes [mode]` | Activate/switch/deactivate compression mode |
| `rune_stats` | `/runes-stats` | Show real token stats + savings estimate |
| `rune_help` | `/runes-help` | Show in-session documentation |
| `rune_config` | `/runes-config` | View/modify auto-stats settings |
| `rune_commit` | `/runes-commit` | Generate Conventional Commits message from staged diff |
| `rune_review` | `/runes-review [ref]` | Review changes: security, logic, performance, error handling |
| `rune_delegate` | `/runes-delegate <task>` | One-shot delegation with optional mode override |
| `rune_shrink` | `/runes-shrink <text\|@file>` | On-demand compression of text, files, or images |

### Slash commands

| Command | Effect |
|---------|--------|
| `/runes` | Toggle on (full) / off |
| `/runes lite` | Activate lite mode |
| `/runes full` | Activate full mode |
| `/runes ultra` | Activate ultra mode |
| `/runes wenyan` | Activate wenyan mode |
| `/runes-config` | View or modify settings (interval, on-switch) |
| `/runes-stats` | Show token stats + savings |
| `/runes-help` | Show in-session documentation |
| `/runes-commit` | Generate commit message from staged diff |
| `/runes-review` | Review git changes for issues |
| `/runes-review main` | Review diff against main branch |
| `/runes-delegate <task>` | One-shot delegation with context |
| `/runes-shrink <text>` | Compress inline text |
| `/runes-shrink @file.ts` | Compress a file |
| `/runes-shrink @image.png` | Shrink an image |

Natural language also works:
- `"activate runes ultra"` / `"switch to runes lite"` / `"normal mode"`

### Configuration

| Command | Effect |
|---------|--------|
| `/runes-config` | Show current config |
| `/runes-config stats interval <N>` | Auto-show stats every N turns (default: 5) |
| `/runes-config stats interval off` | Disable auto-stats |
| `/runes-config stats on-switch on` | Show stats on mode switch (default: on) |
| `/runes-config stats on-switch off` | Disable on-switch stats |

When auto-stats triggers, the status badge is enriched:
```
[RUNES: LITE | ~55% | ~2.4K tokens spared]
```

---

## Auto-safety — always full prose

Regardless of compression mode, these always use full prose:
- Security warnings / authentication failures
- Irreversible operations (destructive git commands, file deletes, data loss)
- Ambiguous logical sequences where dropping conjunctions changes meaning
- Legal / compliance notices

**Never compressed:** code blocks, commit messages, PR descriptions, proper nouns, API names, model names, file paths, URLs.

---

## Example output by mode

**lite:**
> Your component re-renders because it creates a new object reference on each render. Wrap the value in `useMemo`.

**full:**
> New object ref each render. Inline prop → new ref → re-render. Wrap in `useMemo`.

**ultra:**
> Inline prop → new ref → re-render. `useMemo`.

---

## Install

### Option 1: Install script (recommended)

```bash
cd /path/to/opencode-runes
./install.sh
```

The script:
1. Installs dependencies and builds TypeScript → JavaScript
2. Copies output to `~/.config/opencode/plugins/opencode-runes/`
3. Registers the plugin in `~/.config/opencode/opencode.json`
4. Registers all slash commands

Uninstall:
```bash
./install.sh --uninstall
```

### Option 2: Manual install

```bash
# 1. Clone and build
git clone https://github.com/GaiMSdev/opencode-runes.git
cd opencode-runes
npm install && npm run build

# 2. Copy to plugins dir
mkdir -p ~/.config/opencode/plugins/opencode-runes
cp -r dist/ ~/.config/opencode/plugins/opencode-runes/
cp package.json ~/.config/opencode/plugins/opencode-runes/

# 3. Register in ~/.config/opencode/opencode.json
# Add to the "plugin" array:
{
  "plugin": ["~/.config/opencode/plugins/opencode-runes"]
}

# 4. Register slash commands (add to "command" key in opencode.json):
{
  "command": {
    "runes": {
      "description": "Activate / switch / deactivate Runes compression (lite|full|ultra|wenyan)",
      "template": "Manage Runes compression mode. Use the rune_activate tool."
    },
    "runes-help": {
      "description": "Show Runes documentation: modes, commands, compression techniques, examples",
      "template": "Call the rune_help tool and display its output exactly as returned."
    },
    "runes-stats": {
      "description": "Show real token usage stats and estimated savings from Runes",
      "template": "Call the rune_stats tool with scope='alltime' and display the output exactly as returned."
    },
    "runes-commit": {
      "description": "Generate a compressed Conventional Commits message from staged changes",
      "template": "Call the rune_commit tool and display its output exactly as returned."
    },
    "runes-review": {
      "description": "Review staged or recent git changes for issues (security, logic, performance, error handling)",
      "template": "Call the rune_review tool and display its output exactly as returned."
    }
  }
}
```

---

## How it works

### Plugin hooks

| Hook | Purpose |
|------|---------|
| `experimental.chat.system.transform` | Per-turn system prompt injection (main lever) |
| `experimental.chat.messages.transform` | Transparent input compression (filler removal) |
| `tool.execute.before` | Auto-shrink images when read by any tool |
| `experimental.session.compacting` | Preserve mode context across compaction |

### Key design decisions

- **Input compression** — user text is automatically cleaned before reaching the LLM. Only filler words and excessive whitespace are removed — zero semantic loss. No other CLI compression plugin does this.
- **Image shrinking** — images are transparently redirected to shrunk versions. The AI never sees the original full-size image.
- **Per-turn injection** — first turn in a session injects full verbose rules. Subsequent turns inject a compact one-line reinforcement, keeping context overhead low.
- **Flag file persistence** — mode is stored in `~/.config/opencode/.runes-active` (plain text). In-memory variables reset between invocations; the flag file persists until explicitly removed.

### Token stats

Stats are read from `~/.local/share/opencode/opencode.db` using the `sqlite3` CLI (no binary Node.js dependencies). The `message` table stores per-message token counts in its JSON `data` column:

```json
{
  "tokens": {
    "input": 1234,
    "output": 567,
    "reasoning": 0,
    "cache": { "read": 0, "write": 0 }
  }
}
```

---

## Files

| Path | Purpose |
|------|---------|
| `~/.config/opencode/.runes-active` | Mode flag (lite/full/ultra/wenyan/off) |
| `~/.config/opencode/.runes-config.json` | User config (stats interval, on-switch) |
| `~/.config/opencode/.runes-turn-counter.json` | Per-session turn counter for auto-stats |
| `~/.config/opencode/.runes-mode-switched` | Transient marker on mode change |
| `~/.config/opencode/.runes-delegation` | One-shot delegation context |
| `~/.config/opencode/.runes-input-savings.json` | Input compression savings tracker |
| `~/.config/opencode/plugins/opencode-runes/` | Installed plugin |
| `~/.config/opencode/opencode.json` | OpenCode config with plugin + command registration |
| `~/.local/share/opencode/opencode.db` | OpenCode SQLite database (stats source) |

---

## Development

```bash
npm install          # Install dependencies
npm run build        # TypeScript → JavaScript (tsc)
npm run typecheck    # Type-check only (no emit)
```

---

## Attribution

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee — the original high-signal compression concept for LLM CLIs.
