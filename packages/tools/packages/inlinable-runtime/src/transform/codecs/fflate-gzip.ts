/**
 * Gzip-powered compression codec. We use `fflate` instead of the native `zlib`
 * to simplify browser compatibility.
 */

import {gunzipSync} from 'fflate';

import {codecs} from '../common.js';

codecs['fflate-gzip'] = (s: string): any => {
  const arr = Uint8Array.from(atob(s), (m) => m.codePointAt(0)!);
  const decoder = new TextDecoder('utf8');
  return JSON.parse(decoder.decode(gunzipSync(arr)));
};
