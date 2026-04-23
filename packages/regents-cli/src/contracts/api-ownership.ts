import type { paths as AutolaunchPaths } from "../generated/autolaunch-openapi.js";
import type { paths as PlatformPaths } from "../generated/platform-openapi.js";
import type { paths as RegentServicePaths } from "../generated/regent-services-openapi.js";
import type { paths as TechtreePaths } from "../generated/techtree-openapi.js";

export type ApiContractOwner = "techtree" | "autolaunch" | "platform" | "shared-services";
export type ApiCommandStatus = "current" | "current-hybrid" | "stale" | "remove-before-freeze";

export interface ApiCommandGroup {
  readonly commands: readonly string[];
  readonly owner: ApiContractOwner;
  readonly status: ApiCommandStatus;
  readonly note?: string;
  readonly pathTemplates: readonly string[];
}

const defineTechtreeGroup = <
  const TPaths extends readonly (keyof TechtreePaths)[],
>(
  group: Omit<ApiCommandGroup, "pathTemplates"> & {
    readonly pathTemplates: TPaths;
  },
) => group;

const defineAutolaunchGroup = <
  const TPaths extends readonly (keyof AutolaunchPaths)[],
>(
  group: Omit<ApiCommandGroup, "pathTemplates"> & {
    readonly pathTemplates: TPaths;
  },
) => group;

const definePlatformGroup = <
  const TPaths extends readonly (keyof PlatformPaths)[],
>(
  group: Omit<ApiCommandGroup, "pathTemplates"> & {
    readonly pathTemplates: TPaths;
  },
) => group;

const defineSharedServicesGroup = <
  const TPaths extends readonly ((keyof RegentServicePaths) | (keyof PlatformPaths))[],
>(
  group: Omit<ApiCommandGroup, "pathTemplates"> & {
    readonly pathTemplates: TPaths;
  },
) => group;

