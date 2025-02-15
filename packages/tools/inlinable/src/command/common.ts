import {assert, errorFactories, errorMessage} from '@mtth/stl-errors';
import {LocalPath} from '@mtth/stl-utils/files';
import {Command, CommanderError, Option} from 'commander';
import {glob} from 'glob';
import ora, {Ora} from 'ora';
import {AsyncOrSync} from 'ts-essentials';

export const [errors, codes] = errorFactories({
  definitions: {
    actionFailed: (cause: unknown) => ({
      message: 'Command failed: ' + errorMessage(cause),
      cause,
    }),
    commandAborted: (cause: CommanderError) => ({
      message: 'Command aborted',
      cause,
      tags: {exitCode: cause.exitCode},
    }),
  },
});

export const DEFAULT_GLOB = 'lib/**/*.js';

export async function globbedPaths(
  globs: ReadonlyArray<string>
): Promise<ReadonlyArray<LocalPath>> {
  const lps: LocalPath[] = [];
  for (const g of globs.length ? globs : [DEFAULT_GLOB]) {
    for (const lp of await glob(g, {nodir: true})) {
      lps.push(lp);
    }
  }
  return lps;
}

export const quietOption = new Option(
  '-Q, --quiet',
  'suppress spinner output. always true when stdout is not a TTY'
);

export const fileSuffixOption: Option = (() => {
  const opt = new Option(
    '--file-suffix <suffix>',
    'suffix appended to inlined file names, if absent the files are ' +
      'modified in-place. this option is only intended for testing'
  );
  opt.hidden = true;
  return opt;
})();

export const packageNameOption: Option = (() => {
  const opt = new Option(
    '--package-name <name>',
    'name of the inlinable package. this option is only intended for testing'
  );
  opt.hidden = true;
  return opt;
})();

export function newCommand(): Command {
  return new Command().exitOverride((cause) => {
    throw errors.commandAborted(cause);
  });
}

export function contextualAction(
  fn: (this: ActionContext, ...args: any[]) => AsyncOrSync<void>
): (...args: any[]) => Promise<void> {
  return async (...args): Promise<void> => {
    let cmd = args[args.length - 1]; // Command is always last.
    while (cmd.parent) {
      cmd = cmd.parent;
    }
    const opts = cmd.opts();
    const spinner = ora({isSilent: !!opts.quiet});
    const commandPrefix = cmd.rawArgs.slice(0, 2);
    assert(commandPrefix[0] != null, 'Empty command initializer');
    try {
      await fn.call({spinner, commandPrefix}, ...args);
    } catch (cause) {
      spinner.fail(errorMessage(cause));
      throw errors.actionFailed(cause);
    }
  };
}

export interface ActionContext {
  readonly spinner: Ora;
  readonly commandPrefix: [string, ...string[]];
}
