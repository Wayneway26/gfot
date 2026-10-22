import { spawnSync } from 'node:child_process';
import { currentApp } from './app.mjs';

// Conservative compatibility floor: protocol observed in Work 2.32.10.
export const GOAL_MIN_VERSION = '2.32.10';
export const GOAL_AB_REQUEST = Object.freeze({
  goal_mode_enable: { parmas: ['doubao', 'goal_mode', 'enable'], is_login: true, token_type: 2 },
});

export function supportsGoalVersion(version) {
  if (!/^\d+\.\d+\.\d+$/u.test(version || '')) return false;
  const actual = version.split('.').map(Number), minimum = GOAL_MIN_VERSION.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  return true;
}

export function desktopVersion() {
  const result = spawnSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', `${currentApp().appPath}/Contents/Info.plist`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Authenticated renderer requests retain the selected app's runtime identity. */
export async function rendererJsonClient(client) {
  const { runtimeParameters, evaluateWithWatchdog } = await import('./protocol.mjs');
  const runtime = await runtimeParameters(client);
  return { json: async (route, options = {}) => {
    if (!['/alice/job_cron/', '/samantha/user/ab/'].some(prefix => route.startsWith(prefix))) throw new Error('Unsupported feature endpoint');
    const url = new URL(route, 'https://www.doubao.com');
    url.search = runtime.query;
    return evaluateWithWatchdog(client, `(async () => {
      const response = await fetch(${JSON.stringify(url.href)}, {
        method: 'POST', credentials: 'include', headers: {'content-type':'application/json'},
        body: ${JSON.stringify(encodeFeatureRequest(JSON.parse(options.body || '{}')))}, signal: AbortSignal.timeout(${Math.max(1, options.timeoutMs || 10000)})
      });
      if (!response.ok) throw new Error('Doubao feature request failed: HTTP ' + response.status);
      return (${parseFeatureJson.toString()})(await response.text());
    })()`, (options.timeoutMs || 10000) + 1000);
  } };
}

// Job IDs are int64 JSON numbers. Preserve their exact digits before CDP or
// ordinary JSON decoding can round them. Node 22 and current Chromium expose
// the original number token through the JSON reviver context.
export function parseFeatureJson(text) {
  return JSON.parse(text, (key, value, context) => {
    if (key === 'job_id' && typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    if (typeof value !== 'number' || Number.isSafeInteger(value)) return value;
    if (!context?.source) throw new Error('Lossless feature JSON parsing is unavailable');
    return /^-?\d+$/u.test(context.source) ? context.source : value;
  });
}

// The facade binds these fields as int64 JSON tokens, while CLI IDs stay
// strings. rawJSON avoids a Number conversion (and precision loss).
export function encodeFeatureRequest(input) {
  return JSON.stringify(input, (key, value) =>
    ['job_id', 'bot_id', 'project_id'].includes(key) && typeof value === 'string' && /^\d+$/u.test(value)
      ? JSON.rawJSON(BigInt(value).toString()) : value);
}

export function activeGoalFromExtra(extra) {
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  extra = parse(extra || {});
  if (!extra.goal_info) return undefined;
  const info = parse(extra.goal_info);
  const goals = info?.GoalInfo ?? info?.goal_info;
  if (!goals || typeof goals !== 'object' || Array.isArray(goals)) throw new Error('Doubao goal state is invalid');
  const active = Object.entries(goals).filter(([, goal]) => String(goal?.Status ?? goal?.status).toLowerCase() === 'active');
  if (active.length > 1) throw new Error('This conversation has multiple active goals; resolve them in Doubao before sending');
  return active[0]?.[0];
}

export async function goalAvailability(client, version, timeoutMs = 10000) {
  const supportedVersion = supportsGoalVersion(version);
  if (!supportedVersion) return { available: false, version: version || null, minimumVersion: GOAL_MIN_VERSION, reason: 'unsupported_version' };
  const response = await client.json('/samantha/user/ab/get', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ab_request: GOAL_AB_REQUEST }), timeoutMs });
  if (!response || response.code !== 0 || !response.data?.ab_results) throw new Error('Doubao goal availability could not be verified');
  const available = response.data.ab_results.goal_mode_enable === '1';
  return { available, version, minimumVersion: GOAL_MIN_VERSION, ...(!available ? { reason: 'account_not_enabled' } : {}) };
}

export async function requireGoalMode(client, version, timeoutMs) {
  const status = await goalAvailability(client, version, timeoutMs);
  if (!status.available) throw new Error(status.reason === 'unsupported_version'
    ? `Goal mode requires Doubao ${GOAL_MIN_VERSION} or newer (found ${version || 'unknown'})`
    : 'Goal mode is not enabled for this account');
}
