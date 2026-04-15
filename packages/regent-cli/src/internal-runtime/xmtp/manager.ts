import { execFile as execFileCallback, spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import type {
  RegentConfig,
  RegentXmtpEnv,
  XmtpClientInfo,
  XmtpDmTestResult,
  XmtpGroupAddMembersResult,
  XmtpGroupCreateResult,
  XmtpGroupListResult,
  XmtpGroupMembersResult,
  XmtpGroupPermissionUpdateResult,
  XmtpGroupPermissionsResult,
  XmtpGroupRemoveMembersResult,
  XmtpGroupRoleListResult,
  XmtpGroupRoleMutationResult,
  XmtpInitResult,
  XmtpInstallationRevokeResult,
  XmtpMutationResult,
  XmtpPolicyShowResult,
  XmtpPolicyValidationResult,
  XmtpRecentConversation,
  XmtpRecentError,
  XmtpRotationResult,
  XmtpRuntimeMetrics,
  XmtpStatus,
} from "../../internal-types/index.js";

import { generateWallet } from "../agent/wallet.js";
import { RegentError, errorMessage } from "../errors.js";
import { ensureParentDir } from "../paths.js";

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const SECRET_FILE_MODE = 0o600;
const MAX_RECENT_ERRORS = 10;
const MAX_RECENT_CONVERSATIONS = 20;

const DEFAULT_PUBLIC_POLICY = `You are representing your owner to a third party.
Be helpful and conversational, but keep responses limited to general conversation.
Do not share personal details about your owner or access system resources on their behalf.
If unsure whether something is appropriate, err on the side of caution.
`;

interface XmtpCliInfoPayload {
  properties?: {
    address?: string;
    inboxId?: string;
    installationId?: string;
    isRegistered?: boolean;
    appVersion?: string;
    libxmtpVersion?: string;
  };
}

interface XmtpCliInboxIdPayload {
  inboxId?: string | null;
  found?: boolean;
}

interface XmtpCliConversationRecord {
  id?: string;
  type?: string;
  createdAt?: string;
  peerInboxId?: string;
  name?: string;
}

interface XmtpCliCreateGroupResult {
  id?: string;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  memberCount?: number;
  members?: Array<{
    inboxId?: string;
    permissionLevel?: string | number;
  }>;
}

interface XmtpCliAddMembersResult {
  conversationId?: string;
  addedMembers?: string[];
  count?: number;
}

interface XmtpCliSendTextResult {
  success?: boolean;
  messageId?: string;
  conversationId?: string;
  text?: string;
}

interface XmtpCliCreateDmResult {
  id?: string;
}

interface XmtpCliGroupMemberRecord {
  inboxId?: string;
  accountIdentifiers?: string[];
  installationIds?: string[];
  permissionLevel?: string | number | null;
  consentState?: string | null;
}

interface XmtpCliGroupPermissionsResult {
  conversationId?: string;
  permissions?: {
    policyType?: string | null;
    policySet?: Record<string, unknown>;
  };
}

interface XmtpCliGroupPermissionUpdateResult {
  success?: boolean;
  conversationId?: string;
  permissionType?: string;
  policy?: string;
  metadataField?: string | null;
}

interface XmtpCliGroupRoleListResult {
  conversationId?: string;
  admins?: string[];
  superAdmins?: string[];
  count?: number;
}

interface XmtpCliGroupRoleMutationResult {
  success?: boolean;
  conversationId?: string;
  inboxId?: string;
  message?: string;
}

interface XmtpCliRemoveMembersResult {
  success?: boolean;
  conversationId?: string;
  removedMembers?: string[];
  count?: number;
}

interface XmtpRuntimeState {
  connected: boolean;
  metrics: XmtpRuntimeMetrics;
  recentErrors: XmtpRecentError[];
  recentConversations: XmtpRecentConversation[];
}

const defaultMetrics = (): XmtpRuntimeMetrics => ({
  startedAt: null,
  stoppedAt: null,
  lastSyncAt: null,
  lastMessageAt: null,
  receivedMessages: 0,
  sentMessages: 0,
  sendFailures: 0,
  groupsCreated: 0,
  membersAdded: 0,
  installationsRevoked: 0,
  walletRotations: 0,
  dbKeyRotations: 0,
  restarts: 0,
});

const defaultRuntimeState = (): XmtpRuntimeState => ({
  connected: false,
  metrics: defaultMetrics(),
  recentErrors: [],
  recentConversations: [],
});

const resolveXmtpCliPackageJsonPath = (): string => {
  let mainPath: string;
  try {
    mainPath = require.resolve("@xmtp/cli");
  } catch (error) {
    throw new RegentError("xmtp_cli_missing", "missing @xmtp/cli dependency in runtime workspace", error);
  }

  let currentDir = path.dirname(mainPath);
  while (currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, "package.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    currentDir = path.dirname(currentDir);
  }

  throw new RegentError("xmtp_cli_missing", "unable to resolve the @xmtp/cli package root");
};

const resolveXmtpCliBinPath = (): string => {
  const packageJsonPath = resolveXmtpCliPackageJsonPath();
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { bin?: { xmtp?: string } };
  const relativeBin = packageJson.bin?.xmtp;

  if (!relativeBin) {
    throw new RegentError("xmtp_cli_missing", "unable to resolve the xmtp CLI binary from @xmtp/cli");
  }

  return path.resolve(path.dirname(packageJsonPath), relativeBin);
};

const writeFileWithMode = (filePath: string, value: string, mode = SECRET_FILE_MODE): void => {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${value.trim()}\n`, "utf8");
  fs.chmodSync(filePath, mode);
};

const readRequiredFile = (filePath: string, kind: string): string => {
  if (!fs.existsSync(filePath)) {
    throw new RegentError("xmtp_not_initialized", `missing XMTP ${kind} at ${filePath}; run \`regent xmtp init\``);
  }

  return fs.readFileSync(filePath, "utf8").trim();
};

