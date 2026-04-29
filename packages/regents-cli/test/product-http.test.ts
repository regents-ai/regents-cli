import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { requestProductJson } from "../src/commands/product-http.js";
import { defaultConfig } from "../src/internal-runtime/config.js";

describe("product HTTP client", () => {
  it("uses the current product error envelope message", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-product-http-"));
    const config = defaultConfig(path.join(tempDir, "config.json"));

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "bad_request",
            product: "platform",
            status: 400,
            path: "/api/test",
            request_id: "req_product_http_test",
            message: "Choose a supported value.",
            next_steps: null,
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestProductJson("GET", "/api/test", { service: "platform", config }),
    ).rejects.toThrow("Choose a supported value.");

    vi.unstubAllGlobals();
  });
});
