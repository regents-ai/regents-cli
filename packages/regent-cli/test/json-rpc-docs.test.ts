import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { renderJsonRpcMethodsDoc } from "../src/internal-runtime/jsonrpc/docs.js";

describe("JSON-RPC methods doc", () => {
  it("matches the live runtime method registry", () => {
    const docsPath = new URL("../../../docs/json-rpc-methods.md", import.meta.url);
    const currentDoc = fs.readFileSync(docsPath, "utf8");

    expect(currentDoc).toBe(renderJsonRpcMethodsDoc());
  });
});