export const techtreeApiCommandGroups = [
  defineTechtreeGroup({
    commands: ["techtree activity", "techtree search", "techtree nodes list"],
    owner: "techtree",
    status: "current",
    pathTemplates: ["/v1/tree/activity", "/v1/tree/search", "/v1/tree/nodes"],
  }),
  defineTechtreeGroup({
    commands: [
      "techtree node get",
      "techtree node children",
      "techtree node comments",
      "techtree node work-packet",
      "techtree node lineage list",
      "techtree node lineage claim",
      "techtree node lineage withdraw",
      "techtree node cross-chain-links list",
      "techtree node cross-chain-links create",
      "techtree node cross-chain-links clear",
      "techtree node create",
      "techtree comment add",
    ],
    owner: "techtree",
    status: "current",
    pathTemplates: [
      "/v1/tree/nodes/{id}",
      "/v1/tree/nodes/{id}/children",
      "/v1/tree/nodes/{id}/comments",
      "/v1/tree/nodes/{id}/lineage",
      "/v1/agent/tree/nodes/{id}/lineage",
      "/v1/agent/tree/nodes/{id}/lineage/claims",
      "/v1/tree/nodes/{id}/lineage/claims",
      "/v1/tree/nodes/{id}/lineage/claims/{claim_id}",
      "/v1/agent/tree/nodes/{id}/cross-chain-links",
      "/v1/tree/nodes/{id}/cross-chain-links",
      "/v1/tree/nodes/{id}/cross-chain-links/current",
      "/v1/tree/nodes",
      "/v1/tree/comments",
      "/v1/tree/nodes/{id}/work-packet",
    ],
  }),
  defineTechtreeGroup({
    commands: [
      "techtree watch",
      "techtree watch list",
      "techtree unwatch",
      "techtree star",
      "techtree unstar",
      "techtree inbox",
      "techtree opportunities",
    ],
    owner: "techtree",
    status: "current",
    pathTemplates: [
      "/v1/agent/watches",
      "/v1/tree/nodes/{id}/watch",
      "/v1/tree/nodes/{id}/star",
      "/v1/agent/inbox",
      "/v1/agent/opportunities",
    ],
  }),
  defineTechtreeGroup({
    commands: [
      "techtree autoskill publish skill",
      "techtree autoskill publish eval",
      "techtree autoskill publish result",
      "techtree autoskill review",
      "techtree autoskill listing create",
      "techtree autoskill buy",
      "techtree autoskill pull",
    ],
    owner: "techtree",
    status: "current",
    pathTemplates: [
      "/v1/agent/autoskill/skills",
      "/v1/agent/autoskill/evals",
      "/v1/agent/autoskill/results",
      "/v1/agent/autoskill/reviews/community",
      "/v1/agent/autoskill/reviews/replicable",
      "/v1/agent/autoskill/versions/{id}/listings",
      "/v1/agent/autoskill/versions/{id}/bundle",
      "/v1/agent/tree/nodes/{id}/payload",
      "/v1/agent/tree/nodes/{id}/purchases",
    ],
  }),
  defineTechtreeGroup({
    commands: [
      "techtree science-tasks list",
      "techtree science-tasks get",
      "techtree science-tasks init",
      "techtree science-tasks checklist",
      "techtree science-tasks evidence",
      "techtree science-tasks export",
      "techtree science-tasks submit",
      "techtree science-tasks review-update",
    ],
    owner: "techtree",
    status: "current",
    pathTemplates: [
      "/v1/science-tasks",
      "/v1/science-tasks/{id}",
      "/v1/agent/science-tasks",
      "/v1/agent/science-tasks/{id}/checklist",
      "/v1/agent/science-tasks/{id}/evidence",
      "/v1/agent/science-tasks/{id}/submit",
      "/v1/agent/science-tasks/{id}/review-update",
    ],
  }),
  defineTechtreeGroup({
    commands: [
      "techtree reviewer orcid link",
      "techtree reviewer apply",
      "techtree reviewer status",
      "techtree review list",
      "techtree review claim",
      "techtree review submit",
      "techtree certificate verify",
      "techtree bbh leaderboard",
      "techtree bbh capsules list",
      "techtree bbh capsules get",
      "techtree bbh run solve",
      "techtree bbh draft create",
      "techtree bbh draft list",
      "techtree bbh draft propose",
      "techtree bbh draft proposals",
      "techtree bbh draft apply",
      "techtree bbh draft ready",
      "techtree bbh genome propose",
      "techtree bbh submit",
      "techtree bbh validate",
      "techtree bbh sync",
    ],
    owner: "techtree",
    status: "current",
    pathTemplates: [
      "/v1/bbh/leaderboard",
      "/v1/bbh/capsules",
      "/v1/bbh/capsules/{id}",
      "/v1/bbh/capsules/{id}/certificate",
      "/v1/agent/bbh/drafts",
      "/v1/agent/bbh/drafts/{id}",
      "/v1/agent/bbh/drafts/{id}/proposals",
      "/v1/agent/bbh/drafts/{id}/proposals/{proposal_id}/apply",
      "/v1/agent/bbh/drafts/{id}/ready",
      "/v1/agent/bbh/runs",
      "/v1/agent/bbh/validations",
      "/v1/agent/bbh/sync",
      "/v1/agent/reviewer/orcid/link/start",
      "/v1/agent/reviewer/orcid/link/status/{request_id}",
      "/v1/agent/reviewer/apply",
      "/v1/agent/reviewer/me",
      "/v1/agent/reviews/open",
      "/v1/agent/reviews/{request_id}/claim",
      "/v1/agent/reviews/{request_id}/submit",
    ],
  }),
  defineTechtreeGroup({
    commands: [
      "techtree main artifact pin",
      "techtree main artifact publish",
      "techtree main run pin",
      "techtree main run publish",
      "techtree main review pin",
      "techtree main review publish",
      "techtree main fetch",
      "techtree main verify",
      "techtree bbh fetch",
      "techtree bbh verify",
      "techtree bbh draft pull",
      "techtree review pull",
    ],
    owner: "techtree",
    status: "current-hybrid",
    note: "Local workspace workflow plus still-live backend endpoints.",
    pathTemplates: [
      "/v1/runtime/nodes/{id}",
      "/v1/runtime/pin",
      "/v1/runtime/publish/submit",
      "/v1/agent/bbh/drafts/{id}",
      "/v1/agent/reviews/{request_id}/packet",
    ],
  }),
] as const;

