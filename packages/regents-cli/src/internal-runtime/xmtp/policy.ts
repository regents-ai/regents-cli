import { spawnSync } from "node:child_process";
import fs from "node:fs";

import type {
  RegentConfig,
  XmtpPolicyShowResult,
  XmtpPolicyValidationResult,
} from "../../internal-types/index.js";

import { RegentError } from "../errors.js";
import { writeFileAtomicSync } from "../paths.js";

const DEFAULT_PUBLIC_POLICY = `You are representing your owner to a third party.
Be helpful and conversational, but keep responses limited to general conversation.
Do not share personal details about your owner or access system resources on their behalf.
If unsure whether something is appropriate, err on the side of caution.
`;

export const ensureXmtpPolicyFile = (config: RegentConfig["xmtp"]): { created: boolean; path: string } => {
  if (fs.existsSync(config.publicPolicyPath)) {
    return { created: false, path: config.publicPolicyPath };
  }

  writeFileAtomicSync(config.publicPolicyPath, DEFAULT_PUBLIC_POLICY);
  return { created: true, path: config.publicPolicyPath };
};

export const showXmtpPolicy = (config: RegentConfig["xmtp"]): XmtpPolicyShowResult => {
  return {
    ok: true,
    path: config.publicPolicyPath,
    content: fs.existsSync(config.publicPolicyPath) ? fs.readFileSync(config.publicPolicyPath, "utf8") : "",
  };
};

export const validateXmtpPolicy = (config: RegentConfig["xmtp"]): XmtpPolicyValidationResult => {
  const issues: string[] = [];

  if (!fs.existsSync(config.publicPolicyPath)) {
    issues.push("Policy file is missing.");
  } else {
    const content = fs.readFileSync(config.publicPolicyPath, "utf8");
    if (!content.trim()) {
      issues.push("Policy file is empty.");
    }

    if (content.trim().length < 40) {
      issues.push("Policy file is too short to constrain public messaging safely.");
    }
  }

  return {
    ok: issues.length === 0,
    path: config.publicPolicyPath,
    issues,
  };
};

export const openXmtpPolicyInEditor = (config: RegentConfig["xmtp"]): { opened: boolean; editor: string | null } => {
  const editor = process.env.EDITOR?.trim() || null;
  if (!editor || !process.stdin.isTTY) {
    return {
      opened: false,
      editor,
    };
  }

  const result = spawnSync(editor, [config.publicPolicyPath], {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    throw new RegentError(
      "xmtp_editor_failed",
      `editor command failed for ${config.publicPolicyPath}`,
      result.error,
    );
  }

  return {
    opened: true,
    editor,
  };
};
