import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { currentApp, activeProfile } from './app.mjs';
import { runtimeParameters, evaluateWithWatchdog, updateLiveControls, sendChatCompletion } from './protocol.mjs';
import { configDirectory } from './config.mjs';
import { APP_MODULE_BOOTSTRAP } from './app-modules.mjs';

function webIdentityGuard(runtime) {
  if (currentApp().id !== 'web') return { setup: '', check: '', rethrow: '' };
  const accountId = currentApp().accountId || runtime.accountId;
  if (!accountId || accountId === '0') throw new Error('Doubao Web account identity is unavailable; sign in and retry');
  return {
    setup: `const assertWebIdentity = () => {
      const fail = message => { throw Object.assign(new Error(message), { code: 'web_identity_changed' }); };
      if (!['https://www.doubao.com', 'https://doubao.com'].includes(location.origin)
        || !/^\\/chat(?:\\/(?:\\d{12,24}\\/?)?)?$/.test(location.pathname)) {
        fail('Selected web target left the Doubao chat origin');
      }
      if (localStorage.getItem('flow_tea_user_id') !== ${JSON.stringify(accountId)}) {
        fail('Doubao Web account changed; select the originally authenticated account');
      }
    };`,
    check: 'assertWebIdentity();',
    rethrow: "if (error.code === 'web_identity_changed') throw error;",
  };
}

function webRequestBudget(deadline) {
  const timeoutMs = Math.floor(deadline - Date.now());
  if (timeoutMs <= 0) throw Object.assign(new Error('Doubao Web request deadline elapsed before submitting the request'), { code: 'timeout' });
  return timeoutMs;
}

// A background tab can delay timers by a second. Leave room for its abort and
// CDP serialization, and preserve the socket if the caller's budget wins first.
const webBrowserTimeout = budgetMs => budgetMs - Math.min(1000, Math.floor(budgetMs / 2));
const webObservationClient = client => ({ evaluate: expression => client.evaluate(expression), close() {} });
const isWebIdentityError = error => error.code === 'web_identity_changed'
  || /Doubao Web account changed|account identity is unavailable|runtime identity is unavailable outside|left the Doubao chat origin/u.test(error.message);

async function webJsonRequest(client, runtime, url, body, contentType, errorPrefix, deadline) {
  const identity = webIdentityGuard(runtime);
  const budgetMs = webRequestBudget(deadline);
  const browserDeadline = deadline - (budgetMs - webBrowserTimeout(budgetMs));
  return evaluateWithWatchdog(webObservationClient(client), `(async () => {
    ${identity.setup}
    ${identity.check}
    const deadline = ${browserDeadline};
    const controller = new AbortController();
    let timer;
    const deadlineError = () => Object.assign(new Error(${JSON.stringify(errorPrefix + ': request deadline elapsed')}), { code: 'timeout' });
    const boundary = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { ${identity.check} }
        catch (error) { controller.abort(); reject(error); return; }
        controller.abort(); reject(deadlineError());
      }, Math.max(1, deadline - Date.now()));
    });
    boundary.catch(() => {});
    const observe = async operation => {
      ${identity.check}
      if (Date.now() >= deadline) throw deadlineError();
      const value = await Promise.race([operation(), boundary]);
      ${identity.check}
      if (Date.now() >= deadline) throw deadlineError();
      return value;
    };
    try {
      const response = await observe(() => fetch(${JSON.stringify(url)}, {
        method: 'POST', credentials: 'include', headers: { 'content-type': ${JSON.stringify(contentType)} },
        signal: controller.signal, body: ${JSON.stringify(body)},
      }));
      if (!response.ok) throw new Error(${JSON.stringify(errorPrefix + ': HTTP ')} + response.status);
      return await observe(() => response.json());
    } finally { clearTimeout(timer); controller.abort(); }
  })()`, webRequestBudget(deadline));
}

export async function imRequest(client, route, cmd, key, body, timeoutMs = 10000) {
  if (client.imRequest) return client.imRequest(route, cmd, key, body, timeoutMs);
  const web = currentApp().id === 'web';
  const deadline = web ? Date.now() + timeoutMs : undefined;
  if (web) webRequestBudget(deadline);
  const runtime = await runtimeParameters(web ? webObservationClient(client) : client, web ? { timeoutMs } : undefined);
  const { query } = runtime;
  if (web) {
    const result = await webJsonRequest(client, runtime, 'https://www.doubao.com/im/' + route + '?' + query,
      JSON.stringify({ cmd, uplink_body: { [key]: body }, sequence_id: crypto.randomUUID(), channel: 2, version: '1' }),
      'application/json; encoding=utf-8', 'Doubao task lookup failed', deadline);
    if (result.status_code) throw new Error('Doubao task lookup failed: ' + result.status_desc);
    return result.downlink_body;
  }
  const identity = webIdentityGuard(runtime);
  const fetchTimeoutMs = Math.max(1, timeoutMs);
  return evaluateWithWatchdog(client, `(async () => {
    ${identity.setup}
    ${identity.check}
    const response = await fetch(${JSON.stringify('https://www.doubao.com/im/' + route + '?' + query)}, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json; encoding=utf-8' },
      signal: AbortSignal.timeout(${fetchTimeoutMs}),
      body: JSON.stringify({ cmd: ${cmd}, uplink_body: { [${JSON.stringify(key)}]: ${JSON.stringify(body)} },
        sequence_id: crypto.randomUUID(), channel: 2, version: '1' }),
    });
    ${identity.check}
    if (!response.ok) throw new Error('Doubao task lookup failed: HTTP ' + response.status);
    const result = await response.json();
    ${identity.check}
    if (result.status_code) throw new Error('Doubao task lookup failed: ' + result.status_desc);
    return result.downlink_body;
  })()`, timeoutMs + 1000);
}

