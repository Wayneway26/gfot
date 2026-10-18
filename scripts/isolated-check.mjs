// Run only the supplied review snapshot. Never mount a repository or the Docker socket.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractReviewFiles } from '../review-snapshot.mjs';
const image = 'node@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402';
const bundlePath = process.argv[2];
if (!bundlePath) { console.error('Usage: node scripts/isolated-check.mjs path/to/review-copy.md'); process.exit(1); }
const input = readFileSync(bundlePath);
if (input.length > 3_000_000) throw Error('Review bundle is too large');
const files = extractReviewFiles(input.toString('utf8'));
let endpoint = process.env.DOCKER_HOST;
if (!endpoint) {
  const context = spawnSync('docker', ['context', 'inspect'], { encoding: 'utf8', timeout: 15_000 });
  if (context.status !== 0) throw Error('Local Docker context unavailable');
  endpoint = JSON.parse(context.stdout)[0]?.Endpoints?.docker?.Host;
}
if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) throw Error('Only a local Unix-socket Docker daemon is allowed');
const docker = (args, options) => spawnSync('docker', ['--host', endpoint, ...args], options);
const check = docker(['image', 'inspect', image], { encoding: 'utf8', timeout: 15_000 });
if (check.status !== 0) throw Error('Pinned Docker image unavailable. No host execution fallback. See README.');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gfot-isolated-')));
const source = join(scratch, 'source'); mkdirSync(source, { mode: 0o755 });
try {
  for (const file of files) {
    const path = join(source, file.path); mkdirSync(join(path, '..'), { recursive: true, mode: 0o755 });
    writeFileSync(path, file.content, { mode: 0o444, flag: 'wx' });
  }
  const results = [];
  function run(label, command) {
    const name = 'gfot-review-' + randomUUID();
    try {
      const result = docker(['run', '--rm', '--name', name, '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=512m', '--cpus=1', '--user=1000:1000', '--mount', `type=bind,src=${source},dst=/review,readonly`, '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=134217728,uid=1000,gid=1000', '--workdir=/review', '--env=TMPDIR=/tmp', '--env=GFOT_DATA_DIR=/tmp/gfot-data', '--env=npm_config_cache=/tmp/npm-cache', image, ...command], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1_000_000 });
      const ok = result.status === 0 && !result.error;
      results.push({ label, ok, exitCode: result.status, output: (result.stdout || '') + (result.stderr || ''), error: result.error?.message });
      console.log(`=== ${label}: ${ok ? 'PASS' : 'FAIL'} ===\n${results.at(-1).output}`);
      if (!ok) throw Error(`${label} failed. No host execution fallback.`);
    } finally {
      // Only this invocation's randomly named container can be removed.
      docker(['rm', '-f', name], { stdio: 'ignore', timeout: 15_000 });
    }
  }
  const hostDataPath = fileURLToPath(new URL('../data/projects.json', import.meta.url));
  const probe = `
    const fs = require('node:fs'), net = require('node:net');
    const denied = action => { try { action(); return false; } catch { return true; } };
    const checks = {
      sourceReadable: fs.readFileSync('/review/package.json', 'utf8').length > 0,
      sourceWriteDenied: denied(() => fs.writeFileSync('/review/package.json', 'tamper')),
      rootWriteDenied: denied(() => fs.writeFileSync('/outside-review', 'tamper')),
      hostDataUnreadable: denied(() => fs.readFileSync(${JSON.stringify(hostDataPath)})),
      dockerSocketAbsent: !fs.existsSync('/var/run/docker.sock'),
    };
    const socket = net.connect({host:'1.1.1.1', port:443});
    const timer = setTimeout(() => { socket.destroy(); checks.externalNetworkDenied = true; finish(); }, 1000);
    function finish() { console.log(JSON.stringify(checks)); if (Object.values(checks).some(v => !v)) process.exitCode = 1; }
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); checks.externalNetworkDenied = false; finish(); });
    socket.on('error', () => { clearTimeout(timer); checks.externalNetworkDenied = true; finish(); });
  `;
  run('isolation-boundaries', ['node', '-e', probe]);
  run('syntax-check', ['npm', 'run', 'check']);
  run('test-suite', ['npm', 'test']);
  console.log(JSON.stringify({ image, files: files.length, network: 'none', snapshot: 'read-only', hostRepositoryMounted: false, externalDesktopAgentConfined: false, checks: results.map(({label,ok,exitCode}) => ({label,ok,exitCode})) }, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
