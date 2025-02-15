import {Command} from 'commander';

import {quietOption} from './common.js';
import {replaceCommand} from './replace.js';

const COMMAND_NAME = 'inlinable';

export function mainCommand(): Command {
  return new Command()
    .name(COMMAND_NAME)
    .description('Inlinable CLI')
    .addOption(quietOption)
    .addCommand(replaceCommand());
}
