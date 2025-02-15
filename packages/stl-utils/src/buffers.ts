import util from 'util';
import zlib from 'zlib';

/** Compress a buffer using gzip. */
export const compressBuffer = util.promisify(zlib.gzip);

/** Decompress a buffer using gunzip. */
export const decompressBuffer = util.promisify(zlib.gunzip);

/** Buffer-ish things. */
export type BufferLike = Buffer | Uint8Array;

/** Coerce a buffer-like object to a buffer without a copy. */
export function asBuffer(arg: BufferLike): Buffer {
  return Buffer.isBuffer(arg)
    ? arg
    : Buffer.from(arg.buffer, arg.byteOffset, arg.length);
}
