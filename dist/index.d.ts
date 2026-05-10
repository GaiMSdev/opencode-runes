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
export declare const server: Plugin;
//# sourceMappingURL=index.d.ts.map