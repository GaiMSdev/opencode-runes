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

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type Mode = "lite" | "full" | "ultra" | "off";

const VALID_MODES: Mode[] = ["lite", "full", "ultra", "off"];

/**
 * Location of the flag file.
 * Respects OPENCODE_CONFIG_DIR env var if set; otherwise uses the default.
 */
export function flagPath(): string {
  const base =
    process.env["OPENCODE_CONFIG_DIR"] ??
    path.join(os.homedir(), ".config", "opencode");
  return path.join(base, ".runes-active");
}

/**
 * Read the current mode from the flag file.
 * Returns null if the file is absent, malformed, or a symlink (security).
 */
export function readFlag(): Mode | null {
  const fp = flagPath();
  try {
    const stat = fs.lstatSync(fp);
    // Reject symlinks — prevents path-traversal attacks via flag file
    if (stat.isSymbolicLink()) return null;
    // Reject suspiciously large files (real flag is ≤5 bytes)
    if (stat.size > 32) return null;
    const val = fs.readFileSync(fp, "utf8").trim() as Mode;
    return VALID_MODES.includes(val) ? val : null;
  } catch {
    return null;
  }
}

/**
 * Write a mode to the flag file.
 * Silently no-ops if the path is a symlink.
 */
export function writeFlag(mode: Mode): void {
  const fp = flagPath();
  try {
    // Double-check for symlink before writing
    try {
      if (fs.lstatSync(fp).isSymbolicLink()) return;
    } catch {
      // File doesn't exist yet — that's fine
    }
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, mode, "utf8");
  } catch {
    // Best-effort; plugin never crashes the session
  }
}

/**
 * Remove the flag file (deactivate compression).
 */
export function removeFlag(): void {
  try {
    fs.unlinkSync(flagPath());
  } catch {
    // Already gone — no-op
  }
}

/**
 * Convenience: is compression currently active?
 */
export function isActive(): boolean {
  const m = readFlag();
  return m !== null && m !== "off";
}
