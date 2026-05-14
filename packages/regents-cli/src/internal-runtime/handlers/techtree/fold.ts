import type {
  BenchmarkProofResponse,
  FoldPolicyInput,
  FoldPolicyResponse,
  FoldStatusResponse,
  TechtreeEvidencePacketResponse,
} from "../../../internal-types/index.js";
import type { RuntimeContext } from "../../runtime.js";

export async function handleTechtreeFoldPolicyInit(
  ctx: RuntimeContext,
  params: FoldPolicyInput,
): Promise<FoldPolicyResponse> {
  return ctx.techtree.updateFoldPolicy(params);
}

export async function handleTechtreeFoldStatus(ctx: RuntimeContext): Promise<FoldStatusResponse> {
  return ctx.techtree.getFoldStatus();
}

export async function handleTechtreeFoldEvidencePacket(ctx: RuntimeContext): Promise<TechtreeEvidencePacketResponse> {
  return ctx.techtree.getFoldEvidencePacket();
}

export async function handleTechtreeFoldProof(
  ctx: RuntimeContext,
  params: { attempt_id: string },
): Promise<BenchmarkProofResponse> {
  return ctx.techtree.getBenchmarkAttemptProof(params.attempt_id);
}
