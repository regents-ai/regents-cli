import type {
  ActivityListResponse,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  AutoskillBundleAccessResponse,
  AutoskillCreateEvalResponse,
  AutoskillCreateListingResponse,
  AutoskillCreateResultResponse,
  AutoskillCreateReviewResponse,
  AutoskillCreateSkillResponse,
  AutoskillEvalPublishInput,
  AutoskillListingCreateInput,
  AutoskillResultPublishInput,
  AutoskillReview,
  AutoskillReviewCreateInput,
  AutoskillSkillPublishInput,
  AutoskillVersionSummary,
  BbhAssignmentResponse,
  BbhCapsuleGetResponse,
  BbhCapsuleListResponse,
  BbhCertificateVerifyResponse,
  BbhDraftCreateRequest,
  BbhDraftGetResponse,
  BbhDraftListResponse,
  BbhDraftProposal,
  BbhDraftProposalListResponse,
  BbhDraftProposalSubmitRequest,
  BbhGenomeDetailResponse,
  BbhLeaderboardResponse,
  BbhReviewerApplyRequest,
  BbhReviewerApplyResponse,
  BbhReviewerOrcidLinkResponse,
  BbhReviewerStatusResponse,
  BbhReviewListParams,
  BbhReviewListResponse,
  BbhReviewPacketResponse,
  BbhReviewRequest,
  BbhReviewSubmitRequest,
  BbhReviewSubmitResponse,
  BbhRunDetailResponse,
  BbhRunSubmitRequest,
  BbhRunSubmitResponse,
  BbhSyncRequest,
  BbhSyncResponse,
  BbhValidationSubmitRequest,
  BbhValidationSubmitResponse,
  ChatboxListResponse,
  ChatboxPostInput,
  ChatboxPostResponse,
  CommentCreateInput,
  CommentCreateResponse,
  GossipsubStatus,
  NodeCreateInput,
  NodeCreateResponse,
  NodePaidPayloadAccessResponse,
  NodePurchaseVerifyResponse,
  NodeStarRecord,
  RegentConfig,
  ScienceTaskChecklistUpdateInput,
  ScienceTaskCreateInput,
  ScienceTaskDetailResponse,
  ScienceTaskEvidenceUpdateInput,
  ScienceTaskListResponse,
  ScienceTaskMutationResponse,
  ScienceTaskReviewUpdateInput,
  ScienceTaskSubmitInput,
  SearchResponse,
  SiwaNonceRequest,
  SiwaNonceResponse,
  SiwaVerifyRequest,
  SiwaVerifyResponse,
  SkillTextResponse,
  TreeComment,
  TreeNode,
  WatchRecord,
  WorkPacketResponse,
} from "../../internal-types/index.js";
import type { WalletSecretSource } from "../agent/key-store.js";
import type { SessionStore } from "../store/session-store.js";
import type { StateStore } from "../store/state-store.js";
import { AuthResource } from "./client/auth.js";
import { AutoskillResource } from "./client/autoskill.js";
import { BbhResource } from "./client/bbh.js";
import { ChatboxResource } from "./client/chatbox.js";
import { TechtreeRequestClient } from "./client/request.js";
import { ReviewsResource } from "./client/reviews.js";
import { ScienceTasksResource } from "./client/science-tasks.js";
import { TransportResource } from "./client/transport.js";
import { TreeResource } from "./client/tree.js";
import type { SiwaClient } from "../siwa/siwa.js";

export class TechtreeClient {
  readonly baseUrl: string;
  readonly config: RegentConfig;
  readonly requestTimeoutMs: number;
  readonly sessionStore: SessionStore;
  readonly walletSecretSource: WalletSecretSource;
  readonly stateStore: StateStore;
  readonly siwaClient: SiwaClient;

  private readonly request: TechtreeRequestClient;
  private readonly auth: AuthResource;
  private readonly autoskill: AutoskillResource;
  private readonly bbh: BbhResource;
  private readonly chatbox: ChatboxResource;
  private readonly reviews: ReviewsResource;
  private readonly scienceTasks: ScienceTasksResource;
  private readonly transport: TransportResource;
  private readonly tree: TreeResource;

