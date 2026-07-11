#!/usr/bin/env node

const assert = require("assert");
const path = require("path");
const fs = require("fs/promises");
const { createJiti } = require("jiti");

const repoRoot = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const extensionModule = jiti(path.join(repoRoot, "extensions", "xai-oauth.ts"));
const extension = extensionModule.default || extensionModule;
const originalFetch = global.fetch;
const requests = [];

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock() {
  global.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith("http://127.0.0.1:")) {
      return originalFetch(url, init);
    }

    if (href === "https://auth.x.ai/.well-known/openid-configuration") {
      return jsonResponse({
        authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
        token_endpoint: "https://auth.x.ai/oauth2/token",
      });
    }

    if (href === "https://auth.x.ai/oauth2/token") {
      const params = new URLSearchParams(String(init.body || ""));
      requests.push({ url: href, body: Object.fromEntries(params) });
      return jsonResponse({
        access_token: `access-${params.get("code") || "refresh"}`,
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }

    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url: href, headers: init.headers || {}, body, signal: init.signal });
    if (href.endsWith("/images/generations")) {
      return jsonResponse({ data: [{ url: "https://example.test/image.png" }] });
    }
    return jsonResponse({ id: "resp_test", output_text: "OK" });
  };
}

function restoreFetchMock() {
  global.fetch = originalFetch;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] || headers[name.toLowerCase()];
}

