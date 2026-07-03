import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVoiceGatewayServer,
  resolveOpenaiApiKey,
} from "../../src/commands/voice.js";
import { loadConfig } from "../../src/internal-runtime/config.js";
import type { RegentVoiceConfig } from "../../src/internal-types/index.js";

const voiceConfig = (overrides: Partial<RegentVoiceConfig> = {}): RegentVoiceConfig => ({
  openaiApiKeyEnv: "TEST_OPENAI_KEY",
  port: 8787,
  model: "gpt-realtime-2",
  transcriptionModel: "gpt-realtime-whisper",
  defaultVoice: "marin",
  reasoningEffort: "low",
  sessionTtlSeconds: 60,
  // Point at a nonexistent file so the gateway uses the bundled byte-parity registry.
  toolRegistryPath: "/nonexistent/voice-tools.json",
  ...overrides,
});

const startServer = async (server: import("node:http").Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

const closeServer = (server: import("node:http").Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

// Real HTTP client via node:http, so stubbing the global `fetch` (for the
// OpenAI mint) never breaks the test's own requests to the gateway.
type ClientResponse = { status: number; body: string; json: () => unknown };
const request = (
  base: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<ClientResponse> => {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: init.method ?? "GET", headers: init.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text, json: () => JSON.parse(text) });
        });
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) {
      req.write(init.body);
    }
    req.end();
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TEST_OPENAI_KEY;
});

describe("config services.voice (env-indirection, key never persisted)", () => {
  it("defaults surface services.voice with the env var NAME, never a raw key, and default gpt-realtime-2", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-cli-voice-config-"));
    const configPath = path.join(tempDir, "config.json"); // absent -> defaults
    const config = loadConfig(configPath);

    expect(config.services.voice.openaiApiKeyEnv).toBe("OPENAI_API_KEY");
    expect(config.services.voice.model).toBe("gpt-realtime-2");
    // config carries the env var NAME only; there is no field for the raw key.
    expect(config.services.voice).not.toHaveProperty("openaiApiKey");
    expect(config.services.voice).not.toHaveProperty("openaiKey");
  });

  it("a user-provided env var name round-trips without ever storing a raw key", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-cli-voice-config-"));
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ services: { voice: { openaiApiKeyEnv: "MY_LOCAL_OPENAI_KEY" } } }),
    );

    const config = loadConfig(configPath);
    expect(config.services.voice.openaiApiKeyEnv).toBe("MY_LOCAL_OPENAI_KEY");
    // The on-disk config file holds only the env var name, no secret material.
    const onDisk = fs.readFileSync(configPath, "utf8");
    expect(onDisk).toContain("MY_LOCAL_OPENAI_KEY");
    expect(onDisk).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