  constructor(args: {
    config: RegentConfig;
    baseUrl: string;
    requestTimeoutMs: number;
    sessionStore: SessionStore;
    walletSecretSource: WalletSecretSource;
    stateStore: StateStore;
  }) {
    this.config = args.config;
    this.baseUrl = args.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = args.requestTimeoutMs;
    this.sessionStore = args.sessionStore;
    this.walletSecretSource = args.walletSecretSource;
    this.stateStore = args.stateStore;
    this.request = new TechtreeRequestClient({
      config: args.config,
      baseUrl: this.baseUrl,
      requestTimeoutMs: args.requestTimeoutMs,
      sessionStore: args.sessionStore,
      stateStore: args.stateStore,
    });
    this.auth = new AuthResource(this.baseUrl, this.requestTimeoutMs, this.config);
    this.autoskill = new AutoskillResource(this.request);
    this.bbh = new BbhResource(this.request);
    this.chatbox = new ChatboxResource(this.request);
    this.reviews = new ReviewsResource(this.request);
    this.scienceTasks = new ScienceTasksResource(this.request);
    this.transport = new TransportResource(this.request);
    this.tree = new TreeResource(this.request, this.stateStore);
    this.siwaClient = this.auth.siwaClient;
  }

  health(): Promise<Record<string, unknown>> {
    return this.tree.health();
  }

  listNodes(params?: { limit?: number; seed?: string }): Promise<{ data: TreeNode[] }> {
    return this.tree.listNodes(params);
  }

  getNode(id: number): Promise<{ data: TreeNode }> {
    return this.tree.getNode(id);
  }

  getChildren(id: number, params?: { limit?: number }): Promise<{ data: TreeNode[] }> {
    return this.tree.getChildren(id, params);
  }

  getComments(id: number, params?: { limit?: number }): Promise<{ data: TreeComment[] }> {
    return this.tree.getComments(id, params);
  }

  listNodeLineageClaims(id: number): Promise<{ data: Record<string, unknown> | null }> {
    return this.tree.listNodeLineageClaims(id);
  }

  claimNodeLineage(id: number, input: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return this.tree.claimNodeLineage(id, input);
  }

  withdrawNodeLineageClaim(id: number, claimId: string): Promise<{ ok: true }> {
    return this.tree.withdrawNodeLineageClaim(id, claimId);
  }

  listNodeCrossChainLinks(id: number): Promise<{ data: Record<string, unknown>[] }> {
    return this.tree.listNodeCrossChainLinks(id);
  }

  createNodeCrossChainLink(id: number, input: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return this.tree.createNodeCrossChainLink(id, input);
  }

  clearNodeCrossChainLinks(id: number): Promise<{ ok: true }> {
    return this.tree.clearNodeCrossChainLinks(id);
  }

  getSidelinks(id: number): Promise<{ data: unknown[] }> {
    return this.tree.getSidelinks(id);
  }

  getHotSeed(seed: string, params?: { limit?: number }): Promise<{ data: TreeNode[] }> {
    return this.tree.getHotSeed(seed, params);
  }

  listActivity(params?: { limit?: number }): Promise<ActivityListResponse> {
    return this.tree.listActivity(params);
  }

  listScienceTasks(params?: {
    limit?: number;
    stage?: string;
    science_domain?: string;
    science_field?: string;
  }): Promise<ScienceTaskListResponse> {
    return this.scienceTasks.listScienceTasks(params);
  }

  getScienceTask(id: number): Promise<ScienceTaskDetailResponse> {
    return this.scienceTasks.getScienceTask(id);
  }

  createScienceTask(input: ScienceTaskCreateInput): Promise<ScienceTaskMutationResponse> {
    return this.scienceTasks.createScienceTask(input);
  }

  updateScienceTaskChecklist(
    id: number,
    input: ScienceTaskChecklistUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.scienceTasks.updateScienceTaskChecklist(id, input);
  }

  updateScienceTaskEvidence(
    id: number,
    input: ScienceTaskEvidenceUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.scienceTasks.updateScienceTaskEvidence(id, input);
  }

  submitScienceTask(id: number, input: ScienceTaskSubmitInput): Promise<ScienceTaskMutationResponse> {
    return this.scienceTasks.submitScienceTask(id, input);
  }

  reviewUpdateScienceTask(id: number, input: ScienceTaskReviewUpdateInput): Promise<ScienceTaskMutationResponse> {
    return this.scienceTasks.reviewUpdateScienceTask(id, input);
  }

  search(params: { q: string; limit?: number }): Promise<SearchResponse> {
    return this.tree.search(params);
  }

  getLatestSkill(slug: string): Promise<SkillTextResponse> {
    return this.tree.getLatestSkill(slug);
  }

  getBbhLeaderboard(params?: { split?: "climb" | "benchmark" | "challenge" | "draft" }): Promise<BbhLeaderboardResponse> {
    return this.bbh.getBbhLeaderboard(params);
  }

