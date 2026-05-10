declare const VALID_MODES: readonly ["lite", "full", "ultra", "off"];
export type RuneMode = (typeof VALID_MODES)[number];
export declare function flagPath(): string;
export declare function readFlag(): RuneMode | null;
export declare function writeFlag(mode: RuneMode): void;
export declare function removeFlag(): void;
export declare function isActive(): boolean;
export {};
//# sourceMappingURL=flag.d.ts.map