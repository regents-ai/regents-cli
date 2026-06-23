import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { requestProductJson } from "../src/commands/product-http.js";
import { EXPECTED_PLATFORM_CONTRACT_DIGEST } from "../src/generated/platform-contract-digest.js";
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

  it("checks the exact Platform contract digest before write requests", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-product-http-"));
    const config = defaultConfig(path.join(tempDir, "config.json"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("openapi: 3.1.0\n", {
          status: 200,
          headers: {
            "x-regents-contract-major": "0",
            "x-regents-contract-digest": EXPECTED_PLATFORM_CONTRACT_DIGEST,
          },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await requestProductResponse({
      service: "platform",
      method: "POST",
      path: "/api/test",
      config,
      body: JSON.stringify({ ok: true }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/test");
  });

  it("rejects Platform write requests when the contract digest differs", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-product-http-"));
    const config = defaultConfig(path.join(tempDir, "config.json"));

    const fetchMock = vi.fn(async () =>
      new Response("openapi: 3.1.0\n", {
        status: 200,
        headers: {
          "x-regents-contract-major": "0",
          "x-regents-contract-digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestProductResponse({
        service: "platform",
        method: "POST",
        path: "/api/test",
        config,
        body: JSON.stringify({ ok: true }),
      }),
    ).rejects.toMatchObject({
      code: "platform_contract_incompatible",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
