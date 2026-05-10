/**
 * opencode-runes — Production-quality compression plugin for OpenCode CLI.
 *
 * Three modes: lite / full / ultra
 * No wenyan mode.
 *
 * Architecture:
 *   - experimental.chat.system.transform  → per-turn rule injection (main lever)
 *   - experimental.session.compacting     → preserve mode across compaction
 *   - event (session.created)             → inject full rule set at session start
 *   - tool: rune_activate             → activate/switch/deactivate via AI
 *   - tool: rune_stats                → real token stats from SQLite + savings est.
 *
 * Persistence: ~/.config/opencode/.runes-active (plain text flag file)
 * In-memory state resets between tool calls; the flag file does not.
 *
 * Inspired by caveman (https://github.com/JuliusBrussee/caveman) by Julius Brussee.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { readFlag, writeFlag, removeFlag, isActive } from "./flag.js";
import { fullRules, reinforcement, badge } from "./rules.js";
import { querySessionStats, queryAllTimeStats, estimateSaved, fmt } from "./stats.js";
import type { Mode } from "./flag.js";

// ---------------------------------------------------------------------------
// Track which sessions have received full-rules injection (session-start
// surrogate — OpenCode has no dedicated session-init hook, so we use
// experimental.chat.system.transform with a per-session seen-set).
// ---------------------------------------------------------------------------
const seenSessions = new Set<string>();

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const server: Plugin = async (_ctx) => {
  return {
    // -----------------------------------------------------------------------
    // Per-turn system prompt injection
    // -----------------------------------------------------------------------
    "experimental.chat.system.transform": async (input, output) => {
      const mode = readFlag();
      if (!mode || mode === "off") return;

      const sessionID = input.sessionID ?? "unknown";
      const activeMode = mode as Exclude<Mode, "off">;

      if (!seenSessions.has(sessionID)) {
        // First turn in this session — inject verbose full rule block
        seenSessions.add(sessionID);
        output.system.push(
          `<opencode-runes>\n${fullRules(activeMode)}\n</opencode-runes>`
        );
      } else {
        // Subsequent turns — inject compact reinforcement only
        output.system.push(
          `<opencode-runes>${reinforcement(activeMode)} Deactivate: "normal mode".</opencode-runes>`
        );
      }
    },

    // -----------------------------------------------------------------------
    // Preserve mode through session compaction
    // -----------------------------------------------------------------------
    "experimental.session.compacting": async (_input, output) => {
      const mode = readFlag();
      if (!mode || mode === "off") return;
      const activeMode = mode as Exclude<Mode, "off">;
      output.context.push(
        `## opencode-runes\nCompression mode active: ${activeMode.toUpperCase()}.\n${reinforcement(activeMode)}`
      );
    },

    // -----------------------------------------------------------------------
    // Event listener — detect "normal mode" text in user messages to allow
    // natural-language deactivation via the event stream.
    // -----------------------------------------------------------------------
    "event": async ({ event }) => {
      // Listen for message.updated events to detect deactivation phrases.
      // OpenCode doesn't expose user message text in system.transform input
      // (see issue #17637), so we watch message events instead.
      if (event.type !== "message.updated") return;

      // Type guard: message.updated events carry properties we need
      const ev = event as unknown as {
        type: string;
        properties?: {
          message?: {
            data?: { role?: string };
          };
        };
      };

      const msgData = ev.properties?.message?.data;
      if (!msgData || (msgData as { role?: string }).role !== "user") return;

      // We can't read the text from the event payload easily in all versions,
      // so the primary deactivation path is via the rune_activate tool.
      // Natural-language detection ("normal mode") is handled by the
      // rune_activate tool's description guiding the AI to call it.
    },

    // -----------------------------------------------------------------------
    // Tools
    // -----------------------------------------------------------------------
    tool: {
      // ---- rune_activate -----------------------------------------------
      rune_activate: tool({
        description: `Activate, switch, or deactivate opencode-runes compression mode.

WHEN TO CALL THIS TOOL:
- User says "runes", "/runes", "runes lite/full/ultra", "activate runes", "turn on compression"
- User says "normal mode", "stop runes", "deactivate runes", "turn off compression"
- User says "switch to runes lite/full/ultra"
- User invokes "/runes" as a slash command

MODES:
- lite  : Drop filler/hedging. Keep full sentences. Professional-tight.
- full  : Drop articles. Fragments OK. No pleasantries. (DEFAULT)
- ultra : MetaGlyph symbols. Abbreviate prose. Chain-of-Draft. Maximum density.

ACTION:
- mode "off" → deactivates compression, returns to normal verbose output
- Any other mode → activates that compression level

After calling this tool, confirm the new mode to the user with the status badge.`,
        args: {
          mode: z
            .enum(["lite", "full", "ultra", "off"])
            .describe(
              'Compression mode to activate. Use "off" to deactivate.'
            ),
        },
        async execute({ mode }) {
          if (mode === "off") {
            removeFlag();
            return {
              output: `${badge(null)} Compression deactivated. Returning to normal verbose output.`,
            };
          }

          writeFlag(mode);
          const modeDescriptions = {
            lite: "Drop filler/hedging. Keep full sentences. Professional-tight.",
            full: "Drop articles. Fragments OK. No pleasantries. High-signal.",
            ultra:
              "MetaGlyph (∈ → ∀ ∃ ∴ !). Abbreviate prose. Chain-of-Draft. Maximum density.",
          } as const;

          return {
            output:
              `${badge(mode)} Compression activated: ${mode.toUpperCase()}.\n` +
              `Rule: ${modeDescriptions[mode]}\n\n` +
              `All subsequent responses will follow ${mode} compression rules.\n` +
              `Auto-safety: full prose for security warnings, irreversible ops, data loss.\n\n` +
              `Deactivate: say "normal mode" or run rune_activate with mode="off".`,
          };
        },
      }),

      // ---- rune_stats --------------------------------------------------
      rune_stats: tool({
        description: `Show token usage statistics and compression savings estimate for opencode-runes.

WHEN TO CALL: User says "/runes-stats", "compress stats", "show compression stats", "how many tokens saved".

Reads real token counts from OpenCode's local SQLite database.
Shows current compression mode, per-session and all-time token totals, and estimated tokens saved by compression.`,
        args: {
          session_id: z
            .string()
            .optional()
            .describe(
              "OpenCode session ID to scope stats to (optional). If omitted, shows all-time totals."
            ),
          scope: z
            .enum(["session", "alltime"])
            .optional()
            .default("alltime")
            .describe(
              'Scope: "session" for current session only, "alltime" for all sessions.'
            ),
        },
        async execute({ session_id, scope }) {
          const mode = readFlag();
          const activeMode = isActive() ? (mode as Exclude<Mode, "off">) : null;

          let stats;
          let scopeLabel: string;

          if (scope === "session" && session_id) {
            stats = querySessionStats(session_id);
            scopeLabel = `Session ${session_id.slice(0, 12)}...`;
          } else {
            stats = queryAllTimeStats();
            scopeLabel = "All sessions";
          }

          const savedEst = activeMode
            ? estimateSaved(stats.output, activeMode)
            : 0;
          const ratio = activeMode
            ? { lite: 30, full: 55, ultra: 75 }[activeMode] ?? 0
            : 0;

          const lines: string[] = [
            "OPENCODE-RUNES STATS",
            "═══════════════════════════════════",
            `Mode:        ${badge(mode)}`,
            `Scope:       ${scopeLabel}`,
            "───────────────────────────────────",
            `Model:       ${stats.model}`,
            `Turns:       ${fmt(stats.turns)} assistant messages`,
            `Input:       ${fmt(stats.input)} tokens`,
            `Output:      ${fmt(stats.output)} tokens`,
          ];

          if (stats.reasoning > 0) {
            lines.push(`Reasoning:   ${fmt(stats.reasoning)} tokens`);
          }
          if (stats.cacheRead > 0) {
            lines.push(`Cache read:  ${fmt(stats.cacheRead)} tokens`);
          }
          if (stats.cacheWrite > 0) {
            lines.push(`Cache write: ${fmt(stats.cacheWrite)} tokens`);
          }
          if (stats.cost > 0) {
            lines.push(`Cost:        $${stats.cost.toFixed(4)}`);
          }

          lines.push("───────────────────────────────────");

          if (activeMode && savedEst > 0) {
            lines.push(
              `Est. saved:  ${fmt(savedEst)} tokens (~${ratio}% compression)`,
              `Full value:  ${fmt(stats.output + savedEst)} tokens equivalent`,
              `(Savings estimated from ${activeMode} mode ratio)`
            );
          } else if (!activeMode) {
            lines.push(
              "Compression OFF — activate to start saving tokens.",
              "Tip: /runes ultra saves ~75% of output tokens."
            );
          }

          lines.push("═══════════════════════════════════");

          return { output: lines.join("\n") };
        },
      }),

      // ---- rune_help ---------------------------------------------------
      rune_help: tool({
        description: `Show help for opencode-runes — modes, commands, examples, and attribution.

WHEN TO CALL: User says "/runes-help", "compress help", "how does compression work", "compression modes".`,
        args: {},
        async execute() {
          return {
            output: `
OPENCODE-RUNES — Help
════════════════════════════════════════════════════════

High-signal compression for OpenCode CLI.
Removes filler without sacrificing technical accuracy.
Inspired by caveman (https://github.com/JuliusBrussee/caveman) by Julius Brussee.

MODES
─────
lite   Drop filler/hedging. Keep articles and full sentences. Professional-tight.
full   Drop articles. Fragments OK. Short synonyms. No pleasantries. [DEFAULT]
ultra  Abbreviate prose (DB/fn/req/res/impl/ctx/err). MetaGlyph symbols.
       Strip conjunctions. Chain-of-Draft. One word when enough.

COMMANDS
────────
/runes             Toggle on (full) / off
/runes lite        Activate lite mode
/runes full        Activate full mode
/runes ultra       Activate ultra mode
/runes-stats       Show real token stats + savings estimate
/runes-help        This help screen

Or use natural language:
  "activate runes ultra"
  "switch to runes lite"
  "normal mode"  (deactivates)

METAGLYPH SYMBOLS (ultra only)
────────────────────────────────
∈  in / contains
→  leads to / causes / maps to
∀  all / every
∃  exists / there-is
∴  therefore
!  critical / warning

CHAIN-OF-DRAFT (ultra only)
─────────────────────────────
Reason silently in ≤3 minimal draft steps, emit only the final answer.
No visible "thinking" prose — just the result.

AUTO-SAFETY (all modes)
────────────────────────
These always use full prose regardless of compression mode:
  • Security warnings / auth failures
  • Irreversible operations (destructive git, file deletes, data loss)
  • Ambiguous sequences where dropping conjunctions changes meaning
  • Legal / compliance notices

NEVER COMPRESSED
────────────────
  • Code blocks
  • Command-line examples
  • Commit messages, PR descriptions
  • Proper nouns, API names, model names, file paths, URLs

EXAMPLES
────────
lite:
  Input:  "Why does my React component re-render?"
  Output: "Your component re-renders because it creates a new object reference on
           each render. Wrap the value in useMemo."

full:
  Input:  "Why does my React component re-render?"
  Output: "New object ref each render. Inline prop → new ref → re-render. Wrap in useMemo."

ultra:
  Input:  "Why does my React component re-render?"
  Output: "Inline prop → new ref → re-render. useMemo."

FILES
─────
Flag:    ~/.config/opencode/.runes-active
Plugin:  ~/.config/opencode/plugins/opencode-runes/

════════════════════════════════════════════════════════
`.trim(),
          };
        },
      }),
    },
  };
};