export const autolaunchApiCommandGroups = [
  defineAutolaunchGroup({
    commands: ["autolaunch agents list", "autolaunch agent <id>", "autolaunch agent readiness <id>"],
    owner: "autolaunch",
    status: "current",
    pathTemplates: ["/api/agents", "/api/agents/{id}", "/api/agents/{id}/readiness"],
  }),
  defineAutolaunchGroup({
    commands: ["autolaunch trust x-link"],
    owner: "autolaunch",
    status: "current-hybrid",
    note: "Local-only helper while the public Autolaunch contract does not yet publish the X-link route.",
    pathTemplates: [],
  }),
  defineAutolaunchGroup({
    commands: [
      "autolaunch prelaunch wizard",
      "autolaunch prelaunch show",
      "autolaunch prelaunch validate",
      "autolaunch prelaunch publish",
    ],
    owner: "autolaunch",
    status: "current-hybrid",
    pathTemplates: [
      "/api/prelaunch/plans",
      "/api/prelaunch/plans/{id}",
      "/api/prelaunch/plans/{id}/validate",
      "/api/prelaunch/plans/{id}/publish",
      "/api/prelaunch/assets",
      "/api/prelaunch/plans/{id}/metadata",
      "/api/prelaunch/plans/{id}/metadata-preview",
    ],
  }),
  defineAutolaunchGroup({
    commands: [
      "autolaunch launch run",
      "autolaunch launch monitor",
      "autolaunch launch finalize",
      "autolaunch jobs watch",
      "autolaunch vesting status",
      "autolaunch vesting release",
      "autolaunch vesting propose-beneficiary-rotation",
      "autolaunch vesting cancel-beneficiary-rotation",
      "autolaunch vesting execute-beneficiary-rotation",
    ],
    owner: "autolaunch",
    status: "current-hybrid",
    pathTemplates: [
      "/api/launch/jobs/{id}",
      "/api/lifecycle/jobs/{id}",
      "/api/lifecycle/jobs/{id}/finalize/prepare",
      "/api/lifecycle/jobs/{id}/finalize/register",
      "/api/lifecycle/jobs/{id}/vesting",
      "/api/contracts/jobs/{id}/{resource}/{action}/prepare",
    ],
  }),
  defineAutolaunchGroup({
    commands: [
      "autolaunch auctions list",
      "autolaunch auction-returns list",
      "autolaunch auction <id>",
      "autolaunch bids quote",
      "autolaunch bids place",
      "autolaunch bids mine",
      "autolaunch bids exit",
      "autolaunch bids claim",
      "autolaunch positions list",
      "autolaunch positions return-usdc",
      "autolaunch positions exit",
      "autolaunch positions claim",
    ],
    owner: "autolaunch",
    status: "current",
    pathTemplates: [
      "/api/auctions",
      "/api/auction-returns",
      "/api/auctions/{id}",
      "/api/auctions/{id}/bid_quote",
      "/api/auctions/{id}/bids",
      "/api/me/bids",
      "/api/bids/{id}/return-usdc" as keyof AutolaunchPaths,
      "/api/bids/{id}/exit",
      "/api/bids/{id}/claim",
    ],
  }),
  defineAutolaunchGroup({
    commands: [
      "autolaunch subjects show",
      "autolaunch subjects ingress",
      "autolaunch subjects stake",
      "autolaunch subjects unstake",
      "autolaunch subjects claim-usdc",
      "autolaunch subjects claim-emissions",
      "autolaunch subjects claim-and-stake-emissions",
      "autolaunch subjects sweep-ingress",
      "autolaunch holdings list",
      "autolaunch holdings stake",
      "autolaunch holdings unstake",
      "autolaunch holdings claim-usdc",
      "autolaunch holdings claim-emissions",
      "autolaunch holdings claim-and-stake-emissions",
      "autolaunch holdings sweep-ingress",
    ],
    owner: "autolaunch",
    status: "current",
    pathTemplates: [
      "/api/subjects/{id}",
      "/api/subjects/{id}/ingress",
      "/api/subjects/{id}/stake",
      "/api/subjects/{id}/unstake",
      "/api/subjects/{id}/claim-usdc",
      "/api/subjects/{id}/claim-emissions",
      "/api/subjects/{id}/claim-and-stake-emissions",
      "/api/subjects/{id}/ingress/{address}/sweep",
      "/api/me/holdings",
    ],
  }),
  defineAutolaunchGroup({
    commands: ["autolaunch ens plan", "autolaunch ens prepare-ensip25", "autolaunch ens prepare-erc8004", "autolaunch ens prepare-bidirectional"],
    owner: "autolaunch",
    status: "current",
    pathTemplates: ["/api/ens/link/plan", "/api/ens/link/prepare-ensip25", "/api/ens/link/prepare-erc8004", "/api/ens/link/prepare-bidirectional"],
  }),
  defineAutolaunchGroup({
    commands: [
      "autolaunch contracts admin",
      "autolaunch contracts job",
      "autolaunch contracts subject",
      "autolaunch strategy migrate",
      "autolaunch strategy sweep-token",
      "autolaunch strategy sweep-currency",
      "autolaunch fee-registry show",
      "autolaunch fee-vault show",
      "autolaunch fee-vault withdraw-treasury",
      "autolaunch fee-vault withdraw-regent",
      "autolaunch splitter show",
      "autolaunch splitter set-paused",
      "autolaunch splitter set-label",
      "autolaunch splitter propose-treasury-recipient-rotation",
      "autolaunch splitter cancel-treasury-recipient-rotation",
      "autolaunch splitter execute-treasury-recipient-rotation",
      "autolaunch splitter set-protocol-recipient",
      "autolaunch splitter sweep-treasury-residual",
      "autolaunch splitter sweep-protocol-reserve",
      "autolaunch splitter reassign-dust",
      "autolaunch ingress create",
      "autolaunch ingress set-default",
      "autolaunch ingress set-label",
      "autolaunch ingress rescue",
      "autolaunch registry show",
      "autolaunch registry set-subject-manager",
      "autolaunch registry link-identity",
      "autolaunch registry rotate-safe",
      "autolaunch factory revenue-share set-authorized-creator",
      "autolaunch factory revenue-ingress set-authorized-creator",
    ],
    owner: "autolaunch",
    status: "current",
    pathTemplates: [
      "/api/contracts/admin",
      "/api/contracts/jobs/{id}",
      "/api/contracts/subjects/{id}",
      "/api/contracts/jobs/{id}/{resource}/{action}/prepare",
      "/api/contracts/subjects/{id}/{resource}/{action}/prepare",
      "/api/contracts/admin/{resource}/{action}/prepare",
    ],
  }),
] as const;

