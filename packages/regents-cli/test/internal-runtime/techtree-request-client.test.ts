import { describe, expect, it, vi } from "vitest";

import { TechtreeRequestClient } from "../../src/internal-runtime/techtree/client/request.js";

const makeClient = (fetchWithTimeout: (url: string, init: RequestInit) => Promise<Response>): TechtreeRequestClient =>
  Object.assign(Object.create(TechtreeRequestClient.prototype), { fetchWithTimeout }) as TechtreeRequestClient;

describe("Techtree request client", () => {
  it("rejects unsupported external download schemes", async () => {
    const fetchWithTimeout = vi.fn();
    const client = makeClient(fetchWithTimeout);

    await expect(client.fetchExternalText("file:///tmp/bundle.json")).rejects.toMatchObject({
      code: "techtree_download_scheme_unsupported",
    });

    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("rejects external downloads above the byte cap before reading the body", async () => {
    const fetchWithTimeout = vi.fn(async () =>
      new Response("not read", {
        status: 200,
        headers: {
          "content-length": String(25 * 1024 * 1024 + 1),
        },
      }),
    );
    const client = makeClient(fetchWithTimeout);

    await expect(client.fetchExternalText("https://example.test/bundle.json")).rejects.toMatchObject({
      code: "techtree_download_too_large",
    });
  });
});
