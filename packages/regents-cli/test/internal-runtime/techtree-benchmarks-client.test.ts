import { describe, expect, it } from "vitest";

import { BenchmarksResource } from "../../src/internal-runtime/techtree/client/benchmarks.js";
import type { TechtreeRequestClient } from "../../src/internal-runtime/techtree/client/request.js";

describe("benchmark Techtree client", () => {
  it("encodes benchmark path ids before making requests", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const request = {
      getJson: async (path: string) => {
        calls.push({ method: "GET", path });
        return { data: {} };
      },
      authedFetchJson: async (method: string, path: string) => {
        calls.push({ method, path });
        return { data: {} };
      },
    } as unknown as TechtreeRequestClient;
    const benchmarks = new BenchmarksResource(request);
    const capsuleId = "capsule / alpha";
    const harnessId = "harness / alpha";

    await benchmarks.getCapsule(capsuleId);
    await benchmarks.listVersions(capsuleId);
    await benchmarks.scoreboard(capsuleId);
    await benchmarks.reliability(capsuleId);
    await benchmarks.getHarness(harnessId);
    await benchmarks.createVersion(capsuleId, { version_label: "v1" });
    await benchmarks.recomputeReliability(capsuleId);

    expect(calls).toEqual([
      { method: "GET", path: "/api/techtree/v1/benchmarks/capsules/capsule%20%2F%20alpha" },
      { method: "GET", path: "/api/techtree/v1/benchmarks/capsules/capsule%20%2F%20alpha/versions" },
      { method: "GET", path: "/api/techtree/v1/benchmarks/capsules/capsule%20%2F%20alpha/scoreboard" },
      { method: "GET", path: "/api/techtree/v1/benchmarks/capsules/capsule%20%2F%20alpha/reliability" },
      { method: "GET", path: "/api/techtree/v1/benchmarks/harnesses/harness%20%2F%20alpha" },
      { method: "POST", path: "/api/techtree/v1/agent/benchmarks/capsules/capsule%20%2F%20alpha/versions" },
      { method: "POST", path: "/api/techtree/v1/agent/benchmarks/capsules/capsule%20%2F%20alpha/reliability/recompute" },
    ]);
  });
});
