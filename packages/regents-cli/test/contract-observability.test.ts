import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildContractDoctorReport, buildWorkspaceDoctorReport } from "../src/commands/doctor.js";
import { route, routeMatches } from "../src/routes/shared.js";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const sharedApi = path.join(workspaceRoot, "docs/regent-services-contract.openapiv3.yaml");
const sharedCli = path.join(workspaceRoot, "docs/shared-cli-contract.yaml");
const sharedGenerated = path.join(workspaceRoot, "packages/regents-cli/src/generated/regent-services-openapi.ts");
const walletActionSchema = path.join(workspaceRoot, "docs/schemas/wallet-action.schema.yaml");

const writeManifest = (body: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-workspace-"));
  const manifestPath = path.join(dir, "regent-workspace.yaml");
  fs.writeFileSync(manifestPath, body, "utf8");
  return manifestPath;
};

describe("contract observability", () => {
  it("reports loaded contracts, generated files, command coverage, and base URLs from the workspace manifest", () => {
    const manifestPath = writeManifest(`
repos:
  regents-cli:
    path: ${workspaceRoot}
    required_for_public_beta: true
    release_group: public_beta
    owner: regents-cli
    owns:
      - operator_control_surface
    api_contracts:
      - id: shared_services_api
        owner: shared-services
        path: docs/regent-services-contract.openapiv3.yaml
        include_in_cli_command_check: true
        generated_bindings:
          - path: packages/regents-cli/src/generated/regent-services-openapi.ts
            generator: openapi-typescript
    cli_contracts:
      - id: shared_cli
        owner: shared-services
        path: docs/shared-cli-contract.yaml
        include_in_cli_command_check: true
    acceptance_commands:
      - cwd: ${workspaceRoot}
        command: pnpm check:workspace
schemas:
  wallet_action:
    path: ${walletActionSchema}
money_movement:
  - id: regent_staking_claim
    owner_product: shared-services
    route_class: prepare
    signer: staker_wallet
    beneficiary: staker_wallet
    source_of_truth: chain
    confirmation_rule: receipt_and_claimable_read
incident_classes:
  - id: staking_claims
    owner_repo: shared-services
    recovery_command: regents regent-staking show
    requires_reconciliation_job: true
`);
    const report = buildContractDoctorReport(undefined, { manifestPath });

    expect(report.command).toBe("regents doctor contracts");
    expect(report.manifestPath).toBe(manifestPath);
    expect(report.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: "shared-services",
          kind: "cli",
          loaded: true,
          commandStatus: "covered",
        }),
        expect.objectContaining({
          owner: "shared-services",
          kind: "api",
          loaded: true,
          generatedStatus: expect.stringMatching(/^(present|stale)$/u),
        }),
      ]),
    );
    expect(report.summary.loaded).toBeGreaterThan(0);
  });

  it("reports workspace readiness from the workspace manifest", () => {
    const manifestPath = path.join(workspaceRoot, "docs/regent-workspace.yaml");
    const report = buildWorkspaceDoctorReport(undefined, { manifestPath });

    expect(report.command).toBe("regents doctor workspace");
    expect(report.manifestPath).toBe(manifestPath);
    expect(report.repos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "regents-cli", loaded: true, requiredForPublicBeta: true }),
        expect.objectContaining({ name: "design-system", loaded: true, requiredForPublicBeta: true }),
      ]),
    );
    expect(report.walletActionSchemaLoaded).toBe(true);
    expect(report.moneyMovementRows).toBeGreaterThan(0);
  });

  it("reports a clear failure when the workspace manifest is missing", () => {
    const manifestPath = path.join(os.tmpdir(), "regent-missing-workspace.yaml");

    expect(() => buildContractDoctorReport(undefined, { manifestPath })).toThrow(
      `Regent workspace manifest is missing: ${manifestPath}`,
    );
  });

  it("does not match extra words unless the route declares them", () => {
    const exact = route("techtree status", async () => 0);
    const variadic = route("doctor", async () => 0, { variadicTail: true });

    expect(routeMatches(exact, ["techtree", "status"])).toBe(true);
    expect(routeMatches(exact, ["techtree", "status", "extra"])).toBe(false);
    expect(routeMatches(variadic, ["doctor", "auth"])).toBe(true);
  });
});