const readOptionalFile = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf8").trim() || null;
};

export const xmtpRuntimeStatePath = (config: RegentConfig["xmtp"]): string => {
  return path.join(path.dirname(config.dbPath), "runtime-state.json");
};

const parseRuntimeState = (raw: string): XmtpRuntimeState => {
  const parsed = JSON.parse(raw) as Partial<XmtpRuntimeState>;
  return {
    connected: parsed.connected === true,
    metrics: {
      ...defaultMetrics(),
      ...(parsed.metrics ?? {}),
    },
    recentErrors: Array.isArray(parsed.recentErrors)
      ? parsed.recentErrors
          .filter((item): item is XmtpRecentError => {
            return !!item && typeof item.at === "string" && typeof item.code === "string" && typeof item.message === "string";
          })
          .slice(0, MAX_RECENT_ERRORS)
      : [],
    recentConversations: Array.isArray(parsed.recentConversations)
      ? parsed.recentConversations
          .filter((item): item is XmtpRecentConversation => !!item && typeof item.id === "string")
          .slice(0, MAX_RECENT_CONVERSATIONS)
      : [],
  };
};

export const readXmtpRuntimeState = (config: RegentConfig["xmtp"]): XmtpRuntimeState => {
  const statePath = xmtpRuntimeStatePath(config);
  if (!fs.existsSync(statePath)) {
    return defaultRuntimeState();
  }

  try {
    return parseRuntimeState(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    return {
      ...defaultRuntimeState(),
      recentErrors: [
        {
          at: new Date().toISOString(),
          code: "runtime_state_invalid",
          message: errorMessage(error),
        },
      ],
    };
  }
};

export const writeXmtpRuntimeState = (config: RegentConfig["xmtp"], state: XmtpRuntimeState): XmtpRuntimeState => {
  const statePath = xmtpRuntimeStatePath(config);
  ensureParentDir(statePath);
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
};

export const updateXmtpRuntimeState = (
  config: RegentConfig["xmtp"],
  updater: (current: XmtpRuntimeState) => XmtpRuntimeState,
): XmtpRuntimeState => {
  const next = updater(readXmtpRuntimeState(config));
  return writeXmtpRuntimeState(config, next);
};

export const recordXmtpRuntimeError = (
  config: RegentConfig["xmtp"],
  code: string,
  message: string,
): XmtpRuntimeState => {
  return updateXmtpRuntimeState(config, (current) => ({
    ...current,
    recentErrors: [
      {
        at: new Date().toISOString(),
        code,
        message,
      },
      ...current.recentErrors,
    ].slice(0, MAX_RECENT_ERRORS),
  }));
};

export const recordXmtpRecentConversation = (
  config: RegentConfig["xmtp"],
  conversation: XmtpRecentConversation,
): XmtpRuntimeState => {
  return updateXmtpRuntimeState(config, (current) => ({
    ...current,
    recentConversations: [
      conversation,
      ...current.recentConversations.filter((item) => item.id !== conversation.id),
    ].slice(0, MAX_RECENT_CONVERSATIONS),
  }));
};

const trimAddress = (value: string): `0x${string}` => value.trim().toLowerCase() as `0x${string}`;

const parseInitOutput = (stdout: string, env: RegentXmtpEnv): { walletKey: string; dbEncryptionKey: string } => {
  const entries = Object.fromEntries(
    stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=")];
      }),
  ) as Record<string, string>;

  const walletKey = entries.XMTP_WALLET_KEY;
  const dbEncryptionKey = entries.XMTP_DB_ENCRYPTION_KEY;
  const resolvedEnv = entries.XMTP_ENV;

  if (!walletKey || !dbEncryptionKey || resolvedEnv !== env) {
    throw new RegentError("xmtp_cli_error", "xmtp init did not return the expected key material");
  }

  return {
    walletKey,
    dbEncryptionKey,
  };
};

