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
  runXmtpPolicyEdit,
  runXmtpPolicyInit,
  runXmtpPolicyShow,
  runXmtpPolicyValidate,
  runXmtpRevokeOtherInstallations,
  runXmtpResolve,
  runXmtpRotateDbKey,
  runXmtpRotateWallet,
  runXmtpStatus,
  runXmtpTestDm,
  runXmtpTrustedAdd,
  runXmtpTrustedList,
  runXmtpTrustedRemove,
} from "../commands/xmtp.js";
import { route, type CliRoute } from "./shared.js";

export const xmtpRoutes: readonly CliRoute[] = [
  route("xmtp init", async ({ parsedArgs, configPath }) => runXmtpInit(parsedArgs, configPath)),
  route("xmtp info", async ({ configPath }) => {
    await runXmtpInfo(configPath);
    return 0;
  }),
  route("xmtp status", async ({ configPath }) => {
    await runXmtpStatus(configPath);
    return 0;
  }),
  route("xmtp resolve", async ({ parsedArgs, configPath }) => {
    await runXmtpResolve(parsedArgs, configPath);
    return 0;
  }),
  route("xmtp owner add", async ({ parsedArgs, configPath }) => {
    await runXmtpOwnerAdd(parsedArgs, configPath);
    return 0;
  }),
  route("xmtp owner list", async ({ configPath }) => {
    await runXmtpOwnerList(configPath);
    return 0;
  }),
  route("xmtp owner remove", async ({ parsedArgs, configPath }) => {
    await runXmtpOwnerRemove(parsedArgs, configPath);
    return 0;
  }),
  route("xmtp trusted add", async ({ parsedArgs, configPath }) => {
    await runXmtpTrustedAdd(parsedArgs, configPath);
    return 0;
  }),
  route("xmtp trusted list", async ({ configPath }) => {
    await runXmtpTrustedList(configPath);
    return 0;
  }),
  route("xmtp trusted remove", async ({ parsedArgs, configPath }) => {
    await runXmtpTrustedRemove(parsedArgs, configPath);
    return 0;
  }),
  route("xmtp policy init", async ({ configPath }) => {
    await runXmtpPolicyInit(configPath);
    return 0;
  }),
  route("xmtp policy show", async ({ configPath }) => {
    await runXmtpPolicyShow(configPath);
    return 0;
  }),
  route("xmtp policy validate", async ({ configPath }) => runXmtpPolicyValidate(configPath)),
  route("xmtp policy edit", async ({ configPath }) => {
    await runXmtpPolicyEdit(configPath);
    return 0;
  }),
  route("xmtp test dm", async ({ parsedArgs, configPath }) => {
    await runXmtpTestDm(parsedArgs, configPath);
    return 0;
  }),
  route("xmtp group create", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupCreate(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group add-member", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupAddMember(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group remove-member", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupRemoveMember(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group list", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupList(parsedArgs, configPath);
    return 0;
  }),
  route("xmtp group members", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupMembers(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group permissions", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupPermissions(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group update-permission", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupUpdatePermission(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group admins", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupAdmins(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group super-admins", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupSuperAdmins(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group add-admin", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupAddAdmin(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group remove-admin", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupRemoveAdmin(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group add-super-admin", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupAddSuperAdmin(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp group remove-super-admin", async ({ parsedArgs, configPath }) => {
    await runXmtpGroupRemoveSuperAdmin(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("xmtp revoke-other-installations", async ({ configPath }) => {
    await runXmtpRevokeOtherInstallations(configPath);
    return 0;
  }),
  route("xmtp rotate-db-key", async ({ configPath }) => {
    await runXmtpRotateDbKey(configPath);
    return 0;
  }),
  route("xmtp rotate-wallet", async ({ configPath }) => {
    await runXmtpRotateWallet(configPath);
    return 0;
  }),
  route("xmtp doctor", async ({ parsedArgs, configPath }) => runXmtpDoctor(parsedArgs, configPath)),
];
