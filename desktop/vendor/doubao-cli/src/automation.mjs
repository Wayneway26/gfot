import { currentApp } from './app.mjs';
import { desktopVersion, rendererJsonClient, requireGoalMode } from './features.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { uploadAttachmentsFromClient, uploadedAttachmentBlocks, clearUploadedAttachments } from './attachments.mjs';
import { withChatClient } from './cdp.mjs';
import { resolveModelFromClient, resolveReasoningEffort, selectModelFromClient, setReasoningForConversation } from './models.mjs';
import { sendWithConnectors, prepareToolSandbox } from './mcp.mjs';
import { resolveTaskContext, publicTaskContext, validateTaskOptions } from './context.mjs';
import { AUTOMATIC_MODEL_PROTOCOL, sendChatCompletion, switchConversationModel } from './protocol.mjs';
import { refreshTurn, readTurn, waitTurn, stopTurn, receiptStore } from './turns.mjs';

const CHAT_INPUT = '[data-testid="chat_input_input"] [contenteditable="true"]';
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function remainingMilliseconds(deadline, timeoutMs) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`Doubao operation did not complete within ${timeoutMs} ms`);
  return remaining;
}

export function conversationDeepLink(id, app = currentApp()) {
  const webUrl = `https://www.doubao.com/chat/${id}`;
  return `${app.scheme}://${app.scheme}app/open-url?url=${encodeURIComponent(webUrl)}`;
}

export function openConversation(id) {
  const url = conversationDeepLink(id);
  // Doubao activates itself when handling the deep link (open -g does not
  // prevent it), so remember the frontmost app and restore focus in a
  // detached watcher once that activation happens.
  const before = spawnSync('/usr/bin/osascript', [
    '-e', 'tell application "System Events" to get name of first application process whose frontmost is true',
  ], { encoding: 'utf8' }).stdout.trim();
  const result = spawnSync('/usr/bin/open', ['-g', '-a', currentApp().appPath, url], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `failed to open ${url}`);
  if (before && before !== currentApp().name) {
    const restore = [
      'for i in $(seq 1 30); do',
      'cur=$(/usr/bin/osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\' 2>/dev/null);',
      `if [ "$cur" = "${currentApp().name}" ]; then`,
      `/usr/bin/osascript -e 'tell application "System Events" to set frontmost of process "${before.replace(/"/g, '\\"')}" to true' 2>/dev/null;`,
      'exit 0;',
      'fi;',
      'sleep 0.3;',
      'done',
    ].join(' ');
    spawn('bash', ['-c', restore], { detached: true, stdio: 'ignore' }).unref();
  }
  return url;
}

export function conversationIdFromUrl(url) {
  return /\/chat\/(\d{12,24})(?:[?#]|$)/u.exec(url || '')?.[1] || null;
}

async function waitForConversation(client, id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await client.evaluate(`({ href: location.href, ready: Boolean(document.querySelector(${JSON.stringify(CHAT_INPUT)})) })`);
      if (state?.ready && new RegExp(`/chat/${id}(?:[?#]|$)`, 'u').test(state.href)) return state.href;
    } catch {
      // The renderer tears down its execution context during navigation;
      // keep polling until the new page is ready.
    }
    await delay(200);
  }
  throw new Error(`Doubao did not open conversation ${id} within ${timeoutMs} ms`);
}

// Navigating the chat renderer in place never raises the Doubao window,
// unlike the doubao:// deep link, which always activates the app.
// force reloads even when the renderer already shows the conversation, so
// callers read fresh state instead of a stale UI left by server-side changes.
async function navigateToConversation(client, target, id, timeoutMs, { force = false } = {}) {
  if (force || conversationIdFromUrl(target.url) !== id) {
    const base = target.url.replace(/\/chat(?:\/.*)?$/u, '');
    await client.send('Page.navigate', { url: `${base}/chat/${id}` });
  }
  await waitForConversation(client, id, timeoutMs);
}

