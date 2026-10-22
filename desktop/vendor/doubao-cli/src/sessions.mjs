import { cdpStatus, withChatClient } from './cdp.mjs';
import { currentSession, getDataDir, listSessions, readProfiles } from './storage.mjs';
import { evaluateWithWatchdog, runtimeParameters } from './protocol.mjs';

// Current app versions store account-scoped snapshots in IndexedDB rather
// than the old raw IM response. Read through the app to avoid LevelDB locks,
// compression details, and stale snapshots from a previously signed-in user.
export function sessionsFromSnapshots(rows, uid) {
  const sessions = new Map();
  const visit = (data) => {
    for (const item of data?.conversations || []) {
      const id = String(item.conversation_id || '');
      if (/^\d{12,24}$/u.test(id) && !sessions.has(id)) {
        sessions.set(id, { id, title: item.name || null });
      }
    }
    for (const group of [...(data?.projects || []), ...(data?.devices || [])]) visit(group);
  };
  const owned = rows.filter(row => String(row.uid) === String(uid));
  for (const row of owned.filter(row => row.schema?.startsWith('conversation-list-data-overall-'))) visit(row.data);
  for (const row of owned) visit(row.data);
  return [...sessions.values()];
}

export async function conversationSettings(client, id) {
  const runtime = await runtimeParameters(client);
  return evaluateWithWatchdog(client, `(async () => {
    const response = await fetch(${JSON.stringify('https://www.doubao.com/im/conversation/batch_get?' + runtime.query)}, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json; encoding=utf-8' },
      body: JSON.stringify({
        cmd: 1111,
        uplink_body: { batch_get_conv_info_uplink_body: {
          conversation_id: [${JSON.stringify(id)}], option: { recent_message_count_per_conv: 0 }, ext: {},
        } },
        sequence_id: crypto.randomUUID(), channel: 2, version: '1',
      }),
    });
    if (!response.ok) throw new Error('Doubao conversation lookup failed: HTTP ' + response.status);
    const result = await response.json();
    if (result.status_code) throw new Error('Doubao conversation lookup failed: ' + result.status_desc);
    const item = result.downlink_body?.batch_get_conv_info_downlink_body?.conversation_info_list
      ?.find(item => item.conversation_id === ${JSON.stringify(id)});
    if (!item) throw new Error('Doubao conversation was not found');
    const extra = JSON.parse(item.extra || '{}');
    return { key: extra.model_item_key || null, effort: extra.reasoning_effort || null };
  })()`, 10_000);
}

// Stop against server state: a protocol send can leave the visible composer
// on an older turn, so a missing stop button is not evidence of completion.
export async function stopGeneration(client, id, timeoutMs) {
  const runtime = await runtimeParameters(client);
  return evaluateWithWatchdog(client, `(async () => {
    const id = ${JSON.stringify(id)};
    const query = ${JSON.stringify(runtime.query)};
    const deadline = Date.now() + ${Math.max(1, timeoutMs)};
    const request = async (route, cmd, uplink_body) => {
      const response = await fetch('https://www.doubao.com/im/' + route + '?' + query, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json; encoding=utf-8' },
        body: JSON.stringify({ cmd, uplink_body, sequence_id: crypto.randomUUID(), channel: 2, version: '1' }),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (!response.ok) throw new Error('Doubao stop lookup failed: HTTP ' + response.status);
      const result = await response.json();
      if (result.status_code) throw new Error('Doubao stop request failed: ' + result.status_desc);
      return result;
    };
    const read = async () => {
      const result = await request('conversation/batch_get', 1111, { batch_get_conv_info_uplink_body: {
        conversation_id: [id], option: { recent_message_count_per_conv: 6 }, ext: {},
      } });
      const conversation = result.downlink_body?.batch_get_conv_info_downlink_body?.conversation_info_list
        ?.find(item => item.conversation_id === id);
      if (!conversation) throw new Error('Doubao conversation was not found');
      const messages = (conversation.messages || []).slice().sort((a, b) =>
        BigInt(a.index_in_conv || 0) < BigInt(b.index_in_conv || 0) ? 1 : -1);
      const latest = messages[0];
      const replyId = latest?.user_type === 1 ? latest.message_id : latest?.ext?.chat_id || latest?.bot_reply_message_id;
      const interrupted = latest?.ext?.is_interrupted === 'true';
      const complete = !latest || interrupted || (latest.user_type === 2 && latest.ext?.is_finish === '1');
      return { replyId, type: conversation.conversation_type, complete, interrupted };
    };
    const before = await read();
    if (before.complete) return { conversationId: id, stopped: true, interrupted: before.interrupted };
    if (!/^\\d{12,24}$/u.test(before.replyId || '')) throw new Error('Doubao active reply could not be identified');
    await request('message/break_stream_msg', 2240, { break_stream_msg_uplink_body: {
      reply_msg_id: before.replyId, message_id: '', conversation_id: id,
      conversation_type: before.type, break_reason: 7,
    } });
    do {
      const after = await read();
      if (after.replyId !== before.replyId) throw new Error('A new reply started while stopping the conversation');
      if (after.complete) return { conversationId: id, stopped: true, interrupted: after.interrupted };
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    return { conversationId: id, stopped: false, reason: 'generation did not stop in time' };
  })()`, timeoutMs + 1000);
}

export async function sessionIndex(profile) {
  // --profile is a disk selection, not an account switch in a running app.
  const activeProfile = readProfiles(getDataDir()).lastUsed;
  const status = profile.directory === activeProfile ? await cdpStatus() : { available: false };
  if (status.identityMismatch) throw new Error(status.error);
  if (status.available) {
    return withChatClient(client => evaluateWithWatchdog(client, `(async () => {
      const uid = localStorage.getItem('flow_tea_user_id');
      if (!uid || uid === '0') throw new Error('Sign in to the selected Doubao app to read sessions');
      const rows = [];
      for (const entry of await indexedDB.databases()) {
        if (!entry.name?.startsWith('DoubaoPC_')) continue;
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(entry.name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          if (!db.objectStoreNames.contains('conversationListDataSnapshots')) continue;
          const snapshots = await new Promise((resolve, reject) => {
            const request = db.transaction('conversationListDataSnapshots', 'readonly')
              .objectStore('conversationListDataSnapshots').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          rows.push(...snapshots);
        } finally { db.close(); }
      }
      const parse = ${sessionsFromSnapshots.toString()};
      return {
        sessions: parse(rows, uid),
        currentId: /\\/chat\\/(\\d{12,24})(?:[?#]|$)/u.exec(location.href)?.[1] || null,
      };
    })()`, 10_000));
  }
  return { sessions: listSessions(profile.path), currentId: currentSession(profile.path) };
}