const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const ordered = messages => messages.slice().sort((a, b) => {
  const left = BigInt(a.index_in_conv || a.index_in_thread || a.message_id || 0);
  const right = BigInt(b.index_in_conv || b.index_in_thread || b.message_id || 0);
  return left < right ? -1 : left > right ? 1 : 0;
});
export function messageBlocks(message) {
  const blocks = message.content_blocks_v2 || message.content_block || parse(message.content);
  return Array.isArray(blocks) ? blocks : [];
}
export function messageText(message) {
  const blocks = messageBlocks(message);
  // The HTTP API can return legacy JSON text with an empty content_block array.
  if (!Array.isArray(blocks) || !blocks.length) {
    const text = parse(message.content)?.text;
    return typeof text === 'string' ? text.trim() : '';
  }
  const hidden = new Set(blocks.filter(block => block.content?.thinking_block).map(block => block.block_id));
  for (let pass = 0; pass < blocks.length; pass++) {
    let added = false;
    for (const block of blocks) if (hidden.has(block.parent_id) && !hidden.has(block.block_id)) { hidden.add(block.block_id); added = true; }
    if (!added) break;
  }
  return blocks.filter(block => !hidden.has(block.block_id) && !block.control_info?.collapse_block_id)
    .map(block => block.content?.text_block?.text || '').filter(Boolean).join('\n').trim();
}
export function taskLinks(messages) {
  const links = new Map();
  for (const message of messages) for (const block of messageBlocks(message)) {
    const task = block.content?.complex_task_block || block.content?.task_card_block;
    if (task?.thread_id) links.set(String(task.thread_id), {
      threadId: String(task.thread_id), title: task.title || task.header?.name || '',
      type: task.display_type || 'organizer', sourceMessageId: message.message_id,
    });
  }
  return [...links.values()];
}
function artifacts(messages) {
  const result = new Map();
  for (const message of messages) for (const block of messageBlocks(message)) {
    for (const type of ['artifact_block', 'file_block', 'local_file_block', 'artifact_code_file_block', 'creation_block']) {
      const value = block.content?.[type];
      if (value) result.set(block.block_id, { blockId: block.block_id, type, content: value });
    }
  }
  return [...result.values()];
}
function pendingInputs(messages, threadId) {
  const blocks = new Map();
  for (const message of ordered(messages)) for (const block of messageBlocks(message)) {
    blocks.set(block.block_id || message.message_id, { message, block });
  }
  return [...blocks.values()].flatMap(({ message, block }) => {
    const base = { ...(threadId ? { threadId } : {}), messageId: message.message_id, blockId: block.block_id };
    const ask = block.content?.interaction_ask_block;
    if (ask?.status === 1 && ask.quick_reply_scene !== 11) return [{ ...base,
      kind: 'input', questions: ask.questions || [], clarifyId: ask.clarify_id }];
    const quick = block.content?.quick_reply_block;
    // Ordinary reply suggestions are not blocking interactions. These scenes
    // are the app's ask-human, local-app and authorization controls.
    if (quick?.status === 1 && [2, 7, 8, 9, 10, 12].includes(quick.scene)) return [{ ...base,
      kind: 'approval', scene: quick.scene, items: quick.items || [] }];
    return [];
  });
}
function mergeControlBlocks(stored, live) {
  const terminal = ['completed', 'failed', 'cancelled'].includes(messageState(stored));
  const blocks = new Map(messageBlocks(stored).map(block => [block.block_id, block]));
  for (const block of messageBlocks(live)) {
    const previous = blocks.get(block.block_id);
    const ask = previous?.content?.interaction_ask_block;
    const quick = previous?.content?.quick_reply_block;
    if (ask && [2,3].includes(ask.status) || quick?.status === 2) continue;
    if (!terminal || !previous && [10070,10090].includes(block.block_type)) blocks.set(block.block_id, block);
  }
  stored.content_block = [...blocks.values()]; delete stored.content_blocks_v2;
}

