#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultConfigPath, expandHome } from "./internal-runtime/index.js";

import { runAgentbookLookup, runAgentbookRegister, runAgentbookSessionsWatch, runAgentbookVerifyHeader } from "./commands/agentbook.js";
import {
  runAutolaunchAgentsList,
  runAutolaunchAgentReadiness,
  runAutolaunchAgentShow,
  runAutolaunchAuctionsList,
  runAutolaunchAuctionShow,
  runAutolaunchBidsClaim,
  runAutolaunchBidsExit,
  runAutolaunchBidsMine,
  runAutolaunchBidsPlace,
  runAutolaunchBidsQuote,
  runAutolaunchEnsPlan,
  runAutolaunchEnsPrepareBidirectional,
  runAutolaunchEnsPrepareErc8004,
  runAutolaunchEnsPrepareEnsip25,
  runAutolaunchIdentitiesList,
  runAutolaunchIdentitiesMint,
  runAutolaunchJobsWatch,
  runAutolaunchLaunchCreate,
  runAutolaunchLaunchPreview,
} from "./commands/autolaunch.js";
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
import {
  runTechtreeActivity,
  runTechtreeInbox,
  runTechtreeNodeChildren,
  runTechtreeNodeComments,
  runTechtreeNodeGet,
  runTechtreeNodeWorkPacket,
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
import { runTechtreeStart } from "./commands/techtree-start.js";
import {
  runTechtreeArtifactCompile,
  runTechtreeArtifactInit,
  runTechtreeArtifactPin,
  runTechtreeArtifactPublish,
  runTechtreeBbhRunExec,
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
  runTechtreeBbhLeaderboard,
  runTechtreeBbhSync,
  runTechtreeVerify,
} from "./commands/techtree-v1.js";
import {
  runXmtpDoctor,
  runXmtpGroupAddMember,
  runXmtpGroupCreate,
  runXmtpGroupList,
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

    if (namespace === "techtree" && isNamedTree(subcommand)) {
      const tree = subcommand;
      const action = maybeThird;
      const verb = maybeFourth;

      if (tree === "bbh" && action === "run" && verb === "exec") {
        await runTechtreeBbhRunExec(parsedArgs, configPath);
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

    if (namespace === "techtree" && subcommand === "node" && maybeThird === "work-packet") {
      await runTechtreeNodeWorkPacket(requireNodeId(maybeFourth), configPath);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "identities" && maybeThird === "list") {
      await runAutolaunchIdentitiesList(parsedArgs);
      return 0;
    }

    if (namespace === "techtree" && subcommand === "identities" && maybeThird === "mint") {
      await runAutolaunchIdentitiesMint(parsedArgs);
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

    if (namespace === "xmtp" && subcommand === "group" && maybeThird === "list") {
      await runXmtpGroupList(parsedArgs, configPath);
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

    if (namespace === "autolaunch" && subcommand === "auctions" && maybeThird === "list") {
      await runAutolaunchAuctionsList(parsedArgs);
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
      await runAutolaunchBidsMine(parsedArgs);
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

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "plan") {
      await runAutolaunchEnsPlan(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "prepare-ensip25") {
      await runAutolaunchEnsPrepareEnsip25(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "prepare-erc8004") {
      await runAutolaunchEnsPrepareErc8004(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "ens" && maybeThird === "prepare-bidirectional") {
      await runAutolaunchEnsPrepareBidirectional(parsedArgs);
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

    if (namespace === "autolaunch" && subcommand === "launch" && maybeThird === "preview") {
      await runAutolaunchLaunchPreview(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "launch" && maybeThird === "create") {
      await runAutolaunchLaunchCreate(parsedArgs);
      return 0;
    }

    if (namespace === "autolaunch" && subcommand === "jobs" && maybeThird === "watch") {
      await runAutolaunchJobsWatch(parsedArgs);
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
