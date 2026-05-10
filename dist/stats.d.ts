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
/**
 * Query the current session's token totals via sqlite3 CLI.
 * Returns zeroed stats if the database is unavailable.
 */
export declare function querySessionStats(sessionID: string): TokenStats;
/**
 * Query ALL-time aggregate stats (for /compress-stats without a session).
 */
export declare function queryAllTimeStats(): TokenStats;
export declare function estimateSaved(outputTokens: number, mode: string): number;
/**
 * Format a number with locale-style comma separators (no Intl dependency).
 */
export declare function fmt(n: number): string;
//# sourceMappingURL=stats.d.ts.map