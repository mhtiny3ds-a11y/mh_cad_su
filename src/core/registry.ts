// Gom mọi lệnh của MHCAD vào một Registry.

import { BUILTIN, Registry } from './commands';
import { MODIFY_COMMANDS } from './cmds/modify';
import { ANNOTATE_COMMANDS } from './cmds/annotate';
import { HATCH_COMMANDS } from './cmds/hatch';
import { EDIT_COMMANDS } from './cmds/edit';

export function createRegistry(): Registry {
  return new Registry([...BUILTIN, ...MODIFY_COMMANDS, ...ANNOTATE_COMMANDS, ...HATCH_COMMANDS, ...EDIT_COMMANDS]);
}
