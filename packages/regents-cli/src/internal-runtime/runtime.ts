import path from "node:path";

import type { RegentConfig, RegentRpcMethod, RegentRpcResult, RuntimeStatus } from "../internal-types/index.js";

import {
  ConfigAgentHarnessAdapter,
  CoreWorkloadAdapter,
  DefaultAgentRouter,
  type AgentRouter,
  type TechtreePublisher,
  TechtreeV1PublisherAdapter,
  type WorkloadAdapter,
} from "./agent/seams.js";
import { EnvWalletSecretSource, FileWalletSecretSource, type WalletSecretSource } from "./agent/key-store.js";
import { loadConfig } from "./config.js";
import { JsonRpcError } from "./errors.js";
import {
  handleAgentHarnessList,
  handleAgentInit,
  handleAgentProfileList,
  handleAgentProfileShow,
  handleAgentStatus,
} from "./handlers/agent.js";
import {
  handleAuthSiwaLogin,
  handleAuthSiwaLogout,
  handleAuthSiwaStatus,
} from "./handlers/auth.js";
import { handleGossipsubStatus } from "./handlers/gossipsub.js";
import { handleRuntimePing, handleRuntimeShutdown, handleRuntimeStatus } from "./handlers/runtime.js";
import {
  handleTechtreeActivityList,
  handleTechtreeAutoskillBuy,
  handleTechtreeAutoskillInitEval,
  handleTechtreeAutoskillInitSkill,
  handleTechtreeAutoskillNotebookPair,
  handleTechtreeAutoskillListingCreate,
  handleTechtreeAutoskillPublishEval,
  handleTechtreeAutoskillPublishResult,
  handleTechtreeAutoskillPublishSkill,
  handleTechtreeAutoskillPull,
  handleTechtreeAutoskillReview,
  handleTechtreeCommentCreate,
  handleTechtreeInboxGet,
  handleTechtreeNodeChildren,
  handleTechtreeNodeComments,
  handleTechtreeNodeCrossChainLinksCreate,
  handleTechtreeNodeCrossChainLinksClear,
  handleTechtreeNodeCrossChainLinksList,
  handleTechtreeNodeCreate,
  handleTechtreeNodeGet,
  handleTechtreeNodeLineageClaim,
  handleTechtreeNodeLineageWithdraw,
  handleTechtreeNodeLineageList,
  handleTechtreeNodeWorkPacket,
  handleTechtreeNodesList,
  handleTechtreeScienceTasksGet,
  handleTechtreeScienceTasksChecklist,
  handleTechtreeScienceTasksEvidence,
  handleTechtreeScienceTasksExport,
  handleTechtreeScienceTasksInit,
  handleTechtreeScienceTasksList,
  handleTechtreeScienceTasksReviewLoop,
  handleTechtreeScienceTasksReviewUpdate,
  handleTechtreeScienceTasksSubmit,
  handleTechtreeOpportunitiesList,
  handleTechtreeSearchQuery,
  handleTechtreeStarCreate,
  handleTechtreeStarDelete,
  handleTechtreeStatus,
  handleTechtreeChatboxHistory,
  handleTechtreeChatboxPost,
  handleTechtreeV1ArtifactCompile,
  handleTechtreeV1ArtifactInit,
  handleTechtreeV1ArtifactPin,
  handleTechtreeV1ArtifactPublish,
  handleTechtreeV1BbhCapsulesGet,
  handleTechtreeV1BbhCapsulesList,
  handleTechtreeV1BbhDraftApply,
  handleTechtreeV1BbhDraftCreate,
  handleTechtreeV1BbhDraftInit,
  handleTechtreeV1BbhDraftList,
  handleTechtreeV1BbhDraftProposals,
  handleTechtreeV1BbhDraftPropose,
  handleTechtreeV1BbhDraftPull,
  handleTechtreeV1BbhDraftReady,
  handleTechtreeV1BbhAssignmentNext,
  handleTechtreeV1BbhGenomeImprove,
  handleTechtreeV1BbhGenomeInit,
  handleTechtreeV1BbhNotebookPair,
  handleTechtreeV1BbhGenomePropose,
  handleTechtreeV1BbhGenomeScore,
  handleTechtreeV1BbhRunExec,
  handleTechtreeV1BbhRunSolve,
  handleTechtreeV1BbhSubmit,
  handleTechtreeV1BbhValidate,
  handleTechtreeV1BbhLeaderboard,
  handleTechtreeV1BbhSync,
  handleTechtreeV1CertificateVerify,
  handleTechtreeV1Fetch,
  handleTechtreeV1ReviewClaim,
  handleTechtreeV1ReviewCompile,
  handleTechtreeV1ReviewExec,
  handleTechtreeV1ReviewInit,
  handleTechtreeV1ReviewList,
  handleTechtreeV1ReviewPin,
  handleTechtreeV1ReviewPull,
  handleTechtreeV1ReviewPublish,
  handleTechtreeV1ReviewSubmit,
  handleTechtreeV1ReviewerApply,
  handleTechtreeV1ReviewerOrcidLink,
  handleTechtreeV1ReviewerStatus,
  handleTechtreeV1RunCompile,
  handleTechtreeV1RunExec,
  handleTechtreeV1RunInit,
  handleTechtreeV1RunPin,
  handleTechtreeV1RunPublish,
  handleTechtreeV1Verify,
  handleTechtreeWatchCreate,
  handleTechtreeWatchDelete,
  handleTechtreeWatchList,
} from "./handlers/techtree.js";
import { handleXmtpStatus } from "./handlers/xmtp.js";
import { JsonRpcServer } from "./jsonrpc/server.js";
import { StateStore } from "./store/state-store.js";
import { SessionStore } from "./store/session-store.js";
import { TechtreeRuntimeClient } from "./techtree/runtime-client.js";
import { TechtreeClient } from "./techtree/client.js";
import {
  ManagedXmtpAdapter,
  PublicChatboxRelayAdapter,
  type TransportAdapter,
  type GossipsubAdapter,
  type XmtpAdapter,
  ChatboxRelaySocketServer,
  WatchedNodeRelay,
  WatchedNodeRelaySocketServer,
} from "./transports/index.js";
import { resolveChatboxRelaySocketPath } from "./transports/chatbox-relay-socket.js";

