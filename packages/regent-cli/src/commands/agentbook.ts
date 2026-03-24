import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import {
  appendQuery,
  parsePollingIntervalSeconds,
  requestJson,
  requirePositional,
} from "./autolaunch/shared.js";

const watchInterval = async (seconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

const submissionMode = (args: ParsedCliArgs): "auto" | "manual" => {
  if (getBooleanFlag(args, "manual")) return "manual";
  return "auto";
};

const shouldWatch = (args: ParsedCliArgs): boolean => getBooleanFlag(args, "watch");

export const legacyWorldIdKitLoader: {
  load: () => Promise<{
    IDKit: { request: (input: unknown) => { preset: (preset: unknown) => Promise<any> } };
    orbLegacy: (input: { signal: string }) => unknown;
  }>;
} = {
  load: async (): Promise<{
    IDKit: { request: (input: unknown) => { preset: (preset: unknown) => Promise<any> } };
    orbLegacy: (input: { signal: string }) => unknown;
  }> => {
    const worldIdKitCore = (await import("@worldcoin/idkit-core")) as {
      IDKit?: { request: (input: unknown) => { preset: (preset: unknown) => Promise<any> } };
      orbLegacy?: (input: { signal: string }) => unknown;
    };

    if (!worldIdKitCore.IDKit || !worldIdKitCore.orbLegacy) {
      throw new Error("installed @worldcoin/idkit-core build does not expose the legacy agentbook helpers");
    }

    return {
      IDKit: worldIdKitCore.IDKit,
      orbLegacy: worldIdKitCore.orbLegacy,
    };
  },
};

export async function runAgentbookRegister(args: ParsedCliArgs): Promise<void> {
  const { IDKit, orbLegacy } = await legacyWorldIdKitLoader.load();

  const agentAddress = requirePositional(args, 2, "agent-address");
  const network = getFlag(args, "network") ?? "world";
  const relayUrl = getFlag(args, "relay-url");

  const created = await requestJson("POST", "/api/agentbook/sessions", {
    body: {
      agent_address: agentAddress,
      network,
      relay_url: relayUrl,
    },
  });

  const session = created.session as Record<string, unknown>;
  const frontendRequest = session.frontend_request as Record<string, unknown>;

  const builder = IDKit.request({
    app_id: String(frontendRequest.app_id) as `app_${string}`,
    action: String(frontendRequest.action),
    rp_context: frontendRequest.rp_context as {
      rp_id: string;
      nonce: string;
      created_at: number;
      expires_at: number;
      signature: string;
    },
    allow_legacy_proofs: Boolean(frontendRequest.allow_legacy_proofs),
  });
  const request = await builder.preset(orbLegacy({ signal: String(frontendRequest.signal ?? "") }));

  const connectorURI = request.connectorURI;
  const initial = {
    ...created,
    session: {
      ...session,
      connector_uri: connectorURI,
      deep_link_uri: connectorURI,
    },
  };

  if (process.stdout.isTTY) {
    console.error(`World App deep link: ${connectorURI}`);
  }

  if (!shouldWatch(args)) {
    printJson(initial);
    return;
  }

  const completion = await request.pollUntilCompletion({
    pollInterval: 2_000,
    timeout: 120_000,
  });

  if (!completion.success) {
    printJson({
      ok: false,
      session,
      connector_uri: connectorURI,
      error: {
        code: completion.error || "verification_failed",
        message: completion.error || "World App verification failed.",
      },
    });
    return;
  }

  const submitted = await requestJson(
    "POST",
    `/api/agentbook/sessions/${encodeURIComponent(String(session.session_id))}/submit`,
    {
      body: {
        proof: completion.result,
        submission: submissionMode(args),
      },
    },
  );

  printJson({
    ...submitted,
    connector_uri: connectorURI,
  });
}

export async function runAgentbookSessionsWatch(args: ParsedCliArgs): Promise<void> {
  const sessionId = requirePositional(args, 3, "session-id");
  const intervalSeconds = parsePollingIntervalSeconds(args);

  for (;;) {
    const payload = await requestJson("GET", `/api/agentbook/sessions/${encodeURIComponent(sessionId)}`);
    printJson(payload);

    const session = payload.session as Record<string, unknown> | undefined;
    const status = typeof session?.status === "string" ? session.status : "";
    if (status === "proof_ready" || status === "registered" || status === "failed") {
      return;
    }

    await watchInterval(intervalSeconds);
  }
}

export async function runAgentbookLookup(args: ParsedCliArgs): Promise<void> {
  const agentAddress = requireArg(getFlag(args, "address"), "address");
  const network = getFlag(args, "network") ?? "world";

  printJson(
    await requestJson(
      "GET",
      appendQuery("/api/agentbook/lookup", {
        agent_address: agentAddress,
        network,
      }),
    ),
  );
}

export async function runAgentbookVerifyHeader(args: ParsedCliArgs): Promise<void> {
  const header = requireArg(getFlag(args, "header"), "header");
  const resourceUri = requireArg(getFlag(args, "resource-uri"), "resource-uri");

  printJson(
    await requestJson("POST", "/api/agentbook/verify", {
      body: {
        header,
        resource_uri: resourceUri,
      },
    }),
  );
}
