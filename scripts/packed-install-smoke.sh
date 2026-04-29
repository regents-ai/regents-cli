#!/usr/bin/env bash
set -euo pipefail

export NODE_NO_WARNINGS=1

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)
PACK_DIR="$(mktemp -d "/tmp/regent-pack.XXXXXX")"
WORK_DIR="$(mktemp -d "/tmp/regent-install.XXXXXX")"
STAGE_DIR="$(mktemp -d "/tmp/regent-stage.XXXXXX")"
SERVER_PORT_FILE="${WORK_DIR}/mock-server.port"
CONFIG_PATH="${WORK_DIR}/regent.config.json"
NOTEBOOK_PATH="${WORK_DIR}/publish.py"
RUNTIME_LOG="${WORK_DIR}/runtime.log"
SERVER_LOG="${WORK_DIR}/mock-server.log"

TEST_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
TEST_WALLET="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
TEST_WALLET_LOWER="$(printf '%s' "${TEST_WALLET}" | tr '[:upper:]' '[:lower:]')"
TEST_REGISTRY="0x2222222222222222222222222222222222222222"
TEST_SIGNATURE="0x1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"

RUNTIME_PID=""
SERVER_PID=""
ORIGINAL_PATH="${PATH}"

cleanup() {
  if [[ -n "${RUNTIME_PID}" ]] && kill -0 "${RUNTIME_PID}" >/dev/null 2>&1; then
    kill "${RUNTIME_PID}" >/dev/null 2>&1 || true
    wait "${RUNTIME_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi

  rm -rf "${PACK_DIR}" "${WORK_DIR}" "${STAGE_DIR}"
}

wait_for_file() {
  local target="$1"
  local attempts="${2:-50}"

  for ((i = 1; i <= attempts; i += 1)); do
    if [[ -e "${target}" || -S "${target}" ]]; then
      return 0
    fi
    sleep 0.1
  done

  echo "timed out waiting for ${target}" >&2
  return 1
}

pack_workspace_package() {
  local package_dir="$1"
  (
    cd "${package_dir}"
    npm pack --ignore-scripts --pack-destination "${PACK_DIR}" >/dev/null
  )
}

write_fake_cdp() {
  local bin_dir="${WORK_DIR}/bin"
  mkdir -p "${bin_dir}"
  cat > "${bin_dir}/cdp" <<EOF
#!/usr/bin/env bash
set -euo pipefail

if [[ "\$#" -ge 4 && "\$1" == "evm" && "\$2" == "accounts" && "\$3" == "by-name" && "\$4" == "main" ]]; then
  printf '{"name":"main","address":"${TEST_WALLET_LOWER}"}\n'
  exit 0
fi

if [[ "\$#" -ge 3 && "\$1" == "evm" && "\$2" == "accounts" && "\$3" == "list" ]]; then
  printf '{"accounts":[{"name":"main","address":"${TEST_WALLET_LOWER}"}]}\n'
  exit 0
fi

if [[ "\$#" -ge 4 && "\$1" == "evm" && "\$2" == "accounts" && "\$3" == "create" ]]; then
  printf '{"name":"main","address":"${TEST_WALLET_LOWER}"}\n'
  exit 0
fi

if [[ "\$#" -ge 5 && "\$1" == "evm" && "\$2" == "accounts" && "\$3" == "sign" && "\$4" == "message" ]]; then
  printf '{"signature":"${TEST_SIGNATURE}"}\n'
  exit 0
fi

if [[ "\$#" -ge 1 && "\$1" == "mcp" ]]; then
  printf '{"ok":true}\n'
  exit 0
fi

echo "unsupported cdp command: \$*" >&2
exit 1
EOF
  chmod +x "${bin_dir}/cdp"
  export PATH="${bin_dir}:${ORIGINAL_PATH}"
}

trap cleanup EXIT

cd "${ROOT}"
pnpm build >/dev/null
pnpm --filter @regentslabs/cli deploy --prod "${STAGE_DIR}" >/dev/null
pack_workspace_package "${STAGE_DIR}"

cat > "${WORK_DIR}/package.json" <<'EOF'
{
  "name": "regent-packed-install-smoke",
  "private": true,
  "packageManager": "pnpm@9.15.0"
}
EOF

pnpm --dir "${WORK_DIR}" add "${PACK_DIR}"/regentslabs-cli-*.tgz >/dev/null

cat > "${WORK_DIR}/mock-techtree.mjs" <<'EOF'
import http from "node:http";
import fs from "node:fs";

const portFile = process.argv[2];
let nextNodeId = 100;
const issuedAgentNonces = new Map();

