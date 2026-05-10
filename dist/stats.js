import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const DB_PATH = process.env["OPENCODE_DATA_DIR"] != null
    ? path.join(process.env["OPENCODE_DATA_DIR"], "opencode.db")
    : path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
const ZERO_STATS = {
    input: 0, output: 0, reasoning: 0,
    cacheRead: 0, cacheWrite: 0, cost: 0,
    model: "unknown", turns: 0,
};
export function querySessionStats(sessionID) {
    try {
        const sql = `
      SELECT
        COALESCE(SUM(json_extract(data,'$.tokens.input')),0) as inp,
        COALESCE(SUM(json_extract(data,'$.tokens.output')),0) as out,
        COALESCE(SUM(json_extract(data,'$.tokens.reasoning')),0) as reason,
        COALESCE(SUM(json_extract(data,'$.tokens.cache.read')),0) as cr,
        COALESCE(SUM(json_extract(data,'$.tokens.cache.write')),0) as cw,
        COALESCE(SUM(json_extract(data,'$.cost')),0) as cost,
        COUNT(*) as turns,
        MAX(json_extract(data,'$.modelID')) as model
      FROM message
      WHERE session_id = '${sessionID.replace(/'/g, "''")}'
        AND json_extract(data,'$.role') = 'assistant'
        AND json_extract(data,'$.tokens') IS NOT NULL;
    `.trim();
        const result = execSync(`sqlite3 -separator '|' "${DB_PATH}"`, { input: sql, encoding: "utf8", timeout: 3000 }).trim();
        if (!result)
            return ZERO_STATS;
        const [inp, out, reason, cr, cw, cost, turns, model] = result.split("|");
        return {
            input: parseInt(inp ?? "0", 10) || 0,
            output: parseInt(out ?? "0", 10) || 0,
            reasoning: parseInt(reason ?? "0", 10) || 0,
            cacheRead: parseInt(cr ?? "0", 10) || 0,
            cacheWrite: parseInt(cw ?? "0", 10) || 0,
            cost: parseFloat(cost ?? "0") || 0,
            turns: parseInt(turns ?? "0", 10) || 0,
            model: model?.trim() || "unknown",
        };
    }
    catch {
        return ZERO_STATS;
    }
}
export function queryAllTimeStats() {
    try {
        const sql = `
      SELECT
        COALESCE(SUM(json_extract(data,'$.tokens.input')),0),
        COALESCE(SUM(json_extract(data,'$.tokens.output')),0),
        COALESCE(SUM(json_extract(data,'$.tokens.reasoning')),0),
        COALESCE(SUM(json_extract(data,'$.tokens.cache.read')),0),
        COALESCE(SUM(json_extract(data,'$.tokens.cache.write')),0),
        COALESCE(SUM(json_extract(data,'$.cost')),0),
        COUNT(*)
      FROM message
      WHERE json_extract(data,'$.role') = 'assistant'
        AND json_extract(data,'$.tokens') IS NOT NULL;
    `.trim();
        const result = execSync(`sqlite3 -separator '|' "${DB_PATH}"`, { input: sql, encoding: "utf8", timeout: 3000 }).trim();
        if (!result)
            return { ...ZERO_STATS, model: "various" };
        const [inp, out, reason, cr, cw, cost, turns] = result.split("|");
        return {
            input: parseInt(inp ?? "0", 10) || 0,
            output: parseInt(out ?? "0", 10) || 0,
            reasoning: parseInt(reason ?? "0", 10) || 0,
            cacheRead: parseInt(cr ?? "0", 10) || 0,
            cacheWrite: parseInt(cw ?? "0", 10) || 0,
            cost: parseFloat(cost ?? "0") || 0,
            turns: parseInt(turns ?? "0", 10) || 0,
            model: "various",
        };
    }
    catch {
        return { ...ZERO_STATS, model: "various" };
    }
}
const COMPRESSION_RATIO = {
    lite: 0.30,
    full: 0.55,
    ultra: 0.75,
};
export function estimateSaved(outputTokens, mode) {
    const ratio = COMPRESSION_RATIO[mode] ?? 0;
    return Math.round(outputTokens * (ratio / (1 - ratio)));
}
export function fmt(n) {
    return n.toLocaleString("en-US");
}
//# sourceMappingURL=stats.js.map