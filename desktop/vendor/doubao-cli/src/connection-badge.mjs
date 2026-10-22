import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const BADGE_ID = 'doubao-cli-connection';

// Runs in the selected desktop renderer. Keep dynamic values out of HTML.
function updateBadge(id, connection, connected, enabled) {
  let host = document.getElementById(id);
  if (!enabled) {
    if (host) { clearInterval(host.healthTimer); host.remove(); }
    return;
  }
  if (!host && !connected) return;
  if (!document.body) return;
  if (!host) {
    host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;-webkit-app-region:no-drag;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
        button{font:inherit;cursor:pointer;color:inherit;border:0}
        .pill{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;
          font-size:12px;color:#fff;background:#232733;box-shadow:0 1px 5px #0003}
        .dot{width:7px;height:7px;border-radius:50%;background:#9098a5}
        [data-health="connected"] .dot{background:#38d39f}
        [data-health="degraded"] .dot{background:#f5a623}
        .panel{position:absolute;top:100%;right:0;margin-top:6px;padding:12px;border-radius:10px;
          box-sizing:border-box;width:280px;max-width:calc(100vw - 16px);font-size:12px;line-height:1.7;color:#fff;
          background:#232733;box-shadow:0 2px 8px #0003;overflow-wrap:anywhere}
        .panel[hidden]{display:none} .details{white-space:pre-wrap} .hint{color:#bbc1cc}
        .dismiss{margin-top:8px;padding:3px 8px;background:#ffffff20;border-radius:5px}
      </style>
      <button class="pill" aria-expanded="false" aria-controls="details" title="doubao-cli 连接状态">
        <span class="dot" aria-hidden="true"></span><span class="label"></span>
      </button>
      <div class="panel" id="details" hidden>
        <strong>doubao-cli → <span class="app"></span></strong>
        <div class="details"></div>
        <div class="hint">状态表示 CLI 当前连接；命令结束后断开。</div>
        <button class="dismiss">收起</button>
      </div>`;
    const pill = root.querySelector('.pill');
    const panel = root.querySelector('.panel');
    const close = () => { panel.hidden = true; pill.setAttribute('aria-expanded', 'false'); };
    pill.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      pill.setAttribute('aria-expanded', String(!panel.hidden));
      host.refresh();
    });
    root.querySelector('.dismiss').addEventListener('click', close);
    root.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    host.connections = new Map();
    host.refresh = () => {
      const now = Date.now();
      for (const [key, item] of host.connections) {
        if (now - item.seen > 10000) host.connections.delete(key);
      }
      const active = [...host.connections.values()];
      const latest = active.sort((a, b) => b.seen - a.seen)[0] || host.lastConnection;
      const health = active.length ? (now - latest.seen <= 5000 ? 'connected' : 'degraded') : 'disconnected';
      const label = { connected: '已连接', degraded: '连接延迟', disconnected: '已断开' }[health];
      pill.dataset.health = health;
      root.querySelector('.label').textContent = `doubao-cli ${label}`;
      if (latest) {
        root.querySelector('.app').textContent = latest.app;
        root.querySelector('.details').textContent = [
          `状态：${label}（${active.length} 个连接）`,
          `配置：${latest.profile}`,
          `CDP：${latest.endpoint}`,
          `CLI：v${latest.version} · PID ${latest.pid}`,
          `最近连接：${new Date(latest.seen).toLocaleTimeString()}`,
        ].join('\n');
      }
      const anchor = document.querySelector('[data-testid="global-search-icon-entry"]');
      const rect = anchor?.getBoundingClientRect();
      const width = host.getBoundingClientRect().width;
      if (rect?.width && rect.left > width + 16) {
        host.style.top = `${Math.max(8, Math.round(rect.top + rect.height / 2 - host.offsetHeight / 2))}px`;
        host.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.left + 8))}px`;
      } else {
        host.style.top = '12px'; host.style.right = '12px';
      }
      if (!panel.hidden) {
        panel.style.transform = '';
        const bounds = panel.getBoundingClientRect();
        const offset = Math.max(8 - bounds.left, Math.min(0, window.innerWidth - 8 - bounds.right));
        panel.style.transform = `translateX(${offset}px)`;
      }
      if (!active.length) { clearInterval(host.healthTimer); host.healthTimer = null; }
    };
    document.body.appendChild(host);
  }
  if (connected) {
    const item = { ...connection, seen: Date.now() };
    host.connections.set(connection.id, item);
    host.lastConnection = item;
    if (!host.healthTimer) host.healthTimer = setInterval(host.refresh, 1000);
  } else {
    host.connections.delete(connection.id);
  }
  host.refresh();
}

export function badgeExpression(connection, connected = true, enabled = true) {
  return `(${updateBadge.toString()})(${JSON.stringify(BADGE_ID)}, ${JSON.stringify(connection)}, ${connected}, ${enabled})`;
}

// Cosmetic CDP calls have a separate, short deadline and never fail the command.
export async function startConnectionBadge(client, { app, profile, endpoint }, env = process.env) {
  const enabled = env.DOUBAO_CLI_CONNECTION_BADGE === '1';
  const connection = { id: randomUUID(), app, profile, endpoint, version: VERSION, pid: process.pid };
  let stopped = false;
  let pending = false;
  const evaluate = async connected => {
    if (connected && pending) return;
    if (connected) pending = true;
    let timer;
    try {
      const request = Promise.resolve().then(() => client.send('Runtime.evaluate', {
        expression: badgeExpression(connection, connected, enabled), returnByValue: true,
      })).finally(() => { if (connected) pending = false; });
      await Promise.race([
        request,
        new Promise(resolve => { timer = setTimeout(resolve, 500); }),
      ]);
    } catch { /* The next heartbeat retries after navigation or a renderer error. */ }
    finally { clearTimeout(timer); }
  };
  const heartbeat = async () => {
    if (!stopped) await evaluate(true);
  };
  if (!enabled) {
    await evaluate(false);
    return async () => {};
  }
  await heartbeat();
  const timer = setInterval(heartbeat, 2000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await evaluate(false);
  };
}
