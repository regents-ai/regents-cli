#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultConfigPath, expandHome } from "./internal-runtime/index.js";

import { runAgentbookLookup, runAgentbookRegister, runAgentbookSessionsWatch, runAgentbookVerifyHeader } from "./commands/agentbook.js";
import {
  runAutolaunchContractsAdminShow,
  runAutolaunchContractsJobShow,
  runAutolaunchContractsSubjectShow,
  runAutolaunchAgentsList,
  runAutolaunchAgentReadiness,
  runAutolaunchAgentShow,
  runAutolaunchAuctionsList,
  runAutolaunchAuctionReturnsList,
  runAutolaunchAuctionShow,
  runAutolaunchBidsClaim,
  runAutolaunchBidsExit,
  runAutolaunchBidsMine,
  runAutolaunchBidsPlace,
  runAutolaunchBidsQuote,
  runAutolaunchHoldingsClaimAndStakeEmissions,
  runAutolaunchHoldingsClaimEmissions,
  runAutolaunchHoldingsClaimUsdc,
  runAutolaunchHoldingsList,
  runAutolaunchHoldingsStake,
  runAutolaunchHoldingsSweepIngress,
  runAutolaunchHoldingsUnstake,
  runAutolaunchEnsPlan,
  runAutolaunchEnsPrepareBidirectional,
  runAutolaunchEnsPrepareErc8004,
  runAutolaunchEnsPrepareEnsip25,
  runAutolaunchFeeRegistrySetHookEnabled,
  runAutolaunchFeeRegistryShow,
  runAutolaunchFeeVaultShow,
  runAutolaunchFeeVaultWithdrawRegent,
  runAutolaunchFeeVaultWithdrawTreasury,
  runAutolaunchIdentitiesList,
  runAutolaunchIdentitiesMint,
  runAutolaunchIngressCreate,
  runAutolaunchIngressRescue,
  runAutolaunchIngressSetDefault,
  runAutolaunchIngressSetLabel,
  runAutolaunchJobsWatch,
  runAutolaunchLaunchCreate,
  runAutolaunchLaunchFinalize,
  runAutolaunchLaunchMonitor,
  runAutolaunchLaunchPreview,
  runAutolaunchLaunchRun,
  runAutolaunchSafeCreate,
  runAutolaunchSafeWizard,
  runAutolaunchPrelaunchPublish,
  runAutolaunchPrelaunchShow,
  runAutolaunchPrelaunchValidate,
  runAutolaunchPrelaunchWizard,
  runAutolaunchRegistryLinkIdentity,
  runAutolaunchRegistryRotateSafe,
  runAutolaunchRegistrySetSubjectManager,
  runAutolaunchRegistryShow,
  runAutolaunchRevenueIngressFactorySetAuthorizedCreator,
  runAutolaunchRevenueShareFactorySetAuthorizedCreator,
  runAutolaunchSplitterCancelTreasuryRecipientRotation,
  runAutolaunchSplitterExecuteTreasuryRecipientRotation,
  runAutolaunchSplitterProposeTreasuryRecipientRotation,
  runAutolaunchSplitterReassignDust,
  runAutolaunchSplitterSetLabel,
  runAutolaunchSplitterSetPaused,
  runAutolaunchSplitterSetProtocolRecipient,
  runAutolaunchSplitterSetProtocolSkimBps,
  runAutolaunchSplitterSweepProtocolReserve,
  runAutolaunchSplitterSweepTreasuryResidual,
  runAutolaunchSplitterShow,
  runAutolaunchStrategyMigrate,
  runAutolaunchStrategySweepCurrency,
  runAutolaunchStrategySweepToken,
  runAutolaunchTrustXLink,
  runAutolaunchSubjectClaimUsdc,
  runAutolaunchSubjectClaimAndStakeEmissions,
  runAutolaunchSubjectClaimEmissions,
  runAutolaunchSubjectIngress,
  runAutolaunchSubjectShow,
  runAutolaunchSubjectStake,
  runAutolaunchSubjectSweepIngress,
  runAutolaunchSubjectUnstake,
  runAutolaunchPositionsClaim,
  runAutolaunchPositionsExit,
  runAutolaunchPositionsList,
  runAutolaunchPositionsReturnUsdc,
  runAutolaunchVestingCancelBeneficiaryRotation,
  runAutolaunchVestingExecuteBeneficiaryRotation,
  runAutolaunchVestingProposeBeneficiaryRotation,
  runAutolaunchVestingRelease,
  runAutolaunchVestingStatus,
} from "./commands/autolaunch.js";
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
} from "./commands/autoskill.js";
import { runConfigRead, runConfigWrite } from "./commands/config.js";
import {
  runAgentHarnessList,
  runAgentInit,
  runAgentProfileList,
  runAgentProfileShow,
  runAgentStatus,
} from "./commands/agent.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runAuthSiwaLogin, runAuthSiwaLogout, runAuthSiwaStatus } from "./commands/auth.js";
import { runCreateInit, runCreateWallet } from "./commands/create.js";
import { runGossipsubStatus } from "./commands/gossipsub.js";
import { runRuntime } from "./commands/run.js";
import { runChatboxHistory, runChatboxPost, runChatboxTail } from "./commands/chatbox.js";
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
  runTechtreeWatch,
  runTechtreeWatchList,
  runTechtreeWatchTail,
} from "./commands/techtree.js";
import {
  runTechtreeIdentitiesList,
  runTechtreeIdentitiesMint,
} from "./commands/techtree-identities.js";
import { runTechtreeStart } from "./commands/techtree-start.js";
import {
  runTechtreeBbhDraftApply,
  runTechtreeBbhDraftCreate,
  runTechtreeBbhDraftInit,
  runTechtreeBbhDraftList,
  runTechtreeBbhDraftProposals,
  runTechtreeBbhDraftPropose,
  runTechtreeBbhDraftPull,
  runTechtreeBbhDraftReady,
} from "./commands/techtree-v1-bbh-draft.js";
import {
  runTechtreeBbhGenomeImprove,
  runTechtreeBbhGenomeInit,
  runTechtreeBbhGenomePropose,
  runTechtreeBbhGenomeScore,
} from "./commands/techtree-v1-bbh-genome.js";
import { runTechtreeCertificateVerify } from "./commands/techtree-v1-certificate.js";
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
} from "./commands/techtree-v1.js";
import {
  runTechtreeReviewClaim,
  runTechtreeReviewList,
  runTechtreeReviewPull,
  runTechtreeReviewSubmit,
} from "./commands/techtree-v1-review.js";
import {
  runTechtreeReviewerApply,
  runTechtreeReviewerOrcidLink,
  runTechtreeReviewerStatus,
} from "./commands/techtree-v1-reviewer.js";
import {
  runXmtpDoctor,
  runXmtpGroupAddMember,
  runXmtpGroupAddAdmin,
  runXmtpGroupAddSuperAdmin,
  runXmtpGroupAdmins,
  runXmtpGroupCreate,
  runXmtpGroupList,
  runXmtpGroupMembers,
  runXmtpGroupPermissions,
  runXmtpGroupRemoveAdmin,
  runXmtpGroupRemoveMember,
  runXmtpGroupRemoveSuperAdmin,
  runXmtpGroupSuperAdmins,
  runXmtpGroupUpdatePermission,
  runXmtpInfo,
  runXmtpInit,
  runXmtpOwnerAdd,
  runXmtpOwnerList,
  runXmtpOwnerRemove,
  runXmtpPolicyInit,
  runXmtpPolicyShow,
  runXmtpPolicyValidate,
  runXmtpPolicyEdit,
  runXmtpRevokeOtherInstallations,
  runXmtpResolve,
  runXmtpStatus,
  runXmtpRotateDbKey,
  runXmtpRotateWallet,
  runXmtpTestDm,
  runXmtpTrustedAdd,
  runXmtpTrustedList,
  runXmtpTrustedRemove,
} from "./commands/xmtp.js";
import {
  runRegentStakingAccount,
  runRegentStakingClaimAndRestakeRegent,
  runRegentStakingClaimRegent,
  runRegentStakingClaimUsdc,
  runRegentStakingShow,
  runRegentStakingStake,
  runRegentStakingUnstake,
} from "./commands/regent-staking.js";
import { runBugReport, runSecurityReport } from "./commands/reports.js";
import { getFlag, parseCliArgs, requireArg } from "./parse.js";
import { printError, printText, renderUsageScreen } from "./printer.js";