describe("resolveOpenaiApiKey (env-indirection, fail fast)", () => {
  it("reads the key from the env var named by config, never from config itself", () => {
    process.env.TEST_OPENAI_KEY = "sk-test-123";
    const config = voiceConfig();
    // The raw key lives only in the env var; config stores only the env var NAME.
    expect(config).not.toHaveProperty("openaiApiKey");
    expect(JSON.stringify(config)).not.toContain("sk-test-123");
    expect(resolveOpenaiApiKey(config)).toBe("sk-test-123");
  });

  it("fails fast with a clear message when the named env var is missing (no fallback)", () => {
    delete process.env.TEST_OPENAI_KEY;
    expect(() => resolveOpenaiApiKey(voiceConfig())).toThrowError(/TEST_OPENAI_KEY/);
  });

  it("does not fall back to a different source when the configured env var is empty", () => {
    process.env.TEST_OPENAI_KEY = "   ";
    process.env.OPENAI_API_KEY = "sk-should-not-be-used";
    try {
      expect(() => resolveOpenaiApiKey(voiceConfig())).toThrow();
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe("voice gateway /hermes/voice/session", () => {
  it("mints against POST /v1/realtime/client_secrets with session.model=gpt-realtime-2 and returns the HermesVoiceSession envelope", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: "ek_test_ephemeral_secret" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const server = createVoiceGatewayServer(voiceConfig(), "sk-test-123", "local-hermes");
    const base = await startServer(server);
    try {
      const response = await request(base, "/hermes/voice/session", {
        method: "POST",
        headers: { "content-type": "application/json", "openai-safety-identifier": "safety-abc" },
        body: JSON.stringify({ voice: "marin", reasoning_effort: "low" }),
      });
      expect(response.status).toBe(201);
      const body = response.json() as Record<string, any>;

      // Exact HermesVoiceSession envelope fields the iOS app/contract consume.
      expect(body.session_id).toEqual(expect.any(String));
      expect(body.agent_id).toBe("local-hermes");
      expect(body.expires_at).toEqual(expect.any(String));
      expect(body.realtime).toEqual({
        provider: "openai-realtime",
        model: "gpt-realtime-2",
        client_secret: "ek_test_ephemeral_secret",
        client_secret_expires_at: expect.any(String),
        calls_url: "https://api.openai.com/v1/realtime/calls",
      });
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools).toHaveLength(8);
      expect(body.tools.map((t: { name: string }) => t.name)).toContain("ios_approval_request");

      // The mint call: correct endpoint, bearer of the resolved key, model bound at mint time.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [mintUrl, mintInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(mintUrl).toBe("https://api.openai.com/v1/realtime/client_secrets");
      expect((mintInit.headers as Record<string, string>).authorization).toBe("Bearer sk-test-123");
      const mintBody = JSON.parse(String(mintInit.body)) as any;
      expect(mintBody.session.model).toBe("gpt-realtime-2");
      expect(mintBody.session.type).toBe("realtime");
      expect(mintBody.session.audio.input.transcription.model).toBe("gpt-realtime-whisper");
      expect(mintBody.session.audio.output.voice).toBe("marin");
      expect(mintBody.session.reasoning.effort).toBe("low");
      // The raw key is only ever in the Authorization header, never in the minted response body.
      expect(JSON.stringify(body)).not.toContain("sk-test-123");
    } finally {
      await closeServer(server);
    }
  });

  it("returns a provider error (not a crash) when the mint call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const server = createVoiceGatewayServer(voiceConfig(), "sk-test-123");
    const base = await startServer(server);
    try {
      const response = await request(base, "/hermes/voice/session", { method: "POST", body: "{}" });
      expect(response.status).toBe(502);
      expect(response.json() as { error: string }).toEqual({ ok: false, error: "provider_unavailable" });
    } finally {
      await closeServer(server);
    }
  });
});

describe("voice gateway other routes", () => {
  it("status reports enabled/health/model registry, healthz is a liveness probe", async () => {
    const server = createVoiceGatewayServer(voiceConfig(), "sk-test-123");
    const base = await startServer(server);
    try {
      const status = (await request(base, "/hermes/voice/status")).json() as Record<string, unknown>;
      expect(status.enabled).toBe(true);
      expect(status.health).toBe("ok");
      expect(status.tool_registry_digest).toEqual(expect.any(String));

      const healthz = await request(base, "/hermes/voice/healthz");
      expect(healthz.status).toBe(200);
      expect(healthz.json() as { ok: boolean }).toMatchObject({ ok: true, health: "ok" });
    } finally {
      await closeServer(server);
    }
  });

  it("prewarm, disconnect, and tool-result acknowledge without minting", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const server = createVoiceGatewayServer(voiceConfig(), "sk-test-123");
    const base = await startServer(server);
    try {
      expect((await request(base, "/hermes/voice/prewarm", { method: "POST", body: "{}" })).status).toBe(202);
      expect((await request(base, "/hermes/voice/disconnect", { method: "POST", body: JSON.stringify({ session_id: "s1" }) })).status).toBe(200);
      expect((await request(base, "/hermes/voice/tool-result", { method: "POST", body: "{}" })).status).toBe(202);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it("unknown route is a 404, not a crash", async () => {
    const server = createVoiceGatewayServer(voiceConfig(), "sk-test-123");
    const base = await startServer(server);
    try {
      const response = await request(base, "/hermes/voice/unknown");
      expect(response.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });
});
