import fs from 'node:fs';
import { currentApp, resolveApp } from './app.mjs';
import path from 'node:path';

const SNAPSHOT_MARKER = Buffer.from('pull_recent_conv_chain_downlink_body');
const CONVERSATION_ID = Buffer.from('conversation_id');
const NAME = Buffer.from('name');

export function getDataDir(env) {
  return env ? resolveApp(undefined, env).dataDir : currentApp().dataDir;
}

export function readProfiles(dataDir = getDataDir()) {
  const localStatePath = path.join(dataDir, 'Local State');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read Doubao profile metadata at ${localStatePath}: ${error.message}`);
  }

  const infoCache = state.profile?.info_cache || {};
  return {
    lastUsed: state.profile?.last_used || null,
    profiles: Object.entries(infoCache).map(([directory, info]) => ({
      directory,
      name: info.name || directory,
    })),
  };
}

export function resolveProfile(dataDir = getDataDir(), requested) {
  const metadata = readProfiles(dataDir);
  let selected;

  if (requested) {
    selected = metadata.profiles.find(
      (profile) => profile.directory === requested || profile.name === requested,
    );
    if (!selected && fs.existsSync(path.join(dataDir, requested))) {
      selected = { directory: requested, name: requested };
    }
    if (!selected) {
      const available = metadata.profiles.map((profile) => `${profile.directory} (${profile.name})`).join(', ');
      throw new Error(`unknown profile "${requested}". Available profiles: ${available || 'none'}`);
    }
  } else {
    selected = metadata.profiles.find((profile) => profile.directory === metadata.lastUsed)
      || metadata.profiles[0];
  }

  if (!selected) {
    throw new Error(`no Doubao profiles found under ${dataDir}`);
  }

  return { ...selected, path: path.join(dataDir, selected.directory) };
}

function readUnsignedLeb128(buffer, offset) {
  let value = 0;
  let shift = 0;
  for (let cursor = offset; cursor < buffer.length && cursor < offset + 5; cursor += 1) {
    const byte = buffer[cursor];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, bytes: cursor - offset + 1 };
    shift += 7;
  }
  return null;
}

function cleanTitle(value) {
  const title = value.replaceAll('\u0000', '').trim();
  if (!title || title.length > 240 || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(title)) return null;
  return title;
}

function decodeNameValue(buffer, offset, limit) {
  for (let cursor = offset; cursor < Math.min(limit, offset + 18); cursor += 1) {
    const marker = buffer[cursor];
    if (marker !== 0x63 && marker !== 0x22) continue;

    const length = readUnsignedLeb128(buffer, cursor + 1);
    if (!length || length.value <= 0 || length.value > 1024) continue;
    const start = cursor + 1 + length.bytes;
    const end = start + length.value;
    if (end > limit || end > buffer.length) continue;

    const encoding = marker === 0x63 ? 'utf16le' : 'utf8';
    const title = cleanTitle(buffer.subarray(start, end).toString(encoding));
    if (title) return title;
  }
  return null;
}

export function parseSessionSnapshot(buffer, startOffset = 0) {
  const sessions = [];
  const seen = new Set();
  let cursor = startOffset;

  while (cursor < buffer.length) {
    const keyOffset = buffer.indexOf(CONVERSATION_ID, cursor);
    if (keyOffset < 0) break;

    const searchStart = keyOffset + CONVERSATION_ID.length;
    const searchEnd = Math.min(buffer.length, searchStart + 48);
    const nearby = buffer.subarray(searchStart, searchEnd).toString('latin1');
    const idMatch = nearby.match(/\d{12,24}/u);
    if (!idMatch) {
      cursor = searchStart;
      continue;
    }

    const idOffset = searchStart + (idMatch.index || 0);
    const id = idMatch[0];
    const nextConversation = buffer.indexOf(CONVERSATION_ID, idOffset + id.length);
    const recordEnd = nextConversation < 0 ? Math.min(buffer.length, idOffset + 320) : nextConversation;
    const nameOffset = buffer.indexOf(NAME, idOffset + id.length);

    if (nameOffset >= 0 && nameOffset < recordEnd && !seen.has(id)) {
      const title = decodeNameValue(buffer, nameOffset + NAME.length, recordEnd);
      if (title) {
        sessions.push({ id, title });
        seen.add(id);
      }
    }
    cursor = idOffset + id.length;
  }

  return sessions;
}

function cacheFiles(profilePath) {
  const directory = path.join(profilePath, 'IndexedDB', `chrome_${currentApp().scheme}-chat_0.indexeddb.leveldb`);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read Doubao session cache at ${directory}: ${error.message}`);
  }

  return entries
    .filter((entry) => entry.isFile() && /\.(?:log|ldb)$/u.test(entry.name))
    .map((entry) => {
      const filePath = path.join(directory, entry.name);
      return { path: filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

export function listSessions(profilePath) {
  for (const file of cacheFiles(profilePath)) {
    const buffer = fs.readFileSync(file.path);
    let markerOffset = buffer.lastIndexOf(SNAPSHOT_MARKER);
    while (markerOffset >= 0) {
      const sessions = parseSessionSnapshot(buffer, markerOffset + SNAPSHOT_MARKER.length);
      if (sessions.length) return sessions;
      markerOffset = buffer.lastIndexOf(SNAPSHOT_MARKER, markerOffset - 1);
    }
  }
  return [];
}

function idsInBuffer(buffer) {
  const ids = [];
  for (const encoding of ['utf8', 'utf16le']) {
    const text = buffer.toString(encoding);
    const pattern = new RegExp(`(?:${currentApp().scheme}|chrome)://${currentApp().scheme}-chat/chat/(\\d{12,24})`, 'gu');
    for (const match of text.matchAll(pattern)) ids.push({ id: match[1], index: match.index || 0 });
  }
  return ids.sort((left, right) => left.index - right.index);
}

export function currentSession(profilePath) {
  const directory = path.join(profilePath, 'Sessions');
  let files;
  try {
    files = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(?:Session|Tabs)_/u.test(entry.name))
      .map((entry) => {
        const filePath = path.join(directory, entry.name);
        return { path: filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch {
    return null;
  }

  for (const file of files) {
    const ids = idsInBuffer(fs.readFileSync(file.path));
    if (ids.length) return ids.at(-1).id;
  }
  return null;
}
