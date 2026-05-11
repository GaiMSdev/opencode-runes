import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const DEFAULT_CONFIG = {
    stats: {
        interval: 5,
        milestone: null,
        onSwitch: true,
    },
};
function configPath() {
    const base = process.env["OPENCODE_CONFIG_DIR"] ??
        path.join(os.homedir(), ".config", "opencode");
    return path.join(base, ".runes-config.json");
}
export function readConfig() {
    try {
        const fp = configPath();
        const raw = fs.readFileSync(fp, "utf8");
        const parsed = JSON.parse(raw);
        return {
            stats: {
                interval: (parsed.stats?.interval !== undefined ? parsed.stats.interval : DEFAULT_CONFIG.stats.interval),
                milestone: (parsed.stats?.milestone !== undefined ? parsed.stats.milestone : DEFAULT_CONFIG.stats.milestone),
                onSwitch: (parsed.stats?.onSwitch !== undefined ? parsed.stats.onSwitch : DEFAULT_CONFIG.stats.onSwitch),
            },
        };
    }
    catch {
        return { stats: { ...DEFAULT_CONFIG.stats } };
    }
}
export function writeConfig(config) {
    try {
        const fp = configPath();
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, JSON.stringify(config, null, 2) + "\n", "utf8");
    }
    catch { /* best-effort */ }
}
export function configToLines(config) {
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
function turnCounterPath() {
    const base = process.env["OPENCODE_CONFIG_DIR"] ??
        path.join(os.homedir(), ".config", "opencode");
    return path.join(base, ".runes-turn-counter.json");
}
function readTurnCounters() {
    try {
        const fp = turnCounterPath();
        return JSON.parse(fs.readFileSync(fp, "utf8"));
    }
    catch {
        return {};
    }
}
function writeTurnCounters(counters) {
    try {
        const fp = turnCounterPath();
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, JSON.stringify(counters), "utf8");
    }
    catch { /* best-effort */ }
}
export function tickTurn(sessionID) {
    const cfg = readConfig();
    if (cfg.stats.interval === null)
        return false;
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
function modeSwitchPath() {
    const base = process.env["OPENCODE_CONFIG_DIR"] ??
        path.join(os.homedir(), ".config", "opencode");
    return path.join(base, ".runes-mode-switched");
}
export function writeModeSwitchMarker(mode) {
    try {
        const fp = modeSwitchPath();
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, mode, "utf8");
    }
    catch { /* best-effort */ }
}
export function readModeSwitchMarker() {
    try {
        const fp = modeSwitchPath();
        const val = fs.readFileSync(fp, "utf8").trim();
        fs.unlinkSync(fp);
        return val || null;
    }
    catch {
        return null;
    }
}
// Delegation marker — one-shot task description + optional mode override
function delegationPath() {
    const base = process.env["OPENCODE_CONFIG_DIR"] ??
        path.join(os.homedir(), ".config", "opencode");
    return path.join(base, ".runes-delegation");
}
export function writeDelegationMarker(task, mode) {
    try {
        const fp = delegationPath();
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, JSON.stringify({ task, mode: mode ?? null }), "utf8");
    }
    catch { /* best-effort */ }
}
export function readDelegationMarker() {
    try {
        const fp = delegationPath();
        const data = JSON.parse(fs.readFileSync(fp, "utf8"));
        fs.unlinkSync(fp);
        return data;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=config.js.map