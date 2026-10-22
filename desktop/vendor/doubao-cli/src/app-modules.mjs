// These modules have moved between desktop builds. Resolve by the observed
// source/export contract before requiring; requiring a missing id poisons cache.
export function appModule(req, kind) {
  const definitions = {
    stores: { ids: [110872, 521109], match: s => s.includes('Wp:') && s.includes('chat-ioc-manager: store') },
    attachments: { ids: [284642, 109595], match: s => s.includes('getAttachmentActions:') && s.includes('attachmentStatesSelector:') },
    attachmentBlock: { ids: [907216, 613922], match: s => s.includes('S:') && s.includes('transform:') && s.includes('BLOCK_ATTACHMENT') && s.includes('attachmentStates:') },
    skills: { ids: [359531, 609347], match: s => s.includes('Sf:') && s.includes('SI:') },
    sandbox: { ids: [987391, 876207], match: s => s.includes('H:') && s.includes('resolvedSharedFolders:') && s.includes('projectFolders:') && s.length < 1500 },
    // ProjectStoreService exports th(), whose instance owns createProject().
    // The old error string was removed from newer desktop bundles.
    projects: { ids: [], match: s => s.includes('th:') && s.includes('async createProject(') && s.includes('async deleteProject(') },
    projectDevice: { ids: [193447, 670245, 82197, 554995], match: s => s.includes('U:') && s.includes('project_shared_get_device_error') && s.includes('getDeviceInfo()') && s.length < 1500 },
  };
  if (kind === 'communication') {
    if (!req.m) return req(763283);
    const source = Object.values(req.m).map(f => f.toString()).find(s => s.includes('cua.local_file.sandbox_instance.update_conversation') && s.length < 1500);
    const id = source?.match(/var \w+=\w+\((\d+)\)/)?.[1];
    if (id) return req(Number(id));
    throw new Error('Doubao sandbox communication module is unavailable');
  }
  const def = definitions[kind];
  if (!def) throw new Error('Unknown Doubao module: ' + kind);
  if (!req.m) {
    if (def.ids.length) return req(def.ids[0]);
    throw new Error('Doubao ' + kind + ' module discovery is unavailable');
  }
  for (const id of def.ids) if (req.m[id] && def.match(req.m[id].toString())) return req(id);
  const matches = Object.entries(req.m).filter(([, f]) => def.match(f.toString()));
  if (matches.length !== 1) throw new Error('Doubao ' + kind + ' module is unavailable or ambiguous; update the CLI');
  return req(Number(matches[0][0]));
}

export const APP_MODULE_BOOTSTRAP = `const appModule = ${appModule.toString()};`;
