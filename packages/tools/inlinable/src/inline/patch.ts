import {assert, errorFactories, unexpected} from '@mtth/stl-errors';
import {LocalPath} from '@mtth/stl-utils/files';
import * as acorn from 'acorn';
import ast from 'ast-types';
import {readFile, writeFile} from 'fs/promises';
import {isInlineTransformName} from 'inlinable-runtime';
import path from 'path';
import recast from 'recast';

import {ERROR_PREFIX} from '../common.js';
import {collectInlinedValues, InlinedValue, InliningTarget} from './state.js';

const [errors, errorCodes] = errorFactories({
  definitions: {
    invalidCall: (lp: LocalPath, node: ast.ASTNode) => {
      const {code} = recast.print(node);
      return {
        message:
          `Invalid inlinable call in module ${lp}: \`${code}\`. ` +
          'Each call should have a single function argument or a valid ' +
          'transformation followed by a function',
        tags: {path: lp, code},
      };
    },
  },
  prefix: ERROR_PREFIX,
});

export {errorCodes};

type NodePath<K extends keyof ast.Visitor> =
  NonNullable<ast.Visitor[K]> extends (p: infer P) => any ? P : never;

export type ImportNodePath = NodePath<'visitImportDeclaration'>;
export type CallNodePath = NodePath<'visitCallExpression'>;

export abstract class InlinablePatcher {
  private readonly targets = new Map<LocalPath, InliningTarget>();
  constructor(
    /** `inlinable` package import name, configurable for testing. */
    private readonly packageName: string,
    /**
     * Suffix to use for the final module names. If empty the original modules
     * will be overwritten. Also mostly useful for testing.
     */
    private readonly outputSuffix: string
  ) {}

  /** Called on each inline call-site */
  abstract patchCall(cp: CallNodePath, val: InlinedValue): void;

  /** Guaranteed to be called after all calls have been patched */
  abstract patchImport(ip: ImportNodePath): void;

  async addModules(lps: Iterable<LocalPath>): Promise<number> {
    const promises: Promise<[LocalPath, string]>[] = [];
    for (const lp of lps) {
      const alp = path.resolve(lp);
      if (this.targets.has(alp)) {
        continue;
      }
      promises.push(readFile(alp, 'utf8').then((src) => [alp, src]));
    }
    let count = 0;
    for (const [alp, src] of await Promise.all(promises)) {
      if (!src.includes(this.packageName)) {
        continue;
      }
      const target = this.createTarget(alp, src);
      if (!target) {
        continue;
      }
      this.targets.set(alp, target);
      count++;
    }
    return count;
  }

  private createTarget(lp: LocalPath, src: string): InliningTarget | undefined {
    const {packageName} = this;
    const node = parseCode(src);
    let valueCount = 0;

    let importName: string | undefined;
    ast.visit(node, {
      visitImportDeclaration(p) {
        const {source, specifiers} = p.node;
        if (
          source.value === packageName &&
          specifiers?.[0]?.local?.type === 'Identifier'
        ) {
          importName = specifiers[0].local.name;
        }
        return false;
      },
      visitCallExpression(p) {
        const {callee, arguments: args} = p.node;
        if (callee.type === 'Identifier' && callee.name === importName) {
          if (!normalizeArgs(args)) {
            throw errors.invalidCall(lp, p.node);
          }
          args.push(
            ast.builders.objectExpression.from({
              properties: [
                ast.builders.objectProperty.from({
                  key: ast.builders.literal.from({value: 'source'}),
                  value: ast.builders.literal.from({value: lp}),
                }),
                ast.builders.objectProperty.from({
                  key: ast.builders.literal.from({value: 'id'}),
                  value: ast.builders.literal.from({value: valueCount++}),
                }),
              ],
            })
          );
        }
        this.traverse(p); // Detect nested inlinables.
      },
    });
    if (!importName) {
      return undefined;
    }

    const {code} = recast.print(node);
    return {
      path: lp,
      importName,
      valueCount,
      originalSource: src,
      instrumentedSource: code,
      node,
    };
  }

