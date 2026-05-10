import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const VALID_MODES = ["lite", "full", "ultra", "off"];
export function flagPath() {
    const base = process.env["OPENCODE_CONFIG_DIR"] ??
        path.join(os.homedir(), ".config", "opencode");
    return path.join(base, ".runes-active");
}
export function readFlag() {
    const fp = flagPath();
    try {
        const stat = fs.lstatSync(fp);
        if (stat.isSymbolicLink())
            return null;
        if (stat.size > 32)
            return null;
        const val = fs.readFileSync(fp, "utf8").trim();
        return VALID_MODES.includes(val) ? val : null;
    }
    catch {
        return null;
    }
}
export function writeFlag(mode) {
    const fp = flagPath();
    try {
        try {
            if (fs.lstatSync(fp).isSymbolicLink())
                return;
        }
        catch {
            // File doesn't exist yet
        }
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, mode, "utf8");
    }
    catch {
        // Best-effort
    }
}
export function removeFlag() {
    try {
        fs.unlinkSync(flagPath());
    }
    catch {
        // no-op
    }
}
export function isActive() {
    const m = readFlag();
    return m !== null && m !== "off";
}
//# sourceMappingURL=flag.js.map