export const parseConfigPath = (args: string[]): string | undefined => {
  const configFlag = getFlag(args, "config");
  return configFlag ? expandHome(configFlag) : undefined;
};

const requireNodeId = (value: string | undefined): number => {
  if (!value) {
    throw new Error("missing required node id");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("invalid node id");
  }

  return parsed;
};

const isNamedTree = (value: string | undefined): value is "main" | "bbh" =>
  value === "main" || value === "bbh";

const usage = (configPath?: string): void => {
  printText(renderUsageScreen(configPath ?? defaultConfigPath()));
};

export async function runCliEntrypoint(rawArgs: string[]): Promise<number> {
  try {
    const parsedArgs = parseCliArgs(rawArgs);
    const args = [...parsedArgs.positionals];
    const configPath = parseConfigPath(rawArgs);
    const [namespace, subcommand, maybeThird, maybeFourth] = args;

    if (namespace === "run") {
      await runRuntime(configPath);
      return 0;
    }

    if (namespace === "bug") {
      await runBugReport(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "security-report") {
      await runSecurityReport(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "create" && subcommand === "init") {
      await runCreateInit(parsedArgs);
      return 0;
    }

    if (namespace === "create" && subcommand === "wallet") {
      await runCreateWallet(parsedArgs);
      return 0;
    }

    if (namespace === "config" && subcommand === "read") {
      await runConfigRead(parsedArgs);
      return 0;
    }

    if (namespace === "config" && subcommand === "write") {
      await runConfigWrite(parsedArgs);
      return 0;
    }

    if (namespace === "doctor") {
      return await runDoctorCommand(parsedArgs, configPath);
    }

    if (namespace === "auth" && subcommand === "siwa" && maybeThird === "login") {
      await runAuthSiwaLogin(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "auth" && subcommand === "siwa" && maybeThird === "status") {
      await runAuthSiwaStatus(configPath);
      return 0;
    }

    if (namespace === "auth" && subcommand === "siwa" && maybeThird === "logout") {
      await runAuthSiwaLogout(configPath);
      return 0;
    }

    if (namespace === "agent" && subcommand === "init") {
      await runAgentInit(configPath);
      return 0;
    }

    if (namespace === "agent" && subcommand === "status") {
      await runAgentStatus(configPath);
      return 0;
    }

    if (namespace === "agent" && subcommand === "profile" && maybeThird === "list") {
      await runAgentProfileList(configPath);
      return 0;
    }

    if (namespace === "agent" && subcommand === "profile" && maybeThird === "show") {
      await runAgentProfileShow(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "agent" && subcommand === "harness" && maybeThird === "list") {
      await runAgentHarnessList(configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "status") {
      await runTechtreeStatus(configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "start") {
      const result = await runTechtreeStart(parsedArgs, configPath);
      return result.ready ? 0 : 1;
    }

    if (namespace === "regent-staking" && subcommand === "show") {
      await runRegentStakingShow();
      return 0;
    }

    if (namespace === "regent-staking" && subcommand === "account") {
      await runRegentStakingAccount(parsedArgs);
      return 0;
    }

    if (namespace === "regent-staking" && subcommand === "stake") {
      await runRegentStakingStake(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "regent-staking" && subcommand === "unstake") {
      await runRegentStakingUnstake(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "regent-staking" && subcommand === "claim-usdc") {
      await runRegentStakingClaimUsdc(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "regent-staking" && subcommand === "claim-regent") {
      await runRegentStakingClaimRegent(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "regent-staking" && subcommand === "claim-and-restake-regent") {
      await runRegentStakingClaimAndRestakeRegent(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "init" && maybeFourth === "skill") {
      await runAutoskillInitSkill(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "init" && maybeFourth === "eval") {
      await runAutoskillInitEval(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "notebook" && maybeFourth === "pair") {
      await runAutoskillNotebookPair(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "publish" && maybeFourth === "skill") {
      await runAutoskillPublishSkill(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "publish" && maybeFourth === "eval") {
      await runAutoskillPublishEval(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "publish" && maybeFourth === "result") {
      await runAutoskillPublishResult(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "review") {
      await runAutoskillReview(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "listing" && maybeFourth === "create") {
      await runAutoskillListingCreate(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "buy") {
      await runAutoskillBuy(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "autoskill" && maybeThird === "pull") {
      await runAutoskillPull(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && isNamedTree(subcommand)) {
      const tree = subcommand;
      const action = maybeThird;
      const verb = maybeFourth;

      if (tree === "bbh" && action === "run" && verb === "exec") {
        await runTechtreeBbhRunExec(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "run" && verb === "solve") {
        await runTechtreeBbhRunSolve(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "notebook" && verb === "pair") {
        await runTechtreeBbhNotebookPair(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "capsules" && verb === "list") {
        await runTechtreeBbhCapsulesList(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "capsules" && verb === "get") {
        await runTechtreeBbhCapsulesGet(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "submit") {
        await runTechtreeBbhSubmit(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "validate") {
        await runTechtreeBbhValidate(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "leaderboard") {
        await runTechtreeBbhLeaderboard(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "init") {
        await runTechtreeBbhDraftInit(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "create") {
        await runTechtreeBbhDraftCreate(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "list") {
        await runTechtreeBbhDraftList(configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "pull") {
        await runTechtreeBbhDraftPull(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "propose") {
        await runTechtreeBbhDraftPropose(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "proposals") {
        await runTechtreeBbhDraftProposals(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "apply") {
        await runTechtreeBbhDraftApply(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "draft" && verb === "ready") {
        await runTechtreeBbhDraftReady(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "genome" && verb === "init") {
        await runTechtreeBbhGenomeInit(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "genome" && verb === "score") {
        await runTechtreeBbhGenomeScore(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "genome" && verb === "improve") {
        await runTechtreeBbhGenomeImprove(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "genome" && verb === "propose") {
        await runTechtreeBbhGenomePropose(parsedArgs, configPath);
        return 0;
      }

      if (tree === "bbh" && action === "sync") {
        await runTechtreeBbhSync(parsedArgs, configPath);
        return 0;
      }

      if (action === "artifact" && verb === "init") {
        await runTechtreeArtifactInit(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "artifact" && verb === "compile") {
        await runTechtreeArtifactCompile(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "artifact" && verb === "pin") {
        await runTechtreeArtifactPin(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "artifact" && verb === "publish") {
        await runTechtreeArtifactPublish(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "run" && verb === "init") {
        await runTechtreeRunInit(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "run" && verb === "exec") {
        await runTechtreeRunExec(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "run" && verb === "compile") {
        await runTechtreeRunCompile(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "run" && verb === "pin") {
        await runTechtreeRunPin(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "run" && verb === "publish") {
        await runTechtreeRunPublish(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "review" && verb === "init") {
        await runTechtreeReviewInit(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "review" && verb === "exec") {
        await runTechtreeReviewExec(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "review" && verb === "compile") {
        await runTechtreeReviewCompile(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "review" && verb === "pin") {
        await runTechtreeReviewPin(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "review" && verb === "publish") {
        await runTechtreeReviewPublish(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "fetch") {
        await runTechtreeFetch(tree, parsedArgs, configPath);
        return 0;
      }

      if (action === "verify") {
        await runTechtreeVerify(tree, parsedArgs, configPath);
        return 0;
      }

    }

    if (namespace === "techtree" && subcommand === "reviewer" && maybeThird === "orcid" && maybeFourth === "link") {
      await runTechtreeReviewerOrcidLink(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "reviewer" && maybeThird === "apply") {
      await runTechtreeReviewerApply(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "reviewer" && maybeThird === "status") {
      await runTechtreeReviewerStatus(configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "review" && maybeThird === "list") {
      await runTechtreeReviewList(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "review" && maybeThird === "claim") {
      await runTechtreeReviewClaim(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "review" && maybeThird === "pull") {
      await runTechtreeReviewPull(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "review" && maybeThird === "submit") {
      await runTechtreeReviewSubmit(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "certificate" && maybeThird === "verify") {
      await runTechtreeCertificateVerify(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "activity") {
      await runTechtreeActivity(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "search") {
      await runTechtreeSearch(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "nodes" && maybeThird === "list") {
      await runTechtreeNodesList(rawArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "get") {
      await runTechtreeNodeGet(requireNodeId(maybeFourth), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "children") {
      await runTechtreeNodeChildren(rawArgs, requireNodeId(maybeFourth), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "comments") {
      await runTechtreeNodeComments(rawArgs, requireNodeId(maybeFourth), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "lineage" && maybeFourth === "list") {
      await runTechtreeNodeLineageList(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "lineage" && maybeFourth === "claim") {
      await runTechtreeNodeLineageClaim(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "lineage" && maybeFourth === "withdraw") {
      await runTechtreeNodeLineageWithdraw(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "cross-chain-links" && maybeFourth === "list") {
      await runTechtreeNodeCrossChainLinksList(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "cross-chain-links" && maybeFourth === "create") {
      await runTechtreeNodeCrossChainLinksCreate(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "cross-chain-links" && maybeFourth === "clear") {
      await runTechtreeNodeCrossChainLinksClear(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "create") {
      await runTechtreeNodeCreate(rawArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "comment" && maybeThird === "add") {
      await runTechtreeCommentAdd(rawArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "work-packet") {
      await runTechtreeNodeWorkPacket(requireNodeId(maybeFourth), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "identities" && maybeThird === "list") {
      await runTechtreeIdentitiesList(parsedArgs);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "identities" && maybeThird === "mint") {
      await runTechtreeIdentitiesMint(parsedArgs);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "watch" && maybeThird === "list") {
      await runTechtreeWatchList(configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "watch" && maybeThird === "tail") {
      await runTechtreeWatchTail(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "watch") {
      await runTechtreeWatch(requireNodeId(maybeThird), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "unwatch") {
      await runTechtreeUnwatch(requireNodeId(maybeThird), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "star") {
      await runTechtreeStar(requireNodeId(maybeThird), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "unstar") {
      await runTechtreeUnstar(requireNodeId(maybeThird), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "inbox") {
      await runTechtreeInbox(rawArgs, configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "opportunities") {
      await runTechtreeOpportunities(rawArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "init") {
      return await runXmtpInit(parsedArgs, configPath);
    }

    if (namespace === "xmtp" && subcommand === "info") {
      await runXmtpInfo(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "status") {
      await runXmtpStatus(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "resolve") {
      await runXmtpResolve(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "owner" && maybeThird === "add") {
      await runXmtpOwnerAdd(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "owner" && maybeThird === "list") {
      await runXmtpOwnerList(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "owner" && maybeThird === "remove") {
      await runXmtpOwnerRemove(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "trusted" && maybeThird === "add") {
      await runXmtpTrustedAdd(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "trusted" && maybeThird === "list") {
      await runXmtpTrustedList(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "trusted" && maybeThird === "remove") {
      await runXmtpTrustedRemove(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "policy" && maybeThird === "init") {
      await runXmtpPolicyInit(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "policy" && maybeThird === "show") {
      await runXmtpPolicyShow(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "policy" && maybeThird === "validate") {
      return await runXmtpPolicyValidate(configPath);
    }

    if (namespace === "xmtp" && subcommand === "policy" && maybeThird === "edit") {
      await runXmtpPolicyEdit(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "test" && maybeThird === "dm") {
      await runXmtpTestDm(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "create") {
      await runXmtpGroupCreate(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "add-member") {
      await runXmtpGroupAddMember(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "remove-member") {
      await runXmtpGroupRemoveMember(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "list") {
      await runXmtpGroupList(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "members") {
      await runXmtpGroupMembers(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "permissions") {
      await runXmtpGroupPermissions(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "update-permission") {
      await runXmtpGroupUpdatePermission(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "admins") {
      await runXmtpGroupAdmins(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "super-admins") {
      await runXmtpGroupSuperAdmins(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "add-admin") {
      await runXmtpGroupAddAdmin(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "remove-admin") {
      await runXmtpGroupRemoveAdmin(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "add-super-admin") {
      await runXmtpGroupAddSuperAdmin(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "remove-super-admin") {
      await runXmtpGroupRemoveSuperAdmin(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "revoke-other-installations") {
      await runXmtpRevokeOtherInstallations(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "rotate-db-key") {
      await runXmtpRotateDbKey(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "rotate-wallet") {
      await runXmtpRotateWallet(configPath);
      return 0;
    }

    if (namespace === "xmtp" && subcommand === "doctor") {
      return await runXmtpDoctor(parsedArgs, configPath);
    }

    if (namespace === "agentbook" && subcommand === "register") {
      await runAgentbookRegister(parsedArgs);
      return 0;
    }

    if (namespace === "agentbook" && subcommand === "sessions" && maybeThird === "watch") {
      await runAgentbookSessionsWatch(parsedArgs);
      return 0;
    }

    if (namespace === "agentbook" && subcommand === "lookup") {
      await runAgentbookLookup(parsedArgs);
      return 0;
    }

    if (namespace === "agentbook" && subcommand === "verify-header") {
      await runAgentbookVerifyHeader(parsedArgs);
      return 0;
    }

    if (namespace === "chatbox" && subcommand === "history") {
      await runChatboxHistory(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "chatbox" && subcommand === "tail") {
      await runChatboxTail(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "chatbox" && subcommand === "post") {
      await runChatboxPost(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "agents" && maybeThird === "list") {
      await runAutolaunchAgentsList(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "agent" && maybeThird === "readiness") {
      await runAutolaunchAgentReadiness(requireArg(maybeFourth, "agent-id"));
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "agent" && maybeThird) {
      await runAutolaunchAgentShow(maybeThird);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "trust" && maybeThird === "x-link") {
      await runAutolaunchTrustXLink(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "auctions" && maybeThird === "list") {
      await runAutolaunchAuctionsList(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "auction-returns" && maybeThird === "list") {
      await runAutolaunchAuctionReturnsList(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "auction" && maybeThird) {
      await runAutolaunchAuctionShow(maybeThird);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "bids" && maybeThird === "quote") {
      await runAutolaunchBidsQuote(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "bids" && maybeThird === "place") {
      await runAutolaunchBidsPlace(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "bids" && maybeThird === "mine") {
      await runAutolaunchBidsMine(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "bids" && maybeThird === "exit") {
      await runAutolaunchBidsExit(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "bids" && maybeThird === "claim") {
      await runAutolaunchBidsClaim(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "positions" && maybeThird === "list") {
      await runAutolaunchPositionsList(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "positions" && maybeThird === "return-usdc") {
      await runAutolaunchPositionsReturnUsdc(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "positions" && maybeThird === "exit") {
      await runAutolaunchPositionsExit(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "positions" && maybeThird === "claim") {
      await runAutolaunchPositionsClaim(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "plan") {
      await runAutolaunchEnsPlan(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "prepare-ensip25") {
      await runAutolaunchEnsPrepareEnsip25(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "prepare-erc8004") {
      await runAutolaunchEnsPrepareErc8004(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "prepare-bidirectional") {
      await runAutolaunchEnsPrepareBidirectional(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "identities" && maybeThird === "list") {
      await runAutolaunchIdentitiesList(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "identities" && maybeThird === "mint") {
      await runAutolaunchIdentitiesMint(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "prelaunch" && maybeThird === "wizard") {
      await runAutolaunchPrelaunchWizard(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "safe" && maybeThird === "wizard") {
      await runAutolaunchSafeWizard(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "safe" && maybeThird === "create") {
      await runAutolaunchSafeCreate(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "prelaunch" && maybeThird === "show") {
      await runAutolaunchPrelaunchShow(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "prelaunch" && maybeThird === "validate") {
      await runAutolaunchPrelaunchValidate(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "prelaunch" && maybeThird === "publish") {
      await runAutolaunchPrelaunchPublish(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "launch" && maybeThird === "preview") {
      await runAutolaunchLaunchPreview(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "launch" && maybeThird === "create") {
      await runAutolaunchLaunchCreate(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "launch" && maybeThird === "run") {
      await runAutolaunchLaunchRun(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "launch" && maybeThird === "monitor") {
      await runAutolaunchLaunchMonitor(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "launch" && maybeThird === "finalize") {
      await runAutolaunchLaunchFinalize(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "jobs" && maybeThird === "watch") {
      await runAutolaunchJobsWatch(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "subjects" && maybeThird === "show") {
      await runAutolaunchSubjectShow(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "subjects" && maybeThird === "ingress") {
      await runAutolaunchSubjectIngress(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "subjects" && maybeThird === "stake") {
      await runAutolaunchSubjectStake(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "subjects" && maybeThird === "unstake") {
      await runAutolaunchSubjectUnstake(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "subjects" && maybeThird === "claim-usdc") {
      await runAutolaunchSubjectClaimUsdc(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "subjects" && maybeThird === "claim-emissions") {
      await runAutolaunchSubjectClaimEmissions(parsedArgs, configPath);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "subjects" &&
        maybeThird === "claim-and-stake-emissions"
    ) {
      await runAutolaunchSubjectClaimAndStakeEmissions(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "subjects" && maybeThird === "sweep-ingress") {
      await runAutolaunchSubjectSweepIngress(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "holdings" && maybeThird === "list") {
      await runAutolaunchHoldingsList(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "holdings" && maybeThird === "stake") {
      await runAutolaunchHoldingsStake(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "holdings" && maybeThird === "unstake") {
      await runAutolaunchHoldingsUnstake(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "holdings" && maybeThird === "claim-usdc") {
      await runAutolaunchHoldingsClaimUsdc(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "holdings" && maybeThird === "claim-emissions") {
      await runAutolaunchHoldingsClaimEmissions(parsedArgs, configPath);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "holdings" &&
        maybeThird === "claim-and-stake-emissions"
    ) {
      await runAutolaunchHoldingsClaimAndStakeEmissions(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "holdings" && maybeThird === "sweep-ingress") {
      await runAutolaunchHoldingsSweepIngress(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "contracts" && maybeThird === "admin") {
      await runAutolaunchContractsAdminShow(configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "contracts" && maybeThird === "job") {
      await runAutolaunchContractsJobShow(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "contracts" && maybeThird === "subject") {
      await runAutolaunchContractsSubjectShow(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "strategy" && maybeThird === "migrate") {
      await runAutolaunchStrategyMigrate(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "strategy" && maybeThird === "sweep-token") {
      await runAutolaunchStrategySweepToken(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "strategy" &&
        maybeThird === "sweep-currency"
    ) {
      await runAutolaunchStrategySweepCurrency(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "vesting" && maybeThird === "release") {
      await runAutolaunchVestingRelease(parsedArgs, configPath);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "vesting" &&
        maybeThird === "propose-beneficiary-rotation"
    ) {
      await runAutolaunchVestingProposeBeneficiaryRotation(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "vesting" &&
        maybeThird === "cancel-beneficiary-rotation"
    ) {
      await runAutolaunchVestingCancelBeneficiaryRotation(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "vesting" &&
        maybeThird === "execute-beneficiary-rotation"
    ) {
      await runAutolaunchVestingExecuteBeneficiaryRotation(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "vesting" && maybeThird === "status") {
      await runAutolaunchVestingStatus(parsedArgs, configPath);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "fee-registry" && maybeThird === "show") {
      await runAutolaunchFeeRegistryShow(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "fee-registry" &&
        maybeThird === "set-hook-enabled"
    ) {
      await runAutolaunchFeeRegistrySetHookEnabled(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "fee-vault" && maybeThird === "show") {
      await runAutolaunchFeeVaultShow(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "fee-vault" &&
        maybeThird === "withdraw-treasury"
    ) {
      await runAutolaunchFeeVaultWithdrawTreasury(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "fee-vault" &&
        maybeThird === "withdraw-regent"
    ) {
      await runAutolaunchFeeVaultWithdrawRegent(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "splitter" && maybeThird === "show") {
      await runAutolaunchSplitterShow(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "splitter" && maybeThird === "set-paused") {
      await runAutolaunchSplitterSetPaused(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "splitter" && maybeThird === "set-label") {
      await runAutolaunchSplitterSetLabel(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "propose-treasury-recipient-rotation"
    ) {
      await runAutolaunchSplitterProposeTreasuryRecipientRotation(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "cancel-treasury-recipient-rotation"
    ) {
      await runAutolaunchSplitterCancelTreasuryRecipientRotation(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "execute-treasury-recipient-rotation"
    ) {
      await runAutolaunchSplitterExecuteTreasuryRecipientRotation(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "set-protocol-recipient"
    ) {
      await runAutolaunchSplitterSetProtocolRecipient(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "set-protocol-skim-bps"
    ) {
      await runAutolaunchSplitterSetProtocolSkimBps(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "sweep-treasury-residual"
    ) {
      await runAutolaunchSplitterSweepTreasuryResidual(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "sweep-protocol-reserve"
    ) {
      await runAutolaunchSplitterSweepProtocolReserve(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "splitter" &&
        maybeThird === "reassign-dust"
    ) {
      await runAutolaunchSplitterReassignDust(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ingress" && maybeThird === "create") {
      await runAutolaunchIngressCreate(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ingress" && maybeThird === "set-default") {
      await runAutolaunchIngressSetDefault(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ingress" && maybeThird === "set-label") {
      await runAutolaunchIngressSetLabel(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ingress" && maybeThird === "rescue") {
      await runAutolaunchIngressRescue(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "registry" && maybeThird === "show") {
      await runAutolaunchRegistryShow(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "registry" &&
        maybeThird === "set-subject-manager"
    ) {
      await runAutolaunchRegistrySetSubjectManager(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "registry" && maybeThird === "link-identity") {
      await runAutolaunchRegistryLinkIdentity(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "registry" && maybeThird === "rotate-safe") {
      await runAutolaunchRegistryRotateSafe(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "factory" &&
        maybeThird === "revenue-share" &&
        maybeFourth === "set-authorized-creator"
    ) {
      await runAutolaunchRevenueShareFactorySetAuthorizedCreator(parsedArgs);
      return 0;
    }

    if (
      namespace === "autolaunch" &&
        subcommand === "factory" &&
        maybeThird === "revenue-ingress" &&
        maybeFourth === "set-authorized-creator"
    ) {
      await runAutolaunchRevenueIngressFactorySetAuthorizedCreator(parsedArgs);
      return 0;
    }

    if (namespace === "gossipsub" && subcommand === "status") {
      await runGossipsubStatus(configPath);
      return 0;
    }

    usage(configPath);
    return 0;
  } catch (error) {
    printError(error);
    return 1;
  }
}

export async function runCli(rawArgs: string[] = process.argv.slice(2)): Promise<number | void> {
  return runCliEntrypoint(rawArgs);
}

const main = async (): Promise<void> => {
  const exitCode = await runCliEntrypoint(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};

const isMainModule = (): boolean => {
  const invokedPath = process.argv[1];
  if (!invokedPath) {
    return false;
  }

  const currentModulePath = fileURLToPath(import.meta.url);

  try {
    return fs.realpathSync(invokedPath) === fs.realpathSync(currentModulePath);
  } catch {
    return path.resolve(invokedPath) === path.resolve(currentModulePath);
  }
};

if (isMainModule()) {
  void main();
}
