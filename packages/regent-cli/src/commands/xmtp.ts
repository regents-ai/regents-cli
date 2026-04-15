import {
  addXmtpGroupAdmin,
  addXmtpGroupMembers,
  addXmtpGroupSuperAdmin,
  createXmtpGroup,
  defaultConfigPath,
  ensureXmtpPolicyFile,
  getXmtpGroupPermissions,
  getXmtpStatus,
  initializeXmtp,
  listXmtpGroupAdmins,
  listXmtpGroupMembers,
  listXmtpGroupSuperAdmins,
  listXmtpAllowlist,
  listXmtpGroups,
  loadConfig,
  openXmtpPolicyInEditor,
  removeXmtpGroupAdmin,
  removeXmtpGroupMembers,
  removeXmtpGroupSuperAdmin,
  resolveXmtpIdentifier,
  resolveXmtpInboxId,
  revokeAllOtherXmtpInstallations,
  rotateXmtpDbKey,
  rotateXmtpWallet,
  showXmtpPolicy,
  testXmtpDm,
  updateXmtpGroupPermission,
  updateXmtpAllowlist,
  validateXmtpPolicy,
  writeConfigReplacement,
} from "../internal-runtime/index.js";

import { daemonCall } from "../daemon-client.js";
import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import { runDoctorCommand } from "./doctor.js";

const XMTP_GROUP_CREATE_PERMISSIONS = ["all-members", "admin-only"] as const;
const XMTP_GROUP_PERMISSION_TYPES = [
  "add-member",
  "remove-member",
  "add-admin",
  "remove-admin",
  "update-metadata",
] as const;
const XMTP_GROUP_PERMISSION_POLICIES = ["allow", "deny", "admin", "super-admin"] as const;
const XMTP_GROUP_METADATA_FIELDS = ["app-data", "group-description", "group-name", "group-image-url"] as const;

const resolveConfigPath = (configPath?: string): string => configPath ?? defaultConfigPath();
const loadResolvedConfig = (configPath?: string) => {
  const resolvedConfigPath = resolveConfigPath(configPath);
  return {
    resolvedConfigPath,
    config: loadConfig(resolvedConfigPath),
  };
};

const requirePositional = (args: ParsedCliArgs, index: number, name: string): string =>
  requireArg(args.positionals[index], name);

const requireAddress = (args: ParsedCliArgs, flag = "address"): `0x${string}` => {
  const address = getFlag(args, flag) ?? getFlag(args, "wallet-address");
  if (!address) {
    throw new Error(`missing required argument: --${flag}`);
  }

  return address as `0x${string}`;
};

const requireInboxOrAddress = (args: ParsedCliArgs): string =>
  requireArg(getFlag(args, "inbox-id") ?? getFlag(args, "address") ?? getFlag(args, "wallet-address"), "--address or --inbox-id");

const requireEnumFlag = <T extends readonly string[]>(
  value: string | undefined,
  flag: string,
  options: T,
): T[number] => {
  const resolved = requireArg(value, `--${flag}`);
  if (!options.includes(resolved)) {
    throw new Error(`invalid --${flag}; expected one of: ${options.join(", ")}`);
  }

  return resolved as T[number];
};

const resolveStatus = async (configPath?: string) => {
  const { resolvedConfigPath, config } = loadResolvedConfig(configPath);

  try {
    return await daemonCall("xmtp.status", undefined, resolvedConfigPath);
  } catch {
    return getXmtpStatus(config.xmtp);
  }
};

const updateAllowlistConfig = async (
  args: ParsedCliArgs,
  configPath: string,
  list: "owner" | "trusted",
  action: "add" | "remove",
): Promise<void> => {
  const { resolvedConfigPath, config } = loadResolvedConfig(configPath);
  const identifier = requireInboxOrAddress(args);

  const inboxId = await resolveXmtpIdentifier(config.xmtp, identifier);
  const current = list === "owner" ? config.xmtp.ownerInboxIds : config.xmtp.trustedInboxIds;
  const next = updateXmtpAllowlist(current, action, inboxId).updated;

  writeConfigReplacement(resolvedConfigPath, {
    ...config,
    xmtp: {
      ...config.xmtp,
      [list === "owner" ? "ownerInboxIds" : "trustedInboxIds"]: next,
    },
  });

  printJson({
    ok: true,
    updated: next,
    changedInboxId: inboxId,
  });
};