  listBbhCapsules(params?: { split?: "climb" | "benchmark" | "challenge" }): Promise<BbhCapsuleListResponse> {
    return this.bbh.listBbhCapsules(params);
  }

  getBbhCapsule(capsuleId: string): Promise<BbhCapsuleGetResponse> {
    return this.bbh.getBbhCapsule(capsuleId);
  }

  getBbhRun(runId: string): Promise<BbhRunDetailResponse> {
    return this.bbh.getBbhRun(runId);
  }

  getBbhRunValidations(runId: string): Promise<{ data: Record<string, unknown>[] }> {
    return this.bbh.getBbhRunValidations(runId);
  }

  getBbhGenome(genomeId: string): Promise<BbhGenomeDetailResponse> {
    return this.bbh.getBbhGenome(genomeId);
  }

  getSkillVersion(slug: string, version: string): Promise<SkillTextResponse> {
    return this.tree.getSkillVersion(slug, version);
  }

  listAutoskillSkillVersions(slug: string): Promise<{ data: AutoskillVersionSummary[] }> {
    return this.autoskill.listAutoskillSkillVersions(slug);
  }

  listAutoskillEvalVersions(slug: string): Promise<{ data: AutoskillVersionSummary[] }> {
    return this.autoskill.listAutoskillEvalVersions(slug);
  }

  listAutoskillReviews(nodeId: number): Promise<{ data: AutoskillReview[] }> {
    return this.autoskill.listAutoskillReviews(nodeId);
  }

  getAutoskillBundle(nodeId: number): Promise<AutoskillBundleAccessResponse> {
    return this.autoskill.getAutoskillBundle(nodeId);
  }

  getNodePaidPayload(nodeId: number): Promise<NodePaidPayloadAccessResponse> {
    return this.tree.getNodePaidPayload(nodeId);
  }

  verifyNodePurchase(nodeId: number, txHash: `0x${string}`): Promise<NodePurchaseVerifyResponse> {
    return this.tree.verifyNodePurchase(nodeId, txHash);
  }

  fetchExternalText(url: string): Promise<string> {
    return this.request.fetchExternalText(url);
  }

  siwaNonce(input: SiwaNonceRequest): Promise<SiwaNonceResponse> {
    return this.auth.siwaNonce(input);
  }

  siwaVerify(input: SiwaVerifyRequest): Promise<SiwaVerifyResponse> {
    return this.auth.siwaVerify(input);
  }

  getWorkPacket(nodeId: number): Promise<{ data: WorkPacketResponse }> {
    return this.tree.getWorkPacket(nodeId);
  }

  nextBbhAssignment(input?: { split?: "climb" | "benchmark" | "challenge" | "draft" }): Promise<BbhAssignmentResponse> {
    return this.bbh.nextBbhAssignment(input);
  }

  selectBbhAssignment(input: { capsule_id: string }): Promise<BbhAssignmentResponse> {
    return this.bbh.selectBbhAssignment(input);
  }

  createBbhDraft(input: BbhDraftCreateRequest): Promise<BbhDraftGetResponse> {
    return this.bbh.createBbhDraft(input);
  }

  listBbhDrafts(): Promise<BbhDraftListResponse> {
    return this.bbh.listBbhDrafts();
  }

  getBbhDraft(capsuleId: string): Promise<BbhDraftGetResponse> {
    return this.bbh.getBbhDraft(capsuleId);
  }

  createBbhDraftProposal(capsuleId: string, input: BbhDraftProposalSubmitRequest): Promise<{
    data: {
      proposal: BbhDraftProposal;
    };
  }> {
    return this.bbh.createBbhDraftProposal(capsuleId, input);
  }

  listBbhDraftProposals(capsuleId: string): Promise<BbhDraftProposalListResponse> {
    return this.bbh.listBbhDraftProposals(capsuleId);
  }

  applyBbhDraftProposal(capsuleId: string, proposalId: string): Promise<BbhDraftGetResponse> {
    return this.bbh.applyBbhDraftProposal(capsuleId, proposalId);
  }

  readyBbhDraft(capsuleId: string): Promise<BbhDraftGetResponse> {
    return this.bbh.readyBbhDraft(capsuleId);
  }

  startReviewerOrcidLink(): Promise<BbhReviewerOrcidLinkResponse> {
    return this.reviews.startReviewerOrcidLink();
  }

  getReviewerOrcidLinkStatus(requestId: string): Promise<BbhReviewerOrcidLinkResponse> {
    return this.reviews.getReviewerOrcidLinkStatus(requestId);
  }

  applyReviewerProfile(input: BbhReviewerApplyRequest): Promise<BbhReviewerApplyResponse> {
    return this.reviews.applyReviewerProfile(input);
  }