export function messageState(message) {
  if (!message) return 'running';
  const job = parse(message.ext?.async_job);
  if (message.ext?.is_interrupted === 'true' || message.content_status === 120 || job.status === 4) return 'cancelled';
  if (message.content_status === 500 || job.status === 3 || message.ext?.error_details) return 'failed';
  if (job.status === 1 || [100, 101, 110].includes(message.content_status)) return 'running';
  if (job.status === 2 || message.ext?.is_finish === '1') return 'completed';
  return 'unknown';
}
export function summarizeTurn(conversationId, root, messages, nodes, receipt = {}) {
  const runMessages = ordered(messages.filter(m => m.user_type === 2 &&
    String(m.bot_reply_message_id || m.ext?.chat_id) === String(root.message_id) && (!m.status || m.status === 0)));
  const latest = runMessages.at(-1);
  let pending = [...pendingInputs(runMessages), ...nodes.filter(n => !['failed','cancelled'].includes(n.status)).flatMap(n => pendingInputs(n.messages, n.threadId))];
  const tasks = { total: nodes.length, running: 0, completed: 0, failed: 0, cancelled: 0, unknown: 0 };
  for (const node of nodes) tasks[node.status in tasks ? node.status : 'unknown']++;
  let status = messageState(latest);
  if (tasks.running || tasks.unknown || receipt.handoffs?.some(task => !task.completed) && !nodes.length) status = 'running';
  else if (status !== 'cancelled' && tasks.failed) status = 'failed';
  else if (status !== 'failed' && tasks.cancelled) status = 'cancelled';
  // A sync reply may finish while its organizer is still producing the final main-chat summary.
  const firstDelegation = runMessages.find(m => taskLinks([m]).length);
  if (status === 'completed' && nodes.length && latest?.message_id === firstDelegation?.message_id) status = 'running';
  if (receipt.cancellation?.confirmed && !tasks.running && !tasks.unknown
    || !['web', 'headless'].includes(currentApp().id) && receipt.cancellation?.accepted && status === 'completed') status = 'cancelled';
  if (pending.length && !['failed', 'cancelled'].includes(status)) status = 'waiting_input';
  if (['cancelled', 'failed'].includes(status)) pending = [];
  const reply = status === 'completed' ? { role: 'assistant', text: messageText(latest), messageId: latest?.message_id } : null;
  return { conversationId, runId: String(root.message_id), localMessageId: root.local_message_id || receipt.localMessageId,
    status, reply, artifacts: artifacts([...runMessages, ...nodes.flatMap(n => n.messages)]), tasks, pending,
    ...(status !== 'completed' && latest ? { progress: messageText(latest) } : {}) };
}

const remaining = deadline => ['web', 'headless'].includes(currentApp().id) && deadline
  ? Math.min(10000, webRequestBudget(deadline))
  : Math.max(1, Math.min(10000, deadline ? deadline - Date.now() : 10000));

