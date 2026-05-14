import { describe, expect, it } from "vitest";

import { renderScopedHelp } from "../src/help.js";
import { runCliEntrypoint } from "../src/index.js";
import { captureOutput } from "../../../test-support/test-helpers.js";

describe("scoped CLI help", () => {
  it("renders global help with agent skills as a first-run path", async () => {
    const output = await captureOutput(() => runCliEntrypoint(["--help"]));

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("REGENT CLI HELP");
    expect(output.stdout).toContain("regents setup skills");
  });

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

  it("renders setup skills help", async () => {
    const output = await captureOutput(() => runCliEntrypoint(["setup", "skills", "--help"]));

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("SETUP SKILLS HELP");
    expect(output.stdout).toContain("regents setup skills [--project]");
    expect(output.stdout).toContain("--project");
  });

  it("overexplains runtime plugin install choices", async () => {
    const output = await captureOutput(() => runCliEntrypoint(["plugin", "install", "--help"]));

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("PLUGIN INSTALL HELP");
    expect(output.stdout).toContain("regents plugin install --runtime <auto|hermes|openclaw>");
    expect(output.stdout).toContain("--runtime hermes installs only the Hermes tools");
    expect(output.stdout).toContain("--runtime openclaw installs only the OpenClaw tools");
    expect(output.stdout).toContain("If you installed the wrong runtime, nothing dangerous happened");
  });

  it("renders command-level help when a required value is omitted", async () => {
    const output = await captureOutput(() => runCliEntrypoint(["autolaunch", "agent", "--help"]));

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("AUTOLAUNCH AGENT <ID> HELP");
    expect(output.stdout).toContain("regents autolaunch agent <id>");
  });

  it("prefers the more specific help entry when commands share a prefix", async () => {
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "agent", "readiness", "--help"]),
    );

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("AUTOLAUNCH AGENT READINESS <ID> HELP");
    expect(output.stdout).toContain("regents autolaunch agent readiness <id>");
  });

  it("shows the required platform sign-in flags", async () => {
    const output = await captureOutput(() =>
      runCliEntrypoint(["platform", "auth", "login", "--help"]),
    );

    expect(output.result).toBe(0);
    expect(output.stdout).toContain("PLATFORM AUTH LOGIN HELP");
    expect(output.stdout).toContain("--identity-token <token>");
    expect(output.stdout).toContain("--session-file <path>");
    expect(output.stdout).toContain("regents platform formation status");
  });

  it("renders Regent worker help for Hermes and execution pools", async () => {
    const hermes = await captureOutput(() =>
      runCliEntrypoint(["agent", "connect", "hermes", "--help"]),
    );

    expect(hermes.result).toBe(0);
    expect(hermes.stdout).toContain("AGENT CONNECT HERMES HELP");
    expect(hermes.stdout).toContain("regents agent connect hermes --company-id <id>");

    const pool = await captureOutput(() =>
      runCliEntrypoint(["agent", "execution-pool", "--help"]),
    );

    expect(pool.result).toBe(0);
    expect(pool.stdout).toContain("AGENT EXECUTION-POOL HELP");
    expect(pool.stdout).toContain("regents agent execution-pool --company-id <id>");
  });

  it("renders Regent work help with concise output guidance", async () => {
    const run = await captureOutput(() => runCliEntrypoint(["work", "run", "--help"]));

    expect(run.result).toBe(0);
    expect(run.stdout).toContain("WORK RUN HELP");
    expect(run.stdout).toContain("Shows the run id, selected worker, current status, and watch command.");

    const openclaw = await captureOutput(() =>
      runCliEntrypoint(["agent", "connect", "openclaw", "--help"]),
    );

    expect(openclaw.result).toBe(0);
    expect(openclaw.stdout).toContain("Shows the worker id and the local Regents Work skill path.");
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