const normalizeClientInfo = (payload: XmtpCliInfoPayload): XmtpClientInfo => {
  const address = payload.properties?.address;
  const inboxId = payload.properties?.inboxId;
  const installationId = payload.properties?.installationId;

  if (!address || !inboxId || !installationId) {
    throw new RegentError("xmtp_cli_error", "xmtp client info returned an incomplete payload");
  }

  return {
    address: trimAddress(address),
    inboxId,
    installationId,
    isRegistered: payload.properties?.isRegistered === true,
    appVersion: payload.properties?.appVersion,
    libxmtpVersion: payload.properties?.libxmtpVersion,
  };
};

const normalizeRecentConversation = (payload: XmtpCliConversationRecord): XmtpRecentConversation => ({
  id: payload.id ?? "unknown",
  type: payload.type === "group" || payload.type === "dm" ? payload.type : "unknown",
  createdAt: payload.createdAt,
  peerInboxId: payload.peerInboxId,
  name: payload.name,
});

export const cliConnectionArgs = (config: RegentConfig["xmtp"]): string[] => {
  const walletKey = readRequiredFile(config.walletKeyPath, "wallet key");
  const dbEncryptionKey = readRequiredFile(config.dbEncryptionKeyPath, "database encryption key");

  return [
    "--env",
    config.env,
    "--wallet-key",
    walletKey,
    "--db-encryption-key",
    dbEncryptionKey,
    "--db-path",
    config.dbPath,
    "--log-level",
    "off",
  ];
};

