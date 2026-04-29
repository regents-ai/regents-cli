import fs from "node:fs";

import type { DoctorCheckDefinition } from "../types.js";
import { skipDueToMissingConfig } from "./shared.js";
import { ensureXmtpPolicyFile } from "../../xmtp/manager.js";

export function transportChecks(): DoctorCheckDefinition[] {
  return [
    {
      id: "transports.gossipsub.config",
      scope: "transports",
      title: "Gossipsub config",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        return {
          status: "ok",
          message: ctx.config.gossipsub.enabled
            ? "Backend chatbox transport config parsed; live mode is reported by Techtree as libp2p, local_only, or degraded"
            : "Gossipsub is disabled in config",
          details: {
            enabled: ctx.config.gossipsub.enabled,
            listenAddrs: ctx.config.gossipsub.listenAddrs,
            bootstrap: ctx.config.gossipsub.bootstrap,
            peerIdPath: ctx.config.gossipsub.peerIdPath,
          },
        };
      },
    },
    {
      id: "xmtp.config",
      scope: "xmtp",
      title: "XMTP config",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        return {
          status: "ok",
          message: ctx.config.xmtp.enabled
            ? "XMTP config parsed; Regent owns the managed identity and policy files"
            : "XMTP is disabled in config",
          details: {
            enabled: ctx.config.xmtp.enabled,
            env: ctx.config.xmtp.env,
            dbPath: ctx.config.xmtp.dbPath,
            walletKeyPath: ctx.config.xmtp.walletKeyPath,
            dbEncryptionKeyPath: ctx.config.xmtp.dbEncryptionKeyPath,
            publicPolicyPath: ctx.config.xmtp.publicPolicyPath,
            ownerInboxIds: ctx.config.xmtp.ownerInboxIds,
            trustedInboxIds: ctx.config.xmtp.trustedInboxIds,
            profiles: ctx.config.xmtp.profiles,
          },
        };
      },
    },
    {
      id: "xmtp.room.contract",
      scope: "xmtp",
      title: "XMTP room contract",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        return {
          status: "ok",
          message:
            "Room keys stay with the owning app; CLI chatbox uses Techtree routes and CLI XMTP groups use raw conversation ids",
          details: {
            appRoomId: "room_key",
            threadId: "xmtp_group_id",
            techtreeChatboxSelectors: ["webapp", "agent"],
            productRoomOwners: ["platform", "autolaunch", "techtree"],
            cliBoundaries: {
              chatbox: "techtree product routes or local runtime transport",
              xmtpGroup: "local XMTP conversation id",
              iosTalk: "Platform RWR records, not XMTP rooms",
            },
          },
        };
      },
    },
    {
      id: "xmtp.policy",
      scope: "xmtp",
      title: "XMTP public policy",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        const policyPath = ctx.config.xmtp.publicPolicyPath;
        if (ctx.config.xmtp.enabled && ctx.fix) {
          const ensured = ensureXmtpPolicyFile(ctx.config.xmtp);
          return {
            status: "ok",
            message: ensured.created
              ? "Created the default XMTP public policy file"
              : "XMTP public policy file is present",
            details: {
              path: policyPath,
              created: ensured.created,
            },
          };
        }

        if (!ctx.config.xmtp.enabled) {
          return {
            status: "skip",
            message: "XMTP public policy skipped because XMTP is disabled",
            details: {
              path: policyPath,
            },
          };
        }

        return {
          status: fs.existsSync(policyPath) ? "ok" : "warn",
          message: fs.existsSync(policyPath)
            ? "XMTP public policy file is present"
            : "XMTP public policy file is missing; run `regents xmtp policy init`",
          details: {
            path: policyPath,
          },
          remediation: fs.existsSync(policyPath) ? undefined : "Run `regents xmtp policy init`",
        };
      },
    },
    {
      id: "xmtp.identity",
      scope: "xmtp",
      title: "XMTP local identity",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        if (!ctx.config.xmtp.enabled) {
          return {
            status: "skip",
            message: "XMTP identity check skipped because XMTP is disabled",
          };
        }

        const walletExists = fs.existsSync(ctx.config.xmtp.walletKeyPath);
        const dbKeyExists = fs.existsSync(ctx.config.xmtp.dbEncryptionKeyPath);
        const ready = walletExists && dbKeyExists;

        return {
          status: ready ? "ok" : "warn",
          message: ready
            ? "XMTP wallet and database encryption keys are present"
            : "XMTP key material is missing; run `regents xmtp init`",
          details: {
            walletKeyPath: ctx.config.xmtp.walletKeyPath,
            dbEncryptionKeyPath: ctx.config.xmtp.dbEncryptionKeyPath,
            walletExists,
            dbEncryptionKeyExists: dbKeyExists,
          },
          remediation: ready ? undefined : "Run `regents xmtp init`",
        };
      },
    },
    {
      id: "xmtp.owner",
      scope: "xmtp",
      title: "XMTP owner allowlist",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        if (!ctx.config.xmtp.enabled) {
          return {
            status: "skip",
            message: "XMTP owner allowlist skipped because XMTP is disabled",
          };
        }

        const ownerCount = ctx.config.xmtp.ownerInboxIds.length;
        return {
          status: ownerCount > 0 ? "ok" : "warn",
          message: ownerCount > 0
            ? "XMTP owner allowlist is configured"
            : "No XMTP owner inbox is configured; owner messages cannot be privileged yet",
          details: {
            ownerInboxIds: ctx.config.xmtp.ownerInboxIds,
          },
          remediation: ownerCount > 0 ? undefined : "Run `regents xmtp owner add --address <wallet>`",
        };
      },
    },
    {
      id: "xmtp.trusted",
      scope: "xmtp",
      title: "XMTP trusted allowlist",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        if (!ctx.config.xmtp.enabled) {
          return {
            status: "skip",
            message: "XMTP trusted allowlist skipped because XMTP is disabled",
          };
        }

        return {
          status: "ok",
          message:
            ctx.config.xmtp.trustedInboxIds.length > 0
              ? "XMTP trusted allowlist is configured"
              : "No additional XMTP trusted inboxes are configured",
          details: {
            trustedInboxIds: ctx.config.xmtp.trustedInboxIds,
          },
        };
      },
    },
  ];
}