function urlOriginIs(url, expectedOrigin) {
  try {
    return new URL(url).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function loadExtension() {
  const providers = new Map();
  const tools = new Map();
  const handlers = new Map();
  let activeTools = ["read", "bash", "edit", "write"];
  extension({
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerProvider(name, config) {
      providers.set(name, config);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    getActiveTools() {
      return activeTools;
    },
    setActiveTools(toolNames) {
      activeTools = toolNames;
    },
  });
  return { providers, tools, handlers, getActiveTools: () => activeTools, setActiveTools: (toolNames) => { activeTools = toolNames; } };
}

function authContext() {
  return {
    modelRegistry: {
      find(provider, modelId) {
        return { provider, id: modelId, headers: {} };
      },
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "oauth-token" };
      },
    },
  };
}

function verifyProviderOnlyToolset(tools) {
  assert.equal(tools.size, 0, "provider-only extension should not register custom tools");

  for (const name of [
    "xai_generate_text",
    "xai_multi_agent",
    "xai_generate_image",
    "xai_analyze_image",
    "xai_web_search",
    "xai_x_search",
    "xai_code_execution",
    "xai_critique",
    "xai_deep_research",
    "Read",
    "Write",
    "StrReplace",
    "Edit",
    "Delete",
    "LS",
    "Grep",
    "Glob",
    "Shell",
    "WebSearch",
  ]) {
    assert.ok(!tools.has(name), `${name} should not be registered by the provider-only extension`);
  }
}

function lastResultErrorMessage(result) {
  return result && typeof result.errorMessage === "string" ? result.errorMessage : "";
}

async function captureStreamResultMessage(createStream) {
  try {
    const result = await createStream().result();
    return lastResultErrorMessage(result);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function verifyRealGuardSemantics() {
  const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-responses");
  const context = { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] };
  const baseModel = {
    id: "grok-4.3",
    provider: "xai-auth",
    baseUrl: "https://api.x.ai/v1",
    headers: {},
    reasoning: true,
    input: ["text", "image"],
  };


  const before = requests.length;
  const acceptedMessage = await captureStreamResultMessage(() =>
    streamSimple({ ...baseModel, api: "openai-responses" }, context, { apiKey: "oauth-token" }),
  );
  assert.doesNotMatch(acceptedMessage, /Mismatched api/, "an openai-responses model must satisfy the real guard");
  assert.ok(
    requests.slice(before).some((entry) => entry.url && urlOriginIs(entry.url, "https://api.x.ai")),
    "guarded call should reach the xAI endpoint",
  );
}

async function verifyXaiStreamPassesRealGuard(provider) {
  const before = requests.length;
  const message = await captureStreamResultMessage(() =>
    provider.streamSimple(
      {
        id: "grok-4.3",
        provider: "xai-auth",
        api: "xai-responses",
        baseUrl: "https://api.x.ai/v1",
        headers: {},
        reasoning: true,
        input: ["text", "image"],
      },
      { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
      { apiKey: "oauth-token", sessionId: "guard-session" },
    ),
  );
  assert.doesNotMatch(message, /Mismatched api/, "xAI provider stream must satisfy pi 0.79.8 API guard");
  assert.ok(
    requests.slice(before).some((entry) => entry.url && urlOriginIs(entry.url, "https://api.x.ai")),
    "xAI stream should reach the xAI endpoint past the guard",
  );
}


async function verifyCliModelStreamRouting(provider) {
  const composer = provider.models.find((model) => model.id === "grok-composer-2.5-fast");
  const model = {
    ...composer,
    provider: "xai-auth",
    api: provider.api,
    baseUrl: provider.baseUrl,
  };
  const before = requests.length;
  const stream = provider.streamSimple(
    model,
    { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
    { apiKey: "oauth-token", sessionId: "session-test" },
  );
  await stream.result();
  const request = requests.slice(before).find((entry) => entry.url && urlOriginIs(entry.url, "https://cli-chat-proxy.grok.com"));
  assert.ok(request, "Composer 2.5 provider streams should route to the Grok CLI endpoint");
  assert.equal(request.body.model, "grok-composer-2.5-fast");
  assert.equal(request.body.reasoning, undefined, "Composer 2.5 provider streams should not send reasoning effort");
  assert.equal(headerValue(request.headers, "Authorization"), "Bearer oauth-token");
  assert.equal(headerValue(request.headers, "x-xai-token-auth"), "xai-grok-cli");
  assert.equal(headerValue(request.headers, "x-grok-model-override"), "grok-composer-2.5-fast");
  assert.equal(headerValue(request.headers, "x-grok-conv-id"), "session-test");
}

async function verifyOAuthCallbackState(provider) {
  let authUrl;
  const login = provider.oauth.login({
    onPrompt: async () => "n",
    onProgress: () => {},
    onAuth(auth) {
      authUrl = new URL(auth.url);
      const redirectUri = authUrl.searchParams.get("redirect_uri");
      const expectedState = authUrl.searchParams.get("state");
      setTimeout(async () => {
        const bad = new URL(redirectUri);
        bad.searchParams.set("code", "bad-code");
        bad.searchParams.set("state", "wrong-state");
        const badResponse = await originalFetch(bad);
        assert.equal(badResponse.status, 400, "bad OAuth state should be rejected without resolving login");

        const good = new URL(redirectUri);
        good.searchParams.set("code", "good-code");
        good.searchParams.set("state", expectedState);
        await originalFetch(good);
      }, 10);
    },
  });

  const credentials = await login;
  assert.equal(credentials.access, "access-good-code", "login should ignore the bad callback and exchange the good code");
  assert.ok(authUrl, "login should provide an authorization URL");
}

async function verifyOAuthManualRawCode(provider) {
  const rawCode = "bMmOusw8w9arz1aNEuDCY02jhiOs22O5j-92yEKTzMCbPShyToONJWSc2KITti2CgoM0clOeFMUosJm76y_2MA";
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 500);
  let authUrl;

  try {
    const credentials = await provider.oauth.login({
      onPrompt: async () => "n",
      onProgress: () => {},
      onAuth(auth) {
        authUrl = new URL(auth.url);
      },
      onManualCodeInput: async () => rawCode,
      signal: controller.signal,
    });

    assert.equal(credentials.access, `access-${rawCode}`, "raw pasted xAI authorization code should be accepted and exchanged");
    assert.ok(authUrl, "login should provide an authorization URL before accepting manual code");
  } finally {
    clearTimeout(abortTimer);
  }
}

async function verifyOAuthManualCallbackUrlState(provider) {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 500);
  let callbackUrl;

  try {
    const credentials = await provider.oauth.login({
      onPrompt: async () => "n",
      onProgress: () => {},
      onAuth(auth) {
        const authUrl = new URL(auth.url);
        callbackUrl = new URL(authUrl.searchParams.get("redirect_uri"));
        callbackUrl.searchParams.set("code", "manual-url-code");
        callbackUrl.searchParams.set("state", authUrl.searchParams.get("state"));
      },
      onManualCodeInput: async () => callbackUrl.toString(),
      signal: controller.signal,
    });

    assert.equal(credentials.access, "access-manual-url-code", "manual callback URL with matching state should be exchanged");
  } finally {
    clearTimeout(abortTimer);
  }
}

async function verifyOAuthManualWrongStateIgnored(provider) {
  const progress = [];
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 5_000);
  let authUrl;

  try {
    const credentials = await provider.oauth.login({
      onPrompt: async () => "n",
      onProgress(message) {
        progress.push(message);
      },
      onAuth(auth) {
        authUrl = new URL(auth.url);
        const redirectUri = authUrl.searchParams.get("redirect_uri");
        const expectedState = authUrl.searchParams.get("state");
        setTimeout(async () => {
          const good = new URL(redirectUri);
          good.searchParams.set("code", "manual-wrong-state-fallback-good");
          good.searchParams.set("state", expectedState);
          await originalFetch(good);
        }, 10);
      },
      onManualCodeInput: async () => "code=bad-manual-state-code&state=wrong-state",
      signal: controller.signal,
    });

    assert.equal(credentials.access, "access-manual-wrong-state-fallback-good", "manual callback query with wrong state should be ignored");
    assert.ok(progress.some((message) => /OAuth state did not match/.test(message)), "wrong-state manual callback should log that it was ignored");
    assert.ok(authUrl, "login should provide an authorization URL");
  } finally {
    clearTimeout(abortTimer);
  }
}

async function verifyPackageExtensionEntrypoint() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.deepEqual(
    pkg.pi?.extensions,
    ["./extensions/xai-oauth.ts"],
    "package.json pi.extensions should point at the TypeScript entrypoint, not the extensions directory",
  );
}

