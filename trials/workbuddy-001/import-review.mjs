import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir = new URL('./', import.meta.url);
const root = new URL('../../', dir);
const meta = JSON.parse(readFileSync(new URL('project.json', dir), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
for (const [path, expected] of Object.entries(manifest.sha256)) {
 const actual = createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
 if (actual !== expected) throw Error(`Source changed since review was prepared: ${path}`);
}
const review = JSON.parse(readFileSync(new URL('workbuddy-review.json', dir), 'utf8'));
for (const key of ['reviewedVersion', 'source', 'criteriaEvidence', 'findings']) {
 if (typeof review[key] !== 'string' || !review[key].trim()) throw Error(`Missing review field: ${key}`);
}
if (review.reviewedVersion !== manifest.version || !['pass', 'rework'].includes(review.verdict)) throw Error('Invalid review version or verdict');
const endpoint = 'http://127.0.0.1:4317/api/projects/' + meta.projectId;
const currentResponse = await fetch(endpoint);
if (!currentResponse.ok) throw Error(await currentResponse.text());
const current = await currentResponse.json();
if (current.stage !== 'review' || current.status !== 'running') throw Error('Project must be awaiting an external review result');
const body = { action: 'review', verdict: review.verdict, reviewedVersion: review.reviewedVersion, source: review.source, criteriaEvidence: review.criteriaEvidence, findings: review.findings };
const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
if (!response.ok) throw Error(await response.text());
const project = await response.json();
writeFileSync(new URL('import-receipt.json', dir), JSON.stringify({ importedAt: new Date().toISOString(), projectId: meta.projectId, version: manifest.version, originalReview: fileURLToPath(new URL('workbuddy-review.json', dir)), verdict: review.verdict, stage: project.stage, status: project.status }, null, 2));
if (project.stage === 'delivery') {
 const exported = await (await fetch(endpoint + '/delivery')).json();
 writeFileSync(new URL('delivery.md', dir), exported.text);
}
console.log(JSON.stringify({ id: project.id, stage: project.stage, status: project.status, verdict: review.verdict }));
