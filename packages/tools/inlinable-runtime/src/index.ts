import {Inlinable} from './context.js';
import {InlineTransformName} from './transform/index.js';

export * from './context.js';
export {isInlining} from './sentinel.js';
export {
  InlineTransform,
  inlineTransform,
  InlineTransformName,
  isInlineTransformName,
} from './transform/index.js';

export interface Inline {
  <V>(init: Inlinable<V>): V;
  <V>(transform: InlineTransformName, init: Inlinable<V>): V;
}
