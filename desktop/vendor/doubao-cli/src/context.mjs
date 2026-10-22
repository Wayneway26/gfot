import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { APP_MODULE_BOOTSTRAP } from './app-modules.mjs';
import { currentApp } from './app.mjs';
import { defaultWorkspace, evaluateWithWatchdog, runtimeParameters } from './protocol.mjs';
import { imRequest } from './turns.mjs';
import { activeGoalFromExtra } from './features.mjs';

const CONTEXT_BOOTSTRAP = `const req = await new Promise(resolve => {
  window['@flow-web/desktop:stable'].push([['doubao_context_' + crypto.randomUUID()], {}, resolve]);
});`;

export async function runtimeAvailability(client) {
  const identity = await runtimeParameters(client);
  const env = await evaluateWithWatchdog(client, 'window.neotix.taskMode.runtime.queryRuntimeInfo({ env: true })', 10000);
  return { runtimes: [{ id: 'local', name: '本地电脑', available: env?.status === 'READY' && Boolean(env?.env?.environmentId),
    status: env?.status || 'unknown', deviceId: identity.params.device_id, deviceName: os.hostname() },
    { id: 'cloud', name: '云端', available: true }] };
}

export async function listProjects(client) {
  const projects = new Map(), cursors = new Set();
  let cursor;
  do {
    const body = await imRequest(client, 'project/list', 4605, 'list_projects_uplink_body', {
      limit: 100, include_invisible_projects: false, sort_type: 1,
      group_conversation_filter_param: { exclude_archive: true }, ...(cursor ? { cursor } : {}),
    });
    const page = body?.list_projects_downlink_body;
    if (!Array.isArray(page?.projects)) throw new Error('Doubao project list could not be read');
    for (const p of page.projects) {
      if (p.status !== 1) continue;
      projects.set(String(p.project_id), { id: String(p.project_id), name: p.name,
        folders: (p.folders || []).map(f => ({ name: f.folder_name, path: f.workspace,
          deviceId: String(f.folder_device_id || ''), deviceName: f.folder_device_name, primary: Boolean(f.is_primary) })) });
    }
    if (!page.has_more) break;
    if (!page.next_cursor || cursors.has(page.next_cursor)) throw new Error('Doubao project pagination did not advance');
    cursor = page.next_cursor;
    cursors.add(cursor);
  } while (true);
  return [...projects.values()];
}

export function projectCreationInput(name, workspace) {
  name = name?.trim();
  if (!name) throw new Error('projects create requires a project name');
  // Matches the desktop project dialog: characters above U+00FF count twice.
  if ([...name].reduce((n, c) => n + (c.codePointAt(0) > 255 ? 2 : 1), 0) > 40) {
    throw new Error('Project name exceeds 40 units (Chinese characters count as 2)');
  }
  if (workspace !== undefined) {
    workspace = path.resolve(workspace);
    if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error(`workspace is not a directory: ${workspace}`);
  }
  return { name, workspace };
}

export async function createProject(client, options) {
  const { name, workspace } = projectCreationInput(options.name, options.workspace);
  const identity = await runtimeParameters(client);
  const device = await evaluateWithWatchdog(client, `(async () => {
    ${CONTEXT_BOOTSTRAP}
    ${APP_MODULE_BOOTSTRAP}
    if (typeof appModule(req, 'projects').th().createProject !== 'function') throw new Error('Doubao project creation is unavailable');
    return ${Boolean(workspace)} ? await appModule(req, 'projectDevice').U() : null;
  })()`, 10000);
  if (workspace && (!device?.deviceId || String(device.deviceId) !== identity.params.device_id)) {
    throw new Error('Doubao project device identity is unavailable or does not match the selected app');
  }
  const folders = workspace ? [{ folderName: path.basename(workspace) || workspace, workspace, isPrimary: true,
    folderDeviceId: String(device.deviceId), ...(device.deviceName ? { folderDeviceName: device.deviceName } : {}) }] : undefined;
  const operationId = randomUUID();
  let id;
  try {
    // Use the same service as the creation dialog to keep app stores in sync.
    // Never retry this mutation automatically: a disconnected call can succeed.
    const result = await evaluateWithWatchdog(client, `(async () => {
      ${CONTEXT_BOOTSTRAP}
      ${APP_MODULE_BOOTSTRAP}
      return appModule(req, 'projects').th().createProject(${JSON.stringify({ name, folders })}, ${JSON.stringify({ operationId })});
    })()`, 30000);
    if (!result?.projectId) throw new Error('Create project response has no project id');
    id = String(result.projectId);
    const project = (await listProjects(client)).find(p => p.id === id);
    if (!project || project.name !== name || (workspace ? !project.folders.some(f =>
      f.path === workspace && f.deviceId === String(device.deviceId) && f.primary) : project.folders.length)) {
      throw new Error('Project name or folder binding could not be confirmed');
    }
    return { ...project, operationId };
  } catch (cause) {
    const error = new Error(`${id ? 'Project ' + id + ' was created, but readback failed' : 'Project creation could not be confirmed'}: ${cause.message}. Check "doubao projects list" before repeating create.`, { cause });
    error.code = id ? 'project_readback_failed' : 'project_create_unconfirmed';
    error.result = { id: id || null, name, operationId, status: id ? 'created' : 'unknown', verified: false };
    throw error;
  }
}

export function selectProject(projects, value) {
  if (!value || value === 'none') return null;
  const byId = projects.find(p => p.id === value);
  if (byId) return byId;
  const matches = projects.filter(p => p.name === value);
  if (matches.length > 1) throw new Error(`Multiple projects named "${value}"; use a project id`);
  if (!matches.length) throw new Error(`Doubao project not found: ${value}. Run "doubao projects list"`);
  return matches[0];
}

