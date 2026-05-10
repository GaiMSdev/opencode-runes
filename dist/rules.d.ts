/**
 * rules.ts — Mode-specific compression rules injected into the system prompt.
 *
 * Keeps rule text in one place so both the system-transform hook and any
 * diagnostic tools read from the same source.
 */
import type { Mode } from "./flag.js";
/**
 * Full rule block for session-start injection (verbose, includes examples).
 */
export declare function fullRules(mode: Exclude<Mode, "off">): string;
/**
 * Short reinforcement line for per-turn injection (keeps context overhead low).
 */
export declare function reinforcement(mode: Exclude<Mode, "off">): string;
/**
 * Status badge string shown in tool output.
 */
export declare function badge(mode: Mode | null): string;
//# sourceMappingURL=rules.d.ts.map