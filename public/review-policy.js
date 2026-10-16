// Shared by the browser and server. This is a packaging filter, not a secret scanner.
const deniedDirectories = new Set(['data', '.git', '.aws', '.ssh', '.codex', '.agents', 'node_modules', 'vendor', 'dist', 'build', 'coverage', 'trials']);
const allowedExtensions = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'html', 'json', 'md', 'txt', 'diff', 'log', 'py', 'go', 'rs', 'java', 'vue', 'svelte', 'yml', 'yaml', 'toml']);
export function fileIssue(path) {
  if (typeof path !== 'string' || !path || path.length > 240 || path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path) || /^[A-Za-z]:/.test(path)) return '需要规范的项目相对路径';
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return '不允许空目录或路径跳转';
  if (parts.some(p => p.startsWith('.') || deniedDirectories.has(p.toLowerCase()))) return '排除数据、隐藏配置、依赖与构建目录';
  const name = parts.at(-1).toLowerCase();
  if (/(^|[._-])(secret|secrets|credential|credentials|token|tokens|password|passwords)([._-]|$)/.test(name) || /^(id_rsa|id_ed25519|passwd|shadow|projects\.json)$/.test(name) || /\.(pem|key|p12|pfx|sqlite|db)$/.test(name)) return '排除可能包含凭证或运行数据的文件';
  const extension = name.split('.').at(-1);
  if (!allowedExtensions.has(extension)) return '仅支持文本源码和审查材料';
  return null;
}
export const MAX_FILES = 80;
export const MAX_FILE_BYTES = 300_000;
export const MAX_TOTAL_BYTES = 1_000_000;
