import { describe, expect, it, vi } from "vitest";

import { RegentRuntime } from "../../src/internal-runtime/runtime.js";

describe("runtime startup", () => {
  it("rolls back started subsystems when startup fails", async () => {
    const runtime = new RegentRuntime("/tmp/regent-runtime-start.json");
    const gossipsub = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const jsonRpcServer = {
      start: vi.fn(async () => {
        throw new Error("bind failed");
      }),
      stop: vi.fn(async () => undefined),
    };

    Object.assign(runtime as unknown as Record<string, unknown>, {
      gossipsub,
      jsonRpcServer,
    });

    await expect(runtime.start()).rejects.toThrow("bind failed");
    expect(gossipsub.start).toHaveBeenCalledTimes(1);
    expect(jsonRpcServer.start).toHaveBeenCalledTimes(1);
    expect(gossipsub.stop).toHaveBeenCalledTimes(1);
    expect(runtime.isStarted()).toBe(false);
  });

  it("treats shutdown requests as idempotent and allows later requests", async () => {
    const runtime = new RegentRuntime("/tmp/regent-runtime-shutdown.json");
    const stop = vi.fn(async () => undefined);

    Object.assign(runtime as unknown as Record<string, unknown>, { stop });

    runtime.requestShutdown();
    runtime.requestShutdown();
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);

    runtime.requestShutdown();
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("dispatches the next BBH assignment method", async () => {
    const runtime = new RegentRuntime("/tmp/regent-runtime-assignment-next.json");
    const assignment = {
      data: {
        assignment_ref: "assignment-1",
        split: "challenge",
        capsule: {
          capsule_id: "capsule-1",
          provider: "bbh",
          provider_ref: "provider-1",
          split: "challenge",
          language: "python",
          mode: "fixed",
          assignment_policy: "auto",
          title: "Capsule",
          hypothesis: "Hypothesis",
          protocol_md: "Protocol",
          rubric_json: {},
          task_json: {},
          data_files: [],
        },
      },
    };
    const nextBbhAssignment = vi.fn(async () => assignment);

    Object.assign(runtime as unknown as Record<string, unknown>, {
      techtree: { nextBbhAssignment },
    });

    const result = await (
      runtime as unknown as {
        dispatch: (method: string, params: unknown) => Promise<unknown>;
      }
    ).dispatch("techtree.v1.bbh.assignment.next", { split: "challenge" });

    expect(result).toBe(assignment);
    expect(nextBbhAssignment).toHaveBeenCalledWith({ split: "challenge" });
  });
});