async function main() {
  process.env.HOME = path.join(repoRoot, ".tmp-empty-home-for-tests");
  process.env.XAI_API_KEY = "must-not-be-used";
  installFetchMock();

  await verifyPackageExtensionEntrypoint();

  try {
    const firstLoad = loadExtension();
    const { providers, tools } = firstLoad;
    const secondLoad = loadExtension();
    const provider = providers.get("xai-auth");
    assert.ok(provider, "xai-auth provider should be registered");
    assert.equal(secondLoad.tools.size, tools.size, "extension reloads should register tools on the new pi API object");
    assert.equal(provider.api, "xai-responses");
    const grok45 = provider.models.find((model) => model.id === "grok-4.5");
    assert.ok(grok45, "grok-4.5 should be registered in the xAI model catalog");
    assert.equal(grok45?.contextWindow, 500_000);
    assert.equal(grok45?.reasoning, true);
    assert.equal(grok45?.cost.input, 2);
    assert.equal(grok45?.cost.cacheRead, 0.5);
    assert.equal(grok45?.cost.output, 6);
    assert.equal(grok45?.thinkingLevelMap?.off, null, "Grok 4.5 reasoning cannot be disabled");
    assert.equal(provider.models.find((model) => model.id === "grok-4.3")?.contextWindow, 1_000_000);
    assert.equal(provider.models.find((model) => model.id === "grok-build")?.contextWindow, 512_000);
    assert.equal(provider.models.find((model) => model.id === "grok-composer-2.5-fast")?.contextWindow, 200_000);
    assert.equal(provider.models.find((model) => model.id === "grok-composer-2.5-fast")?.reasoning, false);
    assert.equal(provider.models.find((model) => model.id === "grok-4.20-0309-reasoning")?.contextWindow, 2_000_000);
    assert.ok(provider.models.some((model) => model.id === "grok-4.20-multi-agent-0309"));

    await verifyRealGuardSemantics();
    await verifyXaiStreamPassesRealGuard(provider);

    await verifyCliModelStreamRouting(provider);
    verifyProviderOnlyToolset(tools);

    await verifyOAuthCallbackState(provider);
    await verifyOAuthManualRawCode(provider);
    await verifyOAuthManualCallbackUrlState(provider);
    await verifyOAuthManualWrongStateIgnored(provider);


    console.log("verify-extension: ok");
  } finally {
    restoreFetchMock();
  }
}

main().catch((error) => {
  restoreFetchMock();
  console.error(error);
  process.exit(1);
});
