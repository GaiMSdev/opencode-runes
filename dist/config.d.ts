export interface StatsConfig {
    interval: number | null;
    milestone: number | null;
    onSwitch: boolean;
}
export interface RunesConfig {
    stats: StatsConfig;
}
export declare function readConfig(): RunesConfig;
export declare function writeConfig(config: RunesConfig): void;
export declare function configToLines(config: RunesConfig): string[];
export declare function tickTurn(sessionID: string): boolean;
export declare function writeModeSwitchMarker(mode: string): void;
export declare function readModeSwitchMarker(): string | null;
export declare function writeDelegationMarker(task: string, mode?: string): void;
export declare function readDelegationMarker(): {
    task: string;
    mode: string | null;
} | null;
//# sourceMappingURL=config.d.ts.map