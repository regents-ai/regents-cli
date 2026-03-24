import type {
  BbhLeaderboardResponse,
  RegentAgentHarnessSummary,
  RegentAgentProfileKind,
  RegentAgentProfileSummary,
  RegentAgentRuntimeState,
  RegentAgentStatus,
  RegentConfig,
  RegentExecutorHarnessKind,
  RegentResolvedRunMetadata,
  RegentRunExecutorHarness,
  RegentRunMetadata,
  RegentRunOrigin,
  TechtreeFetchRequest,
  TechtreeFetchResponse,
  TechtreePinRequest,
  TechtreePinResponse,
  TechtreePublishRequest,
  TechtreePublishResponse,
  TechtreeTreeName,
  TechtreeWorkspaceActionResult,
} from "../../internal-types/index.js";

import type { SessionStore } from "../store/session-store.js";
import type { StateStore } from "../store/state-store.js";
import { getCurrentAgentIdentity } from "./profile.js";
import { runTechtreeCoreJson, type TechtreeCoreEntrypoint } from "../techtree/core.js";
import type { TechtreeClient } from "../techtree/client.js";
import { TechtreeV1Client } from "../techtree/v1-client.js";

export interface AgentHarnessAdapter {
  init(): Promise<RegentAgentStatus>;
  status(): Promise<RegentAgentStatus>;
  listProfiles(): Promise<RegentAgentProfileSummary[]>;
  showProfile(profile?: string): Promise<RegentAgentProfileSummary>;
  listHarnesses(): Promise<RegentAgentHarnessSummary[]>;
  resolveRunMetadata(hints?: RegentRunMetadata | null): RegentResolvedRunMetadata;
}

export interface WorkloadAdapter {
  runExec(input: {
    tree: TechtreeTreeName;
    workspace_path: string;
    metadata?: RegentRunMetadata | null;
  }): Promise<TechtreeWorkspaceActionResult>;

  reviewExec(input: {
    tree: TechtreeTreeName;
    workspace_path: string;
    metadata?: RegentRunMetadata | null;
  }): Promise<TechtreeWorkspaceActionResult>;
}

export interface AgentRouter {
  init(): Promise<RegentAgentStatus>;
  status(): Promise<RegentAgentStatus>;
  listProfiles(): Promise<RegentAgentProfileSummary[]>;
  showProfile(profile?: string): Promise<RegentAgentProfileSummary>;
  listHarnesses(): Promise<RegentAgentHarnessSummary[]>;
  resolveRunMetadata(hints?: RegentRunMetadata | null): RegentResolvedRunMetadata;
}

export interface TechtreePublisher {
  health(): Promise<Record<string, unknown>>;
  fetchNode(input: TechtreeFetchRequest): Promise<TechtreeFetchResponse>;
  pinNode(input: TechtreePinRequest): Promise<TechtreePinResponse>;
  publishNode(input: TechtreePublishRequest): Promise<TechtreePublishResponse>;
  getBbhLeaderboard(params?: { split?: "climb" | "benchmark" | "challenge" | "draft" }): Promise<BbhLeaderboardResponse>;
}

export class TechtreeV1PublisherAdapter implements TechtreePublisher {
  constructor(
    private readonly techtree: TechtreeClient,
    private readonly v1Client: TechtreeV1Client,
  ) {}

  health(): Promise<Record<string, unknown>> {
    return this.techtree.health();
  }

  fetchNode(input: TechtreeFetchRequest): Promise<TechtreeFetchResponse> {
    return this.v1Client.fetchNode(input);
  }

  pinNode(input: TechtreePinRequest): Promise<TechtreePinResponse> {
    return this.v1Client.pinNode(input);
  }

  publishNode(input: TechtreePublishRequest): Promise<TechtreePublishResponse> {
    return this.v1Client.publishNode(input);
  }

  getBbhLeaderboard(params?: { split?: "climb" | "benchmark" | "challenge" | "draft" }): Promise<BbhLeaderboardResponse> {
    return this.v1Client.getBbhLeaderboard(params);
  }
}

