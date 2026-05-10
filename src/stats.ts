/**
 * stats.ts — Token statistics from OpenCode's SQLite database.
 *
 * OpenCode stores all message data in:
 *   ~/.local/share/opencode/opencode.db
 *
 * The `message` table has a `data` JSON column with this schema (assistant rows):
 *   {
 *     "role": "assistant",
 *     "tokens": {
 *       "input": number,
 *       "output": number,
 *       "reasoning": number,
 *       "cache": { "read": number, "write": number }
 *     },
 *     "modelID": string,
 *     "providerID": string,
 *     "cost": number
 *   }
 *
 * We use the `sqlite3` CLI (always available on macOS) via child_process
 * rather than a native module, so the plugin has zero binary dependencies.
 */

import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export interface TokenStats {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string;
  turns: number;
}

const DB_PATH =
  process.env["OPENCODE_DATA_DIR"] != null
    ? path.join(process.env["OPENCODE_DATA_DIR"], "opencode.db")
    : path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

/**
 * Query the current session's token totals via sqlite3 CLI.
 * Returns zeroed stats if the database is unavailable.
 */
export function querySessionStats(sessionID: string): TokenStats {
  const zero: TokenStats = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    model: "unknown",
    turns: 0,
  };

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

    const result = execSync(
      `sqlite3 -separator '|' "${DB_PATH}"`,
      { input: sql, encoding: "utf8", timeout: 3000 }
    ).trim();

    if (!result) return zero;
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
  } catch {
    return zero;
  }
}

/**
 * Query ALL-time aggregate stats (for /compress-stats without a session).
 */
export function queryAllTimeStats(): TokenStats {
  const zero: TokenStats = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    model: "various",
    turns: 0,
  };

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

    const result = execSync(
      `sqlite3 -separator '|' "${DB_PATH}"`,
      { input: sql, encoding: "utf8", timeout: 3000 }
    ).trim();

    if (!result) return zero;
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
  } catch {
    return zero;
  }
}

/**
 * Estimated tokens saved given compression mode and actual output count.
 * Based on measured reduction ratios from caveman/GEM-THAL benchmarking.
 */
const COMPRESSION_RATIO: Record<string, number> = {
  lite: 0.30, // ~30% shorter output
  full: 0.55, // ~55% shorter output
  ultra: 0.75, // ~75% shorter output
};

export function estimateSaved(outputTokens: number, mode: string): number {
  const ratio = COMPRESSION_RATIO[mode] ?? 0;
  // saved / (saved + actual) = ratio  =>  saved = actual * ratio / (1 - ratio)
  return Math.round(outputTokens * (ratio / (1 - ratio)));
}

/**
 * Format a number with locale-style comma separators (no Intl dependency).
 */
export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
