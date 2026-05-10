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
export declare function querySessionStats(sessionID: string): TokenStats;
export declare function queryAllTimeStats(): TokenStats;
export declare function estimateSaved(outputTokens: number, mode: string): number;
export declare function fmt(n: number): string;
//# sourceMappingURL=stats.d.ts.map