const defaultRunMetadata = (config: RegentConfig): RegentRunMetadata => {
  const defaultHarnessKind = config.workloads.bbh.defaultHarness ?? config.agents.defaultHarness;
  const harness = config.agents.harnesses[defaultHarnessKind];

  return {
    executor_harness: {
      kind: defaultHarnessKind,
      profile: config.workloads.bbh.defaultProfile,
      entrypoint: harness?.entrypoint ?? "regent agent init",
    },
    origin: {
      kind: "local",
      transport: "api",
      session_id: null,
      trigger_ref: "regent agent init",
    },
  };
};

const nowIso = (): string => new Date().toISOString();

const cloneRunExecutorHarness = (
  executorHarness: RegentRunExecutorHarness,
): RegentRunExecutorHarness => ({
  kind: executorHarness.kind,
  profile: executorHarness.profile,
  ...(executorHarness.entrypoint === undefined ? {} : { entrypoint: executorHarness.entrypoint }),
});

const cloneRunOrigin = (origin: RegentRunOrigin): RegentRunOrigin => ({
  kind: origin.kind,
  ...(origin.transport === undefined ? {} : { transport: origin.transport }),
  ...(origin.session_id === undefined ? {} : { session_id: origin.session_id }),
  ...(origin.trigger_ref === undefined ? {} : { trigger_ref: origin.trigger_ref }),
});

const cloneRunMetadata = (metadata: RegentRunMetadata): RegentRunMetadata => ({
  executor_harness: cloneRunExecutorHarness(metadata.executor_harness),
  origin: cloneRunOrigin(metadata.origin),
});

const resolvedRunMetadata = (metadata: RegentRunMetadata): RegentResolvedRunMetadata => {
  const clonedMetadata = cloneRunMetadata(metadata);

  return {
    resolved_at: nowIso(),
    executor_harness: clonedMetadata.executor_harness,
    origin: clonedMetadata.origin,
    executor_harness_kind: metadata.executor_harness.kind,
    executor_harness_profile: metadata.executor_harness.profile,
    origin_session_id: metadata.origin.session_id ?? null,
  };
};

const runtimeStateFromMetadata = (metadata: RegentRunMetadata): RegentAgentRuntimeState => ({
  ...resolvedRunMetadata(metadata),
  initializedAt: nowIso(),
});

const agentRuntimeState = (stateStore: StateStore): RegentAgentRuntimeState | null => {
  return stateStore.read().agentRuntime ?? null;
};

const defaultState = (config: RegentConfig): RegentAgentRuntimeState =>
  runtimeStateFromMetadata(defaultRunMetadata(config));

const profileKind = (name: string): RegentAgentProfileKind => {
  if (name === "owner" || name === "public" || name === "group") {
    return name;
  }

  return "custom";
};

const harnessLabel = (kind: RegentExecutorHarnessKind): string => {
  if (kind === "openclaw") {
    return "OpenClaw executor harness";
  }
  if (kind === "hermes") {
    return "Hermes executor harness";
  }
  if (kind === "claude_code") {
    return "Claude Code executor harness";
  }

  return "Custom executor harness";
};

const profileLabel = (name: string): string => {
  if (name === "owner") {
    return "Owner agent profile";
  }
  if (name === "public") {
    return "Public agent profile";
  }
  if (name === "group") {
    return "Group agent profile";
  }

  return "Custom agent profile";
};

const configuredProfiles = (config: RegentConfig, activeProfile: string): string[] =>
  Array.from(
    new Set([
      "owner",
      "public",
      "group",
      config.workloads.bbh.defaultProfile,
      activeProfile,
      ...Object.values(config.agents.harnesses).flatMap((harness) => harness.profiles),
    ]),
  );

