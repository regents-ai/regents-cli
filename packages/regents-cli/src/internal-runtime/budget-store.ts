import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CliUsageError } from "../cli-usage-error.js";
import type { RegentConfig } from "../internal-types/index.js";

import { writeJsonFileAtomicSync } from "./paths.js";

export interface BudgetLedgerEntry {
  readonly entry_id: string;
  readonly at: string;
  readonly type: "grant" | "spend" | "revoke";
  readonly amount_usdc?: string;
  readonly reference?: string;
  readonly rail?: PaymentRail;
  readonly note?: string;
}

export type BudgetMode = "techtree_research" | "paid_service";
export type PaymentRail = "regent-wallet" | "agentic-wallet";

export interface BudgetRecord {
  readonly schema: "regents.budget.v1";
  readonly budget_id: string;
  readonly agent_id: string;
  readonly mode: BudgetMode;
  readonly rail: PaymentRail;
  readonly amount_usdc: string;
  readonly remaining_usdc: string;
  readonly max_payment_usdc: string;
  readonly allowed_hosts: readonly string[];
  readonly allowed_actions: readonly string[];
  readonly disallowed_actions: readonly string[];
  readonly expires_at: string;
  readonly status: "active" | "revoked";
  readonly created_at: string;
  readonly ledger: readonly BudgetLedgerEntry[];
}

interface BudgetFile {
  readonly schema: "regents.budgets.v1";
  readonly budgets: readonly BudgetRecord[];
}

const budgetFilePath = (config: RegentConfig): string => path.join(config.runtime.stateDir, "budgets.json");

const emptyBudgetFile = (): BudgetFile => ({ schema: "regents.budgets.v1", budgets: [] });

const newLedgerEntryId = (): string => `led_${crypto.randomBytes(12).toString("hex")}`;

export const readBudgetFile = (config: RegentConfig): BudgetFile => {
  const filePath = budgetFilePath(config);
  if (!fs.existsSync(filePath)) {
    return emptyBudgetFile();
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.trim() === "") {
    return emptyBudgetFile();
  }

  const parsed = JSON.parse(raw) as BudgetFile;
  return parsed && parsed.schema === "regents.budgets.v1" && Array.isArray(parsed.budgets)
    ? parsed
    : emptyBudgetFile();
};

const writeBudgetFile = (config: RegentConfig, file: BudgetFile): void => {
  writeJsonFileAtomicSync(budgetFilePath(config), file);
};

export const parseUsdcAtomic = (value: string, label = "USDC amount"): bigint => {
  const normalized = value.trim();
  const match = normalized.match(/^([0-9]+)(?:\.([0-9]{1,6}))?$/u);
  if (!match) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: `${label} must be a non-negative USDC amount with up to 6 decimals.`,
    });
  }

  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
};