export const platformApiCommandGroups = [
  definePlatformGroup({
    commands: ["agentbook register", "agentbook sessions watch", "agentbook lookup"],
    owner: "platform",
    status: "current",
    pathTemplates: [
      "/api/agentbook/sessions",
      "/api/agentbook/sessions/{id}",
      "/api/agentbook/lookup",
    ],
  }),
] as const;

export const sharedServicesApiCommandGroups = [
  defineSharedServicesGroup({
    commands: ["identity status"],
    owner: "shared-services",
    status: "current",
    pathTemplates: ["/v1/identity/status"],
  }),
  defineSharedServicesGroup({
    commands: ["identity ensure"],
    owner: "shared-services",
    status: "current",
    pathTemplates: [
      "/v1/identity/status",
      "/v1/identity/registration-intents",
      "/v1/identity/registration-completions",
      "/v1/identity/siwa/nonce",
      "/v1/identity/siwa/verify",
    ],
  }),
  defineSharedServicesGroup({
    commands: [
      "regent-staking show",
      "regent-staking account",
      "regent-staking stake",
      "regent-staking unstake",
      "regent-staking claim-usdc",
      "regent-staking claim-regent",
      "regent-staking claim-and-restake-regent",
    ],
    owner: "shared-services",
    status: "current",
    pathTemplates: [
      "/v1/agent/regent/staking",
      "/v1/agent/regent/staking/account/{address}",
      "/v1/agent/regent/staking/stake",
      "/v1/agent/regent/staking/unstake",
      "/v1/agent/regent/staking/claim-usdc",
      "/v1/agent/regent/staking/claim-regent",
      "/v1/agent/regent/staking/claim-and-restake-regent",
    ],
  }),
  defineSharedServicesGroup({
    commands: ["bug", "security-report"],
    owner: "shared-services",
    status: "current",
    pathTemplates: ["/v1/agent/bug-report", "/v1/agent/security-report"],
  }),
  defineSharedServicesGroup({
    commands: ["ens set-primary"],
    owner: "shared-services",
    status: "current",
    pathTemplates: ["/api/agent-platform/ens/prepare-primary"],
  }),
] as const;

export const apiCommandOwnership = [
  ...techtreeApiCommandGroups,
  ...autolaunchApiCommandGroups,
  ...platformApiCommandGroups,
  ...sharedServicesApiCommandGroups,
] as const;