export const spawnXmtpCliProcess = (
  config: RegentConfig["xmtp"],
  args: string[],
): ChildProcessByStdio<null, import("node:stream").Readable, import("node:stream").Readable> => {
  return spawn(process.execPath, [resolveXmtpCliBinPath(), ...args, ...cliConnectionArgs(config)], {
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const runXmtpCli = async (args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFile(process.execPath, [resolveXmtpCliBinPath(), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      maxBuffer: 1024 * 1024 * 4,
    });

    return stdout.trim();
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    throw new RegentError(
      "xmtp_cli_error",
      failure.stderr?.trim() || failure.stdout?.trim() || failure.message || "xmtp CLI command failed",
      error,
    );
  }
};

const runConnectedXmtpCli = async (config: RegentConfig["xmtp"], args: string[]): Promise<string> => {
  return runXmtpCli([...args, ...cliConnectionArgs(config)]);
};

const runConnectedXmtpCliJson = async <T>(config: RegentConfig["xmtp"], args: string[]): Promise<T> => {
  const stdout = await runConnectedXmtpCli(config, [...args, "--json"]);
  return JSON.parse(stdout) as T;
};

const deleteDatabaseArtifacts = (dbPath: string): boolean => {
  let removed = false;
  for (const candidate of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    fs.rmSync(candidate, { force: true, recursive: false });
    removed = true;
  }

  return removed;
};

export const ensureXmtpPolicyFile = (config: RegentConfig["xmtp"]): { created: boolean; path: string } => {
  if (fs.existsSync(config.publicPolicyPath)) {
    return { created: false, path: config.publicPolicyPath };
  }

  ensureParentDir(config.publicPolicyPath);
  fs.writeFileSync(config.publicPolicyPath, DEFAULT_PUBLIC_POLICY, "utf8");
  return { created: true, path: config.publicPolicyPath };
};

export const showXmtpPolicy = (config: RegentConfig["xmtp"]): XmtpPolicyShowResult => {
  return {
    ok: true,
    path: config.publicPolicyPath,
    content: fs.existsSync(config.publicPolicyPath) ? fs.readFileSync(config.publicPolicyPath, "utf8") : "",
  };
};

export const validateXmtpPolicy = (config: RegentConfig["xmtp"]): XmtpPolicyValidationResult => {
  const issues: string[] = [];

  if (!fs.existsSync(config.publicPolicyPath)) {
    issues.push("Policy file is missing.");
  } else {
    const content = fs.readFileSync(config.publicPolicyPath, "utf8");
    if (!content.trim()) {
      issues.push("Policy file is empty.");
    }

    if (content.trim().length < 40) {
      issues.push("Policy file is too short to constrain public messaging safely.");
    }
  }

  return {
    ok: issues.length === 0,
    path: config.publicPolicyPath,
    issues,
  };
};

export const xmtpMaterialExists = (config: RegentConfig["xmtp"]): boolean => {
  return fs.existsSync(config.walletKeyPath) && fs.existsSync(config.dbEncryptionKeyPath);
};

export const loadXmtpClientInfo = async (config: RegentConfig["xmtp"]): Promise<XmtpClientInfo> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliInfoPayload>(config, ["client", "info"]);
  return normalizeClientInfo(payload);
};

export const resolveXmtpInboxId = async (
  config: RegentConfig["xmtp"],
  identifier: `0x${string}`,
): Promise<string | null> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliInboxIdPayload>(config, ["client", "inbox-id", "-i", identifier]);
  return payload.found === false ? null : (payload.inboxId ?? null);
};

export const resolveXmtpIdentifier = async (config: RegentConfig["xmtp"], identifier: string): Promise<string> => {
  if (!identifier) {
    throw new RegentError("xmtp_identifier_missing", "missing XMTP identifier");
  }

  if (identifier.startsWith("0x")) {
    const inboxId = await resolveXmtpInboxId(config, trimAddress(identifier));
    if (!inboxId) {
      throw new RegentError("xmtp_inbox_not_found", `no XMTP inbox found for ${identifier}`);
    }

    return inboxId;
  }

  return identifier.trim();
};

export const ensureXmtpMaterial = async (
  config: RegentConfig["xmtp"],
): Promise<{ createdWalletKey: boolean; createdDbEncryptionKey: boolean }> => {
  const walletExists = fs.existsSync(config.walletKeyPath);
  const dbKeyExists = fs.existsSync(config.dbEncryptionKeyPath);

  if (walletExists && dbKeyExists) {
    return {
      createdWalletKey: false,
      createdDbEncryptionKey: false,
    };
  }

  const stdout = await runXmtpCli(["init", "--stdout", "--env", config.env]);
  const initResult = parseInitOutput(stdout, config.env);

  if (!walletExists) {
    writeFileWithMode(config.walletKeyPath, initResult.walletKey);
  }

  if (!dbKeyExists) {
    writeFileWithMode(config.dbEncryptionKeyPath, initResult.dbEncryptionKey);
  }

  return {
    createdWalletKey: !walletExists,
    createdDbEncryptionKey: !dbKeyExists,
  };
};

