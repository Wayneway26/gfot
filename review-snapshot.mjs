import { createHash } from 'node:crypto';
import { fileIssue, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './public/review-policy.js';

export function extractReviewFiles(text) {
  const lines = text.split('\n');
  let manifest = null, inSources = false, manifests = 0, sourceSections = 0;
  const sources = new Map();
  function block(start) {
    const match = lines[start].match(/^(`{3,})(\w*)$/);
    if (!match) throw Error('Expected fenced review content');
    const end = lines.indexOf(match[1], start + 1);
    if (end < 0) throw Error('Unclosed review content');
    return { text: lines.slice(start + 1, end).join('\n'), end };
  }
  function nextBlock(start) {
    while (start < lines.length && !/^`{3,}/.test(lines[start])) start++;
    if (start === lines.length) throw Error('Missing review content');
    return { ...block(start), start };
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '## 全部输入文件清单') {
      manifests++;
      const data = nextBlock(i + 1); manifest = JSON.parse(data.text); i = data.end;
    } else if (lines[i] === '## 源码快照') {
      sourceSections++; inSources = true;
    } else if (inSources && lines[i].startsWith('### ')) {
      const path = lines[i].slice(4);
      if (sources.has(path.toLowerCase())) throw Error('Duplicate source path');
      const data = nextBlock(i + 1);
      sources.set(path.toLowerCase(), { path, content: data.text }); i = data.end;
    } else if (lines[i].startsWith('## ')) {
      inSources = false;
    } else if (/^`{3,}/.test(lines[i])) {
      i = block(i).end;
    }
  }
  if (manifests !== 1 || sourceSections !== 1 || !Array.isArray(manifest) || !manifest.length || manifest.length > MAX_FILES || sources.size !== manifest.length) throw Error('Invalid review manifest');
  let total = 0;
  const seen = new Set();
  return manifest.map(entry => {
    if (!entry || fileIssue(entry.path) || typeof entry.sha256 !== 'string') throw Error('Forbidden review path');
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate manifest path'); seen.add(key);
    const source = sources.get(key);
    if (!source || source.path !== entry.path) throw Error('Missing source text');
    const bytes = Buffer.from(source.content, 'utf8'); total += bytes.length;
    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || bytes.length !== entry.bytes || bytes.includes(0)) throw Error('Invalid review source size');
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Review checksum mismatch: ${entry.path}`);
    return { path: entry.path, content: source.content };
  });
}
