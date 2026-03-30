import { printJson } from "../printer.js";
import type { ParsedCliArgs } from "../parse.js";
import {
  listAutolaunchIdentities,
  mintAutolaunchIdentity,
  type IdentityListResult as TechtreeIdentityListResult,
  type IdentityMintResult as TechtreeIdentityMintResult,
} from "./autolaunch/identities.js";

export type { TechtreeIdentityListResult, TechtreeIdentityMintResult };

export const listTechtreeIdentities = listAutolaunchIdentities;
export const mintTechtreeIdentity = mintAutolaunchIdentity;

export async function runTechtreeIdentitiesList(args: ParsedCliArgs): Promise<void> {
  printJson(await listTechtreeIdentities(args));
}

export async function runTechtreeIdentitiesMint(args: ParsedCliArgs): Promise<void> {
  printJson(await mintTechtreeIdentity(args));
}
