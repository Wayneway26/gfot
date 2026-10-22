import os from 'node:os';
import path from 'node:path';

export function configDirectory(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.DOUBAO_CLI_CONFIG_DIR) return env.DOUBAO_CLI_CONFIG_DIR;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'doubao-cli');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'doubao-cli');
}
