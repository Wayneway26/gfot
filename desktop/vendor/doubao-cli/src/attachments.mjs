import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_MODULE_BOOTSTRAP } from './app-modules.mjs';
import { evaluateWithWatchdog } from './protocol.mjs';

const DROP_AREA = '[data-testid="file_drop_area"]';
const ATTACHMENT_AREA = '[data-testid="attachment_area"]';
const ATTACHMENT_ITEM = '[data-testid="attachment_area"] [data-testid="attachment_file_item"]';
const IMAGE_ITEM = '[data-testid="attachment_area"] [data-testid="mdbox_image"]';
const MAX_FILE_COUNT = 50;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const CHUNK_BYTES = 384 * 1024;

const MIME_TYPES = new Map([
  ['.csv', 'text/csv'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.epub', 'application/epub+zip'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.mobi', 'application/x-mobipocket-ebook'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.txt', 'text/plain'],
  ['.webp', 'image/webp'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function attachmentMimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLocaleLowerCase('en-US')) || 'application/octet-stream';
}

export async function resolveAttachmentFiles(filePaths) {
  if (!Array.isArray(filePaths) || !filePaths.length) return [];
  if (filePaths.length > MAX_FILE_COUNT) throw new Error(`at most ${MAX_FILE_COUNT} attachments can be uploaded at once`);

  const files = [];
  for (const input of filePaths) {
    const resolvedPath = path.resolve(input);
    let stat;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      throw new Error(`attachment does not exist: ${resolvedPath}`);
    }
    if (!stat.isFile()) throw new Error(`attachment is not a regular file: ${resolvedPath}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`attachment exceeds the 100 MiB CLI limit: ${resolvedPath}`);
    files.push({
      path: resolvedPath,
      name: path.basename(resolvedPath),
      size: stat.size,
      type: attachmentMimeType(resolvedPath),
      lastModified: Math.trunc(stat.mtimeMs),
    });
  }
  return files;
}

async function stageFiles(client, files, stateKey) {
  await client.evaluate(`globalThis[${JSON.stringify(stateKey)}] = []`);
  for (const [index, file] of files.entries()) {
    await client.evaluate(`globalThis[${JSON.stringify(stateKey)}].push({
      name: ${JSON.stringify(file.name)},
      type: ${JSON.stringify(file.type)},
      lastModified: ${file.lastModified},
      chunks: [],
    })`);
    const bytes = await fs.readFile(file.path);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const base64 = bytes.subarray(offset, offset + CHUNK_BYTES).toString('base64');
      await client.evaluate(`globalThis[${JSON.stringify(stateKey)}][${index}].chunks.push(
        Uint8Array.from(atob(${JSON.stringify(base64)}), (character) => character.charCodeAt(0)),
      )`);
    }
  }
}

async function dispatchDrop(client, stateKey) {
  return client.evaluate(`(() => {
    const records = globalThis[${JSON.stringify(stateKey)}];
    const target = document.querySelector(${JSON.stringify(DROP_AREA)})?.parentElement;
    if (!target) throw new Error('Doubao attachment drop target was not found');
    const transfer = new DataTransfer();
    for (const record of records) {
      transfer.items.add(new File(record.chunks, record.name, {
        type: record.type,
        lastModified: record.lastModified,
      }));
    }
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return [...transfer.files].map((file) => ({ name: file.name, size: file.size, type: file.type }));
  })()`);
}

export function attachmentUploadReady(state, expected) {
  return state.files.length === expected.files
    && state.files.every((item) => item.available)
    && state.images.length === expected.images
    && state.images.every((item) => item.loaded)
    && !state.progressing;
}

function inputDraftModule(req) {
  const match = Object.entries(req.m || {}).find(([, factory]) => {
    const source = factory.toString();
    return source.includes('WebInputDraftRepository:') && source.includes('createInputAttachmentDraftUnit:');
  });
  if (!match) throw new Error('Native input-draft repository API is unavailable');
  return req(Number(match[0]));
}

// Native input-draft restore creates a new localKey from the stable uploaded
// fileKey. Match the remote identity and its multiplicity, never the pre-send
// localKey; extra copies are ambiguous and must be left untouched.
export async function removeAttachmentsByUploadKey({ list, remove, readDurable }, fileKeys, options = {}) {
  const targets = new Map();
  for (const key of fileKeys || []) {
    if (typeof key !== 'string' || !key) throw new Error('Uploaded attachment identity is missing');
    targets.set(key, (targets.get(key) || 0) + 1);
  }
  if (!targets.size) return;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 125;
  // Discovery, deletion and durable readback share one budget. This function
  // is also serialized into the renderer, so keep its deadline helpers local.
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + timeoutMs);
  const expired = () => new Error('Staged attachment cleanup timed out; could not confirm cleanup in the native draft repository');
  const remainingMs = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw expired();
    return ms;
  };
  const bounded = async operation => {
    const ms = remainingMs();
    let timer;
    try {
      const result = await Promise.race([
        operation(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(expired()), ms); }),
      ]);
      // A late native read must never lead to another deletion after expiry.
      remainingMs();
      return result;
    } finally { clearTimeout(timer); }
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remainingMs())));
  let ownedRecords = [];

  while (Date.now() < deadline) {
    const records = await bounded(list);
    const owned = records.filter((record) => targets.has(record.fileKey));
    if (owned.length) {
      for (const [key, count] of targets) {
        const matches = owned.filter((record) => record.fileKey === key);
        if (matches.length > count) throw new Error('Staged attachment identity is ambiguous; nothing else was removed');
        if (matches.length < count) break;
      }
      const complete = [...targets].every(([key, count]) => owned.filter((record) => record.fileKey === key).length === count);
      if (complete) {
        ownedRecords = owned;
        const remaining = new Map(targets);
        // Delete by a fresh index for each action because deleting one item
        // shifts every later index in that native attachment group.
        for (const target of [...owned].sort((a, b) => b.index - a.index)) {
          const current = (await bounded(list)).filter((record) => record.fileKey === target.fileKey);
          if (current.length !== remaining.get(target.fileKey)) continue;
          const record = current.find((item) => item.localKey === target.localKey && item.params.chatId === target.params.chatId && item.params.skillType === target.params.skillType);
          if (record) {
            await bounded(() => remove(record));
            remaining.set(target.fileKey, remaining.get(target.fileKey) - 1);
          }
        }
        break;
      }
    }
    await pause();
  }

  if (!ownedRecords.length) throw new Error('Could not identify staged attachments in the accepted conversation');
  if (typeof readDurable !== 'function') throw new Error('Native attachment draft readback is unavailable');

  while (Date.now() < deadline) {
    const current = await bounded(list);
    const visible = current.filter((record) => targets.has(record.fileKey));
    const persistedKeys = await bounded(() => readDurable(ownedRecords));
    const persistedCounts = new Map();
    for (const key of persistedKeys || []) persistedCounts.set(key, (persistedCounts.get(key) || 0) + 1);
    const cleared = [...targets].every(([key]) => !persistedCounts.has(key));
    if (!visible.length && cleared) return;
    await pause();
  }
  throw new Error('Could not confirm staged attachment cleanup in the native draft repository');
}

async function waitForUploads(client, files, timeoutMs) {
  const expected = {
    files: files.filter((file) => !file.type.startsWith('image/')).length,
    images: files.filter((file) => file.type.startsWith('image/')).length,
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await client.evaluate(`(() => {
      const area = document.querySelector(${JSON.stringify(ATTACHMENT_AREA)});
      const fileItems = ${expected.files}
        ? [...document.querySelectorAll(${JSON.stringify(ATTACHMENT_ITEM)})].slice(-${expected.files})
        : [];
      const imageItems = ${expected.images}
        ? [...document.querySelectorAll(${JSON.stringify(IMAGE_ITEM)})]
          .filter((item) => !item.closest('[data-testid="attachment_file_item"]'))
          .slice(-${expected.images})
        : [];
      return {
        files: fileItems.map((item) => ({
          available: item.getAttribute('data-available') === 'true',
          name: (item.querySelector('[data-testid="message_nested_content_file_name"]')?.innerText || '').trim(),
          status: (item.querySelector('[data-testid="message_nested_content_file_subtitle"]')?.innerText || '').trim(),
        })),
        images: imageItems.map((item) => {
          const image = item.querySelector('img[alt="image"]');
          return { loaded: Boolean(image?.complete && image?.naturalWidth > 0) };
        }),
        progressing: /(?:^|\\s)\\d{1,3}%(?:\\s|$)/u.test(area?.innerText || ''),
        status: (area?.innerText || '').trim(),
      };
    })()`);
    if (attachmentUploadReady(state, expected)) return;
    const failed = state.files.find((item) => /(?:失败|不支持|超出|error|failed)/iu.test(item.status));
    if (failed) throw new Error(`Doubao failed to upload attachment ${failed.name || ''}: ${failed.status}`.trim());
    if (/(?:失败|不支持|超出|error|failed)/iu.test(state.status)) {
      throw new Error(`Doubao failed to upload an attachment: ${state.status}`);
    }
    await delay(250);
  }
  throw new Error(`Doubao attachments did not finish uploading within ${timeoutMs} ms`);
}

async function clearComposerAttachments(client) {
  await client.evaluate(`(() => {
    for (const item of document.querySelectorAll(${JSON.stringify(ATTACHMENT_ITEM)})) {
      item.querySelector('[data-testid="message_nested_content_file_delete"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    const area = document.querySelector(${JSON.stringify(ATTACHMENT_AREA)});
    const imageItems = [...document.querySelectorAll(${JSON.stringify(IMAGE_ITEM)})]
      .filter((item) => !item.closest('[data-testid="attachment_file_item"]'));
    for (const image of imageItems) {
      let container = image.parentElement;
      while (container && container !== area) {
        const deleteButton = [...container.children]
          .find((child) => /(?:^|\\s)delete-btn-[^\\s]+/u.test(child.className || ''));
        if (deleteButton) {
          deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          break;
        }
        container = container.parentElement;
      }
    }
  })()`);
}

export async function uploadAttachmentsFromClient(client, filePaths, options = {}) {
  const files = await resolveAttachmentFiles(filePaths);
  if (!files.length) return [];
  const existingAttachmentCount = await client.evaluate(`(() => {
    const files = document.querySelectorAll(${JSON.stringify(ATTACHMENT_ITEM)}).length;
    const images = [...document.querySelectorAll(${JSON.stringify(IMAGE_ITEM)})]
      .filter((item) => !item.closest('[data-testid="attachment_file_item"]')).length;
    return files + images;
  })()`);
  if (existingAttachmentCount) {
    throw new Error('Doubao composer already contains draft attachments; remove them before using --attach');
  }
  const timeoutMs = options.timeoutMs || 60_000;
  const stateKey = `__doubaoCliUpload_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    await stageFiles(client, files, stateKey);
    const dropped = await dispatchDrop(client, stateKey);
    if (dropped.length !== files.length) throw new Error('Doubao did not accept every attachment from the drop event');
    try {
      await waitForUploads(client, files, timeoutMs);
    } catch (error) {
      await clearComposerAttachments(client).catch(() => {});
      throw error;
    }
    return files;
  } finally {
    await client.evaluate(`delete globalThis[${JSON.stringify(stateKey)}]`).catch(() => {});
  }
}

// Reuse the app's uploaded attachment records and official wire formatter.
// Only read/remove the uploads staged by this invocation, never another draft.
export async function uploadedAttachmentBlocks(client, files) {
  return client.evaluate(`(async () => {
    const req = await new Promise(resolve => window['@flow-web/desktop:stable'].push([['doubao_attachment_' + crypto.randomUUID()], {}, resolve]));
    ${APP_MODULE_BOOTSTRAP}
    const chatId = appModule(req, 'stores').Wp('chatViewCoreStore').getState().currentChatViewConfig?.chatId;
    const map = appModule(req, 'stores').Wp('attachmentsStore').getState().attachmentsMap?.[chatId] || {};
    const groups = Object.entries(map).filter(([, list]) => list?.length);
    if (groups.length !== 1) throw new Error('Cannot identify the staged attachments safely');
    const [group, attachments] = groups[0];
    const expected = ${JSON.stringify(files.map(f => ({ name: f.name, size: f.size })))};
    if (attachments.length !== expected.length || attachments.some((a, i) =>
      (a.fileName || a.file?.name) !== expected[i].name || Number(a.file?.size ?? a.size) !== expected[i].size)) {
      throw new Error('Composer attachments changed; nothing was sent');
    }
    const params = { chatId, skillType: group.slice(1) };
    const api = appModule(req, 'attachments');
    const states = api.getAttachmentStates(params), keys = api.getAttachmentsKeys(params);
    if (keys.some(k => !k)) throw new Error('Attachment upload identifiers are not ready');
    const block = appModule(req, 'attachmentBlock').S({ attachments, attachmentKeys: keys, attachmentStates: states });
    if (block?.content?.attachment_block?.attachments?.length !== expected.length) throw new Error('The app could not encode every attachment');
    return { blocks: [block], params, fileKeys: keys };
  })()`);
}

export async function clearUploadedAttachments(client, snapshot, acceptedConversationId, options = {}) {
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + (options.timeoutMs ?? 5_000));
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) throw new Error('Staged attachment cleanup skipped because the operation deadline expired');
  await evaluateWithWatchdog(client, `(async () => {
    const req = await new Promise(resolve => window['@flow-web/desktop:stable'].push([['doubao_attachment_cleanup_' + crypto.randomUUID()], {}, resolve]));
    ${APP_MODULE_BOOTSTRAP}
    const removeAttachmentsByUploadKey = ${removeAttachmentsByUploadKey.toString()};
    const inputDraftModule = ${inputDraftModule.toString()};
    const snapshot = ${JSON.stringify(snapshot)};
    const api = appModule(req, 'attachments');
    const stores = appModule(req, 'stores');
    const store = stores.Wp('attachmentsStore');
    const uploadStore = stores.Wp('attachmentUploadStore');
    const originChatId = snapshot.params.chatId;
    const acceptedChatId = ${JSON.stringify(acceptedConversationId ?? '')};
    const chatIds = [...new Set([...(typeof originChatId === 'string' ? [originChatId] : []), ...(acceptedChatId ? [String(acceptedChatId)] : [])])];
    const skillType = snapshot.params.skillType;
    const list = () => {
      const map = store.getState().attachmentsMap || {};
      const preprocess = uploadStore.getState().preprocessTaskMap || {};
      return Object.entries(map).flatMap(([recordChatId, groups]) => {
        if (!chatIds.includes(String(recordChatId))) return [];
        return Object.entries(groups || {}).flatMap(([group, attachments]) => {
          if (group !== '_' + skillType) return [];
          const params = { chatId: recordChatId, skillType: group.slice(1) };
          const keys = api.getAttachmentsKeys(params) || [];
          return (attachments || []).map((attachment, index) => {
            const fileKey = keys[index] || attachment.fileKey || attachment.key || preprocess[attachment.localKey]?.key;
            return {
              fileKey,
              localKey: attachment.localKey,
              index,
              params,
            };
          }).filter(record => record.fileKey);
        });
      });
    };
    const accountScope = localStorage.getItem('flow_tea_user_id');
    let draftModule;
    try { draftModule = inputDraftModule(req); } catch {}
    await removeAttachmentsByUploadKey({
      list: () => {
        return list();
      },
      remove: async record => {
        const actions = api.getAttachmentActions(record.params);
        await actions.deleteAttachment({ index: record.index });
      },
      readDurable: async records => {
        if (!draftModule) throw new Error('Native input-draft repository API is unavailable');
        if (!accountScope) throw new Error('Native input-draft account scope is unavailable');
        // Construct a fresh repository for each read so its per-account hydration cache cannot
        // mask a write that the native debounce has not flushed yet.
        const repository = new draftModule.WebInputDraftRepository();
        await repository.get({ accountScope, conversationScope: 'conversation:' + snapshot.params.chatId, inputId: 'primary' });
        if (repository.memoryOnlyAccounts?.has(accountScope)) {
          throw new Error('Native input-draft storage is unavailable; memory fallback cannot confirm durable cleanup');
        }
        const persisted = repository.memory.snapshotAccountRecords(accountScope);
        const ownedKeys = new Set(snapshot.fileKeys);
        return persisted.flatMap(record => Object.values(record?.units || {})
          .flatMap(unit => unit?.payload?.items || []))
          .map(item => item.fileKey)
          .filter(key => typeof key === 'string' && ownedKeys.has(key));
      },
    }, snapshot.fileKeys, { deadline: ${deadline}, timeoutMs: ${timeoutMs} });
  })()`, timeoutMs);
}
