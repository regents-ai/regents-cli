import path from "node:path";

import { describe, expect, it } from "vitest";

import { cliCommandContractFiles, cliCommandOpenApiFiles } from "../src/workspace/manifest.js";

const workspaceRoot = path.resolve(path.sep, "tmp", "regent-workspace-manifest-test");
const cliRoot = path.join(workspaceRoot, "regents-cli");

describe("workspace manifest", () => {
  it("returns the CLI command check OpenAPI files by owner", () => {
    const files = cliCommandOpenApiFiles(
      {
        repos: {
          "regents-cli": {
            path: "regents-cli",
            api_contracts: [
              {
                id: "shared_services_api",
                owner: "shared-services",
                path: "docs/regent-services-contract.openapiv3.yaml",
                include_in_cli_command_check: true,
              },
            ],
          },
        },
      },
      cliRoot,
    );

    expect(files).toEqual({
      "shared-services": path.join(cliRoot, "docs/regent-services-contract.openapiv3.yaml"),
    });
  });

  it("rejects duplicate OpenAPI owners for CLI command checks", () => {
    expect(() =>
      cliCommandOpenApiFiles(
        {
          repos: {
            "regents-cli": {
            path: "regents-cli",
              api_contracts: [
                {
                  id: "shared_services_api",
                  owner: "shared-services",
                  path: "docs/regent-services-contract.openapiv3.yaml",
                  include_in_cli_command_check: true,
                },
                {
                  id: "shared_services_api_copy",
                  owner: "shared-services",
                  path: "docs/regent-services-contract-copy.openapiv3.yaml",
                  include_in_cli_command_check: true,
                },
              ],
            },
          },
        },
        cliRoot,
      ),
    ).toThrow("multiple api contracts marked for CLI command checks for owner shared-services");
  });

  it("rejects duplicate CLI contract owners for CLI command checks", () => {
    expect(() =>
      cliCommandContractFiles(
        {
          repos: {
            "regents-cli": {
            path: "regents-cli",
              cli_contracts: [
                {
                  id: "shared_cli",
                  owner: "shared-services",
                  path: "docs/shared-cli-contract.yaml",
                  include_in_cli_command_check: true,
                },
                {
                  id: "shared_cli_copy",
                  owner: "shared-services",
                  path: "docs/shared-cli-contract-copy.yaml",
                  include_in_cli_command_check: true,
                },
              ],
            },
          },
        },
        cliRoot,
      ),
    ).toThrow("multiple cli contracts marked for CLI command checks for owner shared-services");
  });
});