  getReviewerProfile(): Promise<BbhReviewerStatusResponse> {
    return this.reviews.getReviewerProfile();
  }

  listBbhReviews(params?: BbhReviewListParams): Promise<BbhReviewListResponse> {
    return this.reviews.listBbhReviews(params);
  }

  claimBbhReview(requestId: string): Promise<{ data: BbhReviewRequest }> {
    return this.reviews.claimBbhReview(requestId);
  }

  getBbhReviewPacket(requestId: string): Promise<BbhReviewPacketResponse> {
    return this.reviews.getBbhReviewPacket(requestId);
  }

  submitBbhReview(requestId: string, input: BbhReviewSubmitRequest): Promise<BbhReviewSubmitResponse> {
    return this.reviews.submitBbhReview(requestId, input);
  }

  verifyBbhCertificate(capsuleId: string): Promise<BbhCertificateVerifyResponse> {
    return this.bbh.verifyBbhCertificate(capsuleId);
  }

  submitBbhRun(input: BbhRunSubmitRequest): Promise<BbhRunSubmitResponse> {
    return this.bbh.submitBbhRun(input);
  }

  submitBbhValidation(input: BbhValidationSubmitRequest): Promise<BbhValidationSubmitResponse> {
    return this.bbh.submitBbhValidation(input);
  }

  syncBbh(input: BbhSyncRequest): Promise<BbhSyncResponse> {
    return this.bbh.syncBbh(input);
  }

  createNodeDetailed(input: NodeCreateInput): Promise<{
    response: NodeCreateResponse;
    statusCode: number;
  }> {
    return this.tree.createNodeDetailed(input);
  }

  createNode(input: NodeCreateInput): Promise<NodeCreateResponse> {
    return this.tree.createNode(input);
  }

  createComment(input: CommentCreateInput): Promise<CommentCreateResponse> {
    return this.tree.createComment(input);
  }

  watchNode(nodeId: number): Promise<{ data: WatchRecord }> {
    return this.tree.watchNode(nodeId);
  }

  unwatchNode(nodeId: number): Promise<{ ok: true }> {
    return this.tree.unwatchNode(nodeId);
  }

  listWatches(): Promise<{ data: WatchRecord[] }> {
    return this.tree.listWatches();
  }

  starNode(nodeId: number): Promise<{ data: NodeStarRecord }> {
    return this.tree.starNode(nodeId);
  }

  createAutoskillSkill(input: AutoskillSkillPublishInput): Promise<AutoskillCreateSkillResponse> {
    return this.autoskill.createAutoskillSkill(input);
  }

  createAutoskillEval(input: AutoskillEvalPublishInput): Promise<AutoskillCreateEvalResponse> {
    return this.autoskill.createAutoskillEval(input);
  }

  publishAutoskillResult(input: AutoskillResultPublishInput): Promise<AutoskillCreateResultResponse> {
    return this.autoskill.publishAutoskillResult(input);
  }

  createAutoskillReview(input: AutoskillReviewCreateInput): Promise<AutoskillCreateReviewResponse> {
    return this.autoskill.createAutoskillReview(input);
  }

  createAutoskillListing(input: AutoskillListingCreateInput): Promise<AutoskillCreateListingResponse> {
    return this.autoskill.createAutoskillListing(input);
  }

  unstarNode(nodeId: number): Promise<{ ok: true }> {
    return this.tree.unstarNode(nodeId);
  }

  getInbox(params?: { cursor?: number; limit?: number; seed?: string; kind?: string | string[] }): Promise<AgentInboxResponse> {
    return this.tree.getInbox(params);
  }

  getOpportunities(params?: { limit?: number; seed?: string }): Promise<AgentOpportunitiesResponse> {
    return this.tree.getOpportunities(params);
  }

  listChatboxMessages(params?: {
    before?: number;
    limit?: number;
    room?: "webapp" | "agent";
  }): Promise<ChatboxListResponse> {
    return this.chatbox.listChatboxMessages(params);
  }

  createAgentChatboxMessage(input: ChatboxPostInput): Promise<ChatboxPostResponse> {
    return this.chatbox.createAgentChatboxMessage(input);
  }

  transportStatus(): Promise<{ data: GossipsubStatus }> {
    return this.transport.transportStatus();
  }

  streamChatbox(
    room: "webapp" | "agent",
    onEvent: (payload: unknown) => void,
    signal: AbortSignal,
  ): Promise<void> {
    return this.chatbox.streamChatbox(room, onEvent, signal);
  }
}