export const initializeXmtp = async (
  config: RegentConfig["xmtp"],
  configPath: string,
): Promise<XmtpInitResult> => {
  const { createdWalletKey, createdDbEncryptionKey } = await ensureXmtpMaterial(config);
  const { created: createdPolicyFile } = ensureXmtpPolicyFile(config);
  const client = await loadXmtpClientInfo(config);

  updateXmtpRuntimeState(config, (current) => ({
      ...current,
      recentConversations: [
        {
          id: client.inboxId,
          type: "unknown" as const,
          createdAt: new Date().toISOString(),
          peerInboxId: client.inboxId,
        },
      ...current.recentConversations.filter((item) => item.id !== client.inboxId),
    ].slice(0, MAX_RECENT_CONVERSATIONS),
  }));

  return {
    configPath,
    enabled: config.enabled,
    env: config.env,
    dbPath: config.dbPath,
    dbEncryptionKeyPath: config.dbEncryptionKeyPath,
    walletKeyPath: config.walletKeyPath,
    publicPolicyPath: config.publicPolicyPath,
    ownerInboxIds: [...config.ownerInboxIds],
    trustedInboxIds: [...config.trustedInboxIds],
    profiles: { ...config.profiles },
    createdWalletKey,
    createdDbEncryptionKey,
    createdPolicyFile,
    client,
  };
};

export const listXmtpAllowlist = (
  config: RegentConfig["xmtp"],
  list: "owner" | "trusted",
): { ok: true; items: string[] } => ({
  ok: true,
  items: list === "owner" ? [...config.ownerInboxIds] : [...config.trustedInboxIds],
});

export const updateXmtpAllowlist = (
  current: string[],
  action: "add" | "remove",
  inboxId: string,
): XmtpMutationResult => {
  const normalized = inboxId.trim();
  const next =
    action === "add"
      ? Array.from(new Set([...current, normalized]))
      : current.filter((item) => item !== normalized);

  return {
    ok: true,
    updated: next,
  };
};

export const generateStandaloneXmtpWallet = async (): Promise<`0x${string}`> => {
  const wallet = await generateWallet();
  return wallet.privateKey;
};

export const syncXmtpConversations = async (config: RegentConfig["xmtp"]): Promise<void> => {
  await runConnectedXmtpCli(config, ["conversations", "sync-all"]);
  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      lastSyncAt: new Date().toISOString(),
    },
  }));
};

export const listXmtpGroups = async (
  config: RegentConfig["xmtp"],
  options?: { sync?: boolean },
): Promise<XmtpGroupListResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliConversationRecord[]>(
    config,
    [
      "conversations",
      "list",
      "--type",
      "group",
      ...(options?.sync ? ["--sync"] : []),
    ],
  );

  const conversations = payload.map(normalizeRecentConversation);
  if (conversations[0]) {
    recordXmtpRecentConversation(config, conversations[0]);
  }

  return {
    ok: true,
    conversations,
  };
};

export const createXmtpGroup = async (
  config: RegentConfig["xmtp"],
  members: string[],
  options?: {
    name?: string;
    description?: string;
    imageUrl?: string;
    permissions?: "all-members" | "admin-only";
  },
): Promise<XmtpGroupCreateResult> => {
  if (members.length === 0) {
    throw new RegentError("xmtp_group_members_missing", "at least one member address is required");
  }

  const payload = await runConnectedXmtpCliJson<XmtpCliCreateGroupResult>(config, [
    "conversations",
    "create-group",
    ...members.map((member) => member.toLowerCase()),
    ...(options?.name ? ["--name", options.name] : []),
    ...(options?.description ? ["--description", options.description] : []),
    ...(options?.imageUrl ? ["--image-url", options.imageUrl] : []),
    ...(options?.permissions ? ["--permissions", options.permissions] : []),
  ]);

  if (!payload.id) {
    throw new RegentError("xmtp_cli_error", "group create did not return a conversation id");
  }

  recordXmtpRecentConversation(config, {
    id: payload.id,
    type: "group",
    name: payload.name ?? undefined,
  });
  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      groupsCreated: current.metrics.groupsCreated + 1,
    },
  }));

  return {
    ok: true,
    id: payload.id,
    name: payload.name,
    description: payload.description,
    imageUrl: payload.imageUrl,
    memberCount: payload.memberCount ?? payload.members?.length ?? 0,
    members: (payload.members ?? []).map((member) => ({
      inboxId: member.inboxId ?? "unknown",
      permissionLevel: member.permissionLevel,
    })),
  };
};

