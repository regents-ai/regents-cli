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
  route("autolaunch agents list", async ({ parsedArgs }) => {
    await runAutolaunchAgentsList(parsedArgs);
    return 0;
  }),
  route("autolaunch agent readiness <id>", async ({ positionals }) => {
    await runAutolaunchAgentReadiness(requireArg(positionals[3], "agent-id"));
    return 0;
  }),
  route("autolaunch agent <id>", async ({ positionals }) => {
    await runAutolaunchAgentShow(positionals[2] as string);
    return 0;
  }),
  route("autolaunch auctions list", async ({ parsedArgs }) => {
    await runAutolaunchAuctionsList(parsedArgs);
    return 0;
  }),
  route("autolaunch auction-returns list", async ({ parsedArgs, configPath }) => {
    await runAutolaunchAuctionReturnsList(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch auction <id>", async ({ positionals }) => {
    await runAutolaunchAuctionShow(positionals[2] as string);
    return 0;
  }),
  route("autolaunch bids quote", async ({ parsedArgs }) => {
    await runAutolaunchBidsQuote(parsedArgs);
    return 0;
  }),
  route("autolaunch bids place", async ({ parsedArgs }) => {
    await runAutolaunchBidsPlace(parsedArgs);
    return 0;
  }),
  route("autolaunch bids exit", async ({ parsedArgs }) => {
    await runAutolaunchBidsExit(parsedArgs);
    return 0;
  }),
  route("autolaunch bids claim", async ({ parsedArgs }) => {
    await runAutolaunchBidsClaim(parsedArgs);
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
  route("autolaunch contracts job", async ({ parsedArgs }) => {
    await runAutolaunchContractsJobShow(parsedArgs);
    return 0;
  }),
  route("autolaunch contracts subject", async ({ parsedArgs }) => {
    await runAutolaunchContractsSubjectShow(parsedArgs);
    return 0;
  }),
  route("autolaunch strategy migrate", async ({ parsedArgs, configPath }) => {
    await runAutolaunchStrategyMigrate(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch strategy sweep-token", async ({ parsedArgs }) => {
    await runAutolaunchStrategySweepToken(parsedArgs);
    return 0;
  }),
  route("autolaunch strategy sweep-currency", async ({ parsedArgs }) => {
    await runAutolaunchStrategySweepCurrency(parsedArgs);
    return 0;
  }),
  route("autolaunch vesting release", async ({ parsedArgs, configPath }) => {
    await runAutolaunchVestingRelease(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch vesting propose-beneficiary-rotation", async ({ parsedArgs }) => {
    await runAutolaunchVestingProposeBeneficiaryRotation(parsedArgs);
    return 0;
  }),
  route("autolaunch vesting cancel-beneficiary-rotation", async ({ parsedArgs }) => {
    await runAutolaunchVestingCancelBeneficiaryRotation(parsedArgs);
    return 0;
  }),
  route("autolaunch vesting execute-beneficiary-rotation", async ({ parsedArgs }) => {
    await runAutolaunchVestingExecuteBeneficiaryRotation(parsedArgs);
    return 0;
  }),
  route("autolaunch vesting status", async ({ parsedArgs, configPath }) => {
    await runAutolaunchVestingStatus(parsedArgs, configPath);
    return 0;
  }),
  route("autolaunch fee-registry show", async ({ parsedArgs }) => {
    await runAutolaunchFeeRegistryShow(parsedArgs);
    return 0;
  }),
  route("autolaunch fee-vault show", async ({ parsedArgs }) => {
    await runAutolaunchFeeVaultShow(parsedArgs);
    return 0;
  }),
  route("autolaunch fee-vault withdraw-treasury", async ({ parsedArgs }) => {
    await runAutolaunchFeeVaultWithdrawTreasury(parsedArgs);
    return 0;
  }),
  route("autolaunch fee-vault withdraw-regent", async ({ parsedArgs }) => {
    await runAutolaunchFeeVaultWithdrawRegent(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter show", async ({ parsedArgs }) => {
    await runAutolaunchSplitterShow(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter accept-ownership", async ({ parsedArgs }) => {
    await runAutolaunchSplitterAcceptOwnership(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter set-paused", async ({ parsedArgs }) => {
    await runAutolaunchSplitterSetPaused(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter set-label", async ({ parsedArgs }) => {
    await runAutolaunchSplitterSetLabel(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter propose-eligible-revenue-share", async ({ parsedArgs }) => {
    await runAutolaunchSplitterProposeEligibleRevenueShare(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter cancel-eligible-revenue-share", async ({ parsedArgs }) => {
    await runAutolaunchSplitterCancelEligibleRevenueShare(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter activate-eligible-revenue-share", async ({ parsedArgs }) => {
    await runAutolaunchSplitterActivateEligibleRevenueShare(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter propose-treasury-recipient-rotation", async ({ parsedArgs }) => {
    await runAutolaunchSplitterProposeTreasuryRecipientRotation(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter cancel-treasury-recipient-rotation", async ({ parsedArgs }) => {
    await runAutolaunchSplitterCancelTreasuryRecipientRotation(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter execute-treasury-recipient-rotation", async ({ parsedArgs }) => {
    await runAutolaunchSplitterExecuteTreasuryRecipientRotation(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter set-protocol-recipient", async ({ parsedArgs }) => {
    await runAutolaunchSplitterSetProtocolRecipient(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter sweep-treasury-residual", async ({ parsedArgs }) => {
    await runAutolaunchSplitterSweepTreasuryResidual(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter sweep-treasury-reserved", async ({ parsedArgs }) => {
    await runAutolaunchSplitterSweepTreasuryReserved(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter sweep-protocol-reserve", async ({ parsedArgs }) => {
    await runAutolaunchSplitterSweepProtocolReserve(parsedArgs);
    return 0;
  }),
  route("autolaunch splitter reassign-dust", async ({ parsedArgs }) => {
    await runAutolaunchSplitterReassignDust(parsedArgs);
    return 0;
  }),
  route("autolaunch ingress create", async ({ parsedArgs }) => {
    await runAutolaunchIngressCreate(parsedArgs);
    return 0;
  }),
  route("autolaunch ingress set-default", async ({ parsedArgs }) => {
    await runAutolaunchIngressSetDefault(parsedArgs);
    return 0;
  }),
  route("autolaunch ingress set-label", async ({ parsedArgs }) => {
    await runAutolaunchIngressSetLabel(parsedArgs);
    return 0;
  }),
  route("autolaunch ingress rescue", async ({ parsedArgs }) => {
    await runAutolaunchIngressRescue(parsedArgs);
    return 0;
  }),
  route("autolaunch registry show", async ({ parsedArgs }) => {
    await runAutolaunchRegistryShow(parsedArgs);
    return 0;
  }),
  route("autolaunch registry set-subject-manager", async ({ parsedArgs }) => {
    await runAutolaunchRegistrySetSubjectManager(parsedArgs);
    return 0;
  }),
  route("autolaunch registry link-identity", async ({ parsedArgs }) => {
    await runAutolaunchRegistryLinkIdentity(parsedArgs);
    return 0;
  }),
  route("autolaunch registry rotate-safe", async ({ parsedArgs }) => {
    await runAutolaunchRegistryRotateSafe(parsedArgs);
    return 0;
  }),
  route("autolaunch factory revenue-share set-authorized-creator", async ({ parsedArgs }) => {
    await runAutolaunchRevenueShareFactorySetAuthorizedCreator(parsedArgs);
    return 0;
  }),
  route("autolaunch factory revenue-ingress set-authorized-creator", async ({ parsedArgs }) => {
    await runAutolaunchRevenueIngressFactorySetAuthorizedCreator(parsedArgs);
    return 0;
  }),
];