export function projectContext(project, deviceId, runtime) {
  if (!project) return {};
  return { project_id: project.id, project_name: project.name,
    folders: runtime === 'local' ? project.folders.filter(f => f.deviceId === deviceId && f.path?.trim())
      .map(f => ({ folder_name: f.name?.trim() || '', path: f.path.trim(), is_primary: f.primary })) : [] };
}

export async function enterpriseSkill(client, runtime) {
  const skill = await evaluateWithWatchdog(client, `(async () => {
    ${CONTEXT_BOOTSTRAP}
    ${APP_MODULE_BOOTSTRAP}
    const response = await appModule(req, 'skills').Sf.AGWListUserAndFeaturedSkills({ runtime_type: ${runtime === 'local' ? 2 : 1} });
    if (response?.code || !Array.isArray(response?.data?.skills)) throw new Error('Doubao skill catalog could not be read');
    const skill = response.data.skills.find(s => s.name === 'doubao-enterprise-search' && s.visible !== false);
    return skill ? { name: skill.name, displayName: skill.display_name, type: skill.type, externalId: skill.external_skill_id } : null;
  })()`, 15000);
  if (!skill?.externalId || !skill.type) throw new Error('企业知识 is unavailable for this account/runtime');
  return skill;
}

export async function conversationContext(client, conversationId) {
  if (!conversationId) return { agentParam: null, projectId: '' };
  const body = await imRequest(client, 'conversation/batch_get', 1111, 'batch_get_conv_info_uplink_body', {
    conversation_id: [conversationId], option: { recent_message_count_per_conv: 0 }, ext: {},
  });
  const conversation = body?.batch_get_conv_info_downlink_body?.conversation_info_list?.find(c => c.conversation_id === conversationId);
  if (!conversation) throw new Error('Doubao conversation was not found');
  const rawExtra = conversation.extra || conversation.ext || {};
  const extra = typeof rawExtra === 'string' ? JSON.parse(rawExtra) : rawExtra;
  let agentParam = extra.agent_task_param;
  if (typeof agentParam === 'string') {
    try { agentParam = JSON.parse(agentParam); } catch { throw new Error('Doubao conversation execution context is invalid'); }
  }
  return { agentParam: agentParam || null, projectId: conversation.project_reference?.project_id || '', activeGoalId: activeGoalFromExtra(extra) };
}

export function validateTaskOptions(options) {
  if (options.runtime !== undefined && !['local', 'cloud'].includes(options.runtime)) throw new Error('--runtime requires local or cloud');
  if (options.runtime === 'cloud' && (options.mcps?.length || options.workspace || options.permission || options.skillPaths?.length === 0 || options.noSkills)) {
    throw new Error('--runtime cloud cannot use --mcp, --workspace, --permission, or --no-skills');
  }
}

export async function resolveTaskContext(client, conversationId, options = {}) {
  validateTaskOptions(options);
  const previous = await conversationContext(client, conversationId);
  const localOption = options.mcps?.length || options.workspace || options.permission || options.skillPaths?.length === 0;
  const runtime = options.runtime || (localOption || !conversationId ? 'local' : previous.agentParam?.runtime_type === 2 ? 'local' : 'cloud');
  // An inherited remote-device session must not silently acquire local files.
  const local = runtime === 'local' ? (await runtimeAvailability(client)).runtimes.find(r => r.id === 'local') : { deviceId: '', deviceName: '' };
  if (runtime === 'local' && (!local.available || !local.deviceId)) throw new Error('Doubao local runtime is not ready; check "doubao runtimes" and initialize 本地电脑 in the app');
  if (runtime === 'local' && !options.runtime && !localOption && previous.agentParam?.local_device_id
      && (previous.agentParam.local_device_id !== local.deviceId || previous.agentParam.local_app_id !== currentApp().aid)) {
    throw new Error('This session uses another local device/app; pass --runtime local to select this computer explicitly');
  }
  const requestedProject = options.project ?? previous.projectId;
  const project = requestedProject && requestedProject !== 'none' ? selectProject(await listProjects(client), requestedProject) : null;
  const context = projectContext(project, local.deviceId, runtime);
  const projectChanged = (project?.id || '') !== previous.projectId;
  const sameDevice = previous.agentParam?.local_device_id === local.deviceId && previous.agentParam?.local_app_id === currentApp().aid;
  const selectedWorkspace = options.workspace
    || (options.project === undefined && !projectChanged && sameDevice ? previous.agentParam?.workspace : '')
    || context.folders?.find(f => f.is_primary)?.path || context.folders?.[0]?.path;
  const createWorkspace = runtime === 'local' && !selectedWorkspace;
  const workspace = runtime === 'local' ? path.resolve(selectedWorkspace || defaultWorkspace()) : undefined;
  if (options.workspace && (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory())) throw new Error(`workspace is not a directory: ${workspace}`);
  return { workspace, createWorkspace, taskContext: { runtime, projectId: project?.id || '', projectContext: context,
    previousAgentParam: previous.agentParam, previousProjectId: previous.projectId, activeGoalId: previous.activeGoalId,
    deviceId: local.deviceId, deviceName: local.deviceName,
    ...(options.enterpriseKnowledge ? { enterpriseSkill: await enterpriseSkill(client, runtime) } : {}) } };
}

export function publicTaskContext(taskContext, workspace) {
  return { runtime: taskContext.runtime, projectId: taskContext.projectId || null,
    ...(workspace ? { workspace } : {}), enterpriseKnowledge: Boolean(taskContext.enterpriseSkill) };
}