export const addXmtpGroupMembers = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  members: string[],
): Promise<XmtpGroupAddMembersResult> => {
  if (members.length === 0) {
    throw new RegentError("xmtp_group_members_missing", "at least one member address is required");
  }

  const payload = await runConnectedXmtpCliJson<XmtpCliAddMembersResult>(config, [
    "conversation",
    "add-members",
    conversationId,
    ...members.map((member) => member.toLowerCase()),
  ]);

  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      membersAdded: current.metrics.membersAdded + (payload.count ?? members.length),
    },
  }));

  return {
    ok: true,
    conversationId: payload.conversationId ?? conversationId,
    addedMembers: payload.addedMembers ?? members,
    count: payload.count ?? members.length,
  };
};

export const removeXmtpGroupMembers = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  members: string[],
): Promise<XmtpGroupRemoveMembersResult> => {
  if (members.length === 0) {
    throw new RegentError("xmtp_group_members_missing", "at least one member address is required");
  }

  const payload = await runConnectedXmtpCliJson<XmtpCliRemoveMembersResult>(config, [
    "conversation",
    "remove-members",
    conversationId,
    ...members.map((member) => member.toLowerCase()),
  ]);

  return {
    ok: true,
    conversationId: payload.conversationId ?? conversationId,
    removedMembers: payload.removedMembers ?? members,
    count: payload.count ?? members.length,
  };
};

export const listXmtpGroupMembers = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  options?: { sync?: boolean },
): Promise<XmtpGroupMembersResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliGroupMemberRecord[]>(config, [
    "conversation",
    "members",
    conversationId,
    ...(options?.sync ? ["--sync"] : []),
  ]);

  const members = payload.map((member) => ({
    inboxId: member.inboxId ?? "unknown",
    accountIdentifiers: member.accountIdentifiers ?? [],
    installationIds: member.installationIds ?? [],
    permissionLevel: member.permissionLevel ?? null,
    consentState: member.consentState ?? null,
  }));

  return {
    ok: true,
    conversationId,
    members,
    count: members.length,
  };
};

export const getXmtpGroupPermissions = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
): Promise<XmtpGroupPermissionsResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliGroupPermissionsResult>(config, [
    "conversation",
    "permissions",
    conversationId,
  ]);

  return {
    ok: true,
    conversationId: payload.conversationId ?? conversationId,
    permissions: {
      policyType: payload.permissions?.policyType ?? null,
      policySet: payload.permissions?.policySet ?? {},
    },
  };
};

export const updateXmtpGroupPermission = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  input: {
    type: string;
    policy: string;
    metadataField?: string;
  },
): Promise<XmtpGroupPermissionUpdateResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliGroupPermissionUpdateResult>(config, [
    "conversation",
    "update-permission",
    conversationId,
    "--type",
    input.type,
    "--policy",
    input.policy,
    ...(input.metadataField ? ["--metadata-field", input.metadataField] : []),
  ]);

  return {
    ok: true,
    conversationId: payload.conversationId ?? conversationId,
    permissionType: payload.permissionType ?? input.type,
    policy: payload.policy ?? input.policy,
    metadataField: payload.metadataField ?? input.metadataField ?? null,
  };
};

const listXmtpGroupRole = async (
  config: RegentConfig["xmtp"],
  command: "list-admins" | "list-super-admins",
  conversationId: string,
): Promise<XmtpGroupRoleListResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliGroupRoleListResult>(config, [
    "conversation",
    command,
    conversationId,
  ]);

  const items = command === "list-admins" ? (payload.admins ?? []) : (payload.superAdmins ?? []);

  return {
    ok: true,
    conversationId: payload.conversationId ?? conversationId,
    items,
    count: payload.count ?? items.length,
  };
};

export const listXmtpGroupAdmins = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
): Promise<XmtpGroupRoleListResult> => listXmtpGroupRole(config, "list-admins", conversationId);

export const listXmtpGroupSuperAdmins = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
): Promise<XmtpGroupRoleListResult> => listXmtpGroupRole(config, "list-super-admins", conversationId);

