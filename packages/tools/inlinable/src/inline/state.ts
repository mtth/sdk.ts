import {assert, errorFactories} from '@mtth/stl-errors';
import {LocalPath} from '@mtth/stl-utils/files';
import ast from 'ast-types';
import {
  Inlinable,
  InlineTransformName,
  isInlineTransformName,
} from 'inlinable-runtime';
import {inlining} from 'inlinable-runtime/sentinel';
import path from 'path';

import {ERROR_PREFIX} from '../common.js';
import {newContext} from '../context.js';

const [errors, errorCodes] = errorFactories({
  definitions: {
    duplicateCall: (lp: LocalPath) => ({
      message:
        `An inlinable function in ${lp} was called twice. Please ensure that ` +
        'each inlinable call-site is called exactly once when the module is ' +
        'imported',
      tags: {path: lp},
    }),
    invalidReturnValue: (lp: LocalPath, val: unknown) => ({
      message:
        `Value ${val} in ${lp} is not inlinable. All inlinable functions ` +
        'must return a simple JSON value (number, boolean, null, string, ' +
        'array, or object).',
      tags: {path: lp, value: val},
    }),
    missingCall: (lp: LocalPath, state: InliningState) => ({
      message:
        `At least one inlinable in ${lp} was not called. Please ensure that ` +
        'each inlinable call-site is called exactly once.',
      tags: {path: lp, state},
    }),
  },
  prefix: ERROR_PREFIX,
});

export {errorCodes};

const statesSymbol = Symbol.for('inlinable:inliningStates+v2');

export interface RegisterInlinable {
  <V>(init: Inlinable<V>, key?: RegistrationKey): V;
  <V>(
    transform: InlineTransformName,
    init: Inlinable<V>,
    key?: RegistrationKey
  ): V;
  [statesSymbol]: Map<LocalPath, InliningState>;
}

export interface RegistrationKey {
  readonly source: LocalPath;
  readonly id: number;
}

export type InlinedValue =
  | {readonly transform: undefined; readonly expression: JsonExpression}
  | {readonly transform: InlineTransformName; readonly data: unknown};

type InliningState = (InlinedValue | Error)[];

export const registerInlinable: RegisterInlinable = (() => {
  function register<V>(...args: any[]): V {
    let transform: InlineTransformName | undefined;
    let init: Inlinable<V>;
    let key: RegistrationKey | undefined;
    if (typeof args[0] == 'string') {
      assert(
        isInlineTransformName(args[0]),
        'Unknown inline transform: %s',
        args[0]
      );
      transform = args[0];
      init = args[1];
      key = args[2];
    } else {
      init = args[0];
      key = args[1];
    }
    const val = init(newContext());
    if (key != null) {
      const {source, id} = key;
      assert(id != null, 'Missing inlining ID in %s', source);
      const state = getInliningState(source);
      assert(id >= 0 && id < state.length, 'Unexpected inlining ID %s', id);
      if (state[id] !== undefined) {
        state[id] = errors.duplicateCall(source);
      } else if (!canBeInlined(val)) {
        state[id] = errors.invalidReturnValue(source, val);
      } else {
        const inlined: InlinedValue =
          transform == null
            ? {transform, expression: jsonExpression(val)}
            : {transform, data: val};
        state[id] = inlined;
      }
    }
    return val;
  }
  (register as any)[statesSymbol] = new Map();
  return register as any;
})();

function canBeInlined(arg: unknown): boolean {
  switch (typeof arg) {
    case 'object':
      if (arg != null) {
        break;
      }
    // Fall through
    case 'string':
    case 'boolean':
    case 'number':
      return true;
    default:
      return false;
  }
  if (Array.isArray(arg)) {
    return arg.every(canBeInlined);
  }
  for (const val of Object.values(arg)) {
    if (!canBeInlined(val)) {
      return false;
    }
  }
  return true;
}

export async function collectInlinedValues(
  target: InliningTarget,
  packageName?: string
): Promise<ReadonlyArray<InlinedValue>> {
  const {path: lp, valueCount} = target;

  let register: RegisterInlinable;
  if (packageName == null) {
    register = registerInlinable;
  } else {
    const moduleName = packageName.startsWith('.')
      ? path.resolve(path.dirname(lp), packageName)
      : packageName;
    const pkg = await import(moduleName);
    register = pkg.default;
  }
  const states = register[statesSymbol];
  assert(states instanceof Map, 'Invalid inlining states in %s', register);

  assert(!states.has(lp), 'Inlining state collision for %s', lp);
  const state: InliningState = new Array(valueCount);
  states.set(lp, state);
  try {
    await inlining(lp, () => import(lp));
  } finally {
    states.delete(lp);
  }

  const inlined: InlinedValue[] = [];
  for (const val of state) {
    if (val === undefined) {
      throw errors.missingCall(lp, state);
    }
    if (val instanceof Error) {
      throw val;
    }
    inlined.push(val);
  }
  return inlined;
}

export interface InliningTarget {
  readonly path: LocalPath;
  readonly originalSource: string;
  readonly instrumentedSource: string;
  readonly node: ast.ASTNode;
  readonly importName: string;
  readonly valueCount: number;
}

function getInliningState(lp: LocalPath): unknown[] {
  const state = registerInlinable[statesSymbol].get(lp);
  assert(state, 'Missing inlining state for %s', lp);
  return state;
}

export type JsonExpression =
  | ast.namedTypes.Literal
  | ast.namedTypes.ArrayExpression
  | ast.namedTypes.ObjectExpression;

function jsonExpression(val: unknown, comment?: string): JsonExpression {
  const comments = comment
    ? [ast.builders.commentBlock.from({leading: true, value: comment})]
    : null;
  switch (typeof val) {
    case 'object':
      if (val != null) {
        break;
      }
    // Fall through
    case 'string':
    case 'boolean':
    case 'number':
      return ast.builders.literal.from({value: val, comments});
  }
  if (Array.isArray(val)) {
    return ast.builders.arrayExpression.from({
      comments,
      elements: val.map((v) => jsonExpression(v)),
    });
  }
  return ast.builders.objectExpression.from({
    comments,
    properties: Object.entries(val as any).map(([k, v]) =>
      ast.builders.objectProperty.from({
        key: ast.builders.literal.from({value: k}),
        value: jsonExpression(v),
      })
    ),
  });
}