const json = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(`${JSON.stringify(payload)}\n`);
};

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw === "" ? undefined : JSON.parse(raw);
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
  const body = await readJson(req);

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    json(res, 200, { ok: true, service: "packed-install-smoke" });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/identity/status") {
    json(res, 200, {
      ok: true,
      code: "identity_status_resolved",
      data: {
        network: body?.network ?? "base",
        address: String(body?.address ?? "0x0").toLowerCase(),
        provider: body?.provider ?? "coinbase-cdp",
        registered: false,
        verified: "unregistered"
      }
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/identity/registration-intents") {
    json(res, 200, {
      ok: true,
      code: "identity_registration_intent_created",
      data: {
        intent_id: "packed-install-intent",
        intent_kind: "erc8004_registration",
        signing_payload: {
          message: `Register Regent identity for ${String(body?.address ?? "0x0").toLowerCase()}`
        }
      }
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/identity/registration-completions") {
    json(res, 200, {
      ok: true,
      code: "identity_registration_completed",
      data: {
        registered: true,
        agent_id: 99,
        agent_registry: "eip155:8453/erc8004:0x2222222222222222222222222222222222222222"
      }
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/identity/siwa/nonce") {
    json(res, 200, {
      ok: true,
      code: "identity_siwa_nonce_issued",
      data: {
        nonce_token: "packed-install-nonce",
        message: `Sign in with Regent\nAddress: ${String(body?.address ?? "0x0").toLowerCase()}\nNetwork: base\nAgent ID: 99\nAgent Registry: eip155:8453/erc8004:0x2222222222222222222222222222222222222222\nNonce: packed-install-nonce`,
        address: String(body?.address ?? "0x0").toLowerCase(),
        agent_id: body?.agent_id ?? 99,
        agent_registry: body?.agent_registry ?? "eip155:8453/erc8004:0x2222222222222222222222222222222222222222",
        expires_at: "2999-01-01T00:00:00.000Z"
      }
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/identity/siwa/verify") {
    json(res, 200, {
      ok: true,
      code: "identity_siwa_verified",
      data: {
        verified: "onchain",
        network: body?.network ?? "base",
        address: String(body?.address ?? "0x0").toLowerCase(),
        agent_id: body?.agent_id ?? 99,
        agent_registry: body?.agent_registry ?? "eip155:8453/erc8004:0x2222222222222222222222222222222222222222",
        signer_type: "evm_personal_sign",
        receipt: "receipt-valid.eyJ3YWxsZXRBZGRyZXNzIjoiMHgwIiwgImNoYWluSWQiOjg0NTMsICJyZWdpc3RyeUFkZHJlc3MiOiIweDIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIiLCAidG9rZW5JZCI6Ijk5IiwgImtleUlkIjoiMHgwIiwgImV4cGlyZXNBdCI6IjI5OTktMDEtMDFUMDA6MDA6MDAuMDAwWiJ9",
        receipt_issued_at: "2026-03-10T00:00:00.000Z",
        receipt_expires_at: "2999-01-01T00:00:00.000Z"
      }
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/agent/siwa/nonce") {
    const walletAddress = String(body?.wallet_address ?? "0x0").toLowerCase();
    const chainId = Number(body?.chain_id ?? 8453);
    const registryAddress = String(body?.registry_address ?? "0x2222222222222222222222222222222222222222").toLowerCase();
    const tokenId = String(body?.token_id ?? "99");
    const audience = String(body?.audience ?? "techtree");
    const nonce = `agent-nonce-${Date.now()}`;

    issuedAgentNonces.set(nonce, {
      walletAddress,
      chainId,
      registryAddress,
      tokenId,
      audience
    });

    json(res, 200, {
      ok: true,
      code: "nonce_issued",
      data: {
        nonce,
        walletAddress,
        chainId,
        registryAddress,
        tokenId,
        audience,
        expiresAt: "2999-01-01T00:00:00.000Z"
      }
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/agent/siwa/verify") {
    const walletAddress = String(body?.wallet_address ?? "0x0").toLowerCase();
    const chainId = Number(body?.chain_id ?? 8453);
    const registryAddress = String(body?.registry_address ?? "0x2222222222222222222222222222222222222222").toLowerCase();
    const tokenId = String(body?.token_id ?? "99");
    const audience = String(body?.audience ?? "techtree");
    const nonce = String(body?.nonce ?? "");
    const issuedNonce = issuedAgentNonces.get(nonce);

    if (!issuedNonce) {
      json(res, 422, { error: { code: "siwa_verify_invalid", message: "nonce was not issued" } });
      return;
    }

    issuedAgentNonces.delete(nonce);
    json(res, 200, {
      ok: true,
      code: "siwa_verified",
      data: {
        verified: true,
        walletAddress,
        chainId,
        registryAddress,
        tokenId,
        audience,
        nonce,
        keyId: walletAddress,
        signatureScheme: "evm_personal_sign",
        receipt: "receipt-valid.eyJ3YWxsZXRBZGRyZXNzIjoiMHg3MDk5Nzk3MGM1MTgxMmRjM2EwMTBjN2QwMWI1MGUwZDE3ZGM3OWM4IiwiY2hhaW5JZCI6ODQ1MywicmVnaXN0cnlBZGRyZXNzIjoiMHgyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIiLCJ0b2tlbklkIjoiOTkiLCJrZXlJZCI6IjB4NzA5OTc5NzBjNTE4MTJkYzNhMDEwYzdkMDFiNTBlMGQxN2RjNzljOCIsImV4cGlyZXNBdCI6IjI5OTktMDEtMDFUMDA6MDA6MDAuMDAwWiJ9",
        receiptIssuedAt: "2026-03-10T00:00:00.000Z",
        receiptExpiresAt: "2999-01-01T00:00:00.000Z"
      }
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/v1/tree/nodes") {
    json(res, 200, {
      data: [{
        id: 1,
        parent_id: null,
        path: "1",
        depth: 0,
        seed: "ml",
        kind: "hypothesis",
        title: "Root node",
        slug: "root-node",
        summary: "A root node",
        status: "anchored",
        manifest_cid: "bafyroot",
        manifest_uri: null,
        manifest_hash: null,
        notebook_cid: "bafyrootnotebook",
        skill_slug: null,
        skill_version: null,
        child_count: 0,
        comment_count: 0,
        watcher_count: 0,
        activity_score: "1.0",
        comments_locked: false,
        inserted_at: "2026-03-10T00:00:00.000Z",
        updated_at: "2026-03-10T00:00:00.000Z",
        sidelinks: []
      }]
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/v1/tree/nodes") {
    if (!req.headers["x-siwa-receipt"]) {
      json(res, 401, { error: { code: "http_envelope_invalid", message: "missing SIWA receipt" } });
      return;
    }

    json(res, 201, {
      data: {
        node_id: nextNodeId++,
        manifest_cid: "bafypackedinstall",
        status: "pinned",
        anchor_status: "pending"
      }
    });
    return;
  }

  json(res, 404, { error: { code: "route_not_found", message: `${req.method} ${requestUrl.pathname}` } });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  fs.writeFileSync(portFile, String(address.port), "utf8");
});
EOF

node "${WORK_DIR}/mock-techtree.mjs" "${SERVER_PORT_FILE}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!
wait_for_file "${SERVER_PORT_FILE}"
BASE_URL="http://127.0.0.1:$(cat "${SERVER_PORT_FILE}")"

write_fake_cdp

pnpm --dir "${WORK_DIR}" exec regents create init --config "${CONFIG_PATH}" >/dev/null
pnpm --dir "${WORK_DIR}" exec regents create wallet --dev-file "${WORK_DIR}/wallet.json" >/dev/null

cat > "${WORK_DIR}/replacement.json" <<EOF
{
  "runtime": {
    "socketPath": "${WORK_DIR}/regent.sock",
    "stateDir": "${WORK_DIR}/state",
    "logLevel": "info"
  },
  "auth": {
    "audience": "techtree",
    "defaultChainId": 84532
  },
  "services": {
    "siwa": {
      "baseUrl": "${BASE_URL}",
      "requestTimeoutMs": 1000
    },
    "platform": {
      "baseUrl": "${BASE_URL}",
      "requestTimeoutMs": 1000
    },
    "autolaunch": {
      "baseUrl": "${BASE_URL}",
      "requestTimeoutMs": 1000
    },
    "techtree": {
      "baseUrl": "${BASE_URL}",
      "requestTimeoutMs": 1000
    }
  },
  "wallet": {
    "privateKeyEnv": "REGENT_WALLET_PRIVATE_KEY",
    "keystorePath": "${WORK_DIR}/wallet-keystore.json"
  },
  "gossipsub": {
    "enabled": false,
    "listenAddrs": [],
    "bootstrap": [],
    "peerIdPath": "${WORK_DIR}/peer-id.json"
  },
  "xmtp": {
    "enabled": false,
    "env": "production",
    "dbPath": "${WORK_DIR}/xmtp/client.db",
    "dbEncryptionKeyPath": "${WORK_DIR}/xmtp/db.key",
    "walletKeyPath": "${WORK_DIR}/xmtp/wallet.key",
    "ownerInboxIds": [],
    "trustedInboxIds": [],
    "publicPolicyPath": "${WORK_DIR}/xmtp/public-policy.md",
    "profiles": {
      "owner": "full",
      "public": "messaging",
      "group": "messaging"
    }
  },
  "agents": {
    "defaultHarness": "hermes",
    "harnesses": {
      "openclaw": {
        "enabled": false,
        "entrypoint": "openclaw",
        "workspaceRoot": "${WORK_DIR}/workspaces/openclaw",
        "profiles": ["owner", "public", "group", "bbh"]
      },
      "hermes": {
        "enabled": true,
        "entrypoint": "hermes",
        "workspaceRoot": "${WORK_DIR}/workspaces/hermes",
        "profiles": ["owner", "public", "group", "bbh"]
      },
      "claude_code": {
        "enabled": false,
        "entrypoint": "claude",
        "workspaceRoot": "${WORK_DIR}/workspaces/claude-code",
        "profiles": ["owner", "public", "group", "bbh"]
      },
      "custom": {
        "enabled": false,
        "entrypoint": "custom-harness",
        "workspaceRoot": "${WORK_DIR}/workspaces/custom",
        "profiles": ["custom"]
      }
    }
  },
  "workloads": {
    "bbh": {
      "workspaceRoot": "${WORK_DIR}/workspaces/bbh",
      "defaultHarness": "hermes",
      "defaultProfile": "bbh"
    }
  }
}
EOF

pnpm --dir "${WORK_DIR}" exec regents config write --config "${CONFIG_PATH}" --input "@${WORK_DIR}/replacement.json" >/dev/null

HOME="${WORK_DIR}" REGENT_WALLET_PRIVATE_KEY="${TEST_PRIVATE_KEY}" CDP_KEY_ID="test-key" CDP_KEY_SECRET="test-secret" CDP_WALLET_SECRET="test-wallet-secret" PATH="${PATH}" \
  pnpm --dir "${WORK_DIR}" exec regents wallet setup \
    --config "${CONFIG_PATH}" \
    >/dev/null

HOME="${WORK_DIR}" REGENT_WALLET_PRIVATE_KEY="${TEST_PRIVATE_KEY}" CDP_KEY_ID="test-key" CDP_KEY_SECRET="test-secret" CDP_WALLET_SECRET="test-wallet-secret" PATH="${PATH}" \
  pnpm --dir "${WORK_DIR}" exec regents identity ensure \
    --config "${CONFIG_PATH}" \
    --network base >/dev/null

HOME="${WORK_DIR}" REGENT_WALLET_PRIVATE_KEY="${TEST_PRIVATE_KEY}" CDP_KEY_ID="test-key" CDP_KEY_SECRET="test-secret" CDP_WALLET_SECRET="test-wallet-secret" PATH="${PATH}" \
  pnpm --dir "${WORK_DIR}" exec regents run --config "${CONFIG_PATH}" >"${RUNTIME_LOG}" 2>&1 &
RUNTIME_PID=$!

wait_for_file "${WORK_DIR}/regent.sock"

HOME="${WORK_DIR}" REGENT_WALLET_PRIVATE_KEY="${TEST_PRIVATE_KEY}" CDP_KEY_ID="test-key" CDP_KEY_SECRET="test-secret" CDP_WALLET_SECRET="test-wallet-secret" PATH="${PATH}" \
  pnpm --dir "${WORK_DIR}" exec regents auth login \
    --config "${CONFIG_PATH}" \
    --audience techtree \
    >/dev/null

HOME="${WORK_DIR}" REGENT_WALLET_PRIVATE_KEY="${TEST_PRIVATE_KEY}" CDP_KEY_ID="test-key" CDP_KEY_SECRET="test-secret" CDP_WALLET_SECRET="test-wallet-secret" PATH="${PATH}" \
  pnpm --dir "${WORK_DIR}" exec regents techtree nodes list --config "${CONFIG_PATH}" --limit 1 >/dev/null

printf "print('packed install smoke')\n" > "${NOTEBOOK_PATH}"

HOME="${WORK_DIR}" REGENT_WALLET_PRIVATE_KEY="${TEST_PRIVATE_KEY}" CDP_KEY_ID="test-key" CDP_KEY_SECRET="test-secret" CDP_WALLET_SECRET="test-wallet-secret" PATH="${PATH}" \
  pnpm --dir "${WORK_DIR}" exec regents techtree node create \
    --config "${CONFIG_PATH}" \
    --seed ml \
    --kind hypothesis \
    --title "Packed install publish" \
    --parent-id 1 \
    --notebook-source "@${NOTEBOOK_PATH}" >/dev/null

echo "packed install smoke passed"