// Use the existing renderer only. A missing chat page must not implicitly
// launch the app's deep link and interrupt the user's foreground application.
async function withConversationPage(id, timeoutMs, callback, { force = false } = {}) {
  return withChatClient(async (client, target) => {
    await navigateToConversation(client, target, id, timeoutMs, { force });
    return await callback(client);
  });
}

// The drop area mounts slightly after the composer input, especially after an
// in-page navigation. Wait for it before staging attachment uploads.
async function waitForDropTarget(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate('Boolean(document.querySelector(\'[data-testid="file_drop_area"]\'))');
    if (ready) return;
    await delay(200);
  }
  throw new Error('Doubao attachment drop target was not found');
}

async function waitForBlankConversation(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await client.evaluate(`({
        href: location.href,
        ready: Boolean(document.querySelector(${JSON.stringify(CHAT_INPUT)})),
      })`);
      if (state?.ready && /\/chat(?:[?#]|$)/u.test(state.href)) return state.href;
    } catch {
      // Keep polling while the renderer navigates.
    }
    await delay(100);
  }
  throw new Error(`Doubao did not open a blank conversation within ${timeoutMs} ms`);
}

const READ_MESSAGES_EXPRESSION = `(() => [...document.querySelectorAll('[data-testid="union_message"]')]
  .map((element) => {
    const role = element.querySelector('[data-testid="send_message"]')
      ? 'user'
      : element.querySelector('[data-testid="receive_message"]') ? 'assistant' : null;
    const parts = [...element.querySelectorAll('[data-testid="message_text_content"]')]
      .map((part) => (part.innerText || '').trim())
      .filter(Boolean);
    const attachments = [...element.querySelectorAll('[data-testid="message_nested_content_file_name"]')]
      .map((part) => (part.innerText || '').trim())
      .filter(Boolean);
    const images = element.querySelectorAll('[data-plugin-identifier="block_type:10052"] img').length;
    return role && (parts.length || attachments.length || images)
      ? {
        role,
        text: parts.join('\\n'),
        ...(attachments.length ? { attachments } : {}),
        ...(images ? { images } : {}),
      }
      : null;
  })
  .filter(Boolean))()`;

async function readFromClient(client) {
  return await client.evaluate(READ_MESSAGES_EXPRESSION) || [];
}

// The composer auto-inserts spaces at CJK/latin/digit boundaries, so the
// rendered text can differ from the submitted message. Compare with all
// whitespace stripped.
export function normalizeMessageText(value) {
  return String(value || '').replace(/\s+/gu, '');
}

export function replyAfterLastUserMessage(messages, message) {
  const expected = normalizeMessageText(message);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user' || normalizeMessageText(messages[index].text) !== expected) continue;
    return messages.slice(index + 1).findLast((item) => item.role === 'assistant' && item.text) || null;
  }
  return null;
}

