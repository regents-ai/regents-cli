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
  runAutolaunchBidsPlace,
  runAutolaunchBidsQuote,
  runAutolaunchEnsPlan,
  runAutolaunchEnsPrepareBidirectional,
  runAutolaunchEnsPrepareErc8004,
  runAutolaunchEnsPrepareEnsip25,
  runAutolaunchFeeRegistryGet,
  runAutolaunchFeeVaultGet,
  runAutolaunchFeeVaultWithdrawRegent,
  runAutolaunchIdentitiesList,
  runAutolaunchIdentitiesMint,
  runAutolaunchIngressCreate,
  runAutolaunchIngressRescue,
  runAutolaunchIngressSetDefault,
  runAutolaunchIngressSetLabel,
  runAutolaunchJobsWatch,
  runAutolaunchConnectStart,
  runAutolaunchAuctionState,
  runAutolaunchPair,
  runAutolaunchPaymentLinkCreate,
  runAutolaunchPaymentLinkSetCanonical,
  runAutolaunchPaymentLinkSetState,
  runAutolaunchLaunchFinalize,
  runAutolaunchLaunchMonitor,
  runAutolaunchLaunchPreview,
  runAutolaunchLaunchRun,
  runAutolaunchLaunchState,
  runAutolaunchSafeCreate,
  runAutolaunchSafeWizard,
  runAutolaunchPrelaunchPublish,
  runAutolaunchPrelaunchGet,
  runAutolaunchPrelaunchValidate,
  runAutolaunchPrelaunchWizard,
  runAutolaunchRegistryLinkIdentity,
  runAutolaunchRegistryRotateSafe,
  runAutolaunchRegistrySetSubjectManager,
  runAutolaunchRegistryGet,
  runAutolaunchRevenueIngressFactorySetAuthorizedCreator,
  runAutolaunchRevenueShareFactorySetAuthorizedCreator,
  runAutolaunchSplitterAcceptOwnership,
  runAutolaunchSplitterActivateEligibleRevenueShare,
  runAutolaunchSplitterCancelEligibleRevenueShare,
  runAutolaunchSplitterCancelTreasuryRecipientRotation,
  runAutolaunchSplitterExecuteTreasuryRecipientRotation,
  runAutolaunchSplitterProposeEligibleRevenueShare,
  runAutolaunchSplitterProposeTreasuryRecipientRotation,
  runAutolaunchSplitterReassignDust,
  runAutolaunchSplitterSetLabel,
  runAutolaunchSplitterSetPaused,
  runAutolaunchSplitterSweepTreasuryReserved,
  runAutolaunchSplitterSweepTreasuryResidual,
  runAutolaunchSplitterGet,
  runAutolaunchStrategyMigrate,
  runAutolaunchStrategySweepQuoteToken,
  runAutolaunchStrategySweepToken,
  runAutolaunchSubjectByToken,
  runAutolaunchSubjectClaimUsdc,
  runAutolaunchSubjectCreateDeferredAutolaunch,
  runAutolaunchSubjectCreateExistingToken,
  runAutolaunchSubjectBuybacks,
  runAutolaunchSubjectIngress,
  runAutolaunchSubjectGet,
  runAutolaunchSubjectPaymentLinks,
  runAutolaunchSubjectRegentEmissions,
  runAutolaunchSubjectSettleBuyback,
  runAutolaunchSubjectStake,
  runAutolaunchSubjectStaking,
  runAutolaunchSubjectSweepIngress,
  runAutolaunchSubjectUnstake,
  runAutolaunchVestingCancelBeneficiaryRotation,
  runAutolaunchVestingExecuteBeneficiaryRotation,
  runAutolaunchVestingProposeBeneficiaryRotation,
  runAutolaunchVestingRelease,
  runAutolaunchVestingStatus,
} from "../commands/autolaunch.js";
import { requireArg } from "../parse.js";
import { route, type CliRoute } from "./shared.js";

