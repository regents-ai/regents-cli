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
  runAutolaunchHoldingsClaimAndStakeEmissions,
  runAutolaunchHoldingsClaimEmissions,
  runAutolaunchHoldingsClaimUsdc,
  runAutolaunchHoldingsStake,
  runAutolaunchHoldingsSweepIngress,
  runAutolaunchHoldingsUnstake,
  runAutolaunchEnsPlan,
  runAutolaunchEnsPrepareBidirectional,
  runAutolaunchEnsPrepareErc8004,
  runAutolaunchEnsPrepareEnsip25,
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
  runAutolaunchSplitterSetProtocolRecipient,
  runAutolaunchSplitterSweepProtocolReserve,
  runAutolaunchSplitterSweepTreasuryReserved,
  runAutolaunchSplitterSweepTreasuryResidual,
  runAutolaunchSplitterShow,
  runAutolaunchStrategyMigrate,
  runAutolaunchStrategySweepCurrency,
  runAutolaunchStrategySweepToken,
  runAutolaunchSubjectClaimUsdc,
  runAutolaunchSubjectClaimAndStakeEmissions,
  runAutolaunchSubjectClaimEmissions,
  runAutolaunchSubjectIngress,
  runAutolaunchSubjectShow,
  runAutolaunchSubjectStake,
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
  route("autolaunch prelaunch show", async ({ parsedArgs, configPath }) => {
    await runAutolaunchPrelaunchShow(parsedArgs, configPath);
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
  route("autolaunch launch create", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchCreate(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch launch run", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchRun(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch launch monitor", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchMonitor(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch launch finalize", async ({ parsedArgs, configPath }) => {
    await runAutolaunchLaunchFinalize(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch jobs watch", async ({ parsedArgs, configPath }) => {
    await runAutolaunchJobsWatch(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects show", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectShow(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects ingress", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectIngress(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects stake", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectStake(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects unstake", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectUnstake(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects claim-usdc", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectClaimUsdc(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects claim-emissions", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectClaimEmissions(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects claim-and-stake-emissions", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectClaimAndStakeEmissions(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch subjects sweep-ingress", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSubjectSweepIngress(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch holdings stake", async ({ parsedArgs, configPath }) => {
    await runAutolaunchHoldingsStake(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch holdings unstake", async ({ parsedArgs, configPath }) => {
    await runAutolaunchHoldingsUnstake(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch holdings claim-usdc", async ({ parsedArgs, configPath }) => {
    await runAutolaunchHoldingsClaimUsdc(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch holdings claim-emissions", async ({ parsedArgs, configPath }) => {
    await runAutolaunchHoldingsClaimEmissions(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch holdings claim-and-stake-emissions", async ({ parsedArgs, configPath }) => {
    await runAutolaunchHoldingsClaimAndStakeEmissions(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch holdings sweep-ingress", async ({ parsedArgs, configPath }) => {
    await runAutolaunchHoldingsSweepIngress(parsedArgs, configPath);
    return 0;
  }),
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
  route("autolaunch strategy sweep-currency", async ({ parsedArgs, configPath }) => {
    await runAutolaunchStrategySweepCurrency(parsedArgs, configPath);
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
  route("autolaunch fee-registry show", async ({ parsedArgs, configPath }) => {
    await runAutolaunchFeeRegistryShow(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch fee-vault show", async ({ parsedArgs, configPath }) => {
    await runAutolaunchFeeVaultShow(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch fee-vault withdraw-treasury", async ({ parsedArgs, configPath }) => {
    await runAutolaunchFeeVaultWithdrawTreasury(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch fee-vault withdraw-regent", async ({ parsedArgs, configPath }) => {
    await runAutolaunchFeeVaultWithdrawRegent(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch splitter show", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterShow(parsedArgs, configPath);
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
  route("autolaunch splitter set-protocol-recipient", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterSetProtocolRecipient(parsedArgs, configPath);
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
  route("autolaunch splitter sweep-protocol-reserve", async ({ parsedArgs, configPath }) => {
    await runAutolaunchSplitterSweepProtocolReserve(parsedArgs, configPath);
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
  route("autolaunch registry show", async ({ parsedArgs, configPath }) => {
    await runAutolaunchRegistryShow(parsedArgs, configPath);
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
