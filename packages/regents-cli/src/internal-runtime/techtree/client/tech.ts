import type {
  TechEpochResponse,
  TechLeaderboardConfirmInput,
  TechLeaderboardConfirmResponse,
  TechLeaderboardListResponse,
  TechLeaderboardRegisterPrepareInput,
  TechPreparedTransactionResponse,
  TechRewardClaimPrepareInput,
  TechRewardProofResponse,
  TechRewardRootConfirmInput,
  TechRewardRootConfirmResponse,
  TechRewardRootPrepareInput,
  TechRewardsResponse,
  TechStatusResponse,
  TechWithdrawPrepareInput,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

export class TechResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  status(): Promise<TechStatusResponse> {
    return this.request.getJson<TechStatusResponse>("/api/techtree/v1/tech/status", "object");
  }

  currentEpoch(): Promise<TechEpochResponse> {
    return this.request.getJson<TechEpochResponse>("/api/techtree/v1/tech/epochs/current", "object");
  }

  listLeaderboards(params?: {
    status?: string;
    limit?: number;
  }): Promise<TechLeaderboardListResponse> {
    return this.request.getJson<TechLeaderboardListResponse>(
      withQuery("/api/techtree/v1/tech/leaderboards", params),
      "array",
    );
  }

  listRewards(params?: {
    epoch?: number;
    lane?: string;
    limit?: number;
  }): Promise<TechRewardsResponse> {
    return this.request.getJson<TechRewardsResponse>(
      withQuery("/api/techtree/v1/tech/rewards", params),
      "array",
    );
  }

  rewardProof(params: {
    epoch: number;
    lane: string;
    agent_id: string;
  }): Promise<TechRewardProofResponse> {
    return this.request.getJson<TechRewardProofResponse>(
      withQuery("/api/techtree/v1/tech/rewards/proof", params),
      "object",
    );
  }

  prepareClaim(input: TechRewardClaimPrepareInput): Promise<TechPreparedTransactionResponse> {
    return this.request.authedFetchJson<TechPreparedTransactionResponse>(
      "POST",
      "/api/techtree/v1/agent/tech/rewards/claim/prepare",
      input,
    );
  }

  prepareWithdrawal(input: TechWithdrawPrepareInput): Promise<TechPreparedTransactionResponse> {
    return this.request.authedFetchJson<TechPreparedTransactionResponse>(
      "POST",
      "/api/techtree/v1/agent/tech/withdraw/prepare",
      input,
    );
  }

  prepareLeaderboardRegistration(
    input: TechLeaderboardRegisterPrepareInput,
  ): Promise<TechPreparedTransactionResponse> {
    return this.request.authedFetchJson<TechPreparedTransactionResponse>(
      "POST",
      "/api/techtree/v1/agent/tech/leaderboards/register/prepare",
      input,
    );
  }

  confirmLeaderboardRegistration(
    input: TechLeaderboardConfirmInput,
  ): Promise<TechLeaderboardConfirmResponse> {
    return this.request.authedFetchJson<TechLeaderboardConfirmResponse>(
      "POST",
      "/api/techtree/v1/agent/tech/leaderboards/register/confirm",
      input,
    );
  }

  prepareRewardRoot(input: TechRewardRootPrepareInput): Promise<TechPreparedTransactionResponse> {
    return this.request.authedFetchJson<TechPreparedTransactionResponse>(
      "POST",
      "/api/techtree/v1/agent/tech/rewards/root/prepare",
      input,
    );
  }

  confirmRewardRoot(input: TechRewardRootConfirmInput): Promise<TechRewardRootConfirmResponse> {
    return this.request.authedFetchJson<TechRewardRootConfirmResponse>(
      "POST",
      "/api/techtree/v1/agent/tech/rewards/root/confirm",
      input,
    );
  }
}
