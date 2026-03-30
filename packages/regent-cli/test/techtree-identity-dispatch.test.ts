import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runTechtreeIdentitiesListMock,
  runTechtreeIdentitiesMintMock,
} = vi.hoisted(() => ({
  runTechtreeIdentitiesListMock: vi.fn(async () => undefined),
  runTechtreeIdentitiesMintMock: vi.fn(async () => undefined),
}));

vi.mock("../src/commands/techtree-identities.js", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/techtree-identities.js")>(
    "../src/commands/techtree-identities.js",
  );

  return {
    ...actual,
    runTechtreeIdentitiesList: runTechtreeIdentitiesListMock,
    runTechtreeIdentitiesMint: runTechtreeIdentitiesMintMock,
  };
});

describe("Techtree identity command dispatch", () => {
  beforeEach(() => {
    runTechtreeIdentitiesListMock.mockClear();
    runTechtreeIdentitiesMintMock.mockClear();
  });

  it("routes techtree identities list through the Techtree command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "identities", "list", "--chain", "sepolia"])).resolves.toBe(0);
    expect(runTechtreeIdentitiesListMock).toHaveBeenCalledTimes(1);
    expect(runTechtreeIdentitiesMintMock).not.toHaveBeenCalled();
  });

  it("routes techtree identities mint through the Techtree command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "identities", "mint", "--chain", "sepolia"])).resolves.toBe(0);
    expect(runTechtreeIdentitiesMintMock).toHaveBeenCalledTimes(1);
    expect(runTechtreeIdentitiesListMock).not.toHaveBeenCalled();
  });
});
