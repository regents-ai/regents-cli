import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CliUsageError } from "../cli-usage-error.js";
import { daemonCall } from "../daemon-client.js";
import type { RunbookAnswerCreateInput } from "../internal-types/index.js";
import { getBooleanFlag, getFlag, getFlags, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { isHumanTerminal, printJson, printText } from "../printer.js";
import {
  renderRunbookAnswer,
  renderRunbookPaymentProfile,
  renderRunbookQuestion,
  renderRunbookQuestionCreated,
  renderRunbookQuestionList,
  renderRunbookSolved,
  renderRunbookUnlock,
  renderRunbookVote,
} from "./techtree-runbook-presenters.js";

type SecretDetection = {
  kind: string;
  file: string;
  line: number;
  preview: string;
  confirmer_detail: string;
};

const SECRET_PATTERNS: Array<{ kind: string; regex: RegExp; detail: string }> = [
  {
    kind: "private_key",
    regex: /\b0x[a-fA-F0-9]{64}\b/g,
    detail: "Looks like a raw private key. Confirm only after replacing it with a harmless placeholder.",
  },
  {
    kind: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    detail: "Looks like a signed token. Confirm only after removing the token body.",
  },
  {
    kind: "api_key",
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
    detail: "Looks like a service API key. Confirm only after redacting the key.",
  },
  {
    kind: "secret_assignment",
    regex: /\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|API_KEY)[A-Za-z0-9_]*\s*[:=]\s*["']?[^"'\s\[]{8,}/gi,
    detail: "Looks like a secret-bearing config value. Confirm only after checking the redacted value.",
  },
];

const readTextValue = (value: string): string => {
  if (!value.startsWith("@")) {
    return value;
  }

  return readAllowedFile(value.slice(1));
};

const readAllowedFile = (filePath: string): string => {
  const base = path.basename(filePath);
  if (base === ".env" || base.startsWith(".env.")) {
    throw new CliUsageError({
      code: "env_file_not_allowed",
      message: "Runbook will not read .env files. Copy only the specific redacted lines into a separate text file.",
    });
  }

  return fs.readFileSync(filePath, "utf8");
};

const parseJsonObject = (value: string | undefined, label: string): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }

  const raw = readTextValue(value);
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliUsageError({ code: "invalid_json", message: `${label} must be a JSON object.` });
  }

  return parsed as Record<string, unknown>;
};

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

const parseAddress = (value: string | undefined, label: string): `0x${string}` | undefined => {
  if (!value) {
    return undefined;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new CliUsageError({ code: "invalid_address", message: `${label} must be an EVM address.` });
  }

  return value.toLowerCase() as `0x${string}`;
};

const parseRiskLevel = (value: string | undefined): RunbookAnswerCreateInput["risk_level"] => {
  if (!value) {
    return undefined;
  }

  const allowed: NonNullable<RunbookAnswerCreateInput["risk_level"]>[] = [
    "read_only",
    "local_write",
    "network_call",
    "credential_touching",
    "billing_touching",
    "deployment",
    "money_movement",
    "destructive",
  ];

  if (!allowed.includes(value as NonNullable<RunbookAnswerCreateInput["risk_level"]>)) {
    throw new CliUsageError({
      code: "invalid_risk_level",
      message: "--risk-level is invalid.",
      validValues: allowed,
    });
  }

  return value as NonNullable<RunbookAnswerCreateInput["risk_level"]>;
};

const parseVisibility = (value: string | undefined): "public" | "unlisted" | undefined => {
  if (!value) {
    return undefined;
  }

  if (value !== "public" && value !== "unlisted") {
    throw new CliUsageError({
      code: "invalid_visibility",
      message: "--visibility must be public or unlisted.",
      validValues: ["public", "unlisted"],
    });
  }

  return value;
};

const parseVote = (value: string | undefined): "up" | "down" => {
  if (value !== "up" && value !== "down") {
    throw new CliUsageError({
      code: "invalid_vote",
      message: "--vote must be up or down.",
      validValues: ["up", "down"],
    });
  }

  return value;
};