const mutateXmtpGroupRole = async (
  config: RegentConfig["xmtp"],
  command: "add-admin" | "remove-admin" | "add-super-admin" | "remove-super-admin",
  conversationId: string,
  inboxId: string,
): Promise<XmtpGroupRoleMutationResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliGroupRoleMutationResult>(config, [
    "conversation",
    command,
    conversationId,
    inboxId,
  ]);

  return {
    ok: true,
    conversationId: payload.conversationId ?? conversationId,
    inboxId: payload.inboxId ?? inboxId,
    message: payload.message ?? "Group role updated",
  };
};

export const addXmtpGroupAdmin = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  inboxId: string,
): Promise<XmtpGroupRoleMutationResult> => mutateXmtpGroupRole(config, "add-admin", conversationId, inboxId);

export const removeXmtpGroupAdmin = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  inboxId: string,
): Promise<XmtpGroupRoleMutationResult> => mutateXmtpGroupRole(config, "remove-admin", conversationId, inboxId);

export const addXmtpGroupSuperAdmin = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  inboxId: string,
): Promise<XmtpGroupRoleMutationResult> => mutateXmtpGroupRole(config, "add-super-admin", conversationId, inboxId);

export const removeXmtpGroupSuperAdmin = async (
  config: RegentConfig["xmtp"],
  conversationId: string,
  inboxId: string,
): Promise<XmtpGroupRoleMutationResult> => mutateXmtpGroupRole(config, "remove-super-admin", conversationId, inboxId);

export const testXmtpDm = async (
  config: RegentConfig["xmtp"],
  to: `0x${string}`,
  message: string,
): Promise<XmtpDmTestResult> => {
  const dm = await runConnectedXmtpCliJson<XmtpCliCreateDmResult>(config, [
    "conversations",
    "create-dm",
    to.toLowerCase(),
  ]);

  if (!dm.id) {
    throw new RegentError("xmtp_cli_error", "DM create did not return a conversation id");
  }

  const sendResult = await runConnectedXmtpCliJson<XmtpCliSendTextResult>(config, [
    "conversation",
    "send-text",
    dm.id,
    message,
  ]);

  if (!sendResult.success || !sendResult.messageId) {
    updateXmtpRuntimeState(config, (current) => ({
      ...current,
      metrics: {
        ...current.metrics,
        sendFailures: current.metrics.sendFailures + 1,
      },
    }));
    throw new RegentError("xmtp_cli_error", "DM send did not return a message id");
  }

  recordXmtpRecentConversation(config, {
    id: dm.id,
    type: "dm",
  });
  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      sentMessages: current.metrics.sentMessages + 1,
    },
  }));

  return {
    ok: true,
    to,
    conversationId: dm.id,
    messageId: sendResult.messageId,
    text: message,
  };
};

export const revokeAllOtherXmtpInstallations = async (
  config: RegentConfig["xmtp"],
): Promise<XmtpInstallationRevokeResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpInstallationRevokeResult>(config, [
    "client",
    "revoke-all-other-installations",
    "--force",
  ]);

  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      installationsRevoked: current.metrics.installationsRevoked + 1,
    },
  }));

  return payload;
};

export const rotateXmtpDbKey = async (config: RegentConfig["xmtp"]): Promise<XmtpRotationResult> => {
  const stdout = await runXmtpCli(["init", "--stdout", "--env", config.env]);
  const nextKeys = parseInitOutput(stdout, config.env);
  const removedDatabase = deleteDatabaseArtifacts(config.dbPath);

  writeFileWithMode(config.dbEncryptionKeyPath, nextKeys.dbEncryptionKey);
  updateXmtpRuntimeState(config, (current) => ({
    connected: false,
    recentErrors: current.recentErrors,
    recentConversations: [],
    metrics: {
      ...defaultMetrics(),
      dbKeyRotations: current.metrics.dbKeyRotations + 1,
      stoppedAt: new Date().toISOString(),
    },
  }));

  return {
    ok: true,
    kind: "db-key",
    dbPath: config.dbPath,
    walletKeyPath: config.walletKeyPath,
    dbEncryptionKeyPath: config.dbEncryptionKeyPath,
    removedDatabase,
  };
};

export const rotateXmtpWallet = async (config: RegentConfig["xmtp"]): Promise<XmtpRotationResult> => {
  const stdout = await runXmtpCli(["init", "--stdout", "--env", config.env]);
  const nextKeys = parseInitOutput(stdout, config.env);
  const removedDatabase = deleteDatabaseArtifacts(config.dbPath);

  writeFileWithMode(config.walletKeyPath, nextKeys.walletKey);
  writeFileWithMode(config.dbEncryptionKeyPath, nextKeys.dbEncryptionKey);
  updateXmtpRuntimeState(config, (current) => ({
    connected: false,
    recentErrors: current.recentErrors,
    recentConversations: [],
    metrics: {
      ...defaultMetrics(),
      walletRotations: current.metrics.walletRotations + 1,
      stoppedAt: new Date().toISOString(),
    },
  }));

  return {
    ok: true,
    kind: "wallet",
    dbPath: config.dbPath,
    walletKeyPath: config.walletKeyPath,
    dbEncryptionKeyPath: config.dbEncryptionKeyPath,
    removedDatabase,
  };
};

const buildBaseStatus = (
  config: RegentConfig["xmtp"],
  runtimeState: XmtpRuntimeState,
  options?: { started?: boolean; lastError?: string | null },
): Omit<XmtpStatus, "status" | "note" | "client" | "connected" | "ready"> => ({
  enabled: config.enabled,
  configured: xmtpMaterialExists(config) && fs.existsSync(config.publicPolicyPath),
  started: options?.started ?? false,
  env: config.env,
  dbPath: config.dbPath,
  walletKeyPath: config.walletKeyPath,
  dbEncryptionKeyPath: config.dbEncryptionKeyPath,
  publicPolicyPath: config.publicPolicyPath,
  ownerInboxIds: [...config.ownerInboxIds],
  trustedInboxIds: [...config.trustedInboxIds],
  profiles: { ...config.profiles },
  lastError: options?.lastError ?? runtimeState.recentErrors[0]?.message ?? null,
  recentErrors: [...runtimeState.recentErrors],
  recentConversations: [...runtimeState.recentConversations],
  metrics: { ...runtimeState.metrics },
  routeState: config.enabled ? "blocked" : "disabled",
});

export const getXmtpStatus = async (
  config: RegentConfig["xmtp"],
  options?: { started?: boolean; lastError?: string | null },
): Promise<XmtpStatus> => {
  const runtimeState = readXmtpRuntimeState(config);
  const base = buildBaseStatus(config, runtimeState, options);

  if (!config.enabled) {
    return {
      ...base,
      enabled: false,
      configured: base.configured,
      connected: false,
      ready: false,
      status: "disabled",
      note: "XMTP is disabled in config",
      routeState: "disabled",
      client: null,
    };
  }

  if (!base.configured) {
    return {
      ...base,
      connected: false,
      ready: false,
      status: "degraded",
      note: "XMTP material is incomplete; run `regent xmtp init`",
      client: null,
    };
  }

  try {
    const client = await loadXmtpClientInfo(config);
    const connected = (options?.started ?? false) && runtimeState.connected;

    return {
      ...base,
      connected,
      ready: true,
      status: connected ? "ready" : (options?.started ?? false) ? "starting" : "stopped",
      note: connected
        ? "XMTP daemon monitor is live; inbound messages are tracked, but Regent does not yet route them into managed agent sessions"
        : "XMTP identity is initialized and ready",
      client,
    };
  } catch (error) {
    return {
      ...base,
      connected: false,
      ready: false,
      status: (options?.started ?? false) ? "error" : "degraded",
      note: "XMTP CLI probe failed",
      lastError: errorMessage(error),
      client: null,
    };
  }
};

export const openXmtpPolicyInEditor = (config: RegentConfig["xmtp"]): { opened: boolean; editor: string | null } => {
  const editor = process.env.EDITOR?.trim() || null;
  if (!editor || !process.stdin.isTTY) {
    return {
      opened: false,
      editor,
    };
  }

  const result = spawnSync(editor, [config.publicPolicyPath], {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    throw new RegentError(
      "xmtp_editor_failed",
      `editor command failed for ${config.publicPolicyPath}`,
      result.error,
    );
  }

  return {
    opened: true,
    editor,
  };
};

export const readXmtpWalletKey = (config: RegentConfig["xmtp"]): string | null => readOptionalFile(config.walletKeyPath);
