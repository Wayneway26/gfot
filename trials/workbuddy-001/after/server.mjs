import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { createProject, act, taskPack, delivery, ValidationError } from './domain.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = process.env.AGENTSUMMARY_DATA_DIR || join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const file = join(dataDir, 'projects.json');
let projects;
try { projects = JSON.parse(readFileSync(file, 'utf8')); if (!Array.isArray(projects)) throw new Error('Invalid database'); }
catch (e) { if (e.code === 'ENOENT') projects = []; else throw e; }
function save(next) { writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 }); renameSync(file + '.tmp', file); projects = next; }
const publicFiles = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const server = http.createServer(async (req, res) => {
  const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    const host = req.headers.host;
    if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) return send(403, { error: '仅允许本机访问' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, { error: '请求来源不允许' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const path = new URL(req.url, `http://${host}`).pathname;
    if (req.method === 'GET' && publicFiles[path]) {
      const name = publicFiles[path]; res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(name)] + '; charset=utf-8');
      return res.end(readFileSync(join(root, 'public', name)));
    }
    if (req.method === 'GET' && path === '/api/projects') return send(200, projects);
    const match = path.match(/^\/api\/projects\/([^/]+)(?:\/(pack|delivery))?$/);
    if (req.method === 'GET' && match) {
      const p = projects.find(x => x.id === match[1]); if (!p) return send(404, { error: '项目不存在' });
      return send(200, match[2] ? { text: match[2] === 'pack' ? taskPack(p) : delivery(p) } : p);
    }
    if (req.method === 'DELETE' && match && !match[2]) { save(projects.filter(p => p.id !== match[1])); return send(200, { ok: true }); }
    if (req.method === 'POST' && (path === '/api/projects' || (match && !match[2]))) {
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '需要 JSON 数据' });
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) return send(413, { error: '内容过大，请控制在 2 MB 内' }); chunks.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'JSON 格式无效' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { error: '需要 JSON 对象' });
      const next = structuredClone(projects); let p;
      if (!match) { p = createProject(input); next.unshift(p); }
      else { p = next.find(x => x.id === match[1]); if (!p) return send(404, { error: '项目不存在' }); act(p, input.action, input); }
      save(next); return send(200, p);
    }
    send(404, { error: '未找到该资源' });
  } catch (e) { if (!(e instanceof ValidationError)) console.error(e); send(e instanceof ValidationError ? 400 : 500, { error: e instanceof ValidationError ? e.message : '保存失败，请查看服务日志；原数据未被覆盖' }); }
});
server.listen(Number(process.env.PORT || 4317), '127.0.0.1', () => console.log(`AgentSummary → http://127.0.0.1:${server.address().port}`));
