import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewBundle } from '../review-bundle.mjs';
import { extractReviewFiles } from '../review-snapshot.mjs';
const project = { id:'test', revision:1, cycle:1, stage:'review', status:'ready', repo:'/private/repo', title:'review', goal:'review source', scope:'test', constraints:'none', criteria:'pass', runs:[{revision:1,cycle:1,version:'v1',artifact:'diff',summary:'changed',tests:'passed',issues:'none'}] };
function bundle(files) { return buildReviewBundle(project, {files,confirmVersion:'v1'}).text; }
test('extract exact UTF-8 text including CRLF, empty files and embedded Markdown headings', () => {
 const files=[{path:'empty.js',content:''},{path:'source.mjs',content:'// 中文 🧪\r\n```\n## 源码快照\n````\n'}];
 const actual=extractReviewFiles(bundle(files)); assert.deepEqual(actual, files);
});
test('reject tampered source content and inconsistent manifest before extracting files', () => {
 const text=bundle([{path:'source.mjs',content:'trusted bytes'}]);
 assert.throws(()=>extractReviewFiles(text.replace('trusted bytes','tampered bytes')), /size|checksum/);
 assert.throws(()=>extractReviewFiles(text.replaceAll('source.mjs','../data.json')), /Forbidden/);
 assert.throws(()=>extractReviewFiles(text.replace('"bytes": 13','"bytes": 1')), /size/);
});
test('reject incomplete bundles and duplicate structural sections', () => {
 assert.throws(()=>extractReviewFiles('not a review bundle'));
 const text=bundle([{path:'source.mjs',content:'console.log(1)'}]);
 assert.throws(()=>extractReviewFiles(text+'\n## 源码快照\n'));
 assert.throws(()=>extractReviewFiles(text.replace('### source.mjs','### missing.mjs')), /Missing/);
});