function attachmentCounts(messages) {
  const counts = new Map();
  for (const item of messages) {
    if (item.role !== 'user') continue;
    for (const name of item.attachments || []) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

export function attachmentsConfirmed(before, after, attachments) {
  const beforeCounts = attachmentCounts(before);
  const afterCounts = attachmentCounts(after);
  const expectedCounts = new Map();
  for (const attachment of attachments.filter((item) => !item.type?.startsWith('image/'))) {
    expectedCounts.set(attachment.name, (expectedCounts.get(attachment.name) || 0) + 1);
  }
  const filesConfirmed = [...expectedCounts].every(([name, expected]) => (
    (afterCounts.get(name) || 0) - (beforeCounts.get(name) || 0) >= expected
  ));
  const expectedImages = attachments.filter((item) => item.type?.startsWith('image/')).length;
  const beforeImages = before.reduce((total, item) => total + (item.role === 'user' ? item.images || 0 : 0), 0);
  const afterImages = after.reduce((total, item) => total + (item.role === 'user' ? item.images || 0 : 0), 0);
  return filesConfirmed && afterImages - beforeImages >= expectedImages;
}

export async function readConversation(id, options = {}) {
  const timeoutMs = options.timeoutMs || 10_000;
  return withConversationPage(id, timeoutMs, async (client) => {
    // File/image blocks mount after text. Wait for the whole message snapshot
    // to settle so a reload cannot silently omit an uploaded attachment.
    const deadline = Date.now() + Math.min(5000, timeoutMs);
    let messages = [];
    let previous = '';
    let stableSince = Date.now();
    do {
      messages = await readFromClient(client);
      const snapshot = JSON.stringify(messages);
      if (snapshot !== previous) stableSince = Date.now();
      if (messages.length && Date.now() - stableSince >= 1000) break;
      previous = snapshot;
      await delay(200);
    } while (Date.now() < deadline);
    return options.limit ? messages.slice(-options.limit) : messages;
  }, { force: true });
}

function validateMessage(message) {
  if (typeof message !== 'string' || !message.trim()) throw new Error('message cannot be empty');
  if (message.length > 100_000) throw new Error('message exceeds the 100000 character limit');
}

function publicAttachments(attachments) {
  return attachments.map(({ name, size, type }) => ({ name, size, type }));
}

async function prepareComposer(client, options, timeoutMs) {
  const selectedModel = options.model ? await selectModelFromClient(client, options.model) : null;
  const attachments = options.attachments?.length
    ? await uploadAttachmentsFromClient(client, options.attachments, { timeoutMs: Math.min(timeoutMs, 60_000) })
    : [];
  return { selectedModel, attachments };
}

// Explicitly stop one accepted turn and confirm all its known tasks are terminal.
export async function stopConversation(id, options = {}) {
  const timeoutMs = options.timeoutMs || 15_000;
  try {
    return await withChatClient(async client => {
      const store = await receiptStore(client);
      const runId = options.runId || (await readTurn(client, id)).result.runId;
      return stopTurn(client, id, { timeoutMs, runId, receipt: store.read(id, runId), onReceipt: r => store.save(r) });
    });
  } catch (error) {
    return { ...error.result, conversationId: id, ...(options.runId ? { runId: options.runId } : {}), stopped: false, reason: error.message };
  }
}

// A receipt identifies the accepted turn even if the streaming connection is lost.
async function sendTracked(client, request, options) {
  const deadline = Date.now() + request.timeoutMs;
  if (options.mode === 'goal') {
    await requireGoalMode(await rendererJsonClient(client), desktopVersion(), request.timeoutMs);
    request.goalId = crypto.randomUUID();
  }
  const resolved = await resolveTaskContext(client, request.conversationId, options);
  Object.assign(request, resolved);
  if (resolved.taskContext.runtime === 'local' && !options.mcps?.length) {
    request.localMessageId = crypto.randomUUID();
    request.localConversationId = `local_${Date.now()}`;
    const sendContext = request.conversationId ? { conversationId: request.conversationId, localMessageId: request.localMessageId }
      : { localConversationId: request.localConversationId, localMessageId: request.localMessageId };
    const sandbox = await prepareToolSandbox(client, { workspace: resolved.workspace, sendContext,
      permission: request.permission, createWorkspace: request.createWorkspace, projectFolders: resolved.taskContext.projectContext.folders?.map(f => f.path) || [] });
    request.sandboxId = sandbox.sandboxId;
    request.sharedFolderPath = sandbox.resolvedSharedFolders;
  }
  request.timeoutMs = remainingMilliseconds(deadline, request.timeoutMs);
  const taskContext = publicTaskContext(resolved.taskContext, resolved.workspace);
  const goal = request.goalId ? { mode: 'goal', goalId: request.goalId } : {};
  const store = await receiptStore(client);
  let receipt = {};
  const onReceipt = next => {
    receipt = { ...receipt, conversationId: next.conversationId, runId: next.runId,
      localMessageId: next.localMessageId, handoffs: next.handoffs || receipt.handoffs || [],
      liveMessages: next.liveMessages || receipt.liveMessages || [], requestBody: next.requestBody || receipt.requestBody };
    store.save(receipt);
    options.onReceipt?.({ conversationId: receipt.conversationId, runId: receipt.runId });
  };
  let stream;
  try {
    stream = options.mcps?.length ? await sendWithConnectors(client, { ...request, onReceipt }, options.mcps)
      : await sendChatCompletion(client, { ...request, onReceipt });
    onReceipt(stream);
  } catch (error) {
    if (error.receipt?.runId) onReceipt(error.receipt);
    if (!receipt.runId || !['timeout', 'incomplete_stream', 'exception'].includes(error.code)) {
      error.result ||= { conversationId: receipt.conversationId, runId: receipt.runId, localMessageId: receipt.localMessageId || error.receipt?.localMessageId, status: 'unknown', reply: null };
      throw error;
    }
  }
  if (!receipt.conversationId || !receipt.runId) throw new Error('Doubao did not identify the accepted turn');
  if (!request.waitForReply) return { ...goal, context: taskContext, conversationId: receipt.conversationId, runId: receipt.runId, localMessageId: receipt.localMessageId, status: 'running', reply: null };
  return { ...await waitTurn(client, receipt.conversationId, { receipt, deadline, onReceipt, loadReceipt: runId => store.read(receipt.conversationId, runId) }), ...goal, context: taskContext };
}

export async function taskStatus(id, options = {}) {
  return withChatClient(async client => {
    const store = await receiptStore(client);
    const runId = options.runId || (await readTurn(client, id)).result.runId;
    const receipt = store.read(id, runId);
    return (await refreshTurn(client, id, { ...options, runId, receipt, onReceipt: r => store.save(r) })).result;
  });
}
export async function waitConversation(id, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 120000);
  return withChatClient(async client => {
    const store = await receiptStore(client);
    const runId = options.runId || (await readTurn(client, id)).result.runId;
    const receipt = store.read(id, runId);
    return waitTurn(client, id, { ...options, runId, receipt, deadline, onReceipt: r => store.save(r), loadReceipt: run => store.read(id, run) });
  });
}

// Protocol-direct send: no conversation navigation, no composer DOM, reply
// completion is verified against the server's turn/task states. Attachments
// are uploaded through the composer and encoded with the app's formatter.
async function sendMessageViaProtocol(id, message, options, timeoutMs) {
  const waitForReply = options.waitForReply || false;
  const effort = options.reasoning ? resolveReasoningEffort(options.reasoning) : null;
  // Changing the effort of an existing conversation goes through the modify
  // API, which requires the model key; without --model the conversation's
  // current key is unknowable without navigating the UI.
  if (effort && !options.model) throw new Error('--reasoning requires --model when sending to an existing conversation');
  try {
    return await withChatClient(async (client) => {
      let modelName = null;
      let model = AUTOMATIC_MODEL_PROTOCOL;
      if (options.model) {
        const resolved = await resolveModelFromClient(client, options.model);
        model = resolved.protocol;
        modelName = resolved.name;
        await switchConversationModel(client, id, model.key, effort?.effort);
      }
      const request = {
        conversationId: id, message, model, reasoningEffort: effort?.effort, timeoutMs, waitForReply,
        workspace: options.workspace, skillPaths: options.skillPaths, permission: options.permission, attachmentBlocks: options.attachmentBlocks,
      };
      const result = await sendTracked(client, request, options);
      return {
        ...result,
        conversationId: result.conversationId,
        ...(modelName ? { model: modelName } : {}),
        ...(effort ? { reasoning: effort.name } : {}),
        sent: { role: 'user', text: message },
        reply: result.reply,
      };
    });
  } catch (error) {
    throw error;
  }
}

// Change the reasoning effort of an existing conversation, keeping its model.
// Forces a renderer reload so the model key comes from fresh state rather
// than a UI stale from earlier server-side changes.
export async function setConversationReasoning(id, value) {
  return withConversationPage(id, 15_000, (client) => setReasoningForConversation(client, id, value), { force: true });
}

async function withProtocolAttachments(options, send) {
  const timeoutMs = options.timeoutMs || 120000, deadline = Date.now() + timeoutMs;
  return withChatClient(async client => {
    await waitForDropTarget(client, Math.min(remainingMilliseconds(deadline, timeoutMs), 10000));
    const files = await uploadAttachmentsFromClient(client, options.attachments, { timeoutMs: Math.min(remainingMilliseconds(deadline, timeoutMs), 60000) });
    const snapshot = await uploadedAttachmentBlocks(client, files);
    let result, sendError;
    try {
      result = await send({ ...options, timeoutMs: remainingMilliseconds(deadline, timeoutMs), attachments: [], attachmentBlocks: snapshot.blocks });
    } catch (error) { sendError = error; }
    try { await clearUploadedAttachments(client, snapshot, result?.conversationId || sendError?.result?.conversationId, { deadline }); }
    catch (error) {
      // Cleanup must never hide an accepted turn or prompt an unsafe resend.
      if (result) result.attachmentCleanupWarning = String(error.message || error);
      if (sendError) sendError.attachmentCleanupWarning = String(error.message || error);
    }
    if (sendError) throw sendError;
    return { ...result, attachments: publicAttachments(files) };
  });
}

export async function sendMessage(id, message, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  validateMessage(message);
  validateTaskOptions(options);

  if (options.mcps?.length && options.attachments?.length) {
    throw new Error('--mcp is not supported with attachments');
  }
  if (!options.attachments?.length) {
    return sendMessageViaProtocol(id, message, options, timeoutMs);
  }
  return withProtocolAttachments(options, staged => sendMessageViaProtocol(id, message, staged, staged.timeoutMs));
}

export async function createConversation(message, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  const deadline = Date.now() + timeoutMs;
  if (options.mode === 'goal' && !message?.trim()) throw new Error('--mode goal requires a message');
  const hasMessage = typeof message === 'string' && message.length > 0;
  if (hasMessage) validateMessage(message);
  validateTaskOptions(options);
  if (hasMessage && options.attachments?.length && !options.mcps?.length) {
    return withProtocolAttachments(options, staged => createConversation(message, staged));
  }
  if (options.mcps?.length && options.attachments?.length) {
    throw new Error('--mcp is not supported with attachments');
  }

  // Protocol-direct create: the conversation id comes back in SSE_ACK,
  // no new-chat button click and no location.href polling.
  if (hasMessage && !options.attachments?.length) {
    const waitForReply = options.waitForReply || false;
    const effort = options.reasoning ? resolveReasoningEffort(options.reasoning) : null;
    try {
      return await withChatClient(async (client) => {
        let modelName = null;
        let model = AUTOMATIC_MODEL_PROTOCOL;
        if (options.model) {
          const resolved = await resolveModelFromClient(client, options.model);
          model = resolved.protocol;
          modelName = resolved.name;
        }
        const request = {
          conversationId: null, message, model, reasoningEffort: effort?.effort, timeoutMs, waitForReply,
          workspace: options.workspace, skillPaths: options.skillPaths, permission: options.permission, attachmentBlocks: options.attachmentBlocks,
        };
        const result = await sendTracked(client, request, options);
        return {
          ...result,
          conversationId: result.conversationId,
          created: true,
          persisted: true,
          ...(modelName ? { model: modelName } : {}),
          ...(effort ? { reasoning: effort.name } : {}),
          sent: { role: 'user', text: message },
          reply: result.reply,
        };
      });
    } catch (error) {
      throw error;
    }
  }

  if (options.reasoning) throw new Error('--reasoning requires sending a message');

  return withChatClient(async (client, target) => {
    // Navigating to the bare chat route yields a blank conversation without
    // clicking the new-conversation button, whose app handler raises the
    // Doubao window.
    const base = target.url.replace(/\/chat(?:\/.*)?$/u, '');
    await client.send('Page.navigate', { url: `${base}/chat` });
    const route = await waitForBlankConversation(client, Math.min(remainingMilliseconds(deadline, timeoutMs), 15_000));
    if (options.attachments?.length) {
      await waitForDropTarget(client, Math.min(remainingMilliseconds(deadline, timeoutMs), 10_000));
    }
    const prepared = await prepareComposer(client, options, remainingMilliseconds(deadline, timeoutMs));
    return {
      conversationId: null,
      created: true,
      persisted: false,
      route,
      ...(prepared.selectedModel ? { model: prepared.selectedModel.name } : {}),
      ...(prepared.attachments.length ? { attachments: publicAttachments(prepared.attachments) } : {}),
    };
  });
}