  /** Patches all added modules. */
  async patchModules(): Promise<void> {
    await this.instrumentSources();
    const values = new Map<LocalPath, ReadonlyArray<InlinedValue>>();
    try {
      await this.forEachTarget(async (t) => {
        const vals = await collectInlinedValues(t, this.packageName);
        values.set(t.path, vals);
      });
    } catch (err) {
      await this.finalizeSources();
      this.targets.clear();
      throw err;
    }
    await this.finalizeSources(values);
    this.targets.clear();
  }

  private async instrumentSources(): Promise<void> {
    await this.forEachTarget(async (t) => {
      await writeFile(t.path, t.instrumentedSource, 'utf8');
    });
  }

  private async finalizeSources(
    values?: ReadonlyMap<LocalPath, ReadonlyArray<InlinedValue>>
  ): Promise<void> {
    if (values == null || this.outputSuffix) {
      // Restore the original source
      await this.forEachTarget(async (t) => {
        await writeFile(t.path, t.originalSource, 'utf8');
      });
    }
    if (values == null) {
      // No values to inline
      return;
    }
    await this.forEachTarget(async (t) => {
      // Write the inlined source
      const vals = values.get(t.path);
      assert(vals != null, 'Missing values for %s', t.path);
      const src = this.patchedSource(t, vals);
      const lp = this.outputSuffix
        ? suffixed(t.path, this.outputSuffix)
        : t.path;
      await writeFile(lp, src, 'utf8');
    });
  }

  private patchedSource(
    target: InliningTarget,
    vals: ReadonlyArray<InlinedValue>
  ): string {
    const {packageName} = this;
    const self = this;
    const {node, importName} = target;

    ast.visit(node, {
      visitCallExpression(p) {
        const {callee, arguments: args} = p.node;
        if (callee.type === 'Identifier' && callee.name === importName) {
          const id = extractId(args.pop());
          const val = vals[id];
          assert(val !== undefined, 'Missing inlined value for ID %s', id);
          self.patchCall(p, val);
        } else {
          this.traverse(p);
        }
        return false;
      },
    });

    ast.visit(node, {
      visitImportDeclaration(p) {
        if (p.node.source.value === packageName) {
          self.patchImport(p);
        }
        return false;
      },
    });

    const {code} = recast.print(node);
    return code;
  }

  private async forEachTarget(
    fn: (t: InliningTarget) => Promise<void>
  ): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const t of this.targets.values()) {
      promises.push(fn(t));
    }
    await Promise.all(promises);
  }
}

type CallArguments = ast.namedTypes.CallExpression['arguments'];

function normalizeArgs(args: CallArguments): boolean {
  switch (args.length) {
    case 1:
      return true;
    case 2:
      if (!isTransformed(args)) {
        args.pop();
      }
      return true;
    case 3:
      if (!isTransformed(args)) {
        return false;
      }
      args.pop();
      return true;
    default:
      return false;
  }
}

function isTransformed(args: CallArguments): boolean {
  return args[0]?.type === 'Literal' && isInlineTransformName(args[0].value);
}

function extractId(node: CallArguments[number] | undefined): number {
  assert(node?.type === 'ObjectExpression', 'Unexpected key %j', node);
  for (const prop of node.properties) {
    assert(
      prop.type === 'ObjectProperty' && prop.key.type === 'Literal',
      'Unexpected property in key %j',
      prop
    );
    if (prop.key.value === 'id') {
      const val = prop.value;
      assert(
        val.type === 'Literal' && typeof val.value == 'number',
        'Unexpected ID: %v',
        val
      );
      return val.value;
    }
  }
  throw unexpected(node);
}

function parseCode(code: string): ast.ASTNode {
  return recast.parse(code, {
    parser: {
      parse(src: string): any {
        return acorn.parse(src, {
          ecmaVersion: 'latest',
          locations: true, // Needed to parse template literals.
          sourceType: 'module',
        });
      },
    },
    tokens: false,
  });
}

function suffixed(lp: LocalPath, suffix: string): string {
  const {dir, name, ext} = path.parse(lp);
  return path.join(dir, `${name}${suffix}${ext}`);
}