export const autolaunchRoutes: readonly CliRoute[] = [
  route("autolaunch agents list", async ({ parsedArgs, configPath }) => {
    await runAutolaunchAgentsList(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch agent readiness <id>", async ({ positionals, configPath }) => {
    await runAutolaunchAgentReadiness(requireArg(positionals[3], "agent-id"), configPath);
    return 0;
  }),
  route("autolaunch agent <id>", async ({ positionals, configPath }) => {
    await runAutolaunchAgentShow(positionals[2] as string, configPath);
    return 0;
  }),
  route("autolaunch auctions list", async ({ parsedArgs, configPath }) => {
    await runAutolaunchAuctionsList(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch auction-returns list", async ({ parsedArgs, configPath }) => {
    await runAutolaunchAuctionReturnsList(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch auction <id>", async ({ positionals, configPath }) => {
    await runAutolaunchAuctionShow(positionals[2] as string, configPath);
    return 0;
  }),
  route("autolaunch auction state <id>", async ({ parsedArgs, positionals, configPath }) => {
    await runAutolaunchAuctionState(
      requireArg(positionals[3], "auction-id"),
      parsedArgs,
      configPath,
    );
    return 0;
  }),
  route("autolaunch bids quote", async ({ parsedArgs, configPath }) => {
    await runAutolaunchBidsQuote(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch bids place", async ({ parsedArgs, configPath }) => {
    await runAutolaunchBidsPlace(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch bids exit", async ({ parsedArgs, configPath }) => {
    await runAutolaunchBidsExit(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch bids claim", async ({ parsedArgs, configPath }) => {
    await runAutolaunchBidsClaim(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ens plan", async ({ parsedArgs, configPath }) => {
    await runAutolaunchEnsPlan(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ens prepare-ensip25", async ({ parsedArgs, configPath }) => {
    await runAutolaunchEnsPrepareEnsip25(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ens prepare-erc8004", async ({ parsedArgs, configPath }) => {
    await runAutolaunchEnsPrepareErc8004(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ens prepare-bidirectional", async ({ parsedArgs, configPath }) => {
    await runAutolaunchEnsPrepareBidirectional(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch identities list", async ({ parsedArgs }) => {
    await runAutolaunchIdentitiesList(parsedArgs);
    return 0;
  }),
  route("autolaunch identities mint", async ({ parsedArgs }) => {
    await runAutolaunchIdentitiesMint(parsedArgs);
    return 0;
  }),
  route("autolaunch pair", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPair(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch connect start", async ({ parsedArgs, configPath }) => {
    await runAutolaunchConnectStart(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch prelaunch wizard", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPrelaunchWizard(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch safe wizard", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSafeWizard(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch safe create", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSafeCreate(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch prelaunch get", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPrelaunchGet(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch prelaunch validate", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPrelaunchValidate(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch prelaunch publish", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPrelaunchPublish(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch launch preview", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchPreview(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch launch run", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchRun(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch launch state", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchState(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch launch monitor", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchMonitor(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("autolaunch launch finalize", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchFinalize(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch jobs watch", async ({ parsedArgs, configPath }) => {
    await runAutolaunchJobsWatch(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("autolaunch subjects get", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectGet(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects get <subject-id>" }),
  route("autolaunch subjects create-existing-token", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectCreateExistingToken(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects create-deferred-autolaunch", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectCreateDeferredAutolaunch(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects by-token", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectByToken(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects ingress", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectIngress(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects ingress <subject-id>" }),
  route("autolaunch subjects staking", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectStaking(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects staking <subject-id>" }),
  route("autolaunch subjects stake", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectStake(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects stake <subject-id>" }),
  route("autolaunch subjects unstake", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectUnstake(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects unstake <subject-id>" }),
  route("autolaunch subjects claim-usdc", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectClaimUsdc(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects claim-usdc <subject-id>" }),
  route("autolaunch subjects sweep-ingress", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectSweepIngress(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects sweep-ingress <subject-id>" }),
  route("autolaunch subjects buybacks", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectBuybacks(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects buybacks <subject-id>" }),
  route("autolaunch subjects settle-buyback", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectSettleBuyback(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects settle-buyback <subject-id>" }),
  route("autolaunch subjects payment-links", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectPaymentLinks(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects payment-links <subject-id>" }),
  route("autolaunch payment-links create", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPaymentLinkCreate(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch payment-links set-canonical", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPaymentLinkSetCanonical(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch payment-links set-state", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPaymentLinkSetState(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects regent-emissions", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectRegentEmissions(parsedArgs, configPath);
    return 0;
  }, { pattern: "autolaunch subjects regent-emissions <subject-id>" }),
  route("autolaunch contracts admin", async ({ configPath }) => {
    await runAutolaunchContractsAdminShow(configPath);
    return 0;
  }),
  route("autolaunch contracts job", async ({ parsedArgs, configPath }) => {
    await runAutolaunchContractsJobShow(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch contracts subject", async ({ parsedArgs, configPath }) => {
    await runAutolaunchContractsSubjectShow(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch strategy migrate", async ({ parsedArgs, configPath }) => {
    await runAutolaunchStrategyMigrate(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch strategy sweep-token", async ({ parsedArgs, configPath }) => {
    await runAutolaunchStrategySweepToken(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch strategy sweep-quote-token", async ({ parsedArgs, configPath }) => {
    await runAutolaunchStrategySweepQuoteToken(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch vesting release", async ({ parsedArgs, configPath }) => {
    await runAutolaunchVestingRelease(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch vesting propose-beneficiary-rotation", async ({ parsedArgs, configPath }) => {
    await runAutolaunchVestingProposeBeneficiaryRotation(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch vesting cancel-beneficiary-rotation", async ({ parsedArgs, configPath }) => {
    await runAutolaunchVestingCancelBeneficiaryRotation(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch vesting execute-beneficiary-rotation", async ({ parsedArgs, configPath }) => {
    await runAutolaunchVestingExecuteBeneficiaryRotation(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch vesting status", async ({ parsedArgs, configPath }) => {
    await runAutolaunchVestingStatus(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch fee-registry get", async ({ parsedArgs, configPath }) => {
    await runAutolaunchFeeRegistryGet(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch fee-vault get", async ({ parsedArgs, configPath }) => {
    await runAutolaunchFeeVaultGet(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch fee-vault withdraw-regent", async ({ parsedArgs, configPath }) => {
    await runAutolaunchFeeVaultWithdrawRegent(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter get", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterGet(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter accept-ownership", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterAcceptOwnership(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter set-paused", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterSetPaused(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter set-label", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterSetLabel(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter propose-eligible-revenue-share", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterProposeEligibleRevenueShare(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter cancel-eligible-revenue-share", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterCancelEligibleRevenueShare(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter activate-eligible-revenue-share", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterActivateEligibleRevenueShare(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter propose-treasury-recipient-rotation", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterProposeTreasuryRecipientRotation(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter cancel-treasury-recipient-rotation", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterCancelTreasuryRecipientRotation(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter execute-treasury-recipient-rotation", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterExecuteTreasuryRecipientRotation(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter sweep-treasury-residual", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterSweepTreasuryResidual(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter sweep-treasury-reserved", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterSweepTreasuryReserved(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter reassign-dust", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterReassignDust(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ingress create", async ({ parsedArgs, configPath }) => {
    await runAutolaunchIngressCreate(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ingress set-default", async ({ parsedArgs, configPath }) => {
    await runAutolaunchIngressSetDefault(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ingress set-label", async ({ parsedArgs, configPath }) => {
    await runAutolaunchIngressSetLabel(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch ingress rescue", async ({ parsedArgs, configPath }) => {
    await runAutolaunchIngressRescue(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch registry get", async ({ parsedArgs, configPath }) => {
    await runAutolaunchRegistryGet(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch registry set-subject-manager", async ({ parsedArgs, configPath }) => {
    await runAutolaunchRegistrySetSubjectManager(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch registry link-identity", async ({ parsedArgs, configPath }) => {
    await runAutolaunchRegistryLinkIdentity(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch registry rotate-safe", async ({ parsedArgs, configPath }) => {
    await runAutolaunchRegistryRotateSafe(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch factory revenue-share set-authorized-creator", async ({ parsedArgs, configPath }) => {
    await runAutolaunchRevenueShareFactorySetAuthorizedCreator(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch factory revenue-ingress set-authorized-creator", async ({ parsedArgs, configPath }) => {
    await runAutolaunchRevenueIngressFactorySetAuthorizedCreator(parsedArgs, configPath);
    return 0;
  }),
];