export const formatUsdcAtomic = (atomic: bigint): string => {
  const whole = atomic / 1_000_000n;
  const fraction = atomic % 1_000_000n;
  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(6, "0").replace(/0+$/u, "")}`;
};

export const usdcToAtomicString = (value: string): string => parseUsdcAtomic(value, "--max-usdc").toString();

export const atomicStringToUsdc = (value: string): string => {
  if (!/^[0-9]+$/u.test(value)) {
    throw new CliUsageError({
      code: "invalid_atomic_usdc",
      message: "x402 amount must be an atomic USDC integer.",
    });
  }

  return formatUsdcAtomic(BigInt(value));
};

export const parseBudgetExpiry = (value: string): string => {
  const durationMatch = value.match(/^([1-9][0-9]*)d$/u);
  if (durationMatch) {
    const days = Number(durationMatch[1]);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: "--expires must be a duration like 7d or an ISO timestamp.",
    });
  }

  return parsed.toISOString();
};

export const createBudget = (
  config: RegentConfig,
  input: {
    readonly agent_id: string;
    readonly amount_usdc: string;
    readonly max_payment_usdc: string;
    readonly mode: BudgetMode;
    readonly rail: PaymentRail;
    readonly allowed_hosts: readonly string[];
    readonly expires_at: string;
  },
): BudgetRecord => {
  const amount = parseUsdcAtomic(input.amount_usdc, "--amount-usdc");
  const maxPayment = parseUsdcAtomic(input.max_payment_usdc, "--max-payment-usdc");
  if (amount === 0n) {
    throw new CliUsageError({ code: "invalid_flag_value", message: "--amount-usdc must be greater than 0." });
  }
  if (maxPayment === 0n || maxPayment > amount) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: "--max-payment-usdc must be greater than 0 and no larger than --amount-usdc.",
    });
  }

  const now = new Date().toISOString();
  const record: BudgetRecord = {
    schema: "regents.budget.v1",
    budget_id: `bud_${crypto.randomBytes(12).toString("hex")}`,
    agent_id: input.agent_id,
    mode: input.mode,
    rail: input.rail,
    amount_usdc: formatUsdcAtomic(amount),
    remaining_usdc: formatUsdcAtomic(amount),
    max_payment_usdc: formatUsdcAtomic(maxPayment),
    allowed_hosts: [...new Set(input.allowed_hosts.map((host) => host.trim().toLowerCase()).filter(Boolean))].sort(),
    allowed_actions: [
      "x402_pay",
      "techtree_workspace_create",
      "notebook_publish",
      "benchmark_attempt_submit",
      "receipt_create",
    ],
    disallowed_actions: ["trade", "arbitrary_send", "arbitrary_contract_call"],
    expires_at: input.expires_at,
    status: "active",
    created_at: now,
    ledger: [{ entry_id: newLedgerEntryId(), at: now, type: "grant", amount_usdc: formatUsdcAtomic(amount) }],
  };

  const current = readBudgetFile(config);
  writeBudgetFile(config, { schema: "regents.budgets.v1", budgets: [...current.budgets, record] });
  return record;
};

export const findBudget = (config: RegentConfig, budgetId: string): BudgetRecord => {
  const budget = readBudgetFile(config).budgets.find((entry) => entry.budget_id === budgetId);
  if (!budget) {
    throw new CliUsageError({ code: "budget_not_found", message: `Budget not found: ${budgetId}.` });
  }
  return budget;
};

export const assertBudgetPaymentAllowed = (
  config: RegentConfig,
  input: {
    readonly budget_id: string;
    readonly amount_usdc: string;
    readonly rail: PaymentRail;
    readonly url?: string;
    readonly approved: boolean;
  },
): BudgetRecord => {
  const budget = findBudget(config, input.budget_id);
  const amount = parseUsdcAtomic(input.amount_usdc, "--max-usdc");
  if (budget.status !== "active") {
    throw new CliUsageError({ code: "budget_revoked", message: "This budget is not active." });
  }
  if (Date.parse(budget.expires_at) <= Date.now()) {
    throw new CliUsageError({ code: "budget_expired", message: "This budget has expired." });
  }
  if (budget.rail !== input.rail) {
    throw new CliUsageError({
      code: "budget_rail_mismatch",
      message: `This budget is for ${budget.rail}.`,
    });
  }
  if (amount === 0n) {
    throw new CliUsageError({ code: "invalid_flag_value", message: "--max-usdc must be greater than 0." });
  }
  if (amount > parseUsdcAtomic(budget.max_payment_usdc, "budget max payment")) {
    throw new CliUsageError({ code: "budget_payment_too_large", message: "--max-usdc is larger than this budget allows." });
  }
  if (amount > parseUsdcAtomic(budget.remaining_usdc, "budget remaining amount")) {
    throw new CliUsageError({ code: "budget_insufficient", message: "This budget does not have enough remaining USDC." });
  }
  if (input.url && budget.allowed_hosts.length > 0) {
    let host = "";
    try {
      host = new URL(input.url).hostname.toLowerCase();
    } catch {
      throw new CliUsageError({
        code: "invalid_url",
        message: "Paid service URL is invalid.",
      });
    }
    if (!budget.allowed_hosts.includes(host)) {
      throw new CliUsageError({
        code: "budget_host_not_allowed",
        message: "This budget does not allow that paid service host.",
      });
    }
  }
  if (budget.mode === "paid_service" && !input.approved) {
    throw new CliUsageError({
      code: "budget_payment_approval_required",
      message: "Paid service budgets require --approve before payment.",
    });
  }

  return budget;
};

export const recordBudgetSpend = (
  config: RegentConfig,
  input: {
    readonly budget_id: string;
    readonly amount_usdc: string;
    readonly reference?: string;
    readonly rail: PaymentRail;
  },
): { readonly budget: BudgetRecord; readonly ledger_entry: BudgetLedgerEntry } => {
  const current = readBudgetFile(config);
  const amount = parseUsdcAtomic(input.amount_usdc, "--max-usdc");
  let updated: BudgetRecord | undefined;
  let ledgerEntry: BudgetLedgerEntry | undefined;

  const budgets = current.budgets.map((budget) => {
    if (budget.budget_id !== input.budget_id) {
      return budget;
    }

    const remaining = parseUsdcAtomic(budget.remaining_usdc, "budget remaining amount") - amount;
    ledgerEntry = {
      entry_id: newLedgerEntryId(),
      at: new Date().toISOString(),
      type: "spend",
      amount_usdc: formatUsdcAtomic(amount),
      ...(input.reference ? { reference: input.reference } : {}),
      rail: input.rail,
    };
    updated = {
      ...budget,
      remaining_usdc: formatUsdcAtomic(remaining),
      ledger: [...budget.ledger, ledgerEntry],
    };
    return updated;
  });

  if (!updated || !ledgerEntry) {
    throw new CliUsageError({ code: "budget_not_found", message: `Budget not found: ${input.budget_id}.` });
  }

  writeBudgetFile(config, { schema: "regents.budgets.v1", budgets });
  return { budget: updated, ledger_entry: ledgerEntry };
};

export const revokeBudget = (config: RegentConfig, budgetId: string): BudgetRecord => {
  const current = readBudgetFile(config);
  let revoked: BudgetRecord | undefined;
  const budgets = current.budgets.map((budget) => {
    if (budget.budget_id !== budgetId) {
      return budget;
    }

    revoked = {
      ...budget,
      status: "revoked",
      ledger: [...budget.ledger, { entry_id: newLedgerEntryId(), at: new Date().toISOString(), type: "revoke" }],
    };
    return revoked;
  });

  if (!revoked) {
    throw new CliUsageError({ code: "budget_not_found", message: `Budget not found: ${budgetId}.` });
  }

  writeBudgetFile(config, { schema: "regents.budgets.v1", budgets });
  return revoked;
};
