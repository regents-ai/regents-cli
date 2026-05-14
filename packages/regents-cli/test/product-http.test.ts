import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestProductJson } from "../src/commands/product-http.js";
import { defaultConfig } from "../src/internal-runtime/config.js";
import { regentsCliVersion, requestProductResponse } from "../src/internal-runtime/product-http-client.js";

describe("product HTTP client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
  });

  it("adds stable Regent CLI identity headers to product requests", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-product-http-"));
    const config = defaultConfig(path.join(tempDir, "config.json"));

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await requestProductResponse({
      service: "platform",
      method: "GET",
      path: "/api/test",
      config,
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("x-regents-client")).toBe("regents-cli");
    expect(headers.get("x-regents-cli-version")).toBe(regentsCliVersion);
    expect(headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("shows the server-provided wait time for rate-limit responses", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-product-http-"));
    const config = defaultConfig(path.join(tempDir, "config.json"));

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "too_many_requests",
            product: "platform",
            status: 429,
            path: "/api/test",
            request_id: "req_rate_limit_test",
            message: "Too many requests.",
            next_steps: null,
          },
        }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": "42" } },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestProductJson("GET", "/api/test", { service: "platform", config }),
    ).rejects.toThrow("Too many requests. Try again in 42 seconds.");
  });
});
