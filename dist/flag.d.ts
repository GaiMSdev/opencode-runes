export type Mode = "lite" | "full" | "ultra" | "wenyan" | "off";
export declare function flagPath(): string;
export declare function resolveDirSafe(dirPath: string): string | null;
export declare function readFlag(): Mode | null;
export declare function writeFlag(mode: Mode): void;
export declare function removeFlag(): void;
export declare function isActive(): boolean;
//# sourceMappingURL=flag.d.ts.map