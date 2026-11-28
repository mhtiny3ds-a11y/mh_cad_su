// Gom mọi lệnh của MHCAD vào một Registry.

import { BUILTIN, Registry } from './commands';
import { MODIFY_COMMANDS } from './cmds/modify';
import { ANNOTATE_COMMANDS } from './cmds/annotate';
import { HATCH_COMMANDS } from './cmds/hatch';
import { EDIT_COMMANDS } from './cmds/edit';
import { DRAW_COMMANDS } from './cmds/draw';
import { LAYER_COMMANDS } from './cmds/layers';
import { TEXT_COMMANDS } from './cmds/text';
import { TOOL_COMMANDS } from './cmds/tools';
import { ANNOT2_COMMANDS } from './cmds/annot2';
import { UI_COMMANDS } from './cmds/ui';

export function createRegistry(): Registry {
  return new Registry([
    ...BUILTIN, ...MODIFY_COMMANDS, ...ANNOTATE_COMMANDS, ...HATCH_COMMANDS, ...EDIT_COMMANDS, ...DRAW_COMMANDS,
    ...LAYER_COMMANDS,
    ...TEXT_COMMANDS,
    ...TOOL_COMMANDS,
    ...ANNOT2_COMMANDS,
    ...UI_COMMANDS,
  ]);
}
