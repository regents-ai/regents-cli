import type { DoctorCheckDefinition } from "../types.js";
import { skipDueToMissingConfig } from "./shared.js";

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
            ? "Backend chat transport config parsed; live mode is reported by Techtree as libp2p, local_only, or degraded"
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
      id: "transports.chat.room-contract",
      scope: "transports",
      title: "Chat room contract",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        return {
          status: "ok",
          message:
            "Room keys stay with the owning app; CLI chat uses Techtree and Autolaunch scopes, and direct messages are server-stored dm scopes on product chat routes",
          details: {
            appRoomId: "room_key",
            techtreeChatScopes: ["system", "topic:<slug>", "node:<node-id>", "dm:<walletA>:<walletB>"],
            autolaunchChatScopes: ["system", "topic:<slug>", "token:<subject-id>", "dm:<walletA>:<walletB>"],
            productRoomOwners: ["platform", "autolaunch", "techtree"],
            cliBoundaries: {
              chat: "techtree or autolaunch chat routes or the local runtime transport",
              dm: "participant-gated dm scopes on product agent chat routes",
              iosTalk: "Platform RWR records",
            },
          },
        };
      },
    },
  ];
}