const maskSecret = (value: string): string =>
  value.length <= 12 ? "[redacted]" : `${value.slice(0, 4)}…${value.slice(-4)}`;

const lineNumberAt = (value: string, index: number): number =>
  value.slice(0, index).split(/\r?\n/u).length;

const scanAndRedact = (filePath: string, content: string): { redacted: string; detections: SecretDetection[] } => {
  let redacted = content;
  const detections: SecretDetection[] = [];

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern.regex, (match, offset: number) => {
      detections.push({
        kind: pattern.kind,
        file: filePath,
        line: lineNumberAt(content, offset),
        preview: maskSecret(match),
        confirmer_detail: pattern.detail,
      });

      return `[redacted:${pattern.kind}]`;
    });
  }

  return { redacted, detections };
};

const buildRedactedLogBundle = (args: ParsedCliArgs): Record<string, unknown> => {
  const logFiles = [...getFlags(args, "log-file"), ...getFlags(args, "config-file")];
  const inlineLogs = getFlags(args, "log").map((value, index) => ({ label: `inline-log-${index + 1}`, value }));
  const files: Record<string, unknown>[] = [];
  const detections: SecretDetection[] = [];

  for (const filePath of logFiles) {
    const content = readAllowedFile(filePath);
    const result = scanAndRedact(filePath, content);
    detections.push(...result.detections);
    files.push({
      path: filePath,
      sha256: sha256(content),
      redacted_sha256: sha256(result.redacted),
      redacted_excerpt: result.redacted.slice(0, 4_000),
      detection_count: result.detections.length,
    });
  }

  for (const entry of inlineLogs) {
    const content = readTextValue(entry.value);
    const result = scanAndRedact(entry.label, content);
    detections.push(...result.detections);
    files.push({
      path: entry.label,
      sha256: sha256(content),
      redacted_sha256: sha256(result.redacted),
      redacted_excerpt: result.redacted.slice(0, 4_000),
      detection_count: result.detections.length,
    });
  }

  if (detections.length > 0 && !getBooleanFlag(args, "confirm-redaction")) {
    const details = detections
      .map((detection) => `${detection.file}:${detection.line} ${detection.kind} ${detection.preview} — ${detection.confirmer_detail}`)
      .join("\n");

    throw new CliUsageError({
      code: "redaction_confirmation_required",
      message: `Runbook found possible secrets. Review these redactions and rerun with --confirm-redaction:\n${details}`,
    });
  }

  return {
    files,
    detections,
    confirmed_by_user: detections.length === 0 || getBooleanFlag(args, "confirm-redaction"),
  };
};

const privateSolutionPayload = (args: ParsedCliArgs): Record<string, unknown> | undefined => {
  const solution = getFlag(args, "private-solution");
  const solutionRef = getFlag(args, "solution-ref");

  if (!solution && !solutionRef) {
    return undefined;
  }

  if (solutionRef) {
    return {
      kind: "external_ref",
      ref: solutionRef,
    };
  }

  const text = readTextValue(requireArg(solution, "--private-solution"));
  return {
    kind: "text",
    sha256: sha256(text),
    text,
  };
};

const commonAnswerInput = (args: ParsedCliArgs): RunbookAnswerCreateInput => ({
  public_summary: readTextValue(requireArg(getFlag(args, "summary"), "--summary")),
  price_usdc: requireArg(getFlag(args, "price-usdc"), "--price-usdc"),
  public_unlock_price_usdc: getFlag(args, "public-unlock-price-usdc"),
  private_solution_payload: privateSolutionPayload(args),
  root_cause_category: getFlag(args, "root-cause-category"),
  risk_level: parseRiskLevel(getFlag(args, "risk-level")),
  applicability: parseJsonObject(getFlag(args, "applicability"), "--applicability"),
});

const printRunbookResult = <T>(
  args: ParsedCliArgs,
  result: T,
  renderer: (result: T) => string,
): void => {
  if (getBooleanFlag(args, "json") || !isHumanTerminal()) {
    printJson(result);
    return;
  }

  printText(renderer(result));
};