export async function runXmtpInit(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const resolvedConfigPath = resolveConfigPath(configPath);
  let config = loadConfig(resolvedConfigPath);

  config = writeConfigReplacement(resolvedConfigPath, {
    ...config,
    xmtp: {
      ...config.xmtp,
      enabled: true,
    },
  });

  let result = await initializeXmtp(config.xmtp, resolvedConfigPath);
  const owner = getFlag(args, "owner");
  if (owner) {
    const inboxId = await resolveXmtpIdentifier(config.xmtp, owner);
    config = writeConfigReplacement(resolvedConfigPath, {
      ...config,
      xmtp: {
        ...config.xmtp,
        ownerInboxIds: Array.from(new Set([...config.xmtp.ownerInboxIds, inboxId])),
      },
    });
    result = {
      ...result,
      enabled: true,
      ownerInboxIds: [...config.xmtp.ownerInboxIds],
    };
  }

  printJson({
    ok: true,
    ...result,
  });

  return 0;
}

export async function runXmtpInfo(configPath?: string): Promise<void> {
  const { resolvedConfigPath, config } = loadResolvedConfig(configPath);

  printJson({
    config: config.xmtp,
    status: await resolveStatus(resolvedConfigPath),
  });
}

export async function runXmtpStatus(configPath?: string): Promise<void> {
  printJson(await resolveStatus(configPath));
}

export async function runXmtpResolve(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const address = requireAddress(args);
  const inboxId = await resolveXmtpInboxId(config.xmtp, address);

  printJson({
    address,
    inboxId,
  });
}

export async function runXmtpOwnerAdd(args: ParsedCliArgs, configPath?: string): Promise<void> {
  await updateAllowlistConfig(args, resolveConfigPath(configPath), "owner", "add");
}

export async function runXmtpOwnerList(configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  printJson(listXmtpAllowlist(config.xmtp, "owner"));
}

export async function runXmtpOwnerRemove(args: ParsedCliArgs, configPath?: string): Promise<void> {
  await updateAllowlistConfig(args, resolveConfigPath(configPath), "owner", "remove");
}

export async function runXmtpTrustedAdd(args: ParsedCliArgs, configPath?: string): Promise<void> {
  await updateAllowlistConfig(args, resolveConfigPath(configPath), "trusted", "add");
}

export async function runXmtpTrustedList(configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  printJson(listXmtpAllowlist(config.xmtp, "trusted"));
}

export async function runXmtpTrustedRemove(args: ParsedCliArgs, configPath?: string): Promise<void> {
  await updateAllowlistConfig(args, resolveConfigPath(configPath), "trusted", "remove");
}

export async function runXmtpPolicyInit(configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  printJson({
    ok: true,
    ...ensureXmtpPolicyFile(config.xmtp),
  });
}

export async function runXmtpPolicyEdit(configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  printJson(openXmtpPolicyInEditor(config.xmtp));
}

export async function runXmtpPolicyShow(configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  printJson(showXmtpPolicy(config.xmtp));
}

export async function runXmtpPolicyValidate(configPath?: string): Promise<number> {
  const { config } = loadResolvedConfig(configPath);
  const result = validateXmtpPolicy(config.xmtp);
  printJson(result);
  return result.ok ? 0 : 1;
}

export async function runXmtpDoctor(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const normalizedArgs: ParsedCliArgs = {
    ...args,
    positionals: ["doctor", "xmtp", ...args.positionals.slice(2)],
  };

  return runDoctorCommand(normalizedArgs, resolveConfigPath(configPath));
}

export async function runXmtpTestDm(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const to = requireAddress(args, "to");
  const message = requireArg(getFlag(args, "message"), "--message");

  printJson(await testXmtpDm(config.xmtp, to, message));
}

export async function runXmtpGroupCreate(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const members = args.positionals.slice(3);
  const permissionsFlag = getFlag(args, "permissions");
  const permissions =
    permissionsFlag === undefined
      ? undefined
      : requireEnumFlag(permissionsFlag, "permissions", XMTP_GROUP_CREATE_PERMISSIONS);

  printJson(
    await createXmtpGroup(config.xmtp, members, {
      name: getFlag(args, "name"),
      description: getFlag(args, "description"),
      imageUrl: getFlag(args, "image-url"),
      permissions,
    }),
  );
}

export async function runXmtpGroupAddMember(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  const members = args.positionals.slice(4);

  printJson(await addXmtpGroupMembers(config.xmtp, conversationId, members));
}

