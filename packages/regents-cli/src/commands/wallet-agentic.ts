import { CliUsageError } from "../cli-usage-error.js";
import { AWAL_VERSION, runAwalJson } from "../internal-runtime/agentic-wallet/awal.js";
import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson, printText, renderKeyValuePanel } from "../printer.js";

const chain = (args: ParsedCliArgs): "base" => {
  const value = requireArg(getFlag(args, "chain"), "--chain");
  if (value === "base") {
    return value;
  }

  throw new CliUsageError({
    code: "unsupported_chain",
    message: "Agentic Wallet funding and balance checks currently use Base.",
    validValues: ["base"],
  });
};

const printAwal = (args: ParsedCliArgs, payload: unknown): void => {
  if (getBooleanFlag(args, "json")) {
    printJson(payload);
    return;
  }

  printText(
    renderKeyValuePanel("◆ AGENTIC WALLET", [
      { label: "status", value: "ready" },
      { label: "details", value: "Use --json for the full Agentic Wallet response." },
    ]),
  );
};

export async function runWalletAgenticStatus(args: ParsedCliArgs): Promise<number> {
  printAwal(args, await runAwalJson(["status", "--json"]));
  return 0;
}

export async function runWalletAgenticLogin(args: ParsedCliArgs): Promise<number> {
  const email = requireArg(getFlag(args, "email"), "--email");
  printAwal(args, await runAwalJson(["auth", "login", email, "--json"]));
  return 0;
}

export async function runWalletAgenticVerify(args: ParsedCliArgs): Promise<number> {
  const flowId = requireArg(getFlag(args, "flow-id"), "--flow-id");
  const otp = requireArg(getFlag(args, "otp"), "--otp");
  printAwal(args, await runAwalJson(["auth", "verify", flowId, otp, "--json"]));
  return 0;
}

export async function runWalletAgenticBalance(args: ParsedCliArgs): Promise<number> {
  printAwal(args, await runAwalJson(["balance", "--chain", chain(args), "--json"]));
  return 0;
}

export async function runWalletAgenticFund(args: ParsedCliArgs): Promise<number> {
  const selectedChain = chain(args);
  const amount = requireArg(getFlag(args, "amount-usdc"), "--amount-usdc");
  const payload = {
    ok: true,
    provider: "coinbase-agentic-wallet",
    awal_version: AWAL_VERSION,
    chain: selectedChain,
    amount_usdc: amount,
    next: [
      "Run `npx -y awal@2.10.0 show`.",
      "Open Fund in the Agentic Wallet screen.",
      "Choose Base USDC and complete the funding step yourself.",
    ],
    warning: "Keep meaningful funds in a Safe treasury, not in Agentic Wallet.",
  };

  if (getBooleanFlag(args, "json")) {
    printJson(payload);
    return 0;
  }

  printText(
    renderKeyValuePanel("◆ FUND AGENTIC WALLET", [
      { label: "amount", value: `${amount} USDC` },
      { label: "chain", value: selectedChain },
      { label: "next", value: "Run npx -y awal@2.10.0 show and use Fund." },
      { label: "note", value: "Keep meaningful funds in a Safe treasury." },
    ]),
  );
  return 0;
}