const profileSummaries = (
  state: RegentAgentRuntimeState,
  config: RegentConfig,
): RegentAgentProfileSummary[] => {
  const activeProfile = state.executor_harness.profile;
  const harness = state.executor_harness;
  const origin = state.origin;

  return configuredProfiles(config, activeProfile).map((name) => ({
    name,
    kind: profileKind(name),
    label: profileLabel(name),
    active: activeProfile === name,
    executor_harness_kind: harness.kind,
    executor_harness_profile: name,
    origin_session_id: origin.session_id ?? null,
    executor_harness: {
      kind: harness.kind,
      profile: name,
      entrypoint: harness.entrypoint ?? null,
    },
    origin: {
      kind: origin.kind,
      transport: origin.transport ?? null,
      session_id: origin.session_id ?? null,
      trigger_ref: origin.trigger_ref ?? null,
    },
  }));
};

const harnessSummaries = (
  state: RegentAgentRuntimeState,
  config: RegentConfig,
): RegentAgentHarnessSummary[] => {
  const activeHarness = state.executor_harness.kind;
  const profile = state.executor_harness.profile;
  const origin = state.origin;

  return Object.entries(config.agents.harnesses).map(([name, harness]) => {
    const kind = name as RegentExecutorHarnessKind;

    return {
      name,
      kind,
      label: harnessLabel(kind),
      active: activeHarness === kind,
      executor_harness_kind: kind,
      executor_harness_profile: profile,
      origin_session_id: origin.session_id ?? null,
      executor_harness: {
        kind,
        profile,
        entrypoint: harness.entrypoint,
      },
      origin: {
        kind: origin.kind,
        transport: origin.transport ?? null,
        session_id: origin.session_id ?? null,
        trigger_ref: origin.trigger_ref ?? null,
      },
    };
  });
};

const stateToResolvedMetadata = (state: RegentAgentRuntimeState): RegentResolvedRunMetadata => ({
  resolved_at: state.resolved_at,
  executor_harness: cloneRunExecutorHarness(state.executor_harness),
  origin: cloneRunOrigin(state.origin),
  executor_harness_kind: state.executor_harness_kind,
  executor_harness_profile: state.executor_harness_profile,
  origin_session_id: state.origin_session_id,
});

const mergeRunMetadata = (
  base: RegentRunMetadata,
  override?: RegentRunMetadata | null,
): RegentRunMetadata => ({
  executor_harness: {
    kind: override?.executor_harness?.kind ?? base.executor_harness.kind,
    profile: override?.executor_harness?.profile ?? base.executor_harness.profile,
    entrypoint:
      override?.executor_harness?.entrypoint !== undefined
        ? override.executor_harness.entrypoint
        : base.executor_harness.entrypoint ?? null,
  },
  origin: {
    kind: override?.origin?.kind ?? base.origin.kind,
    transport:
      override?.origin?.transport !== undefined ? override.origin.transport : base.origin.transport ?? null,
    session_id:
      override?.origin?.session_id !== undefined ? override.origin.session_id : base.origin.session_id ?? null,
    trigger_ref:
      override?.origin?.trigger_ref !== undefined ? override.origin.trigger_ref : base.origin.trigger_ref ?? null,
  },
});

export class ConfigAgentHarnessAdapter implements AgentHarnessAdapter {
  constructor(
    private readonly config: RegentConfig,
    private readonly stateStore: StateStore,
    private readonly _sessionStore: SessionStore,
  ) {}

  async init(): Promise<RegentAgentStatus> {
    const current = agentRuntimeState(this.stateStore);
    if (!current) {
      this.stateStore.patch({ agentRuntime: defaultState(this.config) });
    }

    return this.status();
  }

  async status(): Promise<RegentAgentStatus> {
    const state = agentRuntimeState(this.stateStore);
    const activeState = state ?? defaultState(this.config);
    const profiles = profileSummaries(activeState, this.config);
    const harnesses = harnessSummaries(activeState, this.config);
    const currentProfile = profiles.find((profile) => profile.active) ?? null;
    const currentHarness = harnesses.find((harness) => harness.active) ?? null;

    return {
      initialized: state !== null,
      state,
      identity: getCurrentAgentIdentity(this.stateStore),
      currentProfile,
      currentHarness,
      currentOrigin: activeState.origin,
      profiles,
      harnesses,
      resolvedMetadata: state ? stateToResolvedMetadata(state) : stateToResolvedMetadata(activeState),
    };
  }

