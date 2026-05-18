import {
  runAutoskillInitEval,
  runAutoskillInitSkill,
  runAutoskillNotebookPair,
  runAutoskillBuy,
  runAutoskillListingCreate,
  runAutoskillPublishEval,
  runAutoskillPublishResult,
  runAutoskillPublishSkill,
  runAutoskillRefund,
  runAutoskillPull,
  runAutoskillReview,
} from "../commands/autoskill.js";
import {
  runTechtreeActivity,
  runTechtreeCommentAdd,
  runTechtreeInbox,
  runTechtreeNodeChildren,
  runTechtreeNodeComments,
  runTechtreeNodeGet,
  runTechtreeNodeCrossChainLinksCreate,
  runTechtreeNodeCrossChainLinksClear,
  runTechtreeNodeCrossChainLinksList,
  runTechtreeNodeLineageClaim,
  runTechtreeNodeLineageWithdraw,
  runTechtreeNodeLineageList,
  runTechtreeNodeWorkPacket,
  runTechtreeNodeCreate,
  runTechtreeNodesList,
  runTechtreeOpportunities,
  runTechtreeSearch,
  runTechtreeScienceRun,
  runTechtreeScienceSetGoal,
  runTechtreeStar,
  runTechtreeStatus,
  runTechtreeUnstar,
  runTechtreeUnwatch,
  runTechtreeScienceTasksChecklist,
  runTechtreeScienceTasksEvidence,
  runTechtreeScienceTasksExport,
  runTechtreeScienceTasksGet,
  runTechtreeScienceTasksInit,
  runTechtreeScienceTasksList,
  runTechtreeScienceTasksReviewLoop,
  runTechtreeScienceTasksReviewUpdate,
  runTechtreeScienceTasksSubmit,
  runTechtreeWorkAccept,
  runTechtreeWorkList,
  runTechtreeWorkNext,
  runTechtreeWorkPublish,
  runTechtreeNotebooksInit,
  runTechtreeNotebooksPair,
  runTechtreeNotebooksPublish,
  runTechtreeWatch,
  runTechtreeWatchList,
  runTechtreeWatchTail,
  runTechtreeBenchmarksCapsuleInit,
  runTechtreeBenchmarksCapsulePack,
  runTechtreeBenchmarksCapsuleSubmit,
  runTechtreeBenchmarksGet,
  runTechtreeBenchmarksList,
  runTechtreeBenchmarksReliability,
  runTechtreeBenchmarksRunMaterialize,
  runTechtreeBenchmarksRunRepeat,
  runTechtreeBenchmarksRunSubmit,
  runTechtreeBenchmarksScoreboard,
  runTechtreeBenchmarksValidate,
  runTechtreeRunbookAnswerAttachPaidSolution,
  runTechtreeRunbookAnswerPost,
  runTechtreeRunbookAnswerVote,
  runTechtreeRunbookInviteRequest,
  runTechtreeRunbookMarkSolved,
  runTechtreeRunbookPaymentAddressSet,
  runTechtreeRunbookQuestionPost,
  runTechtreeRunbookQuestionsGet,
  runTechtreeRunbookQuestionsList,
  runTechtreeRunbookUnlock,
  runTechtreeTechEpochCurrent,
  runTechtreeTechLeaderboardsConfirm,
  runTechtreeTechLeaderboardsList,
  runTechtreeTechLeaderboardsRegister,
  runTechtreeTechRewardsClaim,
  runTechtreeTechRewardsList,
  runTechtreeTechRewardsProof,
  runTechtreeTechRewardsRootConfirm,
  runTechtreeTechRewardsRootPrepare,
  runTechtreeTechStatus,
  runTechtreeTechWithdraw,
} from "../commands/techtree.js";
import {
  runTechtreeFoldPolicyInit,
  runTechtreeFoldProof,
  runTechtreeFoldReport,
  runTechtreeFoldStatus,
} from "../commands/techtree-fold.js";
import {
  runTechtreeIdentitiesList,
  runTechtreeIdentitiesMint,
} from "../commands/techtree-identities.js";
import { runTechtreeStart } from "../commands/techtree-start.js";
import {
  runTechtreeBbhDraftApply,
  runTechtreeBbhDraftCreate,
  runTechtreeBbhDraftInit,
  runTechtreeBbhDraftList,
  runTechtreeBbhDraftProposals,
  runTechtreeBbhDraftPropose,
  runTechtreeBbhDraftPull,
  runTechtreeBbhDraftReady,
} from "../commands/techtree-v1-bbh-draft.js";
import {
  runTechtreeBbhGenomeImprove,
  runTechtreeBbhGenomeInit,
  runTechtreeBbhGenomePropose,
  runTechtreeBbhGenomeScore,
} from "../commands/techtree-v1-bbh-genome.js";
import { runTechtreeCertificateVerify } from "../commands/techtree-v1-certificate.js";
import {
  runTechtreeBbhRunExec,
  runTechtreeBbhNotebookPair,
  runTechtreeBbhRunSolve,
  runTechtreeBbhSubmit,
  runTechtreeBbhValidate,
  runTechtreeFetch,
  runTechtreeBbhCapsulesGet,
  runTechtreeBbhCapsulesList,
  runTechtreeBbhLeaderboard,
  runTechtreeBbhSync,
  runTechtreeVerify,
} from "../commands/techtree-v1.js";
import {
  runTechtreeReviewClaim,
  runTechtreeReviewList,
  runTechtreeReviewPull,
  runTechtreeReviewSubmit,
} from "../commands/techtree-v1-review.js";
import {
  runTechtreeReviewerApply,
  runTechtreeReviewerOrcidLink,
  runTechtreeReviewerStatus,
} from "../commands/techtree-v1-reviewer.js";
import { parsePositiveInteger } from "../parse.js";
import { dispatchRoute, route, type CliRoute, type CliRouteContext } from "./shared.js";

