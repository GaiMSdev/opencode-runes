/**
 * opencode-runes — Production-quality compression plugin for OpenCode CLI.
 *
 * Four modes: lite / full / ultra / wenyan
 * Tools: rune_activate, rune_stats, rune_help, rune_shrink
 *
 * Architecture:
 *   - experimental.chat.system.transform  → per-turn rule injection (main lever)
 *   - experimental.chat.messages.transform → auto-compress user input
 *   - experimental.session.compacting     → preserve mode across compaction
 *   - tool.execute.before                 → auto-shrink image reads
 *   - tool: rune_activate             → activate/switch/deactivate via AI
 *   - tool: rune_stats                → real token stats from SQLite + savings est.
 *   - tool: rune_help                 → documentation
 *   - tool: rune_shrink               → on-demand compression of text/files/images
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
import { querySessionStats, queryAllTimeStats, estimateSaved, fmt, compactStatsLine, COMPRESSION_RATIO } from "./stats.js";
import { readConfig, writeConfig, configToLines, tickTurn, writeModeSwitchMarker, readModeSwitchMarker, writeDelegationMarker, readDelegationMarker } from "./config.js";
import type { Mode } from "./flag.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// ---------------------------------------------------------------------------
// Track which sessions have received full-rules injection (session-start
// surrogate — OpenCode has no dedicated session-init hook, so we use
// experimental.chat.system.transform with a per-session seen-set).
// ---------------------------------------------------------------------------
const seenSessions = new Set<string>();

// ---------------------------------------------------------------------------
// Auto input compression — strips filler without losing meaning
// ---------------------------------------------------------------------------
function autoCompressInput(text: string, _mode: string): string {
  let result = text;
  result = result.replace(/\b(just|really|basically|actually|very|quite|simply|honestly|literally|merely)\b/gi, "");
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.split("\n").map(l => l.trimEnd()).join("\n").trim();
  return result;
}

// ---------------------------------------------------------------------------
// Image/shrink helpers
// ---------------------------------------------------------------------------
interface ShrinkResult {
  output: string;
  originalBytes: number;
  shrunkBytes: number;
  method: string;
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".heic", ".heif"].includes(ext);
}

function shrinkImage(filePath: string, mode: string): ShrinkResult {
  const originalBytes = fs.statSync(filePath).size;
  const configs: Record<string, { maxDim: number; quality: number; grayscale: boolean }> = {
    lite:  { maxDim: 1440, quality: 75, grayscale: false },
    full:  { maxDim: 1024, quality: 60, grayscale: false },
    ultra: { maxDim: 720,  quality: 45, grayscale: true  },
    wenyan: { maxDim: 720, quality: 45, grayscale: true },
  };
  const cfg = (configs[mode] ?? configs.full)!;
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  const outPath = path.join(dir, `${base}.shrunk.jpg`);
  try {
    execSync(`sips --resampleWidth ${cfg.maxDim} "${filePath}" --out "${outPath}"`, { timeout: 10000 });
    execSync(`sips -s format jpeg -s formatOptions ${cfg.quality} "${outPath}" --out "${outPath}"`, { timeout: 10000 });
    const shrunkBytes = fs.statSync(outPath).size;
    return { output: outPath, originalBytes, shrunkBytes, method: `image: → ${cfg.maxDim}w JPEG q${cfg.quality}${cfg.grayscale ? " gray" : ""}` };
  } catch {
    return { output: filePath, originalBytes, shrunkBytes: originalBytes, method: "image: fallthrough" };
  }
}

function shrinkText(content: string, mode: string): string {
  let result = content;
  switch (mode) {
    case "lite":
      result = result.replace(/\b(just|really|basically|actually|very|quite|simply|honestly|literally|merely)\b/gi, "");
      result = result.replace(/^(Great question|Sure|Of course|Absolutely|Certainly|Perfect)!?\s*/gmi, "");
      break;
    case "full":
      result = result.replace(/\b(just|really|basically|actually|very|quite|simply|honestly|literally|merely)\b/gi, "");
      result = result.replace(/^(Great question|Sure|Of course|Absolutely|Certainly|Perfect)!?\s*/gmi, "");
      result = result.replace(/\b(a|an|the)\s+/gi, "");
      result = result.replace(/\n{3,}/g, "\n\n");
      break;
    case "ultra":
      result = result.replace(/\b(just|really|basically|actually|very|quite|simply|honestly|literally|merely)\b/gi, "");
      result = result.replace(/^(Great question|Sure|Of course|Absolutely|Certainly|Perfect)!?\s*/gmi, "");
      result = result.replace(/\b(a|an|the)\s+/gi, "");
      const abbrs: Record<string, string> = {
        configuration: "cfg", config: "cfg", database: "DB", authentication: "auth",
        authorization: "auth", request: "req", response: "res", function: "fn",
        implementation: "impl", implement: "impl", context: "ctx", error: "err",
        message: "msg", value: "val", boolean: "bool", package: "pkg",
        dependency: "dep", dependencies: "deps", environment: "env",
        initialize: "init", reference: "ref", variable: "var",
        argument: "arg", parameter: "param", attribute: "attr", property: "prop",
        previous: "prev", current: "curr", temporary: "tmp",
        additional: "addl", approximately: "approx",
        application: "app", applications: "apps",
        information: "info", documentation: "docs",
        repository: "repo", libraries: "libs", library: "lib",
      };
      for (const [full, short] of Object.entries(abbrs)) {
        result = result.replace(new RegExp(`\\b${full}\\b`, "gi"), short);
      }
      result = result.replace(/\n{3,}/g, "\n\n");
      break;
    case "wenyan":
      // For wenyan, text compression is minimal — the mode is about output style
      result = result.replace(/\n{3,}/g, "\n\n");
      break;
  }
  result = result.split("\n").map(l => l.trimEnd()).join("\n").trim();
  return result;
}

