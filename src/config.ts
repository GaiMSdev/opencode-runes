import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveDirSafe } from "./flag.js";

export interface StatsConfig {
  interval: number | null;
  milestone: number | null;
  onSwitch: boolean;
}

export interface RunesConfig {
  stats: StatsConfig;
}

const DEFAULT_CONFIG: RunesConfig = {
  stats: {
    interval: 5,
    milestone: null,
    onSwitch: true,
  },
};

const MAX_CONFIG_BYTES = 16384;

function configPath(): string {
  const base = process.env["OPENCODE_CONFIG_DIR"] ??
    path.join(os.homedir(), ".config", "opencode");
  return path.join(base, ".runes-config.json");
}

function safeReadFile(filePath: string, maxBytes: number): string | null {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > maxBytes) return null;

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd: number | undefined;
    try {
      fd = fs.openSync(filePath, flags);
      const buf = Buffer.alloc(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.slice(0, n).toString("utf8");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function safeWriteFile(filePath: string, content: string): void {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const realDir = resolveDirSafe(dir);
    if (!realDir) return;

    const realPath = path.join(realDir, path.basename(filePath));
    try {
      if (fs.lstatSync(realPath).isSymbolicLink()) return;
    } catch (e: unknown) {
      const nodeErr = e as NodeJS.ErrnoException;
      if (nodeErr.code !== "ENOENT") return;
    }

    const tempPath = path.join(realDir, `.runes-tmp.${process.pid}.${Date.now()}`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const wFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd: number | undefined;
    try {
      fd = fs.openSync(tempPath, wFlags, 0o600);
      fs.writeSync(fd, content);
      try { fs.fchmodSync(fd, 0o600); } catch { /* best-effort */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tempPath, realPath);
  } catch {
    /* best-effort */
  }
}

export function readConfig(): RunesConfig {
  const raw = safeReadFile(configPath(), MAX_CONFIG_BYTES);
  if (!raw) return { stats: { ...DEFAULT_CONFIG.stats } };
  try {
    const parsed = JSON.parse(raw);
    return {
      stats: {
        interval: (parsed.stats?.interval !== undefined ? parsed.stats.interval : DEFAULT_CONFIG.stats.interval) as number | null,
        milestone: (parsed.stats?.milestone !== undefined ? parsed.stats.milestone : DEFAULT_CONFIG.stats.milestone) as number | null,
        onSwitch: (parsed.stats?.onSwitch !== undefined ? parsed.stats.onSwitch : DEFAULT_CONFIG.stats.onSwitch) as boolean,
      },
    };
  } catch {
    return { stats: { ...DEFAULT_CONFIG.stats } };
  }
}

export function writeConfig(config: RunesConfig): void {
  safeWriteFile(configPath(), JSON.stringify(config, null, 2) + "\n");
}

export function configToLines(config: RunesConfig): string[] {
  return [
    "RUNES CONFIG",
    "═══════════════════════════════════",
    `Stats interval:    ${config.stats.interval ?? "off"} turns`,
    `Stats milestone:   ${config.stats.milestone ?? "off"} tokens`,
    `Stats on-switch:   ${config.stats.onSwitch ? "on" : "off"}`,
    "───────────────────────────────────",
    "Change with: /runes-config stats interval <N>",
    "             /runes-config stats on-switch on|off",
    "═══════════════════════════════════",
  ];
}

function safeDeleteFile(filePath: string): void {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return;
    fs.unlinkSync(filePath);
  } catch { /* best-effort */ }
}

function turnCounterPath(): string {
  const base = process.env["OPENCODE_CONFIG_DIR"] ??
    path.join(os.homedir(), ".config", "opencode");
  return path.join(base, ".runes-turn-counter.json");
}

function readTurnCounters(): Record<string, number> {
  const raw = safeReadFile(turnCounterPath(), 4096);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeTurnCounters(counters: Record<string, number>): void {
  safeWriteFile(turnCounterPath(), JSON.stringify(counters));
}

export function tickTurn(sessionID: string): boolean {
  const cfg = readConfig();
  if (cfg.stats.interval === null) return false;

  const counters = readTurnCounters();
  const current = (counters[sessionID] ?? 0) + 1;

  if (current >= cfg.stats.interval) {
    counters[sessionID] = 0;
    writeTurnCounters(counters);
    return true;
  }

  counters[sessionID] = current;
  writeTurnCounters(counters);
  return false;
}

// Mode switch marker — written by rune_activate, read+cleared by system.transform
function modeSwitchPath(): string {
  const base = process.env["OPENCODE_CONFIG_DIR"] ??
    path.join(os.homedir(), ".config", "opencode");
  return path.join(base, ".runes-mode-switched");
}

export function writeModeSwitchMarker(mode: string): void {
  safeWriteFile(modeSwitchPath(), mode);
}

export function readModeSwitchMarker(): string | null {
  const raw = safeReadFile(modeSwitchPath(), 64);
  if (!raw) return null;
  safeDeleteFile(modeSwitchPath());
  return raw.trim() || null;
}

// Delegation marker — one-shot task description + optional mode override
function delegationPath(): string {
  const base = process.env["OPENCODE_CONFIG_DIR"] ??
    path.join(os.homedir(), ".config", "opencode");
  return path.join(base, ".runes-delegation");
}

export function writeDelegationMarker(task: string, mode?: string): void {
  safeWriteFile(delegationPath(), JSON.stringify({ task, mode: mode ?? null }));
}

export function readDelegationMarker(): { task: string; mode: string | null } | null {
  const raw = safeReadFile(delegationPath(), 2048);
  if (!raw) return null;
  safeDeleteFile(delegationPath());
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