async function conversationMessages(client, conversationId, deadline) {
  const body = await imRequest(client, 'conversation/batch_get', 1111, 'batch_get_conv_info_uplink_body', {
    conversation_id: [conversationId], option: { recent_message_count_per_conv: 100 }, ext: {},
  }, remaining(deadline));
  const conversation = body?.batch_get_conv_info_downlink_body?.conversation_info_list?.find(c => c.conversation_id === conversationId);
  if (!conversation) throw Object.assign(new Error('Doubao conversation was not found'), { code: 'turn_unavailable' });
  return conversation;
}
export async function readTurn(client, conversationId, { runId, localMessageId, receipt = {}, deadline } = {}) {
  const conversation = await conversationMessages(client, conversationId, deadline);
  const messages = ordered(conversation.messages || []);
  const live = receipt.liveMessages || [];
  const requested = runId || receipt.runId;
  localMessageId ||= receipt.localMessageId;
  const root = requested ? messages.find(m => m.user_type === 1 && String(m.message_id) === requested)
    : localMessageId ? messages.find(m => m.user_type === 1 && m.local_message_id === localMessageId)
      : messages.filter(m => m.user_type === 1).at(-1);
  if (!root) throw Object.assign(new Error(requested || localMessageId ? 'The requested turn is not in the available conversation history; no other turn was selected' : 'Conversation has no submitted turn'), { code: 'turn_unavailable' });
  const own = messages.filter(m => m.user_type === 2 && String(m.bot_reply_message_id || m.ext?.chat_id) === String(root.message_id));
  // Live task cards can precede the stored history by the entire task duration.
  // Merge control blocks only; persisted terminal messages always win.
  for (const message of live) {
    if (message.thread_id && message.thread_id !== '0') continue;
    const stored = own.find(item => item.message_id === message.message_id);
    if (!stored) {
      const item = { ...message, bot_reply_message_id: root.message_id, content_status: 100 };
      messages.push(item); own.push(item);
    }
    if (stored) mergeControlBlocks(stored, message);
  }
  const queue = taskLinks(own), seen = new Set(), nodes = [];
  for (const handoff of receipt.handoffs || []) {
    const threadId = String(handoff.threadId || '');
    if (!threadId || threadId === '0' || queue.some(link => link.threadId === threadId)) continue;
    queue.push({ threadId, title: '', type: 'organizer', sourceMessageId: '' });
  }
  for (const link of queue) {
    if (seen.has(link.threadId)) continue;
    if (seen.size >= 100) throw new Error('Task tree exceeds 100 threads; completion cannot be confirmed');
    seen.add(link.threadId);
    const info = (await imRequest(client, 'thread/info', 3400, 'get_thread_info_uplink_body', { thread_id: link.threadId }, remaining(deadline)))?.get_thread_info_downlink_body?.thread_info;
    if (!info || info.source_conversation_id !== conversationId) throw new Error('Task thread does not belong to this conversation');
    const threadMessages = []; let cursor = 0;
    for (let page = 0; page < 20; page++) {
      const data = (await imRequest(client, 'chain/thread_message', 3102, 'pull_thread_message_chain_uplink_body', {
        thread_id: link.threadId, limit: 100, direction: cursor ? 1 : 3, anchor_index: cursor, ext: {},
      }, remaining(deadline)))?.pull_thread_message_chain_downlink_body;
      if (!data) throw new Error('Task thread messages are unavailable');
      threadMessages.push(...data.messages || []);
      if (!data.has_more) break;
      if (!data.next_index || String(data.next_index) === String(cursor) || page === 19) throw new Error('Task thread history is incomplete');
      cursor = data.next_index;
    }
    for (const message of live.filter(item => item.thread_id === link.threadId)) {
      const stored = threadMessages.find(item => item.message_id === message.message_id);
      if (stored) mergeControlBlocks(stored, message);
      else threadMessages.push(message);
    }
    const latest = ordered(threadMessages).filter(m => m.user_type === 2).at(-1);
    const rawStatus = info.ext?.thread_status;
    const status = ['running', 'completed', 'failed', 'cancelled'].includes(rawStatus) ? rawStatus
      : rawStatus === 'canceled' ? 'cancelled' : messageState(latest);
    const children = taskLinks(threadMessages);
    nodes.push({ ...link, status, messages: threadMessages, children: children.map(c => c.threadId), job: parse(latest?.ext?.async_job) });
    queue.push(...children);
  }
  const result = summarizeTurn(conversationId, root, messages, nodes, receipt);
  if (['web', 'headless'].includes(currentApp().id) && result.status === 'completed'
    && !result.reply?.text?.trim() && !result.artifacts.length) {
    result.status = 'running';
    result.reply = null;
    result.completionPending = true;
  }
  return { result, root, messages: own, nodes, conversation };
}

