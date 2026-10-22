// Doubao 2.30.1 SandboxAuthType (804013.j4), also used by the native runtime.
const PERMISSIONS = { AlwaysAsk: 0, AskOnRisk: 1, FullAccess: 2 };

export function resolvePermission(value = 'FullAccess') {
  const normalized = String(value).replace(/[-_]/gu, '').toLowerCase();
  const name = Object.keys(PERMISSIONS).find((key) => key.toLowerCase() === normalized);
  if (!name) throw new Error('unknown permission; expected AlwaysAsk, AskOnRisk, or FullAccess');
  return PERMISSIONS[name];
}
