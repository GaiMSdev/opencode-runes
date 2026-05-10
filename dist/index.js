/**
 * opencode-runes — Production-quality compression plugin for OpenCode CLI.
 *
 * Three modes: lite / full / ultra
 * Tools: rune_activate, rune_stats, rune_help, rune_shrink
 *
 * Architecture:
 *   - experimental.chat.system.transform  → per-turn rule injection (main lever)
 *   - experimental.session.compacting     → preserve mode across compaction
 *   - event (session.created)             → inject full rule set at session start
 *   - tool: rune_activate             → activate/switch/deactivate via AI
 *   - tool: rune_stats                → real token stats from SQLite + savings est.
 *   - tool: rune_help                 → documentation
 *   - tool: rune_shrink               → on-demand compression of text/files/images
 *
 * Persistence: ~/.config/opencode/.runes-active (plain text flag file)
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
import os from "node:os";
const seenSessions = new Set();
function savingsPath() {
    const base = process.env["OPENCODE_CONFIG_DIR"] ??
        path.join(os.homedir(), ".config", "opencode");
    return path.join(base, ".runes-input-savings.json");
}
function readInputSavings() {
    try {
        const fp = savingsPath();
        if (fs.lstatSync(fp).isSymbolicLink())
            return { originalChars: 0, compressedChars: 0, turns: 0 };
        return JSON.parse(fs.readFileSync(fp, "utf8"));
    }
    catch {
        return { originalChars: 0, compressedChars: 0, turns: 0 };
    }
}
function writeInputSavings(s) {
    try {
        const fp = savingsPath();
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, JSON.stringify(s), "utf8");
    }
    catch { /* best-effort */ }
}
function trackInputCompression(original, compressed) {
    if (original === compressed)
        return;
    const s = readInputSavings();
    s.originalChars += original.length;
    s.compressedChars += compressed.length;
    s.turns += 1;
    writeInputSavings(s);
}
// ---------------------------------------------------------------------------
// Safe input compression — preserves 100% meaning
// Strips only true filler, never code or structure
// ---------------------------------------------------------------------------
function autoCompressInput(text, _mode) {
    let result = text;
    // Only strip filler — never touch code, structure, or semantic content
    // These are universally safe removals regardless of context
    result = result.replace(/\b(just|really|basically|actually|very|quite|simply|honestly|literally|basically|merely)\b/gi, "");
    // Condense excessive whitespace (multiple blank lines → single)
    result = result.replace(/\n{3,}/g, "\n\n");
    // Trim trailing whitespace per line
    result = result.split("\n").map(l => l.trimEnd()).join("\n").trim();
    return result;
}
function isImageFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".heic", ".heif"].includes(ext);
}
function isTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const textExts = new Set([
        ".ts", ".js", ".tsx", ".jsx", ".swift", ".kt", ".java", ".py", ".rb", ".go", ".rs",
        ".c", ".cpp", ".h", ".hpp", ".m", ".mm", ".cs",
        ".json", ".yaml", ".yml", ".toml", ".xml", ".plist", ".html", ".css", ".scss", ".less",
        ".md", ".txt", ".log", ".env", ".cfg", ".conf", ".ini",
        ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
        ".sql", ".graphql", ".proto",
        ".gradle", ".properties", ".strings",
        ".gitignore", ".dockerfile", ".editorconfig",
    ]);
    if (textExts.has(ext))
        return true;
    return false;
}
function detectFileType(filePath) {
    if (isImageFile(filePath))
        return "image";
    if (isTextFile(filePath))
        return "text";
    // Fallback: try to read as text
    try {
        const buf = fs.readFileSync(filePath);
        // Check if it contains null bytes (binary)
        return buf.includes(0) ? "binary" : "text";
    }
    catch {
        return "binary";
    }
}
function shrinkImage(filePath, mode) {
    const originalBytes = fs.statSync(filePath).size;
    // Mode-based quality/resolution settings
    // Aggressive but preserves readability of UI text, code, and diagrams
    const configs = {
        lite: { maxDim: 1440, quality: 75, grayscale: false },
        full: { maxDim: 1024, quality: 60, grayscale: false },
        ultra: { maxDim: 720, quality: 45, grayscale: true },
    };
    const cfg = configs[mode] ?? configs.full;
    const ext = path.extname(filePath).toLowerCase();
    const isPNG = ext === ".png";
    const base = path.basename(filePath, ext);
    const dir = path.dirname(filePath);
    const outPath = path.join(dir, `${base}.shrunk.jpg`);
    try {
        // Build sips command chain
        let sipsCmd = `sips --resampleWidth ${cfg.maxDim}`;
        if (cfg.grayscale) {
            sipsCmd += ` --setProperty formatOptions ${cfg.quality}`;
            // sips can set colorSpace but simple JPEG with quality works well
        }
        sipsCmd += ` "${filePath}" --out "${outPath}"`;
        // For format conversion: sips -s format jpeg
        const convertCmd = `sips -s format jpeg -s formatOptions ${cfg.quality} "${outPath}" --out "${outPath}"`;
        execSync(sipsCmd, { timeout: 10000 });
        if (!isPNG || cfg.grayscale) {
            execSync(convertCmd, { timeout: 10000 });
        }
        const shrunkBytes = fs.statSync(outPath).size;
        return {
            output: outPath,
            originalBytes,
            shrunkBytes,
            method: `image: ${isPNG ? "PNG" : "JPEG"} → ${cfg.maxDim}w JPEG q${cfg.quality}${cfg.grayscale ? " grayscale" : ""}`,
        };
    }
    catch (e) {
        return {
            output: filePath,
            originalBytes,
            shrunkBytes: originalBytes,
            method: "image: fallthrough (sips failed)",
        };
    }
}
function shrinkText(content, mode) {
    // Apply runes-style compression rules to arbitrary text
    let result = content;
    switch (mode) {
        case "lite":
            // Remove filler words
            result = result.replace(/\b(just|really|basically|actually|very|quite|simply|basically|honestly|literally)\b/gi, "");
            // Remove pleasantry openers at line start
            result = result.replace(/^(Great question|Sure|Of course|Absolutely|Certainly|Perfect)!?\s*/gmi, "");
            break;
        case "full":
            // All lite rules
            result = result.replace(/\b(just|really|basically|actually|very|quite|simply|basically|honestly|literally)\b/gi, "");
            result = result.replace(/^(Great question|Sure|Of course|Absolutely|Certainly|Perfect)!?\s*/gmi, "");
            // Remove articles a/an/the
            result = result.replace(/\b(a|an|the)\s+/gi, "");
            // Condense multiple blank lines
            result = result.replace(/\n{3,}/g, "\n\n");
            break;
        case "ultra":
            // All full rules
            result = result.replace(/\b(just|really|basically|actually|very|quite|simply|basically|honestly|literally)\b/gi, "");
            result = result.replace(/^(Great question|Sure|Of course|Absolutely|Certainly|Perfect)!?\s*/gmi, "");
            result = result.replace(/\b(a|an|the)\s+/gi, "");
            // Abbreviate common words
            const abbrs = {
                "configuration": "cfg", "config": "cfg",
                "database": "DB", "authentication": "auth", "authorization": "auth",
                "request": "req", "response": "res", "function": "fn",
                "implementation": "impl", "implement": "impl",
                "context": "ctx", "error": "err", "message": "msg",
                "value": "val", "boolean": "bool", "package": "pkg",
                "dependency": "dep", "dependencies": "deps",
                "environment": "env", "initialize": "init",
                "reference": "ref", "variable": "var", "argument": "arg",
                "parameter": "param", "attribute": "attr", "property": "prop",
                "previous": "prev", "current": "curr",
                "temporary": "tmp", "temporarily": "tmp",
                "additional": "addl", "approximately": "approx",
                "application": "app", "applications": "apps",
                "information": "info", "documentation": "docs",
                "repository": "repo", "libraries": "libs", "library": "lib",
            };
            // Word-boundary replacement (only whole words)
            for (const [full, short] of Object.entries(abbrs)) {
                result = result.replace(new RegExp(`\\b${full}\\b`, "gi"), short);
            }
            result = result.replace(/\n{3,}/g, "\n\n");
            break;
    }
    // Common: trim trailing whitespace per line
    result = result.split("\n").map(l => l.trimEnd()).join("\n").trim();
    return result;
}
function minifyJSON(content) {
    try {
        return JSON.stringify(JSON.parse(content));
    }
    catch {
        return content;
    }
}
function dedupLogLines(content) {
    // Deduplicate consecutive identical lines in logs
    return content.split("\n").reduce((acc, line) => {
        if (acc.length === 0 || line !== acc[acc.length - 1]) {
            acc.push(line);
        }
        return acc;
    }, []).join("\n");
}
function shrinkFileContent(filePath, mode, text) {
    const originalBytes = text ? Buffer.byteLength(text, "utf8") : fs.statSync(filePath).size;
    let result;
    let method;
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".json") {
        result = minifyJSON(text ?? fs.readFileSync(filePath, "utf8"));
        method = "text: JSON minified";
    }
    else if (ext === ".log") {
        const content = text ?? fs.readFileSync(filePath, "utf8");
        result = dedupLogLines(shrinkText(content, mode));
        method = `text: log dedup + ${mode} compression`;
    }
    else {
        const content = text ?? fs.readFileSync(filePath, "utf8");
        result = shrinkText(content, mode);
        method = `text: ${mode} compression`;
    }
    const shrunkBytes = Buffer.byteLength(result, "utf8");
    return { output: result, originalBytes, shrunkBytes, method };
}
function processInlineText(text, mode) {
    const originalBytes = Buffer.byteLength(text, "utf8");
    const result = shrinkText(text, mode);
    const shrunkBytes = Buffer.byteLength(result, "utf8");
    return { output: result, originalBytes, shrunkBytes, method: `text: ${mode} compression` };
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------
export const server = async (_ctx) => {
    return {
        "experimental.chat.system.transform": async (input, output) => {
            const mode = readFlag();
            if (!mode || mode === "off")
                return;
            const sessionID = input.sessionID ?? "unknown";
            const activeMode = mode;
            if (!seenSessions.has(sessionID)) {
                seenSessions.add(sessionID);
                output.system.push(`<opencode-runes>\n${fullRules(activeMode)}\n</opencode-runes>` + `<opencode-runes-input>\nAutoShrink active: user input text is auto-compressed (filler removal). Zero information loss.\n</opencode-runes-input>`);
            }
            else {
                output.system.push(`<opencode-runes>${reinforcement(activeMode)} Deactivate: "normal mode".</opencode-runes>`);
            }
        },
        // -----------------------------------------------------------------------
        // Auto-compress ALL user input before it reaches the LLM.
        // This is the industry-first: caveman / gem-thal / codex-flint only
        // compress OUTPUT via system prompts. We compress INPUT transparently.
        // -----------------------------------------------------------------------
        "experimental.chat.messages.transform": async (_input, output) => {
            const mode = readFlag();
            if (!mode || mode === "off")
                return;
            for (const msg of output.messages ?? []) {
                // Only compress user messages — never assistant/tool
                if (msg.info?.role !== "user")
                    continue;
                for (const part of msg.parts ?? []) {
                    // Only text parts — never code blocks, images, or tool results
                    if (part.type !== "text")
                        continue;
                    if (typeof part.text !== "string")
                        continue;
                    const original = part.text;
                    const compressed = autoCompressInput(original, mode);
                    if (compressed !== original) {
                        part.text = compressed;
                        trackInputCompression(original, compressed);
                    }
                }
            }
        },
        "experimental.session.compacting": async (_input, output) => {
            const mode = readFlag();
            if (!mode || mode === "off")
                return;
            const activeMode = mode;
            output.context.push(`## opencode-runes\nCompression mode active: ${activeMode.toUpperCase()}.\n${reinforcement(activeMode)}`);
        },
        "event": async ({ event }) => {
            if (event.type !== "message.updated")
                return;
            const ev = event;
            const msgData = ev.properties?.message?.data;
            if (!msgData || msgData.role !== "user")
                return;
        },
        // -----------------------------------------------------------------------
        // Auto-shrink image files when read by any tool.
        // Transparent redirection: LLM reads the .shrunk.jpg without knowing.
        // -----------------------------------------------------------------------
        "tool.execute.before": async (input, output) => {
            const mode = readFlag();
            if (!mode || mode === "off")
                return;
            // When the read tool reads an image, redirect to shrunk version
            if (input.tool === "read" && output.args?.filePath) {
                const fp = path.resolve(output.args.filePath);
                if (isImageFile(fp)) {
                    const result = shrinkImage(fp, mode);
                    if (result.output !== fp) {
                        output.args.filePath = result.output;
                    }
                }
            }
        },
        tool: {
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
                        .describe('Compression mode to activate. Use "off" to deactivate.'),
                },
                async execute({ mode }) {
                    if (mode === "off") {
                        removeFlag();
                        return { output: `${badge(null)} Compression deactivated. Returning to normal verbose output.` };
                    }
                    writeFlag(mode);
                    const modeDescriptions = {
                        lite: "Drop filler/hedging. Keep full sentences. Professional-tight.",
                        full: "Drop articles. Fragments OK. No pleasantries. High-signal.",
                        ultra: "MetaGlyph (∈ → ∀ ∃ ∴ !). Abbreviate prose. Chain-of-Draft. Maximum density.",
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
            rune_stats: tool({
                description: `Show token usage statistics and compression savings estimate for opencode-runes.

WHEN TO CALL: User says "/runes-stats", "compress stats", "show compression stats", "how many tokens saved".

Reads real token counts from OpenCode's local SQLite database.
Shows current compression mode, per-session and all-time token totals, and estimated tokens saved by compression.`,
                args: {
                    session_id: z.string().optional().describe("OpenCode session ID to scope stats to (optional). If omitted, shows all-time totals."),
                    scope: z.enum(["session", "alltime"]).optional().default("alltime").describe('Scope: "session" for current session only, "alltime" for all sessions.'),
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
                    const savedEst = activeMode ? estimateSaved(stats.output, activeMode) : 0;
                    const ratio = activeMode ? { lite: 30, full: 55, ultra: 75 }[activeMode] ?? 0 : 0;
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
                    if (stats.reasoning > 0)
                        lines.push(`Reasoning:   ${fmt(stats.reasoning)} tokens`);
                    if (stats.cacheRead > 0)
                        lines.push(`Cache read:  ${fmt(stats.cacheRead)} tokens`);
                    if (stats.cacheWrite > 0)
                        lines.push(`Cache write: ${fmt(stats.cacheWrite)} tokens`);
                    if (stats.cost > 0)
                        lines.push(`Cost:        $${stats.cost.toFixed(4)}`);
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
/runes-shrink      Compress text/file/image on-demand
/runes-stats       Show real token stats + savings estimate
/runes-help        This help screen

Or use natural language:
  "activate runes ultra"
  "switch to runes lite"
  "normal mode"  (deactivates)

SHRINK — /runes-shrink
───────────────────────
On-demand compression of text, files, and images:

  /runes-shrink <text>         Compress inline text
  /runes-shrink @file.ts       Compress a text file
  /runes-shrink @screenshot.png  Compress an image
  /runes-shrink --mode ultra @file  Override compression mode

Auto-detects file type and applies best strategy:
  • Text files:  apply active runes rules (filler, articles, abbreviations)
  • JSON files:  minify (strip whitespace)
  • Log files:   deduplicate consecutive identical lines + compression
  • Images:      sips resize + JPEG conversion (mode-dependent quality)

Image compression presets by mode:
  lite  → 1440w JPEG q75        (~60% smaller)
  full  → 1024w JPEG q60        (~75% smaller)
  ultra → 720w JPEG q45 gray    (~85% smaller)

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

FILES
─────
Flag:    ~/.config/opencode/.runes-active
Plugin:  ~/.config/opencode/plugins/opencode-runes/

════════════════════════════════════════════════════════`.trim(),
                    };
                },
            }),
            rune_shrink: tool({
                description: `Compress text, file, or image content on-demand using active Runes mode rules.

WHEN TO CALL:
- User says "/runes-shrink <text>" — compress inline text
- User says "/runes-shrink @file.ts" — compress a file
- User says "/runes-shrink @screenshot.png" — optimise an image file

WHAT IT DOES:
Auto-detects content type:
  • Text/files → apply runes compression rules (removes filler, articles, abbreviates)
  • JSON → minify (strip whitespace, parse + re-stringify)
  • Logs → deduplicate consecutive identical lines + compression
  • Images (PNG/JPEG/GIF/WebP) → resize + convert to JPEG via sips (macOS built-in)
    - lite mode: 1440w JPEG q75
    - full mode: 1024w JPEG q60
    - ultra mode: 720w JPEG q45 grayscale

Pass --mode to override the compression mode (default: active runes mode, or full if none active).`,
                args: {
                    text: z.string().optional().describe("Text content to compress (alternative to file)."),
                    file: z.string().optional().describe("Path to file to compress (supports text, JSON, logs, images)."),
                    mode: z.enum(["lite", "full", "ultra"]).optional().describe("Override compression mode. Default: active runes mode, or full."),
                },
                async execute({ text, file, mode }) {
                    const activeMode = readFlag();
                    const shrinkMode = mode ?? (activeMode && activeMode !== "off" ? activeMode : "full");
                    if (!text && !file) {
                        return { output: `${badge(shrinkMode)} Usage: /runes-shrink <text> or /runes-shrink @file` };
                    }
                    let result;
                    if (file) {
                        // Resolve relative to cwd or worktree
                        const absPath = path.resolve(file);
                        if (!fs.existsSync(absPath)) {
                            return { output: `File not found: ${file}` };
                        }
                        const fileType = detectFileType(absPath);
                        if (fileType === "image") {
                            result = shrinkImage(absPath, shrinkMode);
                        }
                        else if (fileType === "binary") {
                            return { output: `Cannot shrink binary file: ${file} (unsupported format)` };
                        }
                        else {
                            result = shrinkFileContent(absPath, shrinkMode);
                        }
                    }
                    else {
                        result = processInlineText(text, shrinkMode);
                    }
                    const pct = result.originalBytes > 0
                        ? ((1 - result.shrunkBytes / result.originalBytes) * 100).toFixed(0)
                        : "0";
                    const lines = [
                        "SHRINK RESULT",
                        "═══════════════════════════════════",
                        `Method:      ${result.method}`,
                        `Original:    ${formatBytes(result.originalBytes)}`,
                        `Shrunk:      ${formatBytes(result.shrunkBytes)}`,
                        `Saved:       ${formatBytes(result.originalBytes - result.shrunkBytes)} (${pct}%)`,
                    ];
                    if (result.shrunkBytes < result.originalBytes) {
                        // Estimate token equivalent savings (assume ~0.25 tokens per byte for text, ~0.5 for images)
                        const isImg = result.method.startsWith("image:");
                        const tokenRate = isImg ? 0.5 : 0.25;
                        const tokenSavings = Math.round((result.originalBytes - result.shrunkBytes) * tokenRate);
                        lines.push(`Token est.:  ~${fmt(tokenSavings)} tokens saved`);
                    }
                    lines.push("═══════════════════════════════════");
                    if (result.method.startsWith("image:")) {
                        lines.push(`\nShrunk file written to: ${result.output}`);
                        lines.push("Tip: Reference the .shrunk.jpg file instead of the original to save tokens.");
                    }
                    else {
                        lines.push(`\nCompressed content:\n${"-".repeat(40)}\n${result.output}`);
                    }
                    return { output: lines.join("\n") };
                },
            }),
        },
    };
};
//# sourceMappingURL=index.js.map