export interface RuntimeContext {
  config: RegentConfig;
  stateStore: StateStore;
  sessionStore: SessionStore;
  techtree: TechtreeClient;
  techtreePublisher: TechtreePublisher;
  walletSecretSource: WalletSecretSource;
  xmtp: XmtpAdapter;
  gossipsub: GossipsubAdapter;
  agentRouter: AgentRouter;
  workload: WorkloadAdapter;
  runtime: RegentRuntime;
  requestShutdown: () => void;
}

const createWalletSecretSource = (config: RegentConfig): WalletSecretSource => {
  const envVarName = config.wallet.privateKeyEnv;
  if (process.env[envVarName]) {
    return new EnvWalletSecretSource(envVarName);
  }

  return new FileWalletSecretSource(config.wallet.keystorePath);
};

const stopIgnoringErrors = async (stopper: { stop: () => Promise<void> }): Promise<void> => {
  await stopper.stop().catch(() => undefined);
};

const loadDoctorHandlers = async () => import("./handlers/doctor.js");

export class RegentRuntime {
  readonly configPath?: string;
  readonly config: RegentConfig;
  readonly stateStore: StateStore;
  readonly sessionStore: SessionStore;
  readonly walletSecretSource: WalletSecretSource;
  readonly techtree: TechtreeClient;
  readonly techtreePublisher: TechtreePublisher;
  readonly xmtp: XmtpAdapter;
  readonly gossipsub: GossipsubAdapter;
  readonly agentRouter: AgentRouter;
  readonly workload: WorkloadAdapter;
  readonly chatboxRelaySocketServer: ChatboxRelaySocketServer;
  readonly watchedNodeRelay: WatchedNodeRelay;
  readonly watchedNodeRelaySocketServer: WatchedNodeRelaySocketServer;
  readonly jsonRpcServer: JsonRpcServer;

  private started = false;
  private shutdownRequested = false;

