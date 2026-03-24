import { type ParsedCliArgs } from "../parse.js";
export declare class CliUsageError extends Error {
    constructor(message: string);
}
export declare function runDoctorCommand(args: ParsedCliArgs, configPath?: string): Promise<number>;
