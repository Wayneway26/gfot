import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const variants = {
  work: { name: 'DoubaoWork', scheme: 'doubaowork', bundleId: 'com.work.pc.doubao', port: 9226, aid: '1044603' },
  doubao: { name: 'Doubao', scheme: 'doubao', bundleId: 'com.bot.pc.doubao', port: 9225, aid: '582478' },
};

export function resolveApp(requested, env = process.env, exists = fs.existsSync) {
  if (requested && !variants[requested]) throw new Error('--app requires work or doubao');
  const customPath = env.DOUBAO_APP;
  const customVariant = customPath && /DoubaoWork\.app\/?$/iu.test(customPath) ? 'work' : 'doubao';
  const id = requested || (customPath ? customVariant : exists('/Applications/DoubaoWork.app') ? 'work' : 'doubao');
  const variant = variants[id];
  // Explicit selection wins over a path override for the other application.
  const appPath = customPath && (!requested || requested === customVariant) ? customPath : `/Applications/${variant.name}.app`;
  return {
    ...variant, id, appPath,
    dataDir: env.DOUBAO_DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', variant.name),
    endpoint: (env.DOUBAO_CDP_ENDPOINT || `http://127.0.0.1:${variant.port}`).replace(/\/$/u, ''),
  };
}

export function resolvePlatform(requested, env = process.env, exists = fs.existsSync) {
  if (requested && !['work', 'doubao', 'web', 'headless'].includes(requested)) {
    throw new Error('--platform requires work, doubao, or web; headless is also supported');
  }
  if (requested === 'headless') {
    return {
      id: 'headless', platform: 'headless', name: 'Doubao Headless',
      appPath: null, dataDir: null,
      endpoint: 'https://www.doubao.com',
    };
  }
  if (requested === 'web') {
    return {
      id: 'web', platform: 'web', name: 'Doubao Web', port: 9227,
      appPath: null, dataDir: null,
      endpoint: (env.DOUBAO_CDP_ENDPOINT || 'http://127.0.0.1:9227').replace(/\/$/u, ''),
    };
  }
  const app = resolveApp(requested, env, exists);
  return { ...app, platform: app.id };
}

export function currentApp() { return context.getStore() || resolveApp(); }
export function withApp(app, callback) { return context.run(app, callback); }

export function activeProfile(app = currentApp()) {
  let profile = app.profile;
  if (!profile) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'Local State'), 'utf8'));
      profile = state.profile?.last_used || Object.keys(state.profile?.info_cache || {})[0];
    } catch {}
  }
  return profile || 'Default';
}

export function agentWorkspace() {
  const app = currentApp();
  return path.join(app.dataDir, activeProfile(app), '.doubao', 'agent_mode', 'workspace');
}

export function isAppTarget(url, app = currentApp(), kind = 'chat') {
  try {
    const parsed = new URL(url);
    if (app.id === 'web') {
      return kind === 'chat'
        && parsed.protocol === 'https:'
        && ['www.doubao.com', 'doubao.com'].includes(parsed.hostname)
        && !parsed.username && !parsed.password && !parsed.port
        && /^\/chat(?:\/(?:\d{12,24}\/?)?)?$/u.test(parsed.pathname);
    }
    return [app.scheme + ':', 'chrome:'].includes(parsed.protocol)
      && parsed.hostname === `${app.scheme}-${kind}`
      && (kind !== 'chat' || /^\/chat(?:\/|$)/u.test(parsed.pathname));
  } catch { return false; }
}
