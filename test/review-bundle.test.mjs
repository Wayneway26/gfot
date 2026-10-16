import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProject, act } from '../domain.mjs';
import { buildReviewBundle } from '../review-bundle.mjs';
import { fileIssue } from '../public/review-policy.js';
function project() {
 const p = createProject({ title: 'Review', goal: 'fix unicode', repo: '/private/real-project', baseline: 'before', scope: 'server', constraints: 'no data access', criteria: 'tests pass', implementer: 'Codex', reviewer: 'WorkBuddy' });
 act(p, 'dispatch');
 act(p, 'result', { summary: 'fixed', artifact: 'diff --git a/server.mjs b/server.mjs', version: 'version-1', evidence: '/private/real-project/trials/evidence.log', tests: 'all passed', issues: 'none', next: 'review' });
 return p;
}
const input = files => ({ files, confirmVersion: 'version-1' });
test('bundle covers all selected bytes with hashes and contains no repo path or session history', () => {
 const p = project(); p.memories.push({ text: 'PRIVATE-MEMORY', state: '有效' });
 const source = 'console.log("中文 🧪");\r\n';
 const bundle = buildReviewBundle(p, input([{ path: 'server.mjs', content: source }]));
 assert.equal(bundle.manifest[0].sha256, createHash('sha256').update(source).digest('hex'));
 assert.ok(bundle.text.includes(source));
 assert.ok(bundle.text.includes(p.criteria));
 assert.ok(bundle.text.includes('diff --git'));
 assert.ok(!bundle.text.includes(p.repo));
 assert.ok(!bundle.text.includes('PRIVATE-MEMORY'));
 assert.equal(bundle.boundary, 'materials-only');
 assert.equal(p.status, 'ready');
});
test('filesystem escapes, hidden paths, data and credential files are rejected', () => {
 for (const path of ['../server.mjs', '/etc/passwd', 'C:/test.js', 'src/../data/projects.json', 'src\\test.js', '.env', '.env.local', '.aws/config', 'data/anything.js', 'DATA/anything.js', 'src/.ssh/id_rsa', 'config/credentials.json', 'api-token.json', 'secret.key', 'projects.json', 'node_modules/pkg/index.js', 'trials/workbuddy-001/project.json']) {
  assert.ok(fileIssue(path), path);
  assert.throws(() => buildReviewBundle(project(), input([{ path, content: 'not read from disk' }])), undefined, path);
 }
});
test('unselected files cannot enter a bundle and an arbitrary path never causes a disk read', () => {
 const bundle = buildReviewBundle(project(), input([{ path: 'source.mjs', content: 'provided bytes only' }]));
 assert.deepEqual(bundle.manifest.map(f => f.path), ['source.mjs']);
 assert.ok(bundle.text.includes('provided bytes only'));
});
test('reject invalid payloads, duplicate paths, binary contents and oversized selections', () => {
 const p = project();
 for (const files of [null, [], [{ path: 'x.js', content: 12 }], [{ path: 'x.js', content: '\0' }], [{ path: 'x.js', content: '\uD800' }], [{ path: 'x.js', content: 'x'.repeat(300001) }], [{ path: 'x.js', content: 'a' }, { path: 'X.js', content: 'b' }], Array.from({length:81},(_,i)=>({path:i+'.js',content:''})), Array.from({length:4},(_,i)=>({path:i+'.js',content:'x'.repeat(260000)}))]) {
  assert.throws(() => buildReviewBundle(p, input(files)));
 }
});
test('bundle identity changes with input bytes, task or review version; input order is irrelevant', () => {
 const p = project();
 const a = [{path:'a.js',content:'a'}, {path:'b.js',content:'b'}];
 const first = buildReviewBundle(p, input(a));
 assert.equal(buildReviewBundle(p, input([...a].reverse())).bundleId, first.bundleId);
 assert.notEqual(buildReviewBundle(p, input([{path:'a.js',content:'changed'}])).bundleId, first.bundleId);
 p.criteria = 'new condition'; assert.notEqual(buildReviewBundle(p, input(a)).bundleId, first.bundleId);
});
test('cannot export without current implementation or explicit version confirmation', () => {
 const p = project(); assert.throws(() => buildReviewBundle(p, {files:[{path:'a.js',content:'a'}]}), /确认/);
 p.runs[0].stale = true; assert.throws(() => buildReviewBundle(p, input([{path:'a.js',content:'a'}])), /实现/);
});
test('source fence injection cannot break out of the exported code block', () => {
 const content = '```\n# injected heading\n````';
 const bundle = buildReviewBundle(project(), input([{path:'a.md',content}]));
 assert.ok(bundle.text.includes('`````\n' + content + '\n`````'));
});
