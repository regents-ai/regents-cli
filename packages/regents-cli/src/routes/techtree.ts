import {
  runAutoskillInitEval,
  runAutoskillInitSkill,
  runAutoskillNotebookPair,
  runAutoskillBuy,
  runAutoskillListingCreate,
  runAutoskillPublishEval,
  runAutoskillPublishResult,
  runAutoskillPublishSkill,
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
  runTechtreeWatch,
  runTechtreeWatchList,
  runTechtreeWatchTail,
} from "../commands/techtree.js";
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
  runTechtreeArtifactCompile,
  runTechtreeArtifactInit,
  runTechtreeArtifactPin,
  runTechtreeArtifactPublish,
  runTechtreeBbhRunExec,
  runTechtreeBbhNotebookPair,
  runTechtreeBbhRunSolve,
  runTechtreeBbhSubmit,
  runTechtreeBbhValidate,
  runTechtreeFetch,
  runTechtreeReviewCompile,
  runTechtreeReviewExec,
  runTechtreeReviewInit,
  runTechtreeReviewPin,
  runTechtreeReviewPublish,
  runTechtreeRunCompile,
  runTechtreeRunExec,
  runTechtreeRunInit,
  runTechtreeRunPin,
  runTechtreeRunPublish,
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
  route("techtree main artifact init", async ({ parsedArgs, configPath }) => {
    await runTechtreeArtifactInit("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main artifact compile", async ({ parsedArgs, configPath }) => {
    await runTechtreeArtifactCompile("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main artifact pin", async ({ parsedArgs, configPath }) => {
    await runTechtreeArtifactPin("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main artifact publish", async ({ parsedArgs, configPath }) => {
    await runTechtreeArtifactPublish("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main run init", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunInit("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main run exec", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunExec("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main run compile", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunCompile("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main run pin", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunPin("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main run publish", async ({ parsedArgs, configPath }) => {
    await runTechtreeRunPublish("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main review init", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewInit("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main review exec", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewExec("main", parsedArgs, configPath);
    return 0;
  }),
  route("techtree main review compile", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewCompile("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main review pin", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewPin("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main review publish", async ({ parsedArgs, configPath }) => {
    await runTechtreeReviewPublish("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main fetch", async ({ parsedArgs, configPath }) => {
    await runTechtreeFetch("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree main verify", async ({ parsedArgs, configPath }) => {
    await runTechtreeVerify("main", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh fetch", async ({ parsedArgs, configPath }) => {
    await runTechtreeFetch("bbh", parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("techtree bbh verify", async ({ parsedArgs, configPath }) => {
    await runTechtreeVerify("bbh", parsedArgs, configPath);
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
