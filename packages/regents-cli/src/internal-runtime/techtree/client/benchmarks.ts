import type {
  BenchmarkAttemptCreateInput,
  BenchmarkAttemptResponse,
  BenchmarkCapsuleCreateInput,
  BenchmarkCapsuleListResponse,
  BenchmarkCapsulePublishInput,
  BenchmarkCapsulePublishResponse,
  BenchmarkCapsuleResponse,
  BenchmarkHarnessCreateInput,
  BenchmarkHarnessResponse,
  BenchmarkReliabilityListResponse,
  BenchmarkProofResponse,
  BenchmarkScoreboardResponse,
  BenchmarkValidationCreateInput,
  BenchmarkValidationResponse,
  BenchmarkVerifierReceiptCreateInput,
  BenchmarkVerifierReceiptResponse,
  BenchmarkVersionCreateInput,
  BenchmarkVersionListResponse,
  BenchmarkVersionResponse,
  FoldPolicyInput,
  FoldPolicyResponse,
  FoldStatusResponse,
  TechtreeEvidencePacketResponse,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

const pathId = (value: string): string => encodeURIComponent(value);

export class BenchmarksResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  listCapsules(params?: {
    domain?: string;
    field?: string;
    status?: string;
    difficulty?: string;
    limit?: number;
  }): Promise<BenchmarkCapsuleListResponse> {
    return this.request.getJson<BenchmarkCapsuleListResponse>(
      withQuery("/v1/benchmarks/capsules", params),
      "array",
    );
  }

  getCapsule(capsuleId: string): Promise<BenchmarkCapsuleResponse> {
    return this.request.getJson<BenchmarkCapsuleResponse>(`/v1/benchmarks/capsules/${pathId(capsuleId)}`, "object");
  }

  listVersions(capsuleId: string): Promise<BenchmarkVersionListResponse> {
    return this.request.getJson<BenchmarkVersionListResponse>(
      `/v1/benchmarks/capsules/${pathId(capsuleId)}/versions`,
      "array",
    );
  }

  scoreboard(capsuleId: string): Promise<BenchmarkScoreboardResponse> {
    return this.request.getJson<BenchmarkScoreboardResponse>(
      `/v1/benchmarks/capsules/${pathId(capsuleId)}/scoreboard`,
      "object",
    );
  }

  reliability(capsuleId: string): Promise<BenchmarkReliabilityListResponse> {
    return this.request.getJson<BenchmarkReliabilityListResponse>(
      `/v1/benchmarks/capsules/${pathId(capsuleId)}/reliability`,
      "array",
    );
  }

  getHarness(harnessId: string): Promise<BenchmarkHarnessResponse> {
    return this.request.getJson<BenchmarkHarnessResponse>(`/v1/benchmarks/harnesses/${pathId(harnessId)}`, "object");
  }

  getAttemptProof(attemptId: string): Promise<BenchmarkProofResponse> {
    return this.request.getJson<BenchmarkProofResponse>(`/v1/benchmarks/attempts/${pathId(attemptId)}/proof`, "object");
  }

  createCapsule(input: BenchmarkCapsuleCreateInput): Promise<BenchmarkCapsuleResponse> {
    return this.request.authedFetchJson<BenchmarkCapsuleResponse>("POST", "/v1/agent/benchmarks/capsules", input);
  }

  createVersion(capsuleId: string, input: BenchmarkVersionCreateInput): Promise<BenchmarkVersionResponse> {
    return this.request.authedFetchJson<BenchmarkVersionResponse>(
      "POST",
      `/v1/agent/benchmarks/capsules/${pathId(capsuleId)}/versions`,
      input,
    );
  }

  publishCapsule(capsuleId: string, input: BenchmarkCapsulePublishInput): Promise<BenchmarkCapsulePublishResponse> {
    return this.request.authedFetchJson<BenchmarkCapsulePublishResponse>(
      "POST",
      `/v1/agent/benchmarks/capsules/${pathId(capsuleId)}/publish`,
      input,
    );
  }

  createHarness(input: BenchmarkHarnessCreateInput): Promise<BenchmarkHarnessResponse> {
    return this.request.authedFetchJson<BenchmarkHarnessResponse>("POST", "/v1/agent/benchmarks/harnesses", input);
  }

  createAttempt(input: BenchmarkAttemptCreateInput): Promise<BenchmarkAttemptResponse> {
    return this.request.authedFetchJson<BenchmarkAttemptResponse>("POST", "/v1/agent/benchmarks/attempts", input);
  }

  createValidation(input: BenchmarkValidationCreateInput): Promise<BenchmarkValidationResponse> {
    return this.request.authedFetchJson<BenchmarkValidationResponse>(
      "POST",
      "/v1/agent/benchmarks/validations",
      input,
    );
  }

  createVerifierReceipt(input: BenchmarkVerifierReceiptCreateInput): Promise<BenchmarkVerifierReceiptResponse> {
    return this.request.authedFetchJson<BenchmarkVerifierReceiptResponse>(
      "POST",
      "/v1/agent/benchmarks/verifier-receipts",
      input,
    );
  }

  getFoldStatus(): Promise<FoldStatusResponse> {
    return this.request.authedFetchJson<FoldStatusResponse>("GET", "/v1/agent/fold/status");
  }

  updateFoldPolicy(input: FoldPolicyInput): Promise<FoldPolicyResponse> {
    return this.request.authedFetchJson<FoldPolicyResponse>("PUT", "/v1/agent/fold/policy", input);
  }

  getFoldEvidencePacket(): Promise<TechtreeEvidencePacketResponse> {
    return this.request.authedFetchJson<TechtreeEvidencePacketResponse>("GET", "/v1/agent/fold/evidence-packet");
  }

  recomputeReliability(capsuleId: string): Promise<BenchmarkReliabilityListResponse> {
    return this.request.authedFetchJson<BenchmarkReliabilityListResponse>(
      "POST",
      `/v1/agent/benchmarks/capsules/${pathId(capsuleId)}/reliability/recompute`,
      {},
    );
  }
}
