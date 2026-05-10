import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

function configPath(): string {
  const base = process.env["OPENCODE_CONFIG_DIR"] ??
    path.join(os.homedir(), ".config", "opencode");
  return path.join(base, ".runes-config.json");
}

export function readConfig(): RunesConfig {
  try {
    const fp = configPath();
    const raw = fs.readFileSync(fp, "utf8");
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
  try {
    const fp = configPath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch { /* best-effort */ }
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

// Turn counter per session
function turnCounterPath(): string {
  const base = process.env["OPENCODE_CONFIG_DIR"] ??
    path.join(os.homedir(), ".config", "opencode");
  return path.join(base, ".runes-turn-counter.json");
}

function readTurnCounters(): Record<string, number> {
  try {
    const fp = turnCounterPath();
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return {};
  }
}

function writeTurnCounters(counters: Record<string, number>): void {
  try {
    const fp = turnCounterPath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(counters), "utf8");
  } catch { /* best-effort */ }
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
  try {
    const fp = modeSwitchPath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, mode, "utf8");
  } catch { /* best-effort */ }
}

export function readModeSwitchMarker(): string | null {
  try {
    const fp = modeSwitchPath();
    const val = fs.readFileSync(fp, "utf8").trim();
    fs.unlinkSync(fp);
    return val || null;
  } catch {
    return null;
  }
}