  listProfiles(): Promise<RegentAgentProfileSummary[]> {
    return Promise.resolve(
      profileSummaries(agentRuntimeState(this.stateStore) ?? defaultState(this.config), this.config),
    );
  }

  async showProfile(profile?: string): Promise<RegentAgentProfileSummary> {
    const summaries = profileSummaries(
      agentRuntimeState(this.stateStore) ?? defaultState(this.config),
      this.config,
    );
    const resolved = profile ?? summaries.find((item) => item.active)?.name ?? "owner";
    const found = summaries.find((item) => item.name === resolved);
    if (!found) {
      throw new Error(`unknown agent profile: ${resolved}`);
    }

    return found;
  }

  listHarnesses(): Promise<RegentAgentHarnessSummary[]> {
    return Promise.resolve(
      harnessSummaries(agentRuntimeState(this.stateStore) ?? defaultState(this.config), this.config),
    );
  }

  resolveRunMetadata(hints?: RegentRunMetadata | null): RegentResolvedRunMetadata {
    const currentState = agentRuntimeState(this.stateStore);
    const baseState = currentState ?? defaultState(this.config);
    const baseMetadata = {
      executor_harness: {
        kind: baseState.executor_harness.kind,
        profile: baseState.executor_harness.profile,
        entrypoint: baseState.executor_harness.entrypoint ?? null,
      },
      origin: {
        kind: baseState.origin.kind,
        transport: baseState.origin.transport ?? null,
        session_id: baseState.origin.session_id ?? null,
        trigger_ref: baseState.origin.trigger_ref ?? null,
      },
    } satisfies RegentRunMetadata;

    const resolved = mergeRunMetadata(baseMetadata, hints);
    return resolvedRunMetadata(resolved);
  }
}

export class CoreWorkloadAdapter implements WorkloadAdapter {
  async runExec(input: {
    tree: TechtreeTreeName;
    workspace_path: string;
    metadata?: RegentRunMetadata | null;
  }): Promise<TechtreeWorkspaceActionResult> {
    return runTechtreeCoreJson<TechtreeWorkspaceActionResult>(
      "run.exec" satisfies TechtreeCoreEntrypoint,
      {
        tree: input.tree,
        workspace_path: input.workspace_path,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      { cwd: input.workspace_path },
    );
  }

  async reviewExec(input: {
    tree: TechtreeTreeName;
    workspace_path: string;
    metadata?: RegentRunMetadata | null;
  }): Promise<TechtreeWorkspaceActionResult> {
    return runTechtreeCoreJson<TechtreeWorkspaceActionResult>(
      "review.exec" satisfies TechtreeCoreEntrypoint,
      {
        tree: input.tree,
        workspace_path: input.workspace_path,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      { cwd: input.workspace_path },
    );
  }
}

export class DefaultAgentRouter implements AgentRouter {
  constructor(private readonly harness: AgentHarnessAdapter) {}

  init(): Promise<RegentAgentStatus> {
    return this.harness.init();
  }

  status(): Promise<RegentAgentStatus> {
    return this.harness.status();
  }

  listProfiles(): Promise<RegentAgentProfileSummary[]> {
    return this.harness.listProfiles();
  }

  showProfile(profile?: string): Promise<RegentAgentProfileSummary> {
    return this.harness.showProfile(profile);
  }

  listHarnesses(): Promise<RegentAgentHarnessSummary[]> {
    return this.harness.listHarnesses();
  }

  resolveRunMetadata(hints?: RegentRunMetadata | null): RegentResolvedRunMetadata {
    return this.harness.resolveRunMetadata(hints);
  }
}