export async function runTechtreeRunbookQuestionsList(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.questions.list",
      {
        q: getFlag(args, "q"),
        status: getFlag(args, "status"),
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookQuestionList);
}

export async function runTechtreeRunbookQuestionsGet(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.questions.get",
      { id: requireArg(args.positionals[4], "question id") },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookQuestion);
}

export async function runTechtreeRunbookPaymentAddressSet(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.paymentAddress.set",
      {
        payment_address: parseAddress(
          requireArg(getFlag(args, "payment-address"), "--payment-address"),
          "--payment-address",
        )!,
      },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookPaymentProfile);
}

export async function runTechtreeRunbookQuestionPost(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const payload = {
    vendor: requireArg(getFlag(args, "vendor"), "--vendor"),
    product: requireArg(getFlag(args, "product"), "--product"),
    tool: requireArg(getFlag(args, "tool"), "--tool"),
    tool_version: getFlag(args, "tool-version"),
    runtime: getFlag(args, "runtime"),
    command: requireArg(getFlag(args, "command"), "--command"),
    error_signature: requireArg(getFlag(args, "error-signature"), "--error-signature"),
    docs_followed_url: getFlag(args, "docs-url"),
    skill_followed_id: getFlag(args, "skill-id"),
    redacted_log_bundle: buildRedactedLogBundle(args),
    environment: parseJsonObject(getFlag(args, "environment"), "--environment") ?? {},
    failed_attempts: [...getFlags(args, "failed-attempt")],
    root_cause_category: getFlag(args, "root-cause-category"),
    public_visibility: parseVisibility(getFlag(args, "visibility")),
  };

  const result = await daemonCall("techtree.runbook.question.post", payload, configPath);
  printRunbookResult(args, result, renderRunbookQuestionCreated);
}

export async function runTechtreeRunbookAnswerPost(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.answer.post",
      {
        question_id: requireArg(args.positionals[4], "question id"),
        input: commonAnswerInput(args),
      },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookAnswer);
}

export async function runTechtreeRunbookAnswerAttachPaidSolution(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.answer.attachPaidSolution",
      {
        answer_id: requireArg(args.positionals[5], "answer id"),
        input: {
          price_usdc: getFlag(args, "price-usdc"),
          public_unlock_price_usdc: getFlag(args, "public-unlock-price-usdc"),
          private_solution_payload: privateSolutionPayload(args),
        },
      },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookAnswer);
}

export async function runTechtreeRunbookMarkSolved(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.markSolved",
      {
        question_id: requireArg(args.positionals[3], "question id"),
        input: {
          answer_id: requireArg(getFlag(args, "answer-id"), "--answer-id"),
          note: getFlag(args, "note"),
        },
      },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookSolved);
}

export async function runTechtreeRunbookUnlock(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.unlock",
      {
        answer_id: requireArg(args.positionals[3], "answer id"),
        input: {
          amount_usdc: requireArg(getFlag(args, "amount-usdc"), "--amount-usdc"),
          x402_receipt_id: requireArg(getFlag(args, "x402-receipt-id"), "--x402-receipt-id"),
          x402_payment_hash: requireArg(getFlag(args, "x402-payment-hash"), "--x402-payment-hash"),
          payer_wallet_address: parseAddress(getFlag(args, "payer-wallet-address"), "--payer-wallet-address"),
          pay_to_address: parseAddress(requireArg(getFlag(args, "pay-to-address"), "--pay-to-address"), "--pay-to-address")!,
          receipt: parseJsonObject(getFlag(args, "receipt"), "--receipt"),
        },
      },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookUnlock);
}

export async function runTechtreeRunbookAnswerVote(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const result = await daemonCall(
      "techtree.runbook.answer.vote",
      {
        answer_id: requireArg(args.positionals[4], "answer id"),
        input: { vote: parseVote(getFlag(args, "vote")) },
      },
      configPath,
    );

  printRunbookResult(args, result, renderRunbookVote);
}
