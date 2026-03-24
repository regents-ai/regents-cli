import crypto from "node:crypto";

import type { DoctorCheckDefinition } from "../types.js";
import { buildBackendDetails, skipDueToMissingConfig } from "./shared.js";

export function fullChecks(): DoctorCheckDefinition[] {
  return [
    {
      id: "full.node.create",
      scope: "techtree",
      title: "full proof node create",
      run: async (ctx) => {
        if (!ctx.techtree || !ctx.knownParentId) {
          return ctx.knownParentId
            ? skipDueToMissingConfig()
            : {
                status: "fail",
                message: "Full proof requires a known parent node id",
                remediation: "Re-run with `regent doctor --full --known-parent-id <id>`",
              };
        }

        try {
          const parent = await ctx.techtree.getNode(ctx.knownParentId);
          const title = `Regent doctor proof ${new Date().toISOString()}`;
          const { response, statusCode } = await ctx.techtree.createNodeDetailed({
            seed: parent.data.seed,
            kind: "hypothesis",
            title,
            parent_id: ctx.knownParentId,
            notebook_source: "print('regent doctor full proof')\n",
            idempotency_key: `doctor-node-${crypto.randomUUID()}`,
          });
          const createContractIssues = [
            statusCode !== 201 ? `expected create status 201, received ${statusCode}` : undefined,
            !Number.isSafeInteger(response.data.node_id) || response.data.node_id <= 0
              ? "node_id must be a positive integer"
              : undefined,
            response.data.manifest_cid.trim() === "" ? "manifest_cid must be present" : undefined,
            response.data.status !== "pinned" ? `expected status pinned, received ${response.data.status}` : undefined,
            response.data.anchor_status !== "pending"
              ? `expected anchor_status pending, received ${response.data.anchor_status}`
              : undefined,
          ].filter((value): value is string => value !== undefined);

          const createdNode = await ctx.techtree.getNode(response.data.node_id);
          const readbackIssues = [
            createdNode.data.parent_id !== ctx.knownParentId
              ? `expected created node parent_id ${ctx.knownParentId}, received ${createdNode.data.parent_id}`
              : undefined,
            createdNode.data.seed !== parent.data.seed
              ? `expected created node seed ${parent.data.seed}, received ${createdNode.data.seed}`
              : undefined,
            createdNode.data.kind !== "hypothesis"
              ? `expected created node kind hypothesis, received ${createdNode.data.kind}`
              : undefined,
            createdNode.data.title !== title
              ? "created node title does not match the proof request"
              : undefined,
            createdNode.data.status !== "pinned"
              ? `expected created node status pinned, received ${createdNode.data.status}`
              : undefined,
          ].filter((value): value is string => value !== undefined);

          if (createContractIssues.length > 0 || readbackIssues.length > 0) {
            return {
              status: "fail",
              message: "Techtree accepted the proof node create, but the returned contract or initial state did not match expectations",
              details: {
                parentId: ctx.knownParentId,
                nodeId: response.data.node_id,
                statusCode,
                createContractIssues,
                readbackIssues,
                response: response.data,
                createdNode: createdNode.data,
              },
              remediation: "Inspect the Techtree node create contract before treating full doctor as successful",
            };
          }

          ctx.fullState.nodeResponse = response;

          return {
            status: "ok",
            message: "Created a disposable Techtree proof node",
            details: {
              parentId: ctx.knownParentId,
              nodeId: response.data.node_id,
              statusCode,
              manifestCid: response.data.manifest_cid,
              status: response.data.status,
              anchorStatus: response.data.anchor_status,
            },
          };
        } catch (error) {
          return {
            status: "fail",
            message: "Full proof node create failed",
            details: buildBackendDetails(error),
            remediation: "Verify parent accessibility and authenticated Techtree write access",
          };
        }
      },
    },
    {
      id: "full.comment.add",
      scope: "techtree",
      title: "full proof comment add",
      run: async (ctx) => {
        if (!ctx.techtree) {
          return skipDueToMissingConfig();
        }

        const nodeId = ctx.fullState.nodeResponse?.data.node_id;
        if (!nodeId) {
          return {
            status: "skip",
            message: "Comment proof skipped because no proof node was created",
          };
        }

        const bodyMarkdown = `${ctx.cleanupCommentBodyPrefix} ${new Date().toISOString()}`;

        try {
          const response = await ctx.techtree.createComment({
            node_id: nodeId,
            body_markdown: bodyMarkdown,
            idempotency_key: `doctor-comment-${crypto.randomUUID()}`,
          });
          ctx.fullState.commentResponse = response;

          return {
            status: "ok",
            message: "Created a disposable Techtree proof comment",
            details: {
              nodeId,
              commentId: response.data.comment_id,
              createdAt: response.data.created_at,
              bodyMarkdown,
            },
          };
        } catch (error) {
          return {
            status: "fail",
            message: "Full proof comment add failed",
            details: buildBackendDetails(error),
            remediation: "Verify authenticated Techtree comment creation",
          };
        }
      },
    },
    {
      id: "full.comment.readback",
      scope: "techtree",
      title: "full proof comment readback",
      run: async (ctx) => {
        if (!ctx.techtree) {
          return skipDueToMissingConfig();
        }

        const nodeId = ctx.fullState.nodeResponse?.data.node_id;
        const commentId = ctx.fullState.commentResponse?.data.comment_id;
        if (!nodeId || !commentId) {
          return {
            status: "skip",
            message: "Comment readback skipped because the proof write steps did not complete",
          };
        }

        try {
          const comments = await ctx.techtree.getComments(nodeId, { limit: 100 });
          const matched = comments.data.find((comment) => comment.id === commentId);
          const workPacket = await ctx.techtree.getWorkPacket(nodeId);
          const matchedInWorkPacket = workPacket.data.comments.find((comment) => comment.id === commentId);

          if (!matched || !matchedInWorkPacket) {
            return {
              status: "fail",
              message: "Created proof comment was not found on all required readback routes",
              details: {
                nodeId,
                commentId,
                commentsRoute: {
                  returnedCount: comments.data.length,
                  found: !!matched,
                },
                workPacketRoute: {
                  returnedCount: workPacket.data.comments.length,
                  found: !!matchedInWorkPacket,
                },
              },
              remediation: "Inspect Techtree comment persistence and work-packet projection for the created node",
            };
          }

          return {
            status: "ok",
            message: "Created proof comment was read back successfully via comments and work-packet routes",
            details: {
              nodeId,
              commentId,
              insertedAt: matched.inserted_at,
              workPacketInsertedAt: matchedInWorkPacket.inserted_at,
            },
          };
        } catch (error) {
          return {
            status: "fail",
            message: "Comment readback failed",
            details: buildBackendDetails(error),
            remediation: "Inspect Techtree comment read routes and write persistence",
          };
        }
      },
    },
    {
      id: "full.node.status.note",
      scope: "techtree",
      title: "full proof publish note",
      run: async (ctx) => {
        const response = ctx.fullState.nodeResponse;
        if (!response) {
          return {
            status: "skip",
            message: "Publish note skipped because the proof node was not created",
          };
        }

        return {
          status: response.data.anchor_status === "failed_anchor" ? "warn" : "ok",
          message:
            response.data.anchor_status === "pending"
              ? "Node create proof succeeded; anchoring remains asynchronous and pending is acceptable"
              : response.data.anchor_status === "anchored"
                ? "Node create proof succeeded and the node is already anchored"
                : "Node create proof succeeded, but anchor status reported a failure",
          details: {
            nodeId: response.data.node_id,
            status: response.data.status,
            anchorStatus: response.data.anchor_status,
          },
        };
      },
    },
  ];
}
