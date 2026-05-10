# opencode-compress

Production-quality compression plugin for [OpenCode CLI](https://opencode.ai). Three modes — lite, full, ultra — injected into every turn's system prompt via the plugin API. Token stats read directly from OpenCode's SQLite database.

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee.

---

## What it does

- Injects mode-specific compression rules into the AI's system context on **every turn**
- Persists mode across turns via a **flag file** (not in-memory — survives tool calls)
- Survives **session compaction** (injects mode context into the compaction hook)
- Provides **real token stats** from `~/.local/share/opencode/opencode.db`
- Exposes slash commands: `/compress`, `/compress-help`, `/compress-stats`
- Auto-safety: full prose always for security warnings, irreversible ops, data loss

---

## Modes

| Mode   | Description |
|--------|-------------|
| `lite`  | Drop filler/hedging. Keep articles and full sentences. Professional-tight. |
| `full`  | Drop articles. Fragments OK. Short synonyms. No pleasantries. **(default)** |
| `ultra` | MetaGlyph symbols. Abbreviate prose. Chain-of-Draft. Maximum token density. |

### MetaGlyph symbols (ultra mode)

| Symbol | Meaning |
|--------|---------|
| `∈`    | in / contains |
| `→`    | leads to / causes / maps to |
| `∀`    | all / every |
| `∃`    | exists / there-is |
| `∴`    | therefore |
| `!`    | critical / warning |

### Chain-of-Draft (ultra mode)

Reason silently in ≤3 minimal draft steps. Emit only the final answer — no visible thinking prose.

---

## Commands

| Command | Effect |
|---------|--------|
| `/compress` | Toggle on (full mode) / off |
| `/compress lite` | Activate lite mode |
| `/compress full` | Activate full mode |
| `/compress ultra` | Activate ultra mode |
| `/compress-help` | Show this documentation in-session |
| `/compress-stats` | Show real token stats + savings estimate |

Natural language also works:
- `"activate compress ultra"` → ultra mode
- `"switch to compress lite"` → lite mode
- `"normal mode"` → deactivate
- `"stop compress"` → deactivate

---

## Examples

**lite:**
> Input: "Why does my React component re-render?"
> Output: "Your component re-renders because it creates a new object reference on each render. Wrap the value in `useMemo`."

**full:**
> Input: "Why does my React component re-render?"
> Output: "New object ref each render. Inline prop → new ref → re-render. Wrap in `useMemo`."

**ultra:**
> Input: "Why does my React component re-render?"
> Output: "Inline prop → new ref → re-render. `useMemo`."

---

## Auto-safety — always full prose

Regardless of compression mode, these always use full prose:
- Security warnings / authentication failures
- Irreversible operations (destructive git commands, file deletes, data loss)
- Ambiguous sequences where dropping conjunctions changes meaning
- Legal / compliance notices

**Never compressed:** code blocks, commit messages, PR descriptions, proper nouns, API names, model names, file paths, URLs.

---

## Install

### Option 1: Install script (recommended)

```bash
cd /path/to/opencode-compress
./install.sh
```

The script:
1. Builds TypeScript → JavaScript (`npm run build` or `bun run build`)
2. Copies output to `~/.config/opencode/plugins/opencode-compress/`
3. Registers the plugin in `~/.config/opencode/opencode.json`
4. Registers slash commands (`/compress`, `/compress-help`, `/compress-stats`)

Uninstall:
```bash
./install.sh --uninstall
```

### Option 2: Manual install

```bash
# 1. Build
npm install && npm run build

# 2. Copy to plugins dir
mkdir -p ~/.config/opencode/plugins/opencode-compress
cp -r dist/ ~/.config/opencode/plugins/opencode-compress/
cp package.json ~/.config/opencode/plugins/opencode-compress/

# 3. Register in ~/.config/opencode/opencode.json
# Add to the "plugin" array:
{
  "plugin": ["~/.config/opencode/plugins/opencode-compress"]
}

# 4. Register slash commands (add to "command" key):
{
  "command": {
    "compress": {
      "description": "Activate/switch/deactivate compression (lite|full|ultra)",
      "template": "Manage compression mode. Call compress_activate tool."
    },
    "compress-help": {
      "description": "Show opencode-compress documentation",
      "template": "Call the compress_help tool and display its output."
    },
    "compress-stats": {
      "description": "Show token stats and savings estimate",
      "template": "Call compress_stats tool with scope='alltime'."
    }
  }
}
```

---

## How it works

### Plugin hooks used

| Hook | Purpose |
|------|---------|
| `experimental.chat.system.transform` | Per-turn system prompt injection (main lever) |
| `experimental.session.compacting` | Preserve mode context across compaction |
| `event` | Monitor session events |

### Per-turn injection strategy

- **First turn in a session**: injects the full verbose rule block (all mode rules + exceptions)
- **Subsequent turns**: injects a compact one-line reinforcement to keep context overhead low

This mirrors GEM-THAL's session-start + before-agent two-phase approach, adapted to OpenCode's single `experimental.chat.system.transform` hook.

### Persistence

Mode is stored in `~/.config/opencode/.compress-active` (plain text: `lite`|`full`|`ultra`|`off`).

In-memory variables reset between plugin invocations and tool calls. The flag file does not — it persists until explicitly removed. Symlink attacks are rejected.

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
| `~/.config/opencode/.compress-active` | Flag file — contains mode string |
| `~/.config/opencode/plugins/opencode-compress/` | Installed plugin |
| `~/.config/opencode/opencode.json` | OpenCode config with plugin + command registration |
| `~/.local/share/opencode/opencode.db` | OpenCode SQLite database (stats source) |

---

## Development

```bash
# Install deps
npm install

# Type-check only (no emit)
npm run typecheck

# Build
npm run build

# Watch mode
npm run build:watch
```

---

## Comparison with GEM-THAL

| Feature | GEM-THAL (Gemini CLI) | opencode-compress |
|---------|----------------------|-------------------|
| Platform | Gemini CLI | OpenCode CLI |
| Session init | `session-start.js` hook | First-turn detection in `system.transform` |
| Per-turn injection | `before-agent.js` hook | `experimental.chat.system.transform` |
| Flag file | `~/.gemini/.compress-active` | `~/.config/opencode/.compress-active` |
| Stats source | JSONL session files | SQLite database |
| Modes | lite, full, ultra, wenyan | lite, full, ultra (no wenyan) |
| Language | CommonJS JavaScript | TypeScript (ESM) |
| Tools | Shell scripts | OpenCode plugin tool API |

---

## Attribution

Inspired by [caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee.
