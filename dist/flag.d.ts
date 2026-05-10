/**
 * flag.ts — Persistent flag file helpers for opencode-runes.
 *
 * Stores the active compression mode in a plain text file so it survives
 * across tool calls and session turns (in-memory variables do not).
 *
 * Flag file: ~/.config/opencode/.runes-active
 * Contents:  "lite" | "full" | "ultra" | "off"
 * Missing    = off (no active compression)
 */
export type Mode = "lite" | "full" | "ultra" | "wenyan" | "off";
/**
 * Location of the flag file.
 * Respects OPENCODE_CONFIG_DIR env var if set; otherwise uses the default.
 */
export declare function flagPath(): string;
/**
 * Read the current mode from the flag file.
 * Returns null if the file is absent, malformed, or a symlink (security).
 */
export declare function readFlag(): Mode | null;
/**
 * Write a mode to the flag file.
 * Silently no-ops if the path is a symlink.
 */
export declare function writeFlag(mode: Mode): void;
/**
 * Remove the flag file (deactivate compression).
 */
export declare function removeFlag(): void;
/**
 * Convenience: is compression currently active?
 */
export declare function isActive(): boolean;
//# sourceMappingURL=flag.d.ts.map