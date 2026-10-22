import { withChatClient } from './cdp.mjs';
import { switchConversationModel } from './protocol.mjs';
import { conversationSettings } from './sessions.mjs';

const MODEL_TRIGGER = '[data-valid-btn="model-select-action-btn"]';
const MODEL_OPTION = '[role="menuitem"][data-slot="dropdown-menu-item"]';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeReasoningValue(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ');
}

export function resolveModelName(value, availableNames) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('model cannot be empty');
  if (availableNames.includes(value)) return value;
  throw new Error(`unknown model "${value}". Available models: ${availableNames.join(', ')}`);
}

// Reasoning effort levels exposed by the model menu (推理强度: 低中高极高最高).
// The value is the reasoning_effort string of the conversation modify API.
// CLI input and output use the English names; the Chinese UI labels and raw
// API values are accepted as aliases.
const REASONING_LEVELS = new Map([
  ['low', '3'],
  ['medium', '4'],
  ['high', '5'],
  ['xhigh', '6'],
  ['max', '7'],
]);

const REASONING_ALIASES = new Map([
  ['低', 'low'],
  ['mid', 'medium'],
  ['中', 'medium'],
  ['高', 'high'],
  ['very high', 'xhigh'],
  ['极高', 'xhigh'],
  ['maximum', 'max'],
  ['highest', 'max'],
  ['最高', 'max'],
]);

// Resolves a level name, alias, or raw API value to { effort, name }.
export function resolveReasoningEffort(value) {
  const normalized = normalizeReasoningValue(value);
  if (!normalized) throw new Error('reasoning effort cannot be empty');
  if (REASONING_LEVELS.has(normalized)) return { effort: REASONING_LEVELS.get(normalized), name: normalized };
  for (const [name, effort] of REASONING_LEVELS) {
    if (normalized === effort) return { effort, name };
  }
  const name = REASONING_ALIASES.get(normalized);
  if (name) return { effort: REASONING_LEVELS.get(name), name };
  throw new Error(`unknown reasoning effort "${value}". Available: low, medium, high, xhigh, max`);
}

// Switch the model of an existing conversation through the
// im/conversation/modify API (cmd=1114) instead of the menu UI.
export async function selectModelForConversation(client, conversationId, value, reasoning) {
  const resolved = await resolveModelFromClient(client, value);
  const id = resolved.id;
  const effort = reasoning ? resolveReasoningEffort(reasoning) : null;
  await switchConversationModel(client, conversationId, resolved.protocol.key, effort?.effort);
  await waitForModelSetting(client, conversationId, resolved.protocol.key, effort?.effort);
  return { id, name: resolved.name, changed: true, ...(effort ? { reasoning: effort.name } : {}) };
}

// Change only the reasoning effort of an existing conversation, keeping its
// model. The chat renderer must be showing the conversation, since the model
// key is read from the model selector button.
export async function setReasoningForConversation(client, conversationId, value) {
  const { effort, name } = resolveReasoningEffort(value);
  const current = await currentModelFromClient(client);
  const model = await resolveModelFromClient(client, current.name);
  await switchConversationModel(client, conversationId, model.protocol.key, effort);
  await waitForModelSetting(client, conversationId, model.protocol.key, effort);
  return { conversationId, model: current.name, reasoning: name };
}

async function waitForModelSetting(client, id, key, effort) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const settings = await conversationSettings(client, id);
    if (settings?.key === key && (!effort || settings.effort === effort)) return;
    await delay(200);
  }
  throw new Error('Doubao did not confirm the requested model setting');
}

async function waitFor(client, expression, timeoutMs = 3000, errorMessage = 'Doubao model menu did not respond') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await client.evaluate(expression);
    if (value) return value;
    await delay(50);
  }
  throw new Error(errorMessage);
}

async function closeModelMenu(client, menuId) {
  await client.pressEscape();
  await waitFor(client, `(() => {
    const trigger = [...document.querySelectorAll(${JSON.stringify(MODEL_TRIGGER)})].find(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0);
    const controlledId = ${JSON.stringify(menuId || '')} || trigger?.getAttribute('aria-controls');
    const menu = controlledId ? document.getElementById(controlledId) : null;
    return trigger?.getAttribute('data-state') !== 'open'
      && (!menu || menu.getAttribute('data-state') !== 'open') ? true : null;
  })()`, 1500).catch(() => {});
  await delay(50);
}

async function modelButtonState(client) {
  const state = await waitFor(client, `(() => {
    const trigger = [...document.querySelectorAll(${JSON.stringify(MODEL_TRIGGER)})].find(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0);
    const button = trigger?.querySelector(':scope > button');
    if (!button) return null;
    const lines = (button.innerText || button.textContent || '')
      .split('\\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return { name: lines[0] || null, reasoning: lines.slice(1).join(' ') || null };
  })()`, 5000, 'Doubao model selector was not found');
  if (!state?.name) throw new Error('Doubao current model could not be read');
  return state;
}