  constructor(configPath?: string) {
    this.configPath = configPath;
    this.config = loadConfig(configPath);
    this.stateStore = new StateStore(path.join(this.config.runtime.stateDir, "runtime-state.json"));
    this.sessionStore = new SessionStore(this.stateStore);
    this.walletSecretSource = createWalletSecretSource(this.config);
    this.techtree = new TechtreeClient({
      config: this.config,
      baseUrl: this.config.services.techtree.baseUrl,
      requestTimeoutMs: this.config.services.techtree.requestTimeoutMs,
      sessionStore: this.sessionStore,
      walletSecretSource: this.walletSecretSource,
      stateStore: this.stateStore,
    });
    this.techtreePublisher = new TechtreeV1PublisherAdapter(
      this.techtree,
      new TechtreeRuntimeClient({
        baseUrl: this.config.services.techtree.baseUrl,
        requestTimeoutMs: this.config.services.techtree.requestTimeoutMs,
        config: this.config,
      }),
    );
    this.xmtp = new ManagedXmtpAdapter(this.config.xmtp);
    this.watchedNodeRelay = new WatchedNodeRelay(this.techtree);
    this.gossipsub = new PublicChatboxRelayAdapter(
      this.config.gossipsub,
      this.techtree,
      resolveChatboxRelaySocketPath(this.config.runtime.socketPath),
    );
    this.chatboxRelaySocketServer = new ChatboxRelaySocketServer(
      this.config.runtime.socketPath,
      this.gossipsub,
    );
    this.watchedNodeRelaySocketServer = new WatchedNodeRelaySocketServer(
      this.config.runtime.socketPath,
      this.watchedNodeRelay,
    );
    this.agentRouter = new DefaultAgentRouter(
      new ConfigAgentHarnessAdapter(this.config, this.stateStore, this.sessionStore),
    );
    this.workload = new CoreWorkloadAdapter();
    this.jsonRpcServer = new JsonRpcServer(this.config.runtime.socketPath, async (method, params) =>
      this.dispatch(method, params),
    );
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    try {
      for (const transport of this.transportAdapters()) {
        await transport.start();
      }
      await this.watchedNodeRelay.start();
      await this.chatboxRelaySocketServer.start();
      await this.watchedNodeRelaySocketServer.start();
      await this.jsonRpcServer.start();
      this.started = true;
      this.shutdownRequested = false;
    } catch (error) {
      await this.safeStopSubsystems();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      await this.safeStopSubsystems();
      return;
    }

    await this.safeStopSubsystems();
    this.started = false;
    this.shutdownRequested = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  async status(): Promise<RuntimeStatus> {
    let health: RuntimeStatus["techtree"] = null;

    try {
      const startedAt = Date.now();
      const payload = await this.techtree.health();
      health = {
        ok: true,
        baseUrl: this.config.services.techtree.baseUrl,
        latencyMs: Date.now() - startedAt,
        payload,
      };
    } catch (error) {
      health = {
        ok: false,
        baseUrl: this.config.services.techtree.baseUrl,
        latencyMs: null,
        error: error instanceof Error ? error.message : "health check failed",
      };
    }

    const session = this.sessionStore.getSiwaSession();
    const agent = await this.agentRouter.status();
    const [xmtp, gossipsub] = await Promise.all([
      this.xmtp.status(),
      this.gossipsub.status(),
    ]);

    return {
      running: this.started,
      socketPath: this.config.runtime.socketPath,
      stateDir: this.config.runtime.stateDir,
      logLevel: this.config.runtime.logLevel,
      authenticated: !!session && !this.sessionStore.isReceiptExpired(),
      session: session
        ? {
            walletAddress: session.walletAddress,
            chainId: session.chainId,
            receiptExpiresAt: session.receiptExpiresAt,
          }
        : null,
      agentIdentity: agent.identity,
      agent,
      techtree: health,
      xmtp,
      gossipsub,
    };
  }

  requestShutdown(): void {
    if (this.shutdownRequested) {
      return;
    }

    this.shutdownRequested = true;
    queueMicrotask(() => {
      void this.stop().finally(() => {
        this.shutdownRequested = false;
      });
    });
  }

  private context(): RuntimeContext {
    return {
      config: this.config,
      stateStore: this.stateStore,
      sessionStore: this.sessionStore,
      techtree: this.techtree,
      techtreePublisher: this.techtreePublisher,
      walletSecretSource: this.walletSecretSource,
      xmtp: this.xmtp,
      gossipsub: this.gossipsub,
      agentRouter: this.agentRouter,
      workload: this.workload,
      runtime: this,
      requestShutdown: () => this.requestShutdown(),
    };
  }

  private async safeStopSubsystems(): Promise<void> {
    await stopIgnoringErrors(this.jsonRpcServer);
    await stopIgnoringErrors(this.watchedNodeRelaySocketServer);
    await stopIgnoringErrors(this.chatboxRelaySocketServer);
    await stopIgnoringErrors(this.watchedNodeRelay);
    for (const transport of [...this.transportAdapters()].reverse()) {
      await stopIgnoringErrors(transport);
    }
  }

  private transportAdapters(): TransportAdapter[] {
    return [this.xmtp, this.gossipsub];
  }

  private async dispatch(method: RegentRpcMethod, params: unknown): Promise<unknown> {
    const ctx = this.context();

    switch (method) {
      case "runtime.ping":
        return handleRuntimePing();
      case "runtime.status":
        return handleRuntimeStatus(ctx);
      case "runtime.shutdown":
        return handleRuntimeShutdown(ctx);
      case "agent.init":
        return handleAgentInit(ctx);
      case "agent.status":
        return handleAgentStatus(ctx);
      case "agent.profile.list":
        return handleAgentProfileList(ctx);
      case "agent.profile.show":
        return handleAgentProfileShow(ctx, params as Parameters<typeof handleAgentProfileShow>[1]);
      case "agent.harness.list":
        return handleAgentHarnessList(ctx);
      case "doctor.run":
        return (await loadDoctorHandlers()).handleDoctorRun(
          ctx,
          params as Parameters<(typeof import("./handlers/doctor.js"))["handleDoctorRun"]>[1],
        );
      case "doctor.runScoped":
        return (await loadDoctorHandlers()).handleDoctorRunScoped(
          ctx,
          params as Parameters<(typeof import("./handlers/doctor.js"))["handleDoctorRunScoped"]>[1],
        );
      case "doctor.runFull":
        return (await loadDoctorHandlers()).handleDoctorRunFull(
          ctx,
          params as Parameters<(typeof import("./handlers/doctor.js"))["handleDoctorRunFull"]>[1],
        );
      case "auth.siwa.login":
        return handleAuthSiwaLogin(ctx, (params ?? {}) as Parameters<typeof handleAuthSiwaLogin>[1]);
      case "auth.siwa.status":
        return handleAuthSiwaStatus(ctx);
      case "auth.siwa.logout":
        return handleAuthSiwaLogout(ctx);
      case "techtree.status":
        return handleTechtreeStatus(ctx);
      case "techtree.nodes.list":
        return handleTechtreeNodesList(ctx, params as Parameters<typeof handleTechtreeNodesList>[1]);
      case "techtree.nodes.get":
        return handleTechtreeNodeGet(ctx, params as Parameters<typeof handleTechtreeNodeGet>[1]);
      case "techtree.nodes.children":
        return handleTechtreeNodeChildren(ctx, params as Parameters<typeof handleTechtreeNodeChildren>[1]);
      case "techtree.nodes.comments":
        return handleTechtreeNodeComments(ctx, params as Parameters<typeof handleTechtreeNodeComments>[1]);
      case "techtree.nodes.lineage.list":
        return handleTechtreeNodeLineageList(ctx, params as Parameters<typeof handleTechtreeNodeLineageList>[1]);
      case "techtree.nodes.lineage.claim":
        return handleTechtreeNodeLineageClaim(ctx, params as Parameters<typeof handleTechtreeNodeLineageClaim>[1]);
      case "techtree.nodes.lineage.withdraw":
        return handleTechtreeNodeLineageWithdraw(
          ctx,
          params as Parameters<typeof handleTechtreeNodeLineageWithdraw>[1],
        );
      case "techtree.nodes.crossChainLinks.list":
        return handleTechtreeNodeCrossChainLinksList(
          ctx,
          params as Parameters<typeof handleTechtreeNodeCrossChainLinksList>[1],
        );
      case "techtree.nodes.crossChainLinks.create":
        return handleTechtreeNodeCrossChainLinksCreate(
          ctx,
          params as Parameters<typeof handleTechtreeNodeCrossChainLinksCreate>[1],
        );
      case "techtree.nodes.crossChainLinks.clear":
        return handleTechtreeNodeCrossChainLinksClear(
          ctx,
          params as Parameters<typeof handleTechtreeNodeCrossChainLinksClear>[1],
        );
      case "techtree.activity.list":
        return handleTechtreeActivityList(ctx, params as Parameters<typeof handleTechtreeActivityList>[1]);
      case "techtree.search.query":
        return handleTechtreeSearchQuery(ctx, params as Parameters<typeof handleTechtreeSearchQuery>[1]);
      case "techtree.nodes.workPacket":
        return handleTechtreeNodeWorkPacket(ctx, params as Parameters<typeof handleTechtreeNodeWorkPacket>[1]);
      case "techtree.nodes.create":
        return handleTechtreeNodeCreate(ctx, params as Parameters<typeof handleTechtreeNodeCreate>[1]);
      case "techtree.comments.create":
        return handleTechtreeCommentCreate(ctx, params as Parameters<typeof handleTechtreeCommentCreate>[1]);
      case "techtree.watch.create":
        return handleTechtreeWatchCreate(ctx, params as Parameters<typeof handleTechtreeWatchCreate>[1]);
      case "techtree.watch.delete":
        return handleTechtreeWatchDelete(ctx, params as Parameters<typeof handleTechtreeWatchDelete>[1]);
      case "techtree.watch.list":
        return handleTechtreeWatchList(ctx);
      case "techtree.stars.create":
        return handleTechtreeStarCreate(ctx, params as Parameters<typeof handleTechtreeStarCreate>[1]);
      case "techtree.stars.delete":
        return handleTechtreeStarDelete(ctx, params as Parameters<typeof handleTechtreeStarDelete>[1]);
      case "techtree.scienceTasks.list":
        return handleTechtreeScienceTasksList(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksList>[1],
        );
      case "techtree.scienceTasks.get":
        return handleTechtreeScienceTasksGet(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksGet>[1],
        );
      case "techtree.scienceTasks.init":
        return handleTechtreeScienceTasksInit(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksInit>[1],
        );
      case "techtree.scienceTasks.checklist":
        return handleTechtreeScienceTasksChecklist(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksChecklist>[1],
        );
      case "techtree.scienceTasks.evidence":
        return handleTechtreeScienceTasksEvidence(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksEvidence>[1],
        );
      case "techtree.scienceTasks.export":
        return handleTechtreeScienceTasksExport(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksExport>[1],
        );
      case "techtree.scienceTasks.submit":
        return handleTechtreeScienceTasksSubmit(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksSubmit>[1],
        );
      case "techtree.scienceTasks.reviewUpdate":
        return handleTechtreeScienceTasksReviewUpdate(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksReviewUpdate>[1],
        );
      case "techtree.scienceTasks.reviewLoop":
        return handleTechtreeScienceTasksReviewLoop(
          ctx,
          params as Parameters<typeof handleTechtreeScienceTasksReviewLoop>[1],
        );
      case "techtree.autoskill.initSkill":
        return handleTechtreeAutoskillInitSkill(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillInitSkill>[1],
        );
      case "techtree.autoskill.initEval":
        return handleTechtreeAutoskillInitEval(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillInitEval>[1],
        );
      case "techtree.autoskill.notebook.pair":
        return handleTechtreeAutoskillNotebookPair(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillNotebookPair>[1],
        );
      case "techtree.autoskill.publishSkill":
        return handleTechtreeAutoskillPublishSkill(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillPublishSkill>[1],
        );
      case "techtree.autoskill.publishEval":
        return handleTechtreeAutoskillPublishEval(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillPublishEval>[1],
        );
      case "techtree.autoskill.publishResult":
        return handleTechtreeAutoskillPublishResult(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillPublishResult>[1],
        );
      case "techtree.autoskill.review":
        return handleTechtreeAutoskillReview(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillReview>[1],
        );
      case "techtree.autoskill.listing.create":
        return handleTechtreeAutoskillListingCreate(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillListingCreate>[1],
        );
      case "techtree.autoskill.buy":
        return handleTechtreeAutoskillBuy(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillBuy>[1],
        );
      case "techtree.autoskill.pull":
        return handleTechtreeAutoskillPull(
          ctx,
          params as Parameters<typeof handleTechtreeAutoskillPull>[1],
        );
      case "techtree.inbox.get":
        return handleTechtreeInboxGet(ctx, params as Parameters<typeof handleTechtreeInboxGet>[1]);
      case "techtree.opportunities.list":
        return handleTechtreeOpportunitiesList(
          ctx,
          params as Parameters<typeof handleTechtreeOpportunitiesList>[1],
        );
      case "techtree.chatbox.history":
        return handleTechtreeChatboxHistory(
          ctx,
          params as Parameters<typeof handleTechtreeChatboxHistory>[1],
        );
      case "techtree.chatbox.post":
        return handleTechtreeChatboxPost(ctx, params as Parameters<typeof handleTechtreeChatboxPost>[1]);
      case "techtree.v1.artifact.init":
        return handleTechtreeV1ArtifactInit(ctx, params as Parameters<typeof handleTechtreeV1ArtifactInit>[1]);
      case "techtree.v1.artifact.compile":
        return handleTechtreeV1ArtifactCompile(ctx, params as Parameters<typeof handleTechtreeV1ArtifactCompile>[1]);
      case "techtree.v1.artifact.pin":
        return handleTechtreeV1ArtifactPin(ctx, params as Parameters<typeof handleTechtreeV1ArtifactPin>[1]);
      case "techtree.v1.artifact.publish":
        return handleTechtreeV1ArtifactPublish(ctx, params as Parameters<typeof handleTechtreeV1ArtifactPublish>[1]);
      case "techtree.v1.run.init":
        return handleTechtreeV1RunInit(ctx, params as Parameters<typeof handleTechtreeV1RunInit>[1]);
      case "techtree.v1.run.exec":
        return handleTechtreeV1RunExec(ctx, params as Parameters<typeof handleTechtreeV1RunExec>[1]);
      case "techtree.v1.run.compile":
        return handleTechtreeV1RunCompile(ctx, params as Parameters<typeof handleTechtreeV1RunCompile>[1]);
      case "techtree.v1.run.pin":
        return handleTechtreeV1RunPin(ctx, params as Parameters<typeof handleTechtreeV1RunPin>[1]);
      case "techtree.v1.run.publish":
        return handleTechtreeV1RunPublish(ctx, params as Parameters<typeof handleTechtreeV1RunPublish>[1]);
      case "techtree.v1.review.init":
        return handleTechtreeV1ReviewInit(ctx, params as Parameters<typeof handleTechtreeV1ReviewInit>[1]);
      case "techtree.v1.review.exec":
        return handleTechtreeV1ReviewExec(ctx, params as Parameters<typeof handleTechtreeV1ReviewExec>[1]);
      case "techtree.v1.review.compile":
        return handleTechtreeV1ReviewCompile(ctx, params as Parameters<typeof handleTechtreeV1ReviewCompile>[1]);
      case "techtree.v1.review.pin":
        return handleTechtreeV1ReviewPin(ctx, params as Parameters<typeof handleTechtreeV1ReviewPin>[1]);
      case "techtree.v1.review.publish":
        return handleTechtreeV1ReviewPublish(ctx, params as Parameters<typeof handleTechtreeV1ReviewPublish>[1]);
      case "techtree.v1.fetch":
        return handleTechtreeV1Fetch(ctx, params as Parameters<typeof handleTechtreeV1Fetch>[1]);
      case "techtree.v1.verify":
        return handleTechtreeV1Verify(ctx, params as Parameters<typeof handleTechtreeV1Verify>[1]);
      case "techtree.v1.bbh.run.exec":
        return handleTechtreeV1BbhRunExec(ctx, params as Parameters<typeof handleTechtreeV1BbhRunExec>[1]);
      case "techtree.v1.bbh.run.solve":
        return handleTechtreeV1BbhRunSolve(ctx, params as Parameters<typeof handleTechtreeV1BbhRunSolve>[1]);
      case "techtree.v1.bbh.notebook.pair":
        return handleTechtreeV1BbhNotebookPair(
          ctx,
          params as Parameters<typeof handleTechtreeV1BbhNotebookPair>[1],
        );
      case "techtree.v1.bbh.capsules.list":
        return handleTechtreeV1BbhCapsulesList(
          ctx,
          params as Parameters<typeof handleTechtreeV1BbhCapsulesList>[1],
        );
      case "techtree.v1.bbh.capsules.get":
        return handleTechtreeV1BbhCapsulesGet(
          ctx,
          params as Parameters<typeof handleTechtreeV1BbhCapsulesGet>[1],
        );
      case "techtree.v1.bbh.draft.init":
        return handleTechtreeV1BbhDraftInit(ctx, params as Parameters<typeof handleTechtreeV1BbhDraftInit>[1]);
      case "techtree.v1.bbh.draft.create":
        return handleTechtreeV1BbhDraftCreate(ctx, params as Parameters<typeof handleTechtreeV1BbhDraftCreate>[1]);
      case "techtree.v1.bbh.draft.list":
        return handleTechtreeV1BbhDraftList(ctx, params as Parameters<typeof handleTechtreeV1BbhDraftList>[1]);
      case "techtree.v1.bbh.draft.pull":
        return handleTechtreeV1BbhDraftPull(ctx, params as Parameters<typeof handleTechtreeV1BbhDraftPull>[1]);
      case "techtree.v1.bbh.draft.propose":
        return handleTechtreeV1BbhDraftPropose(ctx, params as Parameters<typeof handleTechtreeV1BbhDraftPropose>[1]);
      case "techtree.v1.bbh.draft.proposals":
        return handleTechtreeV1BbhDraftProposals(
          ctx,
          params as Parameters<typeof handleTechtreeV1BbhDraftProposals>[1],
        );
      case "techtree.v1.bbh.draft.apply":
        return handleTechtreeV1BbhDraftApply(ctx, params as Parameters<typeof handleTechtreeV1BbhDraftApply>[1]);
      case "techtree.v1.bbh.draft.ready":
        return handleTechtreeV1BbhDraftReady(ctx, params as Parameters<typeof handleTechtreeV1BbhDraftReady>[1]);
      case "techtree.v1.bbh.genome.init":
        return handleTechtreeV1BbhGenomeInit(ctx, params as Parameters<typeof handleTechtreeV1BbhGenomeInit>[1]);
      case "techtree.v1.bbh.genome.score":
        return handleTechtreeV1BbhGenomeScore(ctx, params as Parameters<typeof handleTechtreeV1BbhGenomeScore>[1]);
      case "techtree.v1.bbh.genome.improve":
        return handleTechtreeV1BbhGenomeImprove(ctx, params as Parameters<typeof handleTechtreeV1BbhGenomeImprove>[1]);
      case "techtree.v1.bbh.genome.propose":
        return handleTechtreeV1BbhGenomePropose(ctx, params as Parameters<typeof handleTechtreeV1BbhGenomePropose>[1]);
      case "techtree.v1.bbh.assignment.next":
        return handleTechtreeV1BbhAssignmentNext(
          ctx,
          params as Parameters<typeof handleTechtreeV1BbhAssignmentNext>[1],
        );
      case "techtree.v1.bbh.submit":
        return handleTechtreeV1BbhSubmit(ctx, params as Parameters<typeof handleTechtreeV1BbhSubmit>[1]);
      case "techtree.v1.bbh.validate":
        return handleTechtreeV1BbhValidate(ctx, params as Parameters<typeof handleTechtreeV1BbhValidate>[1]);
      case "techtree.v1.bbh.leaderboard":
        return handleTechtreeV1BbhLeaderboard(
          ctx,
          params as Parameters<typeof handleTechtreeV1BbhLeaderboard>[1],
        );
      case "techtree.v1.bbh.sync":
        return handleTechtreeV1BbhSync(ctx, params as Parameters<typeof handleTechtreeV1BbhSync>[1]);
      case "techtree.v1.reviewer.orcid.link":
        return handleTechtreeV1ReviewerOrcidLink(
          ctx,
          params as Parameters<typeof handleTechtreeV1ReviewerOrcidLink>[1],
        );
      case "techtree.v1.reviewer.apply":
        return handleTechtreeV1ReviewerApply(ctx, params as Parameters<typeof handleTechtreeV1ReviewerApply>[1]);
      case "techtree.v1.reviewer.status":
        return handleTechtreeV1ReviewerStatus(ctx);
      case "techtree.v1.review.list":
        return handleTechtreeV1ReviewList(ctx, params as Parameters<typeof handleTechtreeV1ReviewList>[1]);
      case "techtree.v1.review.claim":
        return handleTechtreeV1ReviewClaim(ctx, params as Parameters<typeof handleTechtreeV1ReviewClaim>[1]);
      case "techtree.v1.review.pull":
        return handleTechtreeV1ReviewPull(ctx, params as Parameters<typeof handleTechtreeV1ReviewPull>[1]);
      case "techtree.v1.review.submit":
        return handleTechtreeV1ReviewSubmit(ctx, params as Parameters<typeof handleTechtreeV1ReviewSubmit>[1]);
      case "techtree.v1.certificate.verify":
        return handleTechtreeV1CertificateVerify(
          ctx,
          params as Parameters<typeof handleTechtreeV1CertificateVerify>[1],
        );
      case "xmtp.status":
        return handleXmtpStatus(ctx);
      case "gossipsub.status":
        return handleGossipsubStatus(ctx);
      default:
        throw new JsonRpcError(`method not implemented: ${method}`, {
          code: "method_not_implemented",
          rpcCode: -32601,
        });
    }
  }
}
