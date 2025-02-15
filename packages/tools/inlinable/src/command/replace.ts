import {Multiset} from '@mtth/stl-utils/collections';
import ast from 'ast-types';
import {Command} from 'commander';
import {inlineTransform, InlineTransformName} from 'inlinable-runtime';

import {PACKAGE_NAME, STUBS_PACKAGE_NAME} from '../common.js';
import {
  CallNodePath,
  ImportNodePath,
  InlinablePatcher,
  InlinedValue,
} from '../inline/index.js';
import {
  contextualAction,
  DEFAULT_GLOB,
  fileSuffixOption,
  globbedPaths,
  packageNameOption,
} from './common.js';

// TODO: Check that the inlinable-runtime dependency is present when needed and
// add an option to disable this validation.
export function replaceCommand(): Command {
  return new Command()
    .command('replace')
    .alias('r')
    .description(
      'replace all inlinable calls. if at least one transformation was used, ' +
        'the patched code will require a dependency on `inlinable-runtime` ' +
        'to run'
    )
    .argument(
      '[globs...]',
      'file globs to visit for inlinables. if no globs are specified, the ' +
        `default is \`${DEFAULT_GLOB}\`.`
    )
    .addOption(fileSuffixOption)
    .addOption(packageNameOption)
    .action(
      contextualAction(async function (globs: ReadonlyArray<string>, opts) {
        const {spinner} = this;
        const lps = await globbedPaths(globs);
        if (!lps.length) {
          spinner.warn('No matching files to inline.');
          return;
        }

        spinner.start(`Replacing inlinables in ${lps.length} file(s)...`);
        const patcher = new Patcher(opts.packageName, opts.fileSuffix);
        const instrumented = await patcher.addModules(lps);
        spinner.info(`Instrumented ${instrumented} module(s).`);
        if (!instrumented) {
          return;
        }

        spinner.start('Computing inlined values...');
        await patcher.patchModules();
        const details = [`erase=${patcher.inlined - patcher.transforms.size}`];
        for (const [transform, count] of patcher.transforms.descending()) {
          details.push(`${transform}=${count}`);
        }
        spinner.succeed(
          `Replaced ${patcher.inlined} inlinable(s). [${details.join(', ')}]`
        );
      })
    );
}

class Patcher extends InlinablePatcher {
  readonly transforms = new Multiset<InlineTransformName>();
  inlined = 0;

  constructor(packageName: string | undefined, fileSuffix: string | undefined) {
    super(packageName || PACKAGE_NAME, fileSuffix || '');
  }

  override patchCall(cp: CallNodePath, val: InlinedValue): void {
    this.inlined++;

    if (val.transform == null) {
      cp.replace(val.expression);
      return;
    }

    this.transforms.add(val.transform);
    const transform = inlineTransform(val.transform);
    cp.replace(
      ast.builders.callExpression.from({
        ...cp.node,
        arguments: [
          ast.builders.literal.from({value: transform.codec}),
          ast.builders.literal.from({
            value: transform.encode(val.data),
            comments: cp.node.arguments[0]?.comments ?? null,
          }),
        ],
      })
    );
  }

  override patchImport(ip: ImportNodePath): void {
    if (!this.transforms.size) {
      // All values were directly inlined, we can omit the import altogether.
      ip.prune();
      return;
    }

    const imports: ast.namedTypes.ImportDeclaration[] = [];
    for (const name of [...this.transforms.toMap().keys()].sort()) {
      const transform = inlineTransform(name);
      imports.push(
        ast.builders.importDeclaration.from({
          source: ast.builders.literal.from({
            value: `${STUBS_PACKAGE_NAME}/${transform.codec}`,
          }),
        })
      );
    }
    ip.replace(
      ast.builders.importDeclaration.from({
        source: ast.builders.literal.from({value: STUBS_PACKAGE_NAME}),
        specifiers: ip.node.specifiers,
      }),
      ...imports
    );
  }
}