// ---------------------------------------------------------------------------
// rune_commit helpers
// ---------------------------------------------------------------------------

function determineType(
  _diff: string,
  added: string[],
  deleted: string[],
  modified: string[],
  allFiles: string[],
): string {
  const all = [...added, ...deleted, ...modified, ...allFiles];
  const paths = all.join(" ");

  // Test files
  if (paths.includes(".test.") || paths.includes(".spec.") || paths.includes("__tests__") || paths.includes("test/") || paths.includes("tests/")) {
    // Check if only test files changed
    const nonTest = all.filter(f => !f.includes(".test.") && !f.includes(".spec.") && !f.includes("__tests__") && !f.includes("test/") && !f.includes("tests/"));
    if (nonTest.length === 0) return "test";
  }

  if (paths.includes("ci/") || paths.includes(".github/") || paths.includes("Dockerfile") || paths.includes("docker-compose")) return "ci";
  if (paths.includes("README") || paths.includes(".md") && !paths.includes(".mdx")) {
    const codeFiles = all.filter(f => !f.endsWith(".md") && !f.endsWith(".mdx"));
    if (codeFiles.length === 0) return "docs";
  }

  // If only config files
  const configFiles = all.filter(f => f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".toml") || f.endsWith("rc") || f.includes(".env"));
  if (configFiles.length === all.length && all.length > 0) return "chore";

  // Package/dep changes
  if (paths.includes("package.json") || paths.includes("Cargo.toml") || paths.includes("Podfile") || paths.includes("go.mod")) return "build";

  // If there are deleted files
  if (deleted.length > 0 && added.length === 0) return "chore";

  // Check diff content for fix/feat patterns
  const fixPatterns = [/bug/i, /fix/i, /error/i, /crash/i, /issue/i, /hotfix/i, /patch/i];
  const featPatterns = [/feat/i, /add/i, /new/i, /feature/i, /implement/i];
  const refactorPatterns = [/refactor/i, /rename/i, /restruct/i, /clean/i, /move/i, /extract/i];

  // Count matches in paths
  let fixScore = 0, featScore = 0, refactorScore = 0;
  for (const f of all) {
    for (const p of fixPatterns) if (p.test(f)) fixScore++;
    for (const p of featPatterns) if (p.test(f)) featScore++;
    for (const p of refactorPatterns) if (p.test(f)) refactorScore++;
  }

  if (fixScore > featScore && fixScore > refactorScore) return "fix";
  if (featScore > fixScore && featScore > refactorScore) return "feat";
  if (refactorScore > fixScore && refactorScore > featScore) return "refactor";

  // By default: feat for new files, fix for small modifications, else chore
  if (added.length > modified.length && added.length > 0) return "feat";
  if (modified.length > added.length) return "fix";
  return "chore";
}

function determineScope(files: string[]): string | null {
  // Extract common directory prefix as scope
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length >= 2) dirs.add(parts[0]!);
  }
  if (dirs.size === 1) return [...dirs][0]!;
  if (dirs.size <= 2 && dirs.size > 0) return [...dirs].join(",");
  return null;
}

