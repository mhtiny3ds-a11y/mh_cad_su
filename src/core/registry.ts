// Gom mọi lệnh của MHCAD vào một Registry.

import { BUILTIN, Registry } from './commands';
import { MODIFY_COMMANDS } from './cmds/modify';
import { ANNOTATE_COMMANDS } from './cmds/annotate';

export function createRegistry(): Registry {
  return new Registry([...BUILTIN, ...MODIFY_COMMANDS, ...ANNOTATE_COMMANDS]);
}
