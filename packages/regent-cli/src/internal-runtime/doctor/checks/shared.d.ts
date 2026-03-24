import type { DoctorCheckContext, DoctorCheckOutcome } from "../types.js";
export declare function skipDueToMissingConfig(): DoctorCheckOutcome;
export declare function isValidAddress(value: string): boolean;
export declare function isPositiveIntegerString(value: string): boolean;
export declare function deriveSignerWalletAddress(ctx: DoctorCheckContext): Promise<`0x${string}` | null>;
export declare function buildBackendDetails(error: unknown): Record<string, unknown>;
export declare function ensureDirExists(dirPath: string): boolean;
export declare function uniquePaths(paths: string[]): string[];