export async function receiptStore(client) {
  const uid = client.accountId || await client.evaluate('localStorage.getItem("flow_tea_user_id")');
  if (!uid || uid === '0') throw new Error('Sign in to the selected Doubao app');
  const app = currentApp();
  if (app.id === 'web' && app.accountId && uid !== app.accountId) {
    throw new Error('Doubao Web account changed; select the originally authenticated account');
  }
  const identity = ['web', 'headless'].includes(app.id)
    ? [app.id, app.endpoint, uid, ...(app.id === 'headless' && client.profile && client.profile !== 'default' ? [client.profile] : [])]
    : [app.id, path.resolve(app.dataDir), activeProfile(app), uid];
  const scope = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
  const dir = path.join(configDirectory(), 'turns', scope);
  const validate = id => { if (!/^\d{12,24}$/u.test(id || '')) throw new Error('Invalid run id'); return id; };
  const filePath = (conversationId, runId) => path.join(dir, `${validate(conversationId)}-${validate(runId)}.json`);
  return {
    filePath,
    save(receipt) {
      if (!receipt.conversationId || !receipt.runId) return;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = filePath(receipt.conversationId, receipt.runId), tmp = file + '.' + crypto.randomUUID() + '.tmp';
      let previous = {};
      try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      // A concurrent wait must not erase an explicit cancellation or move
      // reconnect cursors backwards when it checkpoints an older snapshot.
      const handoffs = new Map((previous.handoffs || []).map(task => [task.taskId, task]));
      for (const task of receipt.handoffs || []) {
        const old = handoffs.get(task.taskId) || {};
        handoffs.set(task.taskId, { ...old, ...task, seq: Math.max(old.seq || 0, task.seq || 0), completed: old.completed || task.completed });
      }
      const cancellationFile = file + '.cancellation';
      let cancellation = {};
      try { cancellation = JSON.parse(fs.readFileSync(cancellationFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (receipt.cancellation?.requestedAt) {
        cancellation = { ...cancellation, ...receipt.cancellation,
          accepted: cancellation.accepted || receipt.cancellation.accepted,
          confirmed: cancellation.confirmed || receipt.cancellation.confirmed };
        const pending = cancellationFile + '.' + crypto.randomUUID() + '.tmp';
        fs.writeFileSync(pending, JSON.stringify(cancellation), { mode: 0o600 }); fs.renameSync(pending, cancellationFile);
      }
      const value = { ...receipt, handoffs: [...handoffs.values()], cancellation };
      fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(tmp, file);
    },
    read(conversationId, runId) {
      try {
        const file = filePath(conversationId, runId);
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        try { receipt.cancellation = JSON.parse(fs.readFileSync(file + '.cancellation', 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        return receipt;
      }
      catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
    },
  };
}
function reconcileLiveControls(snapshot, receipt) {
  for (const live of receipt.liveMessages || []) {
    const messages = live.thread_id && live.thread_id !== '0'
      ? snapshot.nodes.find(node => node.threadId === live.thread_id)?.messages : snapshot.messages;
    const stored = messages?.find(message => message.message_id === live.message_id);
    if (!stored) continue;
    if (['completed', 'cancelled', 'failed'].includes(messageState(stored))) {
      live.content_block = messageBlocks(live).filter(block => [10070, 10090].includes(block.block_type));
    } else {
      for (const block of messageBlocks(stored)) {
        const ask = block.content?.interaction_ask_block, quick = block.content?.quick_reply_block;
        if (ask && [2, 3].includes(ask.status) || quick?.status === 2) {
          live.content_block = messageBlocks(live).filter(item => item.block_id !== block.block_id);
        }
      }
    }
  }
}

function handoffsFromSnapshot(snapshot, receipt) {
  receipt.handoffs ||= [];
  for (const message of [...snapshot.messages, ...snapshot.nodes.flatMap(node => node.messages)]) {
    const job = parse(message.ext?.async_job);
    if (job.job_id && job.append_scene && !receipt.handoffs.some(task => task.taskId === String(job.job_id))) {
      receipt.handoffs.push({ taskId: String(job.job_id), appendScene: job.append_scene, seq: 0 });
    }
  }
}

export async function waitTurn(client, conversationId, options = {}) {
  const deadline = options.deadline || Date.now() + (options.timeoutMs || 120000);
  const receipt = options.receipt || {};
  receipt.conversationId = conversationId;
  receipt.runId ||= options.runId;
  receipt.localMessageId ||= options.localMessageId;
  let snapshot = options.snapshot, lastError, resumed = false;
  do {
    options.signal?.throwIfAborted();
    try {
      const saved = options.loadReceipt?.(receipt.runId);
      if (saved?.cancellation) receipt.cancellation = saved.cancellation;
      snapshot = await readTurn(client, conversationId, { ...options, runId: receipt.runId || options.runId, receipt, deadline });
      options.signal?.throwIfAborted();
      receipt.runId = snapshot.result.runId;
      receipt.localMessageId ||= snapshot.result.localMessageId;
      reconcileLiveControls(snapshot, receipt);
      handoffsFromSnapshot(snapshot, receipt);
      options.onReceipt?.(receipt);
      if (['completed', 'failed', 'cancelled', 'waiting_input'].includes(snapshot.result.status)) return snapshot.result;
    } catch (error) {
      lastError = error;
      // An ACK can precede IM persistence. Retry lookups, never the send.
      if (error.code !== 'turn_unavailable') break;
    }
    if (Date.now() >= deadline) break;
    options.signal?.throwIfAborted();
    try {
      if (currentApp().id !== 'web' && !resumed && receipt.requestBody && !receipt.handoffs?.length && !receipt.liveMessages?.some(m => pendingInputs([m]).length)) {
        resumed = true;
        try {
          const send = client.resumeCompletion || ((options) => sendChatCompletion(client, options));
          const result = await send({ conversationId, runId: receipt.runId,
            localMessageId: receipt.localMessageId, model: {}, resumeRequest: receipt.requestBody,
            timeoutMs: Math.max(1, deadline - Date.now()), waitForReply: true, ...(options.signal ? { signal: options.signal } : {}),
            onReceipt: next => { Object.assign(receipt, next); options.onReceipt?.(receipt); } });
          Object.assign(receipt, result); options.onReceipt?.(receipt);
        } catch (error) {
          if (error.receipt) { Object.assign(receipt, error.receipt); options.onReceipt?.(receipt); }
          if (!['timeout', 'incomplete_stream', 'exception'].includes(error.code)) throw error;
        }
      } else if (receipt.handoffs?.some(task => !task.completed)) {
        await followTaskStreams(client, receipt, Math.min(1500, deadline - Date.now()), options.onReceipt);
      } else await new Promise(resolve => setTimeout(resolve, Math.min(750, deadline - Date.now())));
    } catch (error) { lastError = error; break; }
  } while (Date.now() < deadline);
  const timedOut = Date.now() >= deadline;
  const error = new Error(timedOut
    ? 'Waiting timed out; the task was not cancelled. Continue with sessions wait ' + conversationId + (receipt.runId ? ' --run ' + receipt.runId : '')
    : 'Could not confirm task state; the task was not cancelled. ' + lastError?.message);
  error.code = timedOut ? 'timeout' : 'task_unavailable';
  error.result = { ...(snapshot?.result || { conversationId, runId: receipt.runId, localMessageId: receipt.localMessageId, reply: null, status: 'unknown' }),
    ...(!timedOut ? { status: 'unknown' } : {}) };
  throw error;
}

export async function refreshTurn(client, conversationId, options = {}) {
  const receipt = options.receipt || {};
  let snapshot = await readTurn(client, conversationId, { ...options, receipt });
  receipt.conversationId = conversationId; receipt.runId = snapshot.result.runId;
  reconcileLiveControls(snapshot, receipt);
  handoffsFromSnapshot(snapshot, receipt);
  if (['running', 'unknown'].includes(snapshot.result.status) && receipt.handoffs.some(task => !task.completed)) {
    await followTaskStreams(client, receipt, Math.min(1500, remaining(options.deadline)), options.onReceipt);
    if (!['web', 'headless'].includes(currentApp().id) || !options.deadline || Date.now() < options.deadline) {
      snapshot = await readTurn(client, conversationId, { ...options, runId: receipt.runId, receipt });
    }
  }
  options.onReceipt?.(receipt);
  return snapshot;
}

export async function stopTurn(client, conversationId, options = {}) {
  options.receipt ||= {};
  const web = ['web', 'headless'].includes(currentApp().id);
  const deadline = web ? Math.min(options.deadline || Infinity, Date.now() + (options.timeoutMs || 15000))
    : Date.now() + (options.timeoutMs || 15000);
  const receipt = options.receipt;
  let snapshot;
  const stopped = new Set(), failed = new Set(), errors = [];
  const unresolved = () => ({ ...(snapshot?.result || {
    conversationId, runId: options.runId || receipt.runId, localMessageId: options.localMessageId || receipt.localMessageId,
    status: 'unknown', reply: null,
  }), stopped: false,
    reason: web && receipt.taskTrackingIncomplete && !snapshot?.nodes.length
      ? 'Web task tracking was incomplete; the task tree could not be confirmed'
      : receipt.cancellation?.requestedAt ? 'Cancellation requested, but not all task states could be confirmed'
        : 'Could not confirm selected task state; cancellation was not submitted', ...(errors.length ? { errors } : {}) });
  const recordError = (error, identifiers) => {
    errors.push({ ...identifiers, message: error.message });
    if (web && isWebIdentityError(error)) { error.result = unresolved(); throw error; }
  };
  try { snapshot = await refreshTurn(client, conversationId, { ...options, deadline }); }
  catch (error) {
    if (!web) throw error;
    recordError(error, { runId: options.runId || receipt.runId });
    return unresolved();
  }
  const runId = snapshot.result.runId;
  const terminal = result => ['completed', 'failed', 'cancelled'].includes(result.status)
    && !result.tasks.running && !result.tasks.unknown;
  const trackingUnproven = () => web && receipt.taskTrackingIncomplete && snapshot.nodes.length === 0;
  if (terminal(snapshot.result)) {
    if (trackingUnproven()) return { ...snapshot.result, stopped: false,
      reason: 'Web task tracking was incomplete; the task tree could not be confirmed' };
    return { ...snapshot.result, stopped: true };
  }
  receipt.conversationId = conversationId; receipt.runId = runId;
  receipt.cancellation = { requestedAt: new Date().toISOString(), accepted: false };
  options.onReceipt?.(receipt);
  // The server request addresses this question id, never the latest UI reply.
  try {
    await imRequest(client, 'message/break_stream_msg', 2240, 'break_stream_msg_uplink_body', {
      reply_msg_id: runId, message_id: '', conversation_id: conversationId,
      conversation_type: snapshot.conversation.conversation_type, break_reason: 7,
    }, remaining(deadline));
    receipt.cancellation.accepted = true; options.onReceipt?.(receipt);
  } catch (error) { recordError(error, { runId }); }
  do {
    for (const node of snapshot.nodes) {
      if (Date.now() >= deadline) break;
      if (['completed', 'cancelled', 'failed'].includes(node.status)
        || stopped.has(node.threadId) || failed.has(node.threadId)) continue;
      try {
        const timeout = remaining(deadline);
        const result = client.terminateTask ? await client.terminateTask(node.threadId, timeout) : web
          ? await (async () => {
            const requestDeadline = Math.min(deadline, Date.now() + timeout);
            const runtime = await runtimeParameters(webObservationClient(client), { timeoutMs: timeout });
            const { query } = runtime;
            const threadId = String(node.threadId);
            if (!/^[1-9]\d{11,23}$/u.test(threadId)) throw new Error('Web task cancellation has an invalid thread id');
            // The endpoint requires a JSON number. Keep the validated decimal
            // digits as source text so IDs above MAX_SAFE_INTEGER aren't rounded.
            const body = `{"thread_id":${threadId}}`;
            return webJsonRequest(client, runtime, 'https://www.doubao.com/alice/generaltask/terminate?' + query,
              body, 'application/json', 'Web task cancellation failed', requestDeadline);
          })()
          : await evaluateWithWatchdog(client, `(async () => {
          const req = await new Promise(resolve => window['@flow-web/desktop:stable'].push([['doubao_stop_' + crypto.randomUUID()], {}, resolve]));
          ${APP_MODULE_BOOTSTRAP}
          return appModule(req, 'skills').iv.AGWTaskTerminate({ thread_id: ${JSON.stringify(node.threadId)} });
        })()`, timeout + 1000);
        if (result.code !== 0) throw new Error(web ? 'Web task cancellation was rejected' : 'Task cancellation rejected: ' + (result.message || result.msg || result.code));
        stopped.add(node.threadId);
        receipt.cancellation.accepted = true; options.onReceipt?.(receipt);
      } catch (error) {
        if (web && /HTTP 400\b/u.test(error.message)) failed.add(node.threadId);
        recordError(error, { threadId: node.threadId });
      }
    }
    if (web && Date.now() >= deadline) break;
    try { snapshot = await readTurn(client, conversationId, { runId, receipt: options.receipt, deadline }); }
    catch (error) { recordError(error, { runId }); break; }
    if (terminal(snapshot.result) && !trackingUnproven()) {
      if (!web) {
        receipt.cancellation.confirmed = true; options.onReceipt?.(receipt);
        return { ...snapshot.result, status: 'cancelled', reply: null, pending: [], stopped: true };
      }
      const confirmedCancelled = snapshot.result.status === 'cancelled'
        && !snapshot.result.tasks.running && !snapshot.result.tasks.unknown;
      if (confirmedCancelled) { receipt.cancellation.confirmed = true; options.onReceipt?.(receipt); }
      return confirmedCancelled
        ? { ...snapshot.result, status: 'cancelled', reply: null, pending: [], stopped: true }
        : { ...snapshot.result, stopped: true };
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
  } while (Date.now() < deadline);
  return unresolved();
}

// Consume each asynchronous handoff without submitting another user message.
// Server snapshots remain authoritative for final text, task state and artifacts.
export async function followTaskStreams(client, receipt, timeoutMs, onReceipt = () => {}) {
  if (!receipt.handoffs?.length) return;
  if (client.followTaskStreams) return client.followTaskStreams(receipt, timeoutMs, onReceipt);
  const web = currentApp().id === 'web';
  const deadline = web ? Date.now() + timeoutMs : undefined;
  if (web) webRequestBudget(deadline);
  const runtime = await runtimeParameters(web ? webObservationClient(client) : client, web ? { timeoutMs } : undefined);
  const { query } = runtime;
  const identity = webIdentityGuard(runtime);
  const streamBudgetMs = web ? webRequestBudget(deadline) : Math.max(1, timeoutMs);
  // Background-page timers and CDP serialization need more allowance than an HTTP response.
  const streamTimeoutMs = web ? streamBudgetMs - Math.min(1000, Math.floor(streamBudgetMs / 2)) : streamBudgetMs;
  const streamControl = web ? `
    let streamStopped = false, stopStream, deadlineTimer, identityTimer;
    const controllers = new Set();
    const boundary = new Promise((_, reject) => {
      stopStream = error => {
        if (streamStopped) return;
        streamStopped = true;
        for (const controller of controllers) controller.abort();
        reject(error);
      };
      deadlineTimer = setTimeout(() => {
        try { ${identity.check} }
        catch (error) { stopStream(error); return; }
        stopStream(Object.assign(new Error('Async stream polling deadline reached'), { code: 'web_stream_deadline' }));
      }, Math.max(1, deadline - Date.now()));
      const inspectIdentity = () => {
        if (streamStopped) return;
        try { ${identity.check} }
        catch (error) { stopStream(error); return; }
        identityTimer = setTimeout(inspectIdentity, Math.max(1, Math.min(50, deadline - Date.now())));
      };
      identityTimer = setTimeout(inspectIdentity, Math.max(1, Math.min(50, deadline - Date.now())));
    });
    boundary.catch(() => {});
    const withinStream = promise => Promise.race([promise, boundary]);
  ` : 'const withinStream = promise => promise;';
  const result = await evaluateWithWatchdog(web ? webObservationClient(client) : client, `(async () => {
    ${identity.setup}
    ${identity.check}
    const tasks = ${JSON.stringify(receipt.handoffs)};
    const state = { liveMessages: ${JSON.stringify(receipt.liveMessages || [])} };
    const updateLiveControls = ${updateLiveControls.toString()};
    const deadline = ${web ? deadline - (streamBudgetMs - streamTimeoutMs) : `Date.now() + ${streamTimeoutMs}`};
    ${streamControl}
    const seen = new Set(), pending = [];
    const read = async task => {
      if (seen.has(task.taskId) || task.completed) return;
      seen.add(task.taskId);
      delete task.waitingInput;
      while (${web ? '!streamStopped && ' : ''}Date.now() < deadline && !task.completed) {
        const ac = new AbortController();
        ${web ? 'controllers.add(ac); const timer = undefined;' : 'const timer = setTimeout(() => ac.abort(), Math.max(1, deadline - Date.now()));'}
        try {
          ${identity.check}
          const response = await withinStream(fetch(${web
            ? `location.origin + ${JSON.stringify('/chat/async/chunk_stream?' + query)}`
            : JSON.stringify('https://api5-normal-gl.doubao.com/chat/async/chunk_stream?' + query)}, {
            method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ task_id: task.taskId, seq_start: task.seq || 0, append_scene: task.appendScene, ext: {} }), signal: ac.signal,
          }));
          ${identity.check}
          if (!response.ok) throw new Error('Async stream HTTP ' + response.status);
          ${web ? 'delete task.connectionError;' : ''}
          const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
          try { while (!task.completed) {
            const part = await withinStream(reader.read()); if (part.done) break;
            ${identity.check}
            buffer += decoder.decode(part.value, { stream: true }).replaceAll('\\r\\n', '\\n');
            let end;
            while ((end = buffer.indexOf('\\n\\n')) >= 0) {
              const chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const lines = chunk.split('\\n'), event = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
              const id = Number(lines.find(l => l.startsWith('id:'))?.slice(3).trim());
              let data; try { data = JSON.parse(lines.filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('\\n')); } catch { continue; }
              if (Number.isFinite(id) && id > 0 && id <= (task.seq || 0)) continue;
              if (Number.isFinite(id)) task.seq = Math.max(task.seq || 0, id);
              const waiting = updateLiveControls(state, event, data);
              if (waiting) { task.waitingInput = true; break; }
              if (event === 'ASYNC_CHUNK_SNAPSHOT') task.seq = Math.max(task.seq || 0, Number(data.next_seq) || 0);
              if (event === 'FETCH_STREAM' && data.fetch_type === 2 && data.fetch_key && !tasks.some(t => t.taskId === String(data.fetch_key))) {
                if (tasks.length >= 100) throw new Error('Async task stream limit exceeded');
                const child = { taskId: String(data.fetch_key), appendScene: data.append_scene, threadId: data.thread_id || '', seq: 0 };
                tasks.push(child); const childRead = read(child); ${web ? 'childRead.catch(() => {});' : ''} pending.push(childRead);
              }
              if (event === 'SSE_REPLY_END' && data.end_type === 3) task.completed = true;
              if (event === 'STREAM_ERROR' || event === 'gateway-error') { task.error = data.error_msg || data.error_code || event; task.completed = true; }
            }
            if (task.waitingInput) break;
          } } finally { ${web
            ? 'try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}'
            : 'await reader.cancel().catch(() => {});'} }
        } catch (error) {
          ${identity.rethrow}
          task.connectionError = String(error.message || error);
          ${web ? "if (error.code === 'web_stream_deadline') break;" : ''}
        }
        finally { clearTimeout(timer); ${web ? 'controllers.delete(ac); ac.abort();' : ''} }
        if (task.waitingInput) break;
        if (!task.completed && ${web ? '!streamStopped && ' : ''}Date.now() < deadline) {
          try { await withinStream(new Promise(r => setTimeout(r, ${web ? 'Math.min(300, Math.max(1, deadline - Date.now()))' : '300'}))); }
          catch (error) { ${identity.rethrow} ${web ? "if (error.code === 'web_stream_deadline') break;" : ''} throw error; }
        }
      }
    };
    try {
      for (const task of tasks) { const taskRead = read(task); ${web ? 'taskRead.catch(() => {});' : ''} pending.push(taskRead); }
      for (let index = 0; index < pending.length; index++) await pending[index];
      ${identity.check}
      return { tasks, liveMessages: state.liveMessages };
    } finally { ${web ? 'streamStopped = true; clearTimeout(deadlineTimer); clearTimeout(identityTimer); for (const controller of controllers) controller.abort();' : ''} }
  })()`, web ? webRequestBudget(deadline) : Math.max(1, timeoutMs) + 1000);
  receipt.handoffs = result.tasks; receipt.liveMessages = result.liveMessages; onReceipt(receipt);
}