export async function runXmtpGroupRemoveMember(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  const members = args.positionals.slice(4);

  printJson(await removeXmtpGroupMembers(config.xmtp, conversationId, members));
}

export async function runXmtpGroupList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  printJson(await listXmtpGroups(config.xmtp, { sync: getBooleanFlag(args, "sync") }));
}

export async function runXmtpGroupMembers(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  printJson(await listXmtpGroupMembers(config.xmtp, conversationId, { sync: getBooleanFlag(args, "sync") }));
}

export async function runXmtpGroupPermissions(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  printJson(await getXmtpGroupPermissions(config.xmtp, conversationId));
}

export async function runXmtpGroupUpdatePermission(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  const type = requireEnumFlag(getFlag(args, "type"), "type", XMTP_GROUP_PERMISSION_TYPES);
  const policy = requireEnumFlag(getFlag(args, "policy"), "policy", XMTP_GROUP_PERMISSION_POLICIES);
  const metadataFieldFlag = getFlag(args, "metadata-field");
  if (type === "update-metadata" && !metadataFieldFlag) {
    throw new Error("missing required argument: --metadata-field");
  }
  if (metadataFieldFlag && !XMTP_GROUP_METADATA_FIELDS.includes(metadataFieldFlag as (typeof XMTP_GROUP_METADATA_FIELDS)[number])) {
    throw new Error(`invalid --metadata-field; expected one of: ${XMTP_GROUP_METADATA_FIELDS.join(", ")}`);
  }
  if (metadataFieldFlag && type !== "update-metadata") {
    throw new Error("--metadata-field is only allowed with --type update-metadata");
  }
  const metadataField =
    metadataFieldFlag === undefined ? undefined : (metadataFieldFlag as (typeof XMTP_GROUP_METADATA_FIELDS)[number]);

  printJson(
    await updateXmtpGroupPermission(config.xmtp, conversationId, {
      type,
      policy,
      metadataField: metadataField ?? undefined,
    }),
  );
}

export async function runXmtpGroupAdmins(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  printJson(await listXmtpGroupAdmins(config.xmtp, conversationId));
}

export async function runXmtpGroupSuperAdmins(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  printJson(await listXmtpGroupSuperAdmins(config.xmtp, conversationId));
}

const resolveGroupRoleInboxId = async (configPath: string | undefined, args: ParsedCliArgs): Promise<{
  config: ReturnType<typeof loadResolvedConfig>["config"];
  conversationId: string;
  inboxId: string;
}> => {
  const { config } = loadResolvedConfig(configPath);
  const conversationId = requirePositional(args, 3, "conversation-id");
  const providedInboxId = getFlag(args, "inbox-id");
  const inboxId = providedInboxId
    ? providedInboxId
    : await resolveXmtpIdentifier(config.xmtp, requireInboxOrAddress(args));

  return { config, conversationId, inboxId };
};

export async function runXmtpGroupAddAdmin(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config, conversationId, inboxId } = await resolveGroupRoleInboxId(configPath, args);
  printJson(await addXmtpGroupAdmin(config.xmtp, conversationId, inboxId));
}

export async function runXmtpGroupRemoveAdmin(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config, conversationId, inboxId } = await resolveGroupRoleInboxId(configPath, args);
  printJson(await removeXmtpGroupAdmin(config.xmtp, conversationId, inboxId));
}

export async function runXmtpGroupAddSuperAdmin(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config, conversationId, inboxId } = await resolveGroupRoleInboxId(configPath, args);
  printJson(await addXmtpGroupSuperAdmin(config.xmtp, conversationId, inboxId));
}

export async function runXmtpGroupRemoveSuperAdmin(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const { config, conversationId, inboxId } = await resolveGroupRoleInboxId(configPath, args);
  printJson(await removeXmtpGroupSuperAdmin(config.xmtp, conversationId, inboxId));
}

export async function runXmtpRevokeOtherInstallations(configPath?: string): Promise<void> {
  const { config } = loadResolvedConfig(configPath);
  printJson(await revokeAllOtherXmtpInstallations(config.xmtp));
}

export async function runXmtpRotateDbKey(configPath?: string): Promise<void> {
  const config = loadConfig(resolveConfigPath(configPath));
  printJson(await rotateXmtpDbKey(config.xmtp));
}

export async function runXmtpRotateWallet(configPath?: string): Promise<void> {
  const config = loadConfig(resolveConfigPath(configPath));
  printJson(await rotateXmtpWallet(config.xmtp));
}
