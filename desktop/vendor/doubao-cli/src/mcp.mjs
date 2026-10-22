import { APP_MODULE_BOOTSTRAP } from './app-modules.mjs';
import { currentApp, agentWorkspace } from './app.mjs';
// Local MCP connector support: registers stdio personal connectors through
// the app's own API client, waits for the native MCP runtime to spawn them,
// and prepares the sandbox route that lets model-issued connector.call tool
// calls execute locally. Reverse-engineered from Doubao.app 2.29.12; see
// docs in README. All page-side code runs inside the authenticated renderer
// (or background page) over CDP.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { withBackgroundClient } from './cdp.mjs';
import { defaultWorkspace, evaluateWithWatchdog, sendChatCompletion } from './protocol.mjs';
import { resolvePermission } from './permissions.mjs';

// Doubao versions whose background-page dispatch needs COMPAT_PATCH_EXPRESSION
// (2.29.12 mishandles connector.call argument and result field names). Later
// versions must NOT be patched — the workaround would corrupt the fixed path.
const COMPAT_PATCH_VERSIONS = new Set(['2.29.12']);

function doubaoAppVersion() {
  const appPath = currentApp().appPath;
  const result = spawnSync('/usr/libexec/PlistBuddy', [
    '-c', 'Print CFBundleShortVersionString', `${appPath}/Contents/Info.plist`,
  ], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// webpack runtime bootstrap used by every page-side expression below. Module
// 359531 exports Sf, the app's own SkillsFacadeApiService proxy (carries the
// common query params, request signing and response unwrapping); module
// 987391 prepares sandbox execution contexts in the background page.
const RUNTIME_BOOTSTRAP = `
  ${APP_MODULE_BOOTSTRAP}
  const __readyDeadline = Date.now() + 10000;
  while (!document.querySelector('[data-testid="chat_input_input"]')) {
    if (Date.now() >= __readyDeadline) throw new Error('Doubao chat renderer is not ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const __req = await new Promise((resolve) => {
    window['@flow-web/desktop:stable'].push([['doubao_cli_' + crypto.randomUUID()], {}, (r) => resolve(r)]);
  });
`;

function buildExpression(template, args) {
  return template.replace('%ARGS%', JSON.stringify(args));
}

const REGISTER_EXPRESSION = `(async () => {
  ${RUNTIME_BOOTSTRAP}
  const args = %ARGS%;
  if (!__req.m || !__req.m[359531] && !__req.m[609347]) await __req.e('1383');
  const api = appModule(__req, 'skills').Sf;
  const created = await api.AGWManageCreatePersonalConnector({
    name: args.name,
    mcp_config: {
      transport_type: 3, // STDIO
      stdio_config: { command: args.command, params: args.params, env: args.env },
    },
  });
  const connector = created?.data?.connector;
  if (!connector?.connector_id) return { error: 'create_failed', detail: JSON.stringify(created).slice(0, 300) };
  const connectorId = connector.connector_id;
  await window.neotix.taskMode.runtime.triggerUpdate();
  const deadline = Date.now() + args.timeoutMs;
  let lastStatus = 'absent';
  while (Date.now() < deadline) {
    const { connectors } = await window.neotix.taskMode.connector.queryLocalConnectors({});
    const current = connectors.find((item) => item.connectorId === connectorId);
    if (current) lastStatus = current.status + (current.enabled ? '' : '(disabled)');
    if (current?.enabled && current.status === 'READY') return { connectorId, status: current.status };
    if (current && ['INSTALL_FAILED', 'START_FAILED', 'AUTH_FAILED'].includes(current.status)) {
      return { error: 'status_failed', connectorId, status: current.status };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { error: 'ready_timeout', connectorId, status: lastStatus };
})()`;

const LIST_EXPRESSION = `(async () => {
  ${RUNTIME_BOOTSTRAP}
  if (!__req.m || !__req.m[359531] && !__req.m[609347]) await __req.e('1383');
  const api = appModule(__req, 'skills').Sf;
  const result = await api.AGWManageListUserConnectors({ keyword: '', page_size: 100, page_token: '' });
  if (result?.code || !Array.isArray(result?.data?.items)) throw new Error('Doubao connector list could not be read');
  if (result.data.has_more) throw new Error('Doubao connector list is incomplete; narrow the account catalog before retrying');
  return result.data.items.map((item) => ({
    connectorId: item.connector_id,
    name: item.name,
    enabled: item.enabled,
    type: item.type,
    vendor: item.vendor,
  }));
})()`;

const REMOVE_EXPRESSION = `(async () => {
  ${RUNTIME_BOOTSTRAP}
  const args = %ARGS%;
  if (!__req.m || !__req.m[359531] && !__req.m[609347]) await __req.e('1383');
  const api = appModule(__req, 'skills').Sf;
  const result = { connectorId: args.connectorId, removed: false };
  const verify = async () => {
    const response = await api.AGWManageListUserConnectors({ keyword: '', page_size: 100, page_token: '' });
    if (response?.code || !Array.isArray(response?.data?.items)) throw new Error('connector list could not be read');
    const connector = response.data.items.find(item => item.connector_id === args.connectorId);
    if (!connector && response.data.has_more) throw new Error('connector list is incomplete');
    result.state = !connector ? 'absent' : connector.enabled === false ? 'disabled' : 'enabled';
    return result.state !== 'enabled';
  };
  try { await api.AGWManageDisconnectConnector({ connector_id: args.connectorId, skill_type: 1 }); result.disconnected = true; }
  catch (error) { result.disconnected = false; result.disconnectError = String(error?.message || error).slice(0, 200); }
  let inactive = false;
  try { inactive = await verify(); }
  catch (error) { result.verificationError = String(error?.message || error).slice(0, 200); }
  if (!inactive) {
    try { await api.AGWManageSetConnectorEnabled({ connector_id: args.connectorId, enabled: false, skill_type: 1 }); }
    catch (error) { result.disableError = String(error?.message || error).slice(0, 200); }
    try { inactive = await verify(); delete result.verificationError; }
    catch (error) { result.verificationError = String(error?.message || error).slice(0, 200); }
  }
  result.disabled = inactive;
  try { await window.neotix.taskMode.runtime.triggerUpdate(); } catch {}
  if (inactive) {
    const deadline = Date.now() + 10000;
    do {
      try {
        const { connectors } = await window.neotix.mcp.getAllTools();
        result.runtimeDisconnected = !connectors.some(item => item.connectorId === args.connectorId);
        if (result.runtimeDisconnected) { result.removed = true; break; }
      } catch (error) { result.verificationError = String(error?.message || error).slice(0, 200); break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    if (!result.runtimeDisconnected && !result.verificationError) result.verificationError = 'connector tools are still loaded locally';
  }
  return result;
})()`;

const SNAPSHOT_EXPRESSION = `(async () => {
  const args = %ARGS%;
  const { connectors } = await window.neotix.mcp.getAllTools();
  const missing = [];
  const snapshot = [];
  for (const connectorId of args.connectorIds) {
    const entry = connectors.find((item) => item.connectorId === connectorId);
    if (!entry) { missing.push(connectorId); continue; }
    const parsed = JSON.parse(entry.toolsJson);
    const tools = Array.isArray(parsed) ? parsed : parsed.tools || [];
    snapshot.push({
      connectorId,
      mcpToolsList: tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: JSON.stringify(tool.inputSchema || {}),
        ...(tool.annotations ? { annotations: JSON.stringify(tool.annotations) } : {}),
        ...(tool._meta ? { meta: JSON.stringify(tool._meta) } : {}),
      })),
    });
  }
  return missing.length ? { error: 'connectors_not_ready', missing } : { snapshot };
})()`;

const PREPARE_SANDBOX_EXPRESSION = `(async () => {
  ${RUNTIME_BOOTSTRAP}
  const args = %ARGS%;
  const runtime = await window.neotix.taskMode.runtime.queryRuntimeInfo({ env: true });
  const envId = runtime?.env?.environmentId || '';
  if (!__req.m || !__req.m[987391] && !__req.m[876207]) await __req.e('28037');
  const prepare = appModule(__req, 'sandbox').H;
  const out = await prepare({
    cwd: args.workspace,
    envId,
    from: 'main',
    globalSkillPath: args.agentWorkspace,
    projectFolders: args.projectFolders,
    sandboxAuthType: args.sandboxAuthType,
    sendContext: args.sendContext,
  });
  if (!out?.sandboxId) return { error: 'sandbox_prepare_failed', detail: JSON.stringify(out).slice(0, 300) };
  return { sandboxId: out.sandboxId, resolvedSharedFolders: out.resolvedSharedFolders || [] };
})()`;

// Doubao 2.29.12 background-page dispatch bugs this works around:
// 1. connector.call forwards raw_arguments (string) to the native MCP bridge,
//    which requires an object — parse it when the wire carries a string.
// 2. the success path reads mcpResponseJson but the bridge returns
//    mcpResultJson — alias it.
// Both checks are no-ops once the app fixes the field handling.
const COMPAT_PATCH_EXPRESSION = `(() => {
  if (globalThis.__doubaoCliConnectorPatch) return { patched: false, already: true };
  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const value = origParse(text, reviver);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.protocol_version === 1 && typeof value.raw_arguments === 'string') {
        try { value.raw_arguments = origParse(value.raw_arguments); } catch {}
      }
      if (value.mcpResponseJson === undefined && typeof value.mcpResultJson === 'string') {
        value.mcpResponseJson = value.mcpResultJson;
      }
    }
    return value;
  };
  globalThis.__doubaoCliConnectorPatch = true;
  return { patched: true };
})()`;

// Registers a stdio MCP server as a personal connector and waits for the
// native runtime to report READY (the app spawns the command itself).
export async function registerConnector(client, { name, command, params = [], env = {}, timeoutMs = 90_000 }) {
  const result = await evaluateWithWatchdog(client, buildExpression(REGISTER_EXPRESSION, {
    name, command, params, env, timeoutMs,
  }), timeoutMs + 30_000);
  if (result?.error) {
    throw new Error(`Doubao connector registration failed: ${result.error} ${result.status || ''} ${result.detail || ''}`.trim());
  }
  return result;
}

export async function listConnectors(client) {
  return await evaluateWithWatchdog(client, LIST_EXPRESSION, 15_000) || [];
}

// Disconnect may itself delete a personal connector. Confirm account state
// before disabling, then require the local tool catalog to release it.
export async function removeConnector(client, connectorId) {
  return evaluateWithWatchdog(client, buildExpression(REMOVE_EXPRESSION, { connectorId }), 30_000);
}

// Builds the localConnectors tool snapshot for a chat request. Throws unless
// every requested connector is READY with its tools discovered.
export async function connectorsSnapshot(client, connectorIds) {
  const result = await client.evaluate(buildExpression(SNAPSHOT_EXPRESSION, { connectorIds }));
  if (!result || result.error) {
    throw new Error(`Doubao connectors are not ready: ${(result?.missing || connectorIds).join(', ')}. Run "doubao mcp list" to check them.`);
  }
  return result.snapshot;
}

// Registers a sandbox execution context in the background page. Without this
// route the model's local tool calls fail with sandbox_not_provisioned.
export async function prepareToolSandbox(client, { workspace, sendContext, permission, projectFolders = [], createWorkspace = false }) {
  resolvePermission(permission);
  if (createWorkspace) fs.mkdirSync(workspace, { recursive: true });
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error(`workspace is not a directory: ${workspace}`);
  const result = await evaluateWithWatchdog(client, buildExpression(PREPARE_SANDBOX_EXPRESSION, {
    workspace,
    projectFolders,
    agentWorkspace: agentWorkspace(),
    sendContext,
    sandboxAuthType: resolvePermission(permission),
  }), 30_000);
  if (!result?.sandboxId) {
    throw new Error(`Doubao sandbox preparation failed: ${result?.error || 'unknown'} ${result?.detail || ''}`.trim());
  }
  return result;
}

// Installs the background-page compatibility patch on app versions known to
// need it (idempotent, in-memory only; gone after an app restart).
export async function installConnectorCompatPatch() {
  if (!COMPAT_PATCH_VERSIONS.has(doubaoAppVersion())) return { patched: false, skipped: 'version_ok' };
  return withBackgroundClient(async (client) => client.evaluate(COMPAT_PATCH_EXPRESSION));
}

// Full tool-enabled send: patch the background dispatch, snapshot the
// connectors' tools, register a sandbox route bound to this conversation,
// then send with the localConnectors catalog attached.
export async function sendWithConnectors(client, request, connectorIds) {
  await installConnectorCompatPatch();
  const localConnectors = await connectorsSnapshot(client, connectorIds);
  const workspace = request.workspace || defaultWorkspace();
  const localConversationId = request.localConversationId || `local_${Date.now()}`;
  const localMessageId = request.localMessageId || crypto.randomUUID();
  const sendContext = request.conversationId
    ? { conversationId: request.conversationId, localMessageId }
    : { localConversationId, localMessageId };
  const sandbox = request.sandboxId ? { sandboxId: request.sandboxId, resolvedSharedFolders: request.sharedFolderPath || [] }
    : await prepareToolSandbox(client, { workspace, sendContext, permission: request.permission,
      projectFolders: request.taskContext?.projectContext?.folders?.map(f => f.path) || [], createWorkspace: request.createWorkspace ?? !request.workspace });
  return sendChatCompletion(client, {
    ...request,
    workspace,
    localConnectors,
    sandboxId: sandbox.sandboxId,
    sharedFolderPath: sandbox.resolvedSharedFolders.length ? sandbox.resolvedSharedFolders : undefined,
    localConversationId,
    localMessageId,
    withExt: Boolean(request.conversationId),
  });
}
