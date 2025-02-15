import zlib from 'zlib';

import {InlineCodecName} from './common.js';

export {InlineCodecName} from './common.js';

export interface InlineTransform {
  readonly codec: InlineCodecName;
  readonly encode: (data: unknown) => string;
}

const inlineTransforms = {
  compress: {
    codec: 'fflate-gzip',
    encode: (data) => zlib.gzipSync(JSON.stringify(data)).toString('base64'),
  },
  obfuscate: {
    codec: 'base64',
    encode: (data) => btoa(JSON.stringify(data)),
  },
} as const satisfies {readonly [name: string]: InlineTransform};

export type InlineTransformName = keyof typeof inlineTransforms;

export function isInlineTransformName(
  arg: unknown
): arg is InlineTransformName {
  return typeof arg == 'string' && (inlineTransforms as any)[arg] != null;
}

export function inlineTransform(name: InlineTransformName): InlineTransform {
  return inlineTransforms[name];
}