export async function currentModelFromClient(client) {
  const id = /\/chat\/(\d{12,24})(?:[?#]|$)/u.exec(await client.evaluate('location.href'))?.[1];
  const settings = id ? await conversationSettings(client, id) : null;
  const state = settings ? null : await modelButtonState(client);
  let menuId;
  try {
    menuId = await openModelMenu(client);
    const options = await readOpenOptions(client, menuId);
    const model = options.find(option => settings ? option.protocol?.key === settings.key : option.name === state.name);
    if (!model) throw new Error(`Current model ${settings?.key || state.name} is not in the available model list`);
    const labels = { '3': '低', '4': '中', '5': '高', '6': '极高', '7': '最高' };
    return { id: model.protocol?.key || null, name: model.name, reasoning: settings ? labels[settings.effort] || null : state.reasoning };
  } finally { if (menuId) await closeModelMenu(client, menuId); }
}

async function openModelMenu(client) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitFor(client, `Boolean([...document.querySelectorAll(${JSON.stringify(MODEL_TRIGGER)})].find(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0))`,
      5000, 'Doubao model selector was not found');
    await closeModelMenu(client);
    await client.click(MODEL_TRIGGER);
    try {
      return await waitFor(client, `(() => {
        const trigger = [...document.querySelectorAll(${JSON.stringify(MODEL_TRIGGER)})].find(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0);
        const menuId = trigger?.getAttribute('aria-controls');
        const menu = menuId ? document.getElementById(menuId) : null;
        return menu?.getAttribute('data-state') === 'open' ? menuId : null;
      })()`, 1500);
    } catch (error) {
      await closeModelMenu(client);
      if (attempt === 1) throw error;
    }
  }
  throw new Error('Doubao model menu did not respond');
}

async function readOpenOptions(client, menuId) {
  const options = await waitFor(client, `(() => {
    const menu = document.getElementById(${JSON.stringify(menuId)});
    if (!menu || !menu.querySelectorAll(${JSON.stringify(MODEL_OPTION)}).length) return null;
    return [...menu.querySelectorAll(${JSON.stringify(MODEL_OPTION)})]
      .map((item, index) => {
        const label = item.querySelector('span.shrink-0') || item.querySelector('span');
        const name = (label?.innerText || label?.textContent || '').trim();
        let fiber = item[Object.keys(item).find(key => key.startsWith('__reactFiber'))];
        let protocol;
        for (let depth = 0; fiber && depth < 24; depth++, fiber = fiber.return) {
          const config = fiber.memoizedProps?.item;
          if (config?.name === name && config.model_item_key && Number.isFinite(config.item_id)) {
            protocol = { key: config.model_item_key, ndt: config.item_id, provider: config.model_extra_params?.provider_id || '' };
            break;
          }
        }
        return name ? { index, name, protocol, selected: Boolean(item.querySelector(':scope > svg')) } : null;
      })
      .filter(Boolean);
  })()`);
  if (!options?.length) throw new Error('Doubao model menu contains no model options');
  return options;
}

// Resolve against the selected app's live menu, including newly added models.
export async function resolveModelFromClient(client, value) {
  let menuId;
  try {
    menuId = await openModelMenu(client);
    const options = await readOpenOptions(client, menuId);
    const name = resolveModelName(value, options.map(option => option.name));
    const option = options.find(option => option.name === name);
    if (!option.protocol) throw new Error(`Protocol metadata unavailable for model "${name}"`);
    return { id: option.protocol.key, name, protocol: option.protocol };
  } finally {
    if (menuId) await closeModelMenu(client, menuId);
  }
}

export async function listModelsFromClient(client) {
  const current = await currentModelFromClient(client);
  let menuId;
  try {
    menuId = await openModelMenu(client);
    const options = await readOpenOptions(client, menuId);
    return {
      current: current.name,
      reasoning: current.reasoning,
      models: options.map(({ name, protocol }) => ({ id: protocol?.key || null, name, selected: name === current.name })),
    };
  } finally {
    if (menuId) await closeModelMenu(client, menuId);
  }
}

export async function selectModelFromClient(client, value) {
  const before = await currentModelFromClient(client);
  let menuId;
  let marker;
  try {
    menuId = await openModelMenu(client);
    const options = await readOpenOptions(client, menuId);
    const name = resolveModelName(value, options.map((option) => option.name));
    if (name === before.name) return { ...before, changed: false };

    marker = `doubao-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const marked = await client.evaluate(`(() => {
      const menu = document.getElementById(${JSON.stringify(menuId)});
      const item = [...(menu?.querySelectorAll(${JSON.stringify(MODEL_OPTION)}) || [])]
        .find((candidate) => {
          const label = candidate.querySelector('span.shrink-0') || candidate.querySelector('span');
          return (label?.innerText || label?.textContent || '').trim() === ${JSON.stringify(name)};
        });
      if (!item) return false;
      item.setAttribute('data-doubao-cli-model-option', ${JSON.stringify(marker)});
      return true;
    })()`);
    if (!marked) throw new Error(`Doubao model option "${name}" disappeared`);
    await client.click(`[data-doubao-cli-model-option="${marker}"]`);
    const selected = await waitFor(client, `(() => {
      const trigger = [...document.querySelectorAll(${JSON.stringify(MODEL_TRIGGER)})].find(item => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0);
      const button = trigger?.querySelector(':scope > button');
      const firstLine = (button?.innerText || button?.textContent || '').split('\\n')[0].trim();
      return firstLine === ${JSON.stringify(name)} ? true : null;
    })()`);
    if (!selected) throw new Error(`Doubao did not select model "${name}"`);
    return { ...(await currentModelFromClient(client)), changed: true };
  } finally {
    if (marker) {
      await client.evaluate(`document.querySelector('[data-doubao-cli-model-option=${JSON.stringify(marker)}]')
        ?.removeAttribute('data-doubao-cli-model-option')`).catch(() => {});
    }
    if (menuId) await closeModelMenu(client, menuId);
  }
}

export async function currentModel() {
  return withChatClient((client) => currentModelFromClient(client));
}

export async function listModels() {
  return withChatClient((client) => listModelsFromClient(client));
}

export async function selectModel(value, conversationId, reasoning) {
  if (conversationId) {
    return withChatClient((client) => selectModelForConversation(client, conversationId, value, reasoning));
  }
  if (reasoning) throw new Error('--reasoning requires an active session; run "doubao sessions current" to check');
  return withChatClient((client) => selectModelFromClient(client, value));
}