const requireNodeId = (value: string | undefined): number => {
  if (!value) {
    throw new Error("missing required node id");
  }

  return parsePositiveInteger(value, "invalid node id");
};

export const techtreeNamedTreeRoutes: readonly CliRoute[] = [
  route("techtree bbh run exec", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhRunExec(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh run solve", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhRunSolve(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh notebook pair", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhNotebookPair(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh capsules list", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhCapsulesList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree bbh capsules get", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhCapsulesGet(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh submit", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhSubmit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree bbh validate", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhValidate(parsedArgs, configPath);
    return 0;
  }),
  route("techtree bbh leaderboard", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhLeaderboard(parsedArgs, configPath);
    return 0;
  }),
  route("techtree bbh draft init", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhDraftInit(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh draft create", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhDraftCreate(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh draft list", async ({ configPath }) => {
    await runTechtreeBbhDraftList(configPath);
    return 0;
  }),
  route("techtree bbh draft pull", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhDraftPull(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh draft propose", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhDraftPropose(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh draft proposals", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhDraftProposals(parsedArgs, configPath);
    return 0;
  }),
  route("techtree bbh draft apply", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhDraftApply(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh draft ready", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhDraftReady(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh genome init", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhGenomeInit(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh genome score", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhGenomeScore(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh genome improve", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhGenomeImprove(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh genome propose", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhGenomePropose(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh sync", async ({ parsedArgs, configPath }) => {
    await runTechtreeBbhSync(parsedArgs, configPath);
    return 0;
  }),
  route("techtree main fetch", async ({ parsedArgs, configPath }) => {
    await runTechtreeFetch("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main verify", async ({ parsedArgs, configPath }) => {
    await runTechtreeVerify("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
];

export const techtreeRoutes: readonly CliRoute[] = [
  route("techtree status", async ({ configPath }) => {
    await runTechtreeStatus(configPath);
    return 0;
  }),
  route("techtree science-tasks list", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science-tasks get", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksGet(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree science-tasks init", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksInit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science-tasks checklist", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksChecklist(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science-tasks evidence", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksEvidence(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science-tasks export", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksExport(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science-tasks submit", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksSubmit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science-tasks review-update", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksReviewUpdate(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science-tasks review-loop", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceTasksReviewLoop(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science set-goal", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceSetGoal(parsedArgs, configPath);
    return 0;
  }),
  route("techtree science run", async ({ parsedArgs, configPath }) => {
    await runTechtreeScienceRun(parsedArgs, configPath);
    return 0;
  }),
  route("techtree work list", async ({ parsedArgs, configPath }) => {
    await runTechtreeWorkList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree work next", async ({ parsedArgs, configPath }) => {
    await runTechtreeWorkNext(parsedArgs, configPath);
    return 0;
  }),
  route("techtree work accept", async ({ parsedArgs, configPath }) => {
    await runTechtreeWorkAccept(parsedArgs, configPath);
    return 0;
  }),
  route("techtree work publish", async ({ parsedArgs, configPath }) => {
    await runTechtreeWorkPublish(parsedArgs, configPath);
    return 0;
  }),
  route("techtree notebooks init", async ({ parsedArgs, configPath }) => {
    await runTechtreeNotebooksInit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree notebooks pair", async ({ parsedArgs, configPath }) => {
    await runTechtreeNotebooksPair(parsedArgs, configPath);
    return 0;
  }),
  route("techtree notebooks publish", async ({ parsedArgs, configPath }) => {
    await runTechtreeNotebooksPublish(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks list", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks get <capsule_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksGet(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks scoreboard <capsule_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksScoreboard(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks reliability <capsule_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksReliability(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks capsule init", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksCapsuleInit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks capsule pack", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksCapsulePack(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks capsule submit", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksCapsuleSubmit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks run materialize", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksRunMaterialize(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks run submit", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksRunSubmit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks run repeat", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksRunRepeat(parsedArgs, configPath);
    return 0;
  }),
  route("techtree benchmarks validate", async ({ parsedArgs, configPath }) => {
    await runTechtreeBenchmarksValidate(parsedArgs, configPath);
    return 0;
  }),
  route("techtree fold policy init", async ({ parsedArgs, configPath }) => {
    await runTechtreeFoldPolicyInit(parsedArgs, configPath);
    return 0;
  }),
  route("techtree fold status", async ({ parsedArgs, configPath }) => {
    await runTechtreeFoldStatus(parsedArgs, configPath);
    return 0;
  }),
  route("techtree fold proof", async ({ parsedArgs, configPath }) => {
    await runTechtreeFoldProof(parsedArgs, configPath);
    return 0;
  }),
  route("techtree fold report", async ({ parsedArgs, configPath }) => {
    await runTechtreeFoldReport(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook questions list", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookQuestionsList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook questions get <id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookQuestionsGet(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook payment-address set", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookPaymentAddressSet(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook question post", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookQuestionPost(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook answer post <question_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookAnswerPost(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook answer attach-paid-solution <answer_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookAnswerAttachPaidSolution(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook answer vote <answer_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookAnswerVote(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook mark-solved <question_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookMarkSolved(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook unlock <answer_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookUnlock(parsedArgs, configPath);
    return 0;
  }),
  route("techtree runbook invite-request <question_id>", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunbookInviteRequest(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech status", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechStatus(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech epochs current", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechEpochCurrent(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech leaderboards list", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechLeaderboardsList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech leaderboards register", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechLeaderboardsRegister(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech leaderboards confirm", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechLeaderboardsConfirm(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech rewards list", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechRewardsList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech rewards proof", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechRewardsProof(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech rewards claim", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechRewardsClaim(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech rewards root prepare", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechRewardsRootPrepare(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech rewards root confirm", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechRewardsRootConfirm(parsedArgs, configPath);
    return 0;
  }),
  route("techtree tech withdraw", async ({ parsedArgs, configPath }) => {
    await runTechtreeTechWithdraw(parsedArgs, configPath);
    return 0;
  }),
  route("techtree start", async ({ parsedArgs, configPath }) => {
    const result = await runTechtreeStart(parsedArgs, configPath);
    return result.ready ? 0 : 1;
  }),
  route("techtree autoskill init skill", async ({ parsedArgs, configPath }) => {
    await runAutoskillInitSkill(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill init eval", async ({ parsedArgs, configPath }) => {
    await runAutoskillInitEval(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill notebook pair", async ({ parsedArgs, configPath }) => {
    await runAutoskillNotebookPair(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill publish skill", async ({ parsedArgs, configPath }) => {
    await runAutoskillPublishSkill(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill publish eval", async ({ parsedArgs, configPath }) => {
    await runAutoskillPublishEval(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill publish result", async ({ parsedArgs, configPath }) => {
    await runAutoskillPublishResult(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill review", async ({ parsedArgs, configPath }) => {
    await runAutoskillReview(parsedArgs, configPath);
    return 0;
  }),
  route("techtree autoskill listing create", async ({ parsedArgs, configPath }) => {
    await runAutoskillListingCreate(parsedArgs, configPath);
    return 0;
  }),
  route("techtree autoskill buy", async ({ parsedArgs, configPath }) => {
    await runAutoskillBuy(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill refund", async ({ parsedArgs, configPath }) => {
    await runAutoskillRefund(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree autoskill pull", async ({ parsedArgs, configPath }) => {
    await runAutoskillPull(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree reviewer orcid link", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewerOrcidLink(parsedArgs, configPath);
    return 0;
  }),
  route("techtree reviewer apply", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewerApply(parsedArgs, configPath);
    return 0;
  }),
  route("techtree reviewer status", async ({ configPath }) => {
    await runTechtreeReviewerStatus(configPath);
    return 0;
  }),
  route("techtree review list", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewList(parsedArgs, configPath);
    return 0;
  }),
  route("techtree review claim", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewClaim(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree review pull", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewPull(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree review submit", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewSubmit(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree certificate verify", async ({ parsedArgs, configPath }) => {
    await runTechtreeCertificateVerify(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree activity", async ({ parsedArgs, configPath }) => {
    await runTechtreeActivity(parsedArgs, configPath);
    return 0;
  }),
  route("techtree search", async ({ parsedArgs, configPath }) => {
    await runTechtreeSearch(parsedArgs, configPath);
    return 0;
  }),
  route("techtree nodes list", async ({ rawArgs, configPath }) => {
    await runTechtreeNodesList(rawArgs, configPath);
    return 0;
  }),
  route("techtree node get <id>", async ({ positionals, configPath }) => {
    await runTechtreeNodeGet(requireNodeId(positionals[3]), configPath);
    return 0;
  }),
  route("techtree node children <id>", async ({ rawArgs, positionals, configPath }) => {
    await runTechtreeNodeChildren(rawArgs, requireNodeId(positionals[3]), configPath);
    return 0;
  }),
  route("techtree node comments <id>", async ({ rawArgs, positionals, configPath }) => {
    await runTechtreeNodeComments(rawArgs, requireNodeId(positionals[3]), configPath);
    return 0;
  }),
  route("techtree node lineage list", async ({ parsedArgs, configPath }) => {
    await runTechtreeNodeLineageList(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree node lineage claim", async ({ parsedArgs, configPath }) => {
    await runTechtreeNodeLineageClaim(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree node lineage withdraw", async ({ parsedArgs, configPath }) => {
    await runTechtreeNodeLineageWithdraw(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree node cross-chain-links list", async ({ parsedArgs, configPath }) => {
    await runTechtreeNodeCrossChainLinksList(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree node cross-chain-links create", async ({ parsedArgs, configPath }) => {
    await runTechtreeNodeCrossChainLinksCreate(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree node cross-chain-links clear", async ({ parsedArgs, configPath }) => {
    await runTechtreeNodeCrossChainLinksClear(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree node create", async ({ rawArgs, configPath }) => {
    await runTechtreeNodeCreate(rawArgs, configPath);
    return 0;
  }),
  route("techtree comment add", async ({ rawArgs, configPath }) => {
    await runTechtreeCommentAdd(rawArgs, configPath);
    return 0;
  }),
  route("techtree node work-packet <id>", async ({ positionals, configPath }) => {
    await runTechtreeNodeWorkPacket(requireNodeId(positionals[3]), configPath);
    return 0;
  }),
  route("techtree identities list", async ({ parsedArgs }) => {
    await runTechtreeIdentitiesList(parsedArgs);
    return 0;
  }),
  route("techtree identities mint", async ({ parsedArgs }) => {
    await runTechtreeIdentitiesMint(parsedArgs);
    return 0;
  }),
  route("techtree watch list", async ({ configPath }) => {
    await runTechtreeWatchList(configPath);
    return 0;
  }),
  route("techtree watch tail", async ({ parsedArgs, configPath }) => {
    await runTechtreeWatchTail(parsedArgs, configPath);
    return 0;
  }),
  route("techtree watch <id>", async ({ positionals, configPath }) => {
    await runTechtreeWatch(requireNodeId(positionals[2]), configPath);
    return 0;
  }),
  route("techtree unwatch <id>", async ({ positionals, configPath }) => {
    await runTechtreeUnwatch(requireNodeId(positionals[2]), configPath);
    return 0;
  }),
  route("techtree star <id>", async ({ positionals, configPath }) => {
    await runTechtreeStar(requireNodeId(positionals[2]), configPath);
    return 0;
  }),
  route("techtree unstar <id>", async ({ positionals, configPath }) => {
    await runTechtreeUnstar(requireNodeId(positionals[2]), configPath);
    return 0;
  }),
  route("techtree inbox", async ({ rawArgs, configPath }) => {
    await runTechtreeInbox(rawArgs, configPath);
    return 0;
  }),
  route("techtree opportunities", async ({ rawArgs, configPath }) => {
    await runTechtreeOpportunities(rawArgs, configPath);
    return 0;
  }),
  ...techtreeNamedTreeRoutes,
];

export const dispatchTechtreeRoute = async (context: CliRouteContext): Promise<number | undefined> =>
  dispatchRoute(techtreeRoutes, context);