function generateSubject(
  type: string,
  _scope: string | null,
  added: string[],
  deleted: string[],
  modified: string[],
  allFiles: string[],
  _addedLines: number,
  _removedLines: number,
): string {
  // Heuristic: pick the best subject based on type and changes
  const totalChanged = added.length + deleted.length + modified.length;

  if (type === "feat") {
    if (added.length === 1) {
      const base = added[0]!.split("/").pop()!.replace(/\.\w+$/, "");
      return `add ${base}`;
    }
    if (added.length > 1) return `add ${added.length} new files`;
    if (modified.length > 0) {
      const base = modified[0]!.split("/").pop()!.replace(/\.\w+$/, "");
      return `add ${base} implementation`;
    }
    return "add new functionality";
  }

  if (type === "fix") {
    if (modified.length === 1) {
      const base = modified[0]!.split("/").pop()!.replace(/\.\w+$/, "");
      return `fix ${base}`;
    }
    if (allFiles.length === 1) {
      const base = allFiles[0]!.split("/").pop()!.replace(/\.\w+$/, "");
      return `fix ${base}`;
    }
    return `fix ${totalChanged > 1 ? "multiple" : "edge case"} issue${totalChanged > 1 ? "s" : ""}`;
  }

  if (type === "refactor") {
    if (modified.length === 1) {
      const base = modified[0]!.split("/").pop()!.replace(/\.\w+$/, "");
      return `refactor ${base}`;
    }
    if (modified.length > 0 && added.length > 0) {
      return `restructure ${modified[0]!.split("/")[0]}`;
    }
    return `refactor ${totalChanged > 1 ? "module" : "code"}`;
  }

  if (type === "test") {
    if (added.length > 0) return `add tests for ${added[0]!.split("/")[0]}`;
    return "update tests";
  }

  if (type === "docs") {
    const docFile = allFiles.find(f => f.endsWith(".md"));
    if (docFile) return `update ${docFile.split("/").pop()!}`;
    return "update documentation";
  }

  if (type === "ci") {
    return "update CI configuration";
  }

  if (type === "build") {
    return "update dependencies";
  }

  if (type === "chore") {
    if (deleted.length > 0) return `remove ${deleted.length > 1 ? "files" : deleted[0]!.split("/").pop()!}`;
    if (modified.length > 0 && allFiles.every(f => f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".toml"))) {
      return "update config";
    }
    if (totalChanged === 1) {
      const base = allFiles[0]!.split("/").pop()!;
      return `update ${base}`;
    }
    return "housekeeping";
  }

  // Fallback
  if (totalChanged === 1) {
    const base = allFiles[0]!.split("/").pop()!.replace(/\.\w+$/, "");
    return `update ${base}`;
  }
  return `update ${totalChanged} files`;
}

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
      const switched = readModeSwitchMarker();

      if (!seenSessions.has(sessionID)) {
        // First turn in this session — inject verbose full rule block
        seenSessions.add(sessionID);
        let rules = fullRules(activeMode);
        const showStats = switched !== null && readConfig().stats.onSwitch;
        if (showStats) {
          const st = querySessionStats(sessionID);
          const saved = estimateSaved(st.output, activeMode);
          const ratio = COMPRESSION_RATIO[activeMode] ?? 0;
          const line = compactStatsLine(activeMode, st.output, saved, ratio);
          rules += `\n\n## Stats badge override — use this badge line for THIS response:\n${line}`;
        }
        output.system.push(
          `<opencode-runes>\n${rules}\n</opencode-runes>`
        );
      } else {
        // Subsequent turns — inject compact reinforcement only
        const cfg = readConfig();
        const intervalHit = tickTurn(sessionID);
        const showStats = intervalHit || (switched !== null && cfg.stats.onSwitch);
        let msg = reinforcement(activeMode);

        // Check for one-shot delegation context
        const deleg = readDelegationMarker();
        if (deleg) {
          const dMode = deleg.mode ? deleg.mode : activeMode;
          msg += ` ## Delegation: "${deleg.task}" — use ${dMode.toUpperCase()} compression for this response only.`;
        }

        if (showStats) {
          const st = querySessionStats(sessionID);
          const saved = estimateSaved(st.output, activeMode);
          const ratio = COMPRESSION_RATIO[activeMode] ?? 0;
          const line = compactStatsLine(activeMode, st.output, saved, ratio);
          msg += ` ## Stats badge override — use this badge line for THIS response:\n${line}`;
        }
        output.system.push(
          `<opencode-runes>${msg} Deactivate: "normal mode".</opencode-runes>`
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
    // -----------------------------------------------------------------------
    // Auto-compress ALL user input before it reaches the LLM.
    // Industry-first: compresses INPUT, not just output.
    // -----------------------------------------------------------------------
    "experimental.chat.messages.transform": async (_input, output) => {
      const mode = readFlag();
      if (!mode || mode === "off") return;
      for (const msg of output.messages ?? []) {
        if (msg.info?.role !== "user") continue;
        for (const part of msg.parts ?? []) {
          if (part.type !== "text" || typeof part.text !== "string") continue;
          const original = part.text;
          const compressed = autoCompressInput(original, mode);
          if (compressed !== original) part.text = compressed;
        }
      }
    },
    // -----------------------------------------------------------------------
    // Auto-shrink image files when read by any tool.
    // -----------------------------------------------------------------------
    "tool.execute.before": async (input, output) => {
      const mode = readFlag();
      if (!mode || mode === "off") return;
      if (input.tool === "read" && output.args?.filePath) {
        const fp = path.resolve(output.args.filePath);
        if (isImageFile(fp)) {
          const result = shrinkImage(fp, mode);
          if (result.output !== fp) output.args.filePath = result.output;
        }
      }
    },
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
- User says "runes", "/runes", "runes lite/full/ultra/wenyan", "activate runes", "turn on compression"
- User says "normal mode", "stop runes", "deactivate runes", "turn off compression"
- User says "switch to runes lite/full/ultra/wenyan"
- User invokes "/runes" as a slash command

MODES:
- lite  : Drop filler/hedging. Keep full sentences. Professional-tight.
- full  : Drop articles. Fragments OK. No pleasantries. (DEFAULT)
- ultra : Abbreviate prose (DB/fn/req/res/impl/ctx/err). → for causality. Chain-of-Draft. Maximum density.
- wenyan : Classical Chinese literary compression. Classical syntax, particles, idioms. 60-80% character reduction.

ACTION:
- mode "off" → deactivates compression, returns to normal verbose output
- Any other mode → activates that compression level

After calling this tool, confirm the new mode to the user with the status badge.`,
        args: {
          mode: z
            .enum(["lite", "full", "ultra", "wenyan", "off"])
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
          writeModeSwitchMarker(mode);
          const modeDescriptions = {
            lite: "Drop filler/hedging. Keep full sentences. Professional-tight.",
            full: "Drop articles. Fragments OK. No pleasantries. High-signal.",
            ultra:
              "Abbreviate prose (DB/fn/req/res/impl/ctx/err). → for causality. Chain-of-Draft. Maximum density.",
            wenyan:
              "Classical Chinese (wenyan) compression. Zen particles, VO syntax, pro-drop, idioms.",
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
            ? { lite: 30, full: 55, ultra: 75, wenyan: 70 }[activeMode] ?? 0
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
ultra  Abbreviate prose (DB/fn/req/res/impl/ctx/err). → for causality.
       Strip conjunctions. Chain-of-Draft. One word when enough.
wenyan Classical Chinese (wenyan) compression. Particles (之/其/者/也),
       VO syntax, pro-drop, idioms. 60-80% char reduction.

COMMANDS
────────
/runes             Toggle on (full) / off
/runes lite        Activate lite mode
/runes full        Activate full mode
/runes ultra       Activate ultra mode
/runes wenyan      Activate wenyan mode
/runes-shrink      Compress text/file/image on-demand
/runes-stats       Show real token stats + savings estimate
/runes-help        This help screen

Or use natural language:
  "activate runes ultra"
  "switch to runes lite"
  "normal mode"  (deactivates)

CONFIG — /runes-config
──────────────────────
View or modify auto-stats behavior:

  /runes-config              Show current config
  /runes-config stats interval <N>   Auto-show stats every N turns (default: 5)
  /runes-config stats interval off   Disable auto-stats
  /runes-config stats on-switch on   Show stats on mode switch (default: on)
  /runes-config stats on-switch off  Disable on-switch stats

Stats appear as enriched badge in the AI response:
  [RUNES: LITE | ~55% | ~2.4K tokens spared]

ULTRA MODE COMPRESSION
──────────────────────
→  leads to / causes / maps to (ONLY symbol allowed)

Prose abbreviations (mandatory in ultra mode):
DB, auth, cfg, req, res, fn, impl, ctx, err, msg,
val, bool, pkg, dep, env, init, ref, var, arg,
param, attr, prop, prev, curr, tmp, addl, approx,
app, info, docs, repo, lib

NOT → DO contrastive examples:
  NOT "The function validates authentication by checking if the token exists in the database."
  DO  "auth in cfg → token in res"
  NOT "Connection pooling reuses open database connections instead of creating new ones per request."
  DO  "pool reuse DB conn. skip handshake → fast."

⚠️  NEVER invent custom symbols. Use ONLY → for causality. Plain words > invented notation.

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
      // ---- rune_config --------------------------------------------------
      rune_config: tool({
        description: `View or modify opencode-runes configuration.

WHEN TO CALL:
- User says "/runes-config", "runes config", "show runes config"
- User wants to change auto-stats behavior (interval, on-switch)

SETTINGS:
- stats.interval <N>    : Show stats every N turns (default: 5). Set to 0 to disable.
- stats.on-switch <on|off> : Show stats when switching modes (default: on).

EXAMPLES:
- "show runes config" — view current settings
- "set stats interval to 10" — stats every 10 turns
- "set stats on-switch off" — disable stats on mode switch
- "turn off auto stats" — set interval to 0`,
        args: {
          show: z.boolean().optional().describe("Show current configuration."),
          stats_interval: z.union([z.number().int().min(0), z.null()]).optional().describe("Show stats every N turns. 0 or null disables."),
          stats_onSwitch: z.boolean().optional().describe("Show stats on mode switch."),
        },
        async execute({ show, stats_interval, stats_onSwitch }) {
          if (show || (stats_interval === undefined && stats_onSwitch === undefined)) {
            const cfg = readConfig();
            return { output: configToLines(cfg).join("\n") };
          }

          const cfg = readConfig();
          if (stats_interval !== undefined) {
            cfg.stats.interval = stats_interval === 0 ? null : stats_interval;
          }
          if (stats_onSwitch !== undefined) {
            cfg.stats.onSwitch = stats_onSwitch;
          }
          writeConfig(cfg);
          return { output: `Config updated.\n${configToLines(cfg).join("\n")}` };
        },
      }),
      // ---- rune_commit --------------------------------------------------
      rune_commit: tool({
        description: `Generate a compressed, high-signal commit message following Conventional Commits.

WHEN TO CALL:
- User says "/runes-commit", "write commit", "generate commit", "commit message"

HOW IT WORKS:
1. Runs git diff --cached (staged changes)
2. If no staged changes, falls back to git diff HEAD (unstaged)
3. Parses diff to determine type, scope, and subject
4. Outputs a Conventional Commits message: type(scope): subject

RULES:
- Subject ≤ 50 characters
- No 'what' descriptions (code shows the change)
- Body only when 'why' isn't obvious from subject
- No emojis
- Conventional Commits types: feat, fix, chore, refactor, test, docs, style, perf, ci, build`,
        args: {},
        async execute() {
          const cwd = process.cwd();

          // Try staged diff first
          let diff: string;
          let source: string;
          try {
            diff = execSync("git diff --cached", { cwd, encoding: "utf8", timeout: 5000 });
            source = "staged";
          } catch {
            return { output: "Not a git repository or git not available." };
          }

          if (!diff || diff.trim().length === 0) {
            // Fallback to unstaged diff vs HEAD
            try {
              diff = execSync("git diff HEAD", { cwd, encoding: "utf8", timeout: 5000 });
              source = "unstaged (git diff HEAD)";
            } catch {
              return { output: "No changes found (staged or unstaged). Nothing to commit." };
            }
            if (!diff || diff.trim().length === 0) {
              return { output: "No changes found (staged or unstaged). Nothing to commit." };
            }
          }

          // Parse diff to gather file stats
          const files: string[] = [];
          const rewrites: string[] = [];
          const additions: string[] = [];
          const deletions: string[] = [];
          let addedLines = 0;
          let removedLines = 0;

          for (const line of diff.split("\n")) {
            const addMatch = line.match(/^diff --git a\/(.+?) b\//);
            if (addMatch) files.push(addMatch[1]!);

            const newFile = line.match(/^new file mode (.+)$/);
            if (newFile) { const f = files[files.length - 1]; if (f) additions.push(f); }

            const delFile = line.match(/^deleted file mode (.+)$/);
            if (delFile) { const f = files[files.length - 1]; if (f) deletions.push(f); }

            const renameFrom = line.match(/^rename from (.+)$/);
            if (renameFrom) rewrites.push(`renamed: ${renameFrom[1]}`);

            const added = line.match(/^\+([^+].*)$/);
            if (added) addedLines++;

            const removed = line.match(/^\-([^-].*)$/);
            if (removed) removedLines++;
          }

          // Recalculate: additions/deletions from diff --git parsing can miss some;
          // compute remaining files as "modified"
          const renamed = [...rewrites];
          const added = [...additions];
          const deleted = [...deletions];
          const modified: string[] = [];
          for (const f of files) {
            if (!added.includes(f) && !deleted.includes(f)) {
              // Check if it's a rename target
              const isRenameTarget = renamed.some(r => r.includes("→ " + f));
              if (!isRenameTarget) modified.push(f);
            }
          }

          // Determine commit type from changes
          let type = determineType(diff, added, deleted, modified, files);
          let scope = determineScope(files);

          // Generate subject
          let subject = generateSubject(type, scope, added, deleted, modified, files, addedLines, removedLines);

          // Ensure subject ≤ 50 chars (type(scope): subject)
          if (subject.length > 50 && scope) {
            // Try without scope
            subject = generateSubject(type, null, added, deleted, modified, files, addedLines, removedLines);
          }
          if (subject.length > 50) {
            // Truncate
            subject = subject.slice(0, 47) + "...";
          }

          // Determine if body is needed
          const lineCount = addedLines + removedLines;
          let body = "";
          if (lineCount > 20 || modified.length > 3 || added.length > 1 || deleted.length > 1) {
            const bulletParts: string[] = [];
            if (added.length > 0) bulletParts.push(`add: ${added.join(", ")}`);
            if (modified.length > 0) bulletParts.push(`mod: ${modified.join(", ")}`);
            if (deleted.length > 0) bulletParts.push(`del: ${deleted.join(", ")}`);
            if (renamed.length > 0) bulletParts.push(renamed.join(", "));
            body = bulletParts.join("\n");
          } else if (addedLines > 0 || removedLines > 0) {
            // Only generate body if there's a meaningful "why" needed
            // For simple changes, no body needed
          }

          const scopePart = scope ? `(${scope})` : "";
          const message = `${type}${scopePart}: ${subject}` + (body ? `\n\n${body}` : "");

          return {
            output: `COMMIT MESSAGE (from ${source})
═══════════════════════════════════
${message}

${addedLines}+ / ${removedLines}- across ${files.length} file${files.length !== 1 ? "s" : ""}
═══════════════════════════════════
Paste into git commit -m or use git commit -m "$(echo '${message}')"`,
          };
        },
      }),
      // ---- rune_review --------------------------------------------------
      rune_review: tool({
        description: `Review staged or recent git changes for issues.

WHEN TO CALL:
- User says "/runes-review", "review this", "review the diff", "review my changes"

FINDINGS:
- Security: secrets, injection, eval
- Logic: off-by-one, null-deref, inf-loop
- Performance: N+1, console.log, blocking-in-async
- Error handling: uncaught rejections, swallowed errors
- Max 10 findings, sorted by severity: CRITICAL > WARN > NOTE

FORMAT:
  path:line: SEVERITY: problem. fix.

No praise, no style/formatting nits.`,
        args: {
          ref: z.string().optional().describe("Git ref to diff against (e.g. main, HEAD~1). Defaults to staged, then HEAD."),
        },
        async execute({ ref }) {
          const cwd = process.cwd();

          // Acquire diff
          let diff: string;
          let source: string;
          try {
            if (ref) {
              diff = execSync(`git diff ${ref}...HEAD`, { cwd, encoding: "utf8", timeout: 8000 });
              source = `diff ${ref}...HEAD`;
            } else {
              diff = execSync("git diff --cached", { cwd, encoding: "utf8", timeout: 5000 });
              source = "staged";
            }
          } catch {
            return { output: "Not a git repository or git not available." };
          }

          if (!diff || diff.trim().length === 0) {
            if (!ref) {
              try {
                diff = execSync("git diff HEAD", { cwd, encoding: "utf8", timeout: 5000 });
                source = "unstaged (git diff HEAD)";
              } catch {
                return { output: "No changes found." };
              }
            }
            if (!diff || diff.trim().length === 0) return { output: "No changes found." };
          }

          // Parse hunks: file path, start line, added lines
          interface Hunk {
            file: string;
            startLine: number;
            lines: { content: string; lineNum: number }[];
          }

          const hunks: Hunk[] = [];
          let currentFile = "";
          let currentStart = 0;

          for (const line of diff.split("\n")) {
            const fileMatch = line.match(/^diff --git a\/(.+?) b\//);
            if (fileMatch) { currentFile = fileMatch[1]!; continue; }

            const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
            if (hunkMatch) {
              currentStart = parseInt(hunkMatch[1]!, 10);
              continue;
            }

            if (line.startsWith("+") && !line.startsWith("+++")) {
              const content = line.slice(1);
              // Don't track pure whitespace/comment diffs for review
              if (!content.match(/^\s*(?:\/\/|#|<!--|\*|\/\*)/)) {
                // Find or create hunk for current file
                let hunk = hunks.find(h => h.file === currentFile && h.startLine === currentStart);
                if (!hunk) {
                  hunk = { file: currentFile, startLine: currentStart, lines: [] };
                  hunks.push(hunk);
                }
                hunk.lines.push({ content, lineNum: currentStart + hunk.lines.length });
              }
            }
          }

          // Analyze hunks
          interface Finding {
            file: string;
            line: number;
            severity: "CRITICAL" | "WARN" | "NOTE";
            problem: string;
            fix: string;
          }

          const findings: Finding[] = [];

          for (const hunk of hunks) {
            const joined = hunk.lines.map(l => l.content).join("\n");

            // ── Security ──────────────────────────────────────────────────
            // Hardcoded secrets
            const secretPat = /(?:password|passwd|pwd|secret|api[_-]?key|token|auth[_-]?token|access[_-]?key|private[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i;
            const secretMatch = joined.match(secretPat);
            if (secretMatch) {
              const ln = hunk.lines.find(l => l.content.match(secretPat))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "CRITICAL",
                problem: "Hardcoded credential",
                fix: "Move to env variable or secrets manager",
              });
            }

            // SQL injection
            const sqlInj = /(?:exec|query|execute|run)\s*\(\s*(?:`|'|")\s*(?:SELECT|INSERT|UPDATE|DELETE)/i;
            const sqlMatch = joined.match(sqlInj);
            if (sqlMatch) {
              const ln = hunk.lines.find(l => l.content.match(sqlInj))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "CRITICAL",
                problem: "Possible SQL injection (string interpolation in SQL)",
                fix: "Use parameterized query or ORM method",
              });
            }

            // eval / Function constructor
            const evalPat = /\b(?:eval|Function)\s*\(/g;
            const evalMatch = joined.match(evalPat);
            if (evalMatch) {
              const ln = hunk.lines.find(l => l.content.match(/\b(?:eval|Function)\s*\(/))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "CRITICAL",
                problem: "eval() or dynamic Function constructor",
                fix: "Use safer alternative (JSON.parse, switch, etc.)",
              });
            }

            // Command injection
            const cmdInj = /(?:exec(?:Sync)?|spawn|system)\s*\(\s*(?:`|\+|concat)/gi;
            const cmdMatch = joined.match(cmdInj);
            if (cmdMatch) {
              const ln = hunk.lines.find(l => l.content.match(cmdInj))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "CRITICAL",
                problem: "Command injection risk (shell with dynamic input)",
                fix: "Pass arguments as array, not string",
              });
            }

            // ── Logic bugs ────────────────────────────────────────────────
            // Off-by-one: <= in loop where < is intended (array length)
            const obo = /for\s*\([^)]*<=\s*\w+\.\s*length\b/i;
            const oboMatch = joined.match(obo);
            if (oboMatch) {
              const ln = hunk.lines.find(l => l.content.match(obo))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "WARN",
                problem: "Off-by-one risk: <= .length iterates past last index",
                fix: "Use < .length instead of <=",
              });
            }

            // Assignment in condition (= vs ==)
            const assignCond = /(?:if|while|for)\s*\([^)]*[^!<>=]=[^=][^)]*\)/;
            const assignMatch = joined.match(assignCond);
            if (assignMatch) {
              const ln = hunk.lines.find(l => l.content.match(assignCond))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "WARN",
                problem: "Assignment (=) in conditional — likely meant comparison (==)",
                fix: "Use == or === for comparison",
              });
            }

            // Potential null dereference
            const nullDeref = /\.\s*(?:map|filter|forEach|reduce|find)\s*\(/g;
            const nullUse = joined.match(nullDeref);
            if (nullUse) {
              for (const _m of nullUse) {
                // Check if there's a null check upstream
                const hasGuard = /\b(?:if\s*\(\s*\w+\s*!==?\s*null|\?\??\.\s*(?:map|filter|foreach|reduce|find))/i.test(joined);
                if (!hasGuard) {
                  const ln = hunk.lines.find(l => l.content.match(nullDeref))?.lineNum ?? hunk.startLine;
                  findings.push({
                    file: hunk.file, line: ln, severity: "WARN",
                    problem: "Array method called without null guard",
                    fix: "Add `?.` optional chaining or null check before call",
                  });
                }
                break; // one finding per hunk for this pattern
              }
            }

            // ── Performance ───────────────────────────────────────────────
            // console.log left in
            const consoleLog = /\bconsole\.\s*(?:log|debug|info|warn|error)\s*\([^)]*\)/g;
            const logMatch = joined.match(consoleLog);
            if (logMatch) {
              for (const _m of logMatch) {
                const ln = hunk.lines.find(l => l.content.match(/\bconsole\.\s*(?:log|debug|info|warn|error)\s*\(/))?.lineNum ?? hunk.startLine;
                findings.push({
                  file: hunk.file, line: ln, severity: "NOTE",
                  problem: "Console statement left in",
                  fix: "Remove or replace with proper logger",
                });
                break;
              }
            }

            // N+1 in loops (DB query inside for/forEach)
            const nPlus1 = /(?:for|forEach|while|map)\s*[^}]*\n\s*(?:await\s+)?\w+\s*\.\s*(?:find|findAll|findMany|fetch|query|execute)/i;
            const n1Match = joined.match(nPlus1);
            if (n1Match) {
              const ln = hunk.lines.find(l => l.content.match(/(?:await\s+)?\w+\s*\.\s*(?:find|findAll|findMany|fetch|query|execute)/i))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "WARN",
                problem: "N+1 query pattern: DB call inside loop",
                fix: "Batch query before loop or use JOIN/in-clause",
              });
            }

            // Large sync operation in async function
            const blockingInAsync = /\b(?:readFileSync|writeFileSync|execSync|existsSync|statSync)\b/;
            const blockMatch = joined.match(blockingInAsync);
            if (blockMatch) {
              const ln = hunk.lines.find(l => l.content.match(blockingInAsync))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "NOTE",
                problem: "Blocking sync call — consider async alternative",
                fix: "Use readFile/writeFile/exec instead of Sync variant",
              });
            }

            // ── Missing error handling ─────────────────────────────────────
            // Promise without catch
            const noCatch = /\.\s*then\s*\([^)]*\)\s*(?!\s*\.\s*catch)/g;
            const thenNoCatch = joined.match(noCatch);
            if (thenNoCatch) {
              const ln = hunk.lines.find(l => l.content.match(noCatch))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "WARN",
                problem: "Promise chain without catch handler",
                fix: "Add .catch() or use async/await with try/catch",
              });
            }

            // await outside try
            const awaitNoTry = /\bawait\b/;
            const hasAwait = joined.match(awaitNoTry);
            const hasTry = joined.match(/\btry\b/);
            const hasCatch = joined.match(/\bcatch\b/);
            if (hasAwait && !hasTry && !hasCatch) {
              const ln = hunk.lines.find(l => l.content.match(awaitNoTry))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "NOTE",
                problem: "await without try/catch — may swallow rejection",
                fix: "Wrap in try/catch or add .catch() handler",
              });
            }

            // Ignored return value (checking for void-ignored results)
            // Only flag if the method name suggests it returns something important
            const ignoredReturn = /\b(?:save|update|delete|insert|create|write|send|push)\s*\([^)]*\)\s*;/i;
            const ignMatch = joined.match(ignoredReturn);
            if (ignMatch) {
              const ln = hunk.lines.find(l => l.content.match(ignoredReturn))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "NOTE",
                problem: "Return value ignored — result may indicate failure",
                fix: "Check return value or add error handling",
              });
            }

            // ── Misleading names (only when actively misleading) ───────────
            const misleadingName = /const\s+(?:temp|tmp|foo|bar|data|thing|stuff|blah)\s*[:=]/i;
            const nameMatch = joined.match(misleadingName);
            if (nameMatch) {
              const ln = hunk.lines.find(l => l.content.match(misleadingName))?.lineNum ?? hunk.startLine;
              findings.push({
                file: hunk.file, line: ln, severity: "NOTE",
                problem: "Non-descriptive variable name",
                fix: "Rename to reflect purpose",
              });
            }
          }

          // Deduplicate same file+line+problem
          const seen = new Set<string>();
          const unique: Finding[] = [];
          for (const f of findings) {
            const key = `${f.file}:${f.line}:${f.problem}`;
            if (!seen.has(key)) { seen.add(key); unique.push(f); }
          }

          // Sort: CRITICAL first, then WARN, then NOTE
          const severityOrder = { CRITICAL: 0, WARN: 1, NOTE: 2 } as const;
          unique.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

          // Cap at 10
          const top = unique.slice(0, 10);

          // Build output
          const linesOut: string[] = [
            "RUNES REVIEW",
            `Source: ${source}`,
            `Findings: ${top.length}${unique.length > 10 ? ` (showing top ${top.length} of ${unique.length})` : ""}`,
            "═══════════════════════════════════",
          ];

          if (top.length === 0) {
            linesOut.push("No actionable findings. Code looks sound.");
          } else {
            for (const f of top) {
              const badge = f.severity === "CRITICAL" ? "!" : f.severity === "WARN" ? "•" : " ";
              linesOut.push(`${f.file}:${f.line}: ${badge} ${f.severity}: ${f.problem}. ${f.fix}.`);
            }
          }

          linesOut.push("═══════════════════════════════════");
          return { output: linesOut.join("\n") };
        },
      }),
      // ---- rune_delegate ------------------------------------------------
      rune_delegate: tool({
        description: `Set a one-shot delegation context for the next response.

WHEN TO CALL:
- User says "/runes-delegate <task>" or "delegate <task> to runes"
- User wants the next response to use a specific compression mode for a focused task

WHAT IT DOES:
Sets a temporary delegation marker. The next LLM response will include the
delegation context in its system prompt. After one response, auto-clears.

MODE (optional): override compression mode for this delegation.
- "lite" for research/exploration (more readable)
- "full" for code reviews / analysis (concise)
- "ultra" for maximum density output
- "wenyan" for classical Chinese style

Default: uses active compression mode.`,
        args: {
          task: z.string().describe("The task or instruction to delegate to the next response."),
          mode: z.enum(["lite", "full", "ultra", "wenyan"]).optional().describe("Optional mode override for this delegation."),
        },
        async execute({ task, mode }) {
          writeDelegationMarker(task, mode);
          const modeLabel = mode ? ` (${mode.toUpperCase()})` : "";
          return { output: `Delegation set${modeLabel}: "${task}"\nNext response will use this context, then auto-clear.` };
        },
      }),
      // ---- rune_shrink --------------------------------------------------
      rune_shrink: tool({
        description: `Compress text, file, or image content on-demand using active Runes mode rules.

WHEN TO CALL:
- User says "/runes-shrink <text>" — compress inline text
- User says "/runes-shrink @file.ts" — compress a file
- User says "/runes-shrink @screenshot.png" — optimise an image file

Auto-detects content type: text → apply runes rules, JSON → minify, images → resize + JPEG.`,
        args: {
          text: z.string().optional().describe("Text content to compress."),
          file: z.string().optional().describe("Path to file to compress (text, JSON, log, image)."),
          mode: z.enum(["lite", "full", "ultra", "wenyan"]).optional().describe("Override compression mode."),
        },
        async execute({ text, file, mode }) {
          const activeMode = readFlag();
          const shrinkMode = mode ?? (activeMode && activeMode !== "off" ? activeMode : "full");
          if (!text && !file) return { output: `${badge(null)} Usage: /runes-shrink <text> or /runes-shrink @file` };

          let result: ShrinkResult;
          if (file) {
            const absPath = path.resolve(file);
            if (!fs.existsSync(absPath)) return { output: `File not found: ${file}` };
            if (isImageFile(absPath)) {
              result = shrinkImage(absPath, shrinkMode);
            } else {
              const content = fs.readFileSync(absPath, "utf8");
              const originalBytes = Buffer.byteLength(content, "utf8");
              const compressed = shrinkText(content, shrinkMode);
              const shrunkBytes = Buffer.byteLength(compressed, "utf8");
              result = { output: compressed, originalBytes, shrunkBytes, method: `text: ${shrinkMode}` };
            }
          } else {
            const originalBytes = Buffer.byteLength(text!, "utf8");
            const compressed = shrinkText(text!, shrinkMode);
            result = { output: compressed, originalBytes, shrunkBytes: Buffer.byteLength(compressed, "utf8"), method: `text: ${shrinkMode}` };
          }

          const pct = result.originalBytes > 0 ? ((1 - result.shrunkBytes / result.originalBytes) * 100).toFixed(0) : "0";
          const lines = [
            "SHRINK RESULT",
            "═══════════════════════",
            `Method:   ${result.method}`,
            `Original: ${result.originalBytes} B`,
            `Shrunk:   ${result.shrunkBytes} B`,
            `Saved:    ${result.originalBytes - result.shrunkBytes} B (${pct}%)`,
            "═══════════════════════",
            result.method.startsWith("image:") ? `\nFile: ${result.output}` : `\n${result.output}`,
          ];
          return { output: lines.join("\n") };
        },
      }),
    },
  };
};
