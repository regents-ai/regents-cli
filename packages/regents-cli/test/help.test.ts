import { describe, expect, it } from "vitest";

import { renderScopedHelp } from "../src/help.js";
import { runCliEntrypoint } from "../src/index.js";
import { captureOutput } from "../../../test-support/test-helpers.js";

describe("scoped CLI help", () => {
  it("renders Autolaunch group help without running a command", async () => {
    const output = await captureOutput(() => runCliEntrypoint(["autolaunch", "--help"]));

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("AUTOLAUNCH HELP");
    expect(output.stdout).toContain("regents auth login --audience autolaunch");
    expect(output.stdout).toContain("regents autolaunch agents list");
  });

  it("renders command-level help", async () => {
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "jobs", "watch", "--help"]),
    );

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("AUTOLAUNCH JOBS WATCH HELP");
    expect(output.stdout).toContain("regents autolaunch jobs watch <job-id>");
    expect(output.stdout).toContain("--interval <seconds>");
  });

  it("keeps command help stable", () => {
    expect(renderScopedHelp(["autolaunch", "jobs", "watch"], "/tmp/regent.json"))
      .toMatchInlineSnapshot(`
        "◆ AUTOLAUNCH JOBS WATCH HELP
        Watch a launch job until it reaches a final state.

        usage regents autolaunch jobs watch <job-id> [--interval seconds]
        auth Needs \`regents auth login --audience autolaunch\` and \`regents identity ensure\`.
        output Shows the latest job status each time it changes.
        next When the job is ready, continue with the next command shown in the output.

        ◆ FLAGS
        --interval <seconds>
        --config <path>

        ◆ EXAMPLES
        regents autolaunch jobs watch job_123 --interval 5"
      `);
  });
});
