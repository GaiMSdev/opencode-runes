import { z } from "zod";
export declare const server: (_ctx: any) => Promise<{
    "experimental.chat.system.transform": (input: any, output: any) => Promise<void>;
    "experimental.chat.messages.transform": (_input: any, output: any) => Promise<void>;
    "experimental.session.compacting": (_input: any, output: any) => Promise<void>;
    event: ({ event }: any) => Promise<void>;
    "tool.execute.before": (input: any, output: any) => Promise<void>;
    tool: {
        rune_activate: {
            description: string;
            args: {
                mode: z.ZodEnum<{
                    lite: "lite";
                    full: "full";
                    ultra: "ultra";
                    off: "off";
                }>;
            };
            execute(args: {
                mode: "lite" | "full" | "ultra" | "off";
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        rune_stats: {
            description: string;
            args: {
                session_id: z.ZodOptional<z.ZodString>;
                scope: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
                    session: "session";
                    alltime: "alltime";
                }>>>;
            };
            execute(args: {
                scope: "session" | "alltime";
                session_id?: string;
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        rune_help: {
            description: string;
            args: {};
            execute(args: Record<string, never>, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
        rune_shrink: {
            description: string;
            args: {
                text: z.ZodOptional<z.ZodString>;
                file: z.ZodOptional<z.ZodString>;
                mode: z.ZodOptional<z.ZodEnum<{
                    lite: "lite";
                    full: "full";
                    ultra: "ultra";
                }>>;
            };
            execute(args: {
                text?: string;
                file?: string;
                mode?: "lite" | "full" | "ultra";
            }, context: import("@opencode-ai/plugin").ToolContext): Promise<import("@opencode-ai/plugin").ToolResult>;
        };
    };
}>;
//# sourceMappingURL=index.d.ts.map