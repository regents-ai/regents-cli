export type RegentXmtpEnv = "local" | "dev" | "production";

export interface RegentXmtpProfiles {
  owner: string;
  public: string;
  group: string;
}

export interface XmtpClientInfo {
  address: `0x${string}`;
  inboxId: string;
  installationId: string;
  isRegistered: boolean;
  appVersion?: string;
  libxmtpVersion?: string;
}

export interface XmtpInitResult {
  configPath: string;
  enabled: boolean;
  env: RegentXmtpEnv;
  dbPath: string;
  dbEncryptionKeyPath: string;
  walletKeyPath: string;
  publicPolicyPath: string;
  ownerInboxIds: string[];
  trustedInboxIds: string[];
  profiles: RegentXmtpProfiles;
  createdWalletKey: boolean;
  createdDbEncryptionKey: boolean;
  createdPolicyFile: boolean;
  client: XmtpClientInfo;
}

export interface XmtpRecentConversation {
  id: string;
  type: "dm" | "group" | "unknown";
  createdAt?: string;
  peerInboxId?: string;
  name?: string;
}

export interface XmtpRuntimeMetrics {
  startedAt: string | null;
  stoppedAt: string | null;
  lastSyncAt: string | null;
  lastMessageAt: string | null;
  receivedMessages: number;
  sentMessages: number;
  sendFailures: number;
  groupsCreated: number;
  membersAdded: number;
  installationsRevoked: number;
  walletRotations: number;
  dbKeyRotations: number;
  restarts: number;
}

export interface XmtpRecentError {
  at: string;
  code: string;
  message: string;
}

export interface XmtpPolicyValidationResult {
  ok: boolean;
  path: string;
  issues: string[];
}

export interface XmtpListResult {
  ok: true;
  items: string[];
}

export interface XmtpMutationResult {
  ok: true;
  updated: string[];
}

export interface XmtpPolicyShowResult {
  ok: true;
  path: string;
  content: string;
}

export interface XmtpDmTestResult {
  ok: true;
  to: `0x${string}`;
  conversationId: string;
  messageId: string;
  text: string;
}

export interface XmtpGroupCreateResult {
  ok: true;
  id: string;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  memberCount: number;
  members: Array<{
    inboxId: string;
    permissionLevel?: string | number;
  }>;
}

export interface XmtpGroupAddMembersResult {
  ok: true;
  conversationId: string;
  addedMembers: string[];
  count: number;
}

export interface XmtpGroupListResult {
  ok: true;
  conversations: XmtpRecentConversation[];
}

export interface XmtpGroupMemberRecord {
  inboxId: string;
  accountIdentifiers: string[];
  installationIds: string[];
  permissionLevel: string | number | null;
  consentState: string | null;
}

export interface XmtpGroupMembersResult {
  ok: true;
  conversationId: string;
  members: XmtpGroupMemberRecord[];
  count: number;
}

export interface XmtpGroupPermissionsResult {
  ok: true;
  conversationId: string;
  permissions: {
    policyType: string | null;
    policySet: Record<string, unknown>;
  };
}

export interface XmtpGroupPermissionUpdateResult {
  ok: true;
  conversationId: string;
  permissionType: string;
  policy: string;
  metadataField: string | null;
}

export interface XmtpGroupRoleListResult {
  ok: true;
  conversationId: string;
  items: string[];
  count: number;
}

export interface XmtpGroupRoleMutationResult {
  ok: true;
  conversationId: string;
  inboxId: string;
  message: string;
}

export interface XmtpGroupRemoveMembersResult {
  ok: true;
  conversationId: string;
  removedMembers: string[];
  count: number;
}

export interface XmtpInstallationRevokeResult {
  ok: true;
  currentInstallationId: string;
  inboxId: string;
  message: string;
}

export interface XmtpRotationResult {
  ok: true;
  kind: "db-key" | "wallet";
  dbPath: string;
  walletKeyPath: string;
  dbEncryptionKeyPath: string;
  removedDatabase: boolean;
}
