import {codecs} from './common.js';

export default function __inline(name: string, data: string): unknown {
  const codec = (codecs as any)[name];
  if (!codec) {
    throw new Error(`Unknown codec: ${name}`);
  }
  return codec(data);
}
