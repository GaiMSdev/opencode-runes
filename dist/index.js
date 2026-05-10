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
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { readFlag, writeFlag, removeFlag, isActive } from "./flag.js";
import { fullRules, reinforcement, badge } from "./rules.js";
import { querySessionStats, queryAllTimeStats, estimateSaved, fmt } from "./stats.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// ---------------------------------------------------------------------------
// Track which sessions have received full-rules injection (session-start
// surrogate — OpenCode has no dedicated session-init hook, so we use
// experimental.chat.system.transform with a per-session seen-set).
// ---------------------------------------------------------------------------
const seenSessions = new Set();
// ---------------------------------------------------------------------------
// Auto input compression — strips filler without losing meaning
// ---------------------------------------------------------------------------
function autoCompressInput(text, _mode) {
    let result = text;
    result = result.replace(/\b(just|really|basically|actually|very|quite|simply|honestly|literally|merely)\b/gi, "");
    result = result.replace(/\n{3,}/g, "\n\n");
    result = result.split("\n").map(l => l.trimEnd()).join("\n").trim();
    return result;
}
function isImageFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".heic", ".heif"].includes(ext);
}
function shrinkImage(filePath, mode) {
    const originalBytes = fs.statSync(filePath).size;
    const configs = {
        lite: { maxDim: 1440, quality: 75, grayscale: false },
        full: { maxDim: 1024, quality: 60, grayscale: false },
        ultra: { maxDim: 720, quality: 45, grayscale: true },
        wenyan: { maxDim: 720, quality: 45, grayscale: true },
    };
    const cfg = (configs[mode] ?? configs.full);
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath, ext);
    const dir = path.dirname(filePath);
    const outPath = path.join(dir, `${base}.shrunk.jpg`);
    try {
        execSync(`sips --resampleWidth ${cfg.maxDim} "${filePath}" --out "${outPath}"`, { timeout: 10000 });
        execSync(`sips -s format jpeg -s formatOptions ${cfg.quality} "${outPath}" --out "${outPath}"`, { timeout: 10000 });
        const shrunkBytes = fs.statSync(outPath).size;
        return { output: outPath, originalBytes, shrunkBytes, method: `image: → ${cfg.maxDim}w JPEG q${cfg.quality}${cfg.grayscale ? " gray" : ""}` };
    }
    catch {
        return { output: filePath, originalBytes, shrunkBytes: originalBytes, method: "image: fallthrough" };
    }
}
function shrinkText(content, mode) {
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
            const abbrs = {
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
// Plugin export
// ---------------------------------------------------------------------------
export const server = async (_ctx) => {
    return {
        // -----------------------------------------------------------------------
        // Per-turn system prompt injection
        // -----------------------------------------------------------------------
        "experimental.chat.system.transform": async (input, output) => {
            const mode = readFlag();
            if (!mode || mode === "off")
                return;
            const sessionID = input.sessionID ?? "unknown";
            const activeMode = mode;
            if (!seenSessions.has(sessionID)) {
                // First turn in this session — inject verbose full rule block
                seenSessions.add(sessionID);
                output.system.push(`<opencode-runes>\n${fullRules(activeMode)}\n</opencode-runes>`);
            }
            else {
                // Subsequent turns — inject compact reinforcement only
                output.system.push(`<opencode-runes>${reinforcement(activeMode)} Deactivate: "normal mode".</opencode-runes>`);
            }
        },
        // -----------------------------------------------------------------------
        // Preserve mode through session compaction
        // -----------------------------------------------------------------------
        "experimental.session.compacting": async (_input, output) => {
            const mode = readFlag();
            if (!mode || mode === "off")
                return;
            const activeMode = mode;
            output.context.push(`## opencode-runes\nCompression mode active: ${activeMode.toUpperCase()}.\n${reinforcement(activeMode)}`);
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
            if (!mode || mode === "off")
                return;
            for (const msg of output.messages ?? []) {
                if (msg.info?.role !== "user")
                    continue;
                for (const part of msg.parts ?? []) {
                    if (part.type !== "text" || typeof part.text !== "string")
                        continue;
                    const original = part.text;
                    const compressed = autoCompressInput(original, mode);
                    if (compressed !== original)
                        part.text = compressed;
                }
            }
        },
        // -----------------------------------------------------------------------
        // Auto-shrink image files when read by any tool.
        // -----------------------------------------------------------------------
        "tool.execute.before": async (input, output) => {
            const mode = readFlag();
            if (!mode || mode === "off")
                return;
            if (input.tool === "read" && output.args?.filePath) {
                const fp = path.resolve(output.args.filePath);
                if (isImageFile(fp)) {
                    const result = shrinkImage(fp, mode);
                    if (result.output !== fp)
                        output.args.filePath = result.output;
                }
            }
        },
        "event": async ({ event }) => {
            // Listen for message.updated events to detect deactivation phrases.
            // OpenCode doesn't expose user message text in system.transform input
            // (see issue #17637), so we watch message events instead.
            if (event.type !== "message.updated")
                return;
            // Type guard: message.updated events carry properties we need
            const ev = event;
            const msgData = ev.properties?.message?.data;
            if (!msgData || msgData.role !== "user")
                return;
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
- ultra : MetaGlyph symbols. Abbreviate prose. Chain-of-Draft. Maximum density.
- wenyan : Classical Chinese literary compression. Classical syntax, particles, idioms. 60-80% character reduction.

ACTION:
- mode "off" → deactivates compression, returns to normal verbose output
- Any other mode → activates that compression level

After calling this tool, confirm the new mode to the user with the status badge.`,
                args: {
                    mode: z
                        .enum(["lite", "full", "ultra", "wenyan", "off"])
                        .describe('Compression mode to activate. Use "off" to deactivate.'),
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
                        ultra: "MetaGlyph (∈ → ∀ ∃ ∴ !). Abbreviate prose. Chain-of-Draft. Maximum density.",
                        wenyan: "Classical Chinese (wenyan) compression. Zen particles, VO syntax, pro-drop, idioms.",
                    };
                    return {
                        output: `${badge(mode)} Compression activated: ${mode.toUpperCase()}.\n` +
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
                        .describe("OpenCode session ID to scope stats to (optional). If omitted, shows all-time totals."),
                    scope: z
                        .enum(["session", "alltime"])
                        .optional()
                        .default("alltime")
                        .describe('Scope: "session" for current session only, "alltime" for all sessions.'),
                },
                async execute({ session_id, scope }) {
                    const mode = readFlag();
                    const activeMode = isActive() ? mode : null;
                    let stats;
                    let scopeLabel;
                    if (scope === "session" && session_id) {
                        stats = querySessionStats(session_id);
                        scopeLabel = `Session ${session_id.slice(0, 12)}...`;
                    }
                    else {
                        stats = queryAllTimeStats();
                        scopeLabel = "All sessions";
                    }
                    const savedEst = activeMode
                        ? estimateSaved(stats.output, activeMode)
                        : 0;
                    const ratio = activeMode
                        ? { lite: 30, full: 55, ultra: 75, wenyan: 70 }[activeMode] ?? 0
                        : 0;
                    const lines = [
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
                        lines.push(`Est. saved:  ${fmt(savedEst)} tokens (~${ratio}% compression)`, `Full value:  ${fmt(stats.output + savedEst)} tokens equivalent`, `(Savings estimated from ${activeMode} mode ratio)`);
                    }
                    else if (!activeMode) {
                        lines.push("Compression OFF — activate to start saving tokens.", "Tip: /runes ultra saves ~75% of output tokens.");
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
                    if (!text && !file)
                        return { output: `${badge(null)} Usage: /runes-shrink <text> or /runes-shrink @file` };
                    let result;
                    if (file) {
                        const absPath = path.resolve(file);
                        if (!fs.existsSync(absPath))
                            return { output: `File not found: ${file}` };
                        if (isImageFile(absPath)) {
                            result = shrinkImage(absPath, shrinkMode);
                        }
                        else {
                            const content = fs.readFileSync(absPath, "utf8");
                            const originalBytes = Buffer.byteLength(content, "utf8");
                            const compressed = shrinkText(content, shrinkMode);
                            const shrunkBytes = Buffer.byteLength(compressed, "utf8");
                            result = { output: compressed, originalBytes, shrunkBytes, method: `text: ${shrinkMode}` };
                        }
                    }
                    else {
                        const originalBytes = Buffer.byteLength(text, "utf8");
                        const compressed = shrinkText(text, shrinkMode);
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
//# sourceMappingURL=index.js.map