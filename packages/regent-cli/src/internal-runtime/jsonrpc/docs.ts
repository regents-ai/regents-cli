import { REGENT_RPC_METHODS } from "./methods.js";

const SECTION_ORDER = [
  { title: "Runtime", prefix: "runtime." },
  { title: "Agent", prefix: "agent." },
  { title: "Doctor", prefix: "doctor." },
  { title: "Auth", prefix: "auth." },
  { title: "Techtree", prefix: "techtree." },
  { title: "XMTP", prefix: "xmtp." },
  { title: "Transports", prefix: "gossipsub." },
] as const;

export function renderJsonRpcMethodsDoc(): string {
  const methods = Object.values(REGENT_RPC_METHODS);
  const lines = [
    "# JSON-RPC Methods",
    "",
    "`regent-cli` uses JSON-RPC 2.0 over a Unix domain socket. Each request and response is one JSON line.",
    "",
    "This file is generated from the current runtime method registry.",
    "",
  ];

  for (const section of SECTION_ORDER) {
    const sectionMethods = methods.filter((method) => method.startsWith(section.prefix));
    if (sectionMethods.length === 0) {
      continue;
    }

    lines.push(`## ${section.title}`, "");
    for (const method of sectionMethods) {
      lines.push(`- \`${method}\``);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
