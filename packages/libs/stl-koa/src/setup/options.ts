// TODO: Vaidate that this actually works

import http from 'http';
import {Writable} from 'ts-essentials';

// Request header controlling options.
const OPTIONS_HEADER = 'mtth-control';

interface RequestOptions {
  readonly debug?: boolean;
}

export function requestOptions(
  headers: http.IncomingHttpHeaders
): RequestOptions {
  const header = headers[OPTIONS_HEADER];
  const arr = Array.isArray(header) ? header : header ? [header] : [];
  const opts: Writable<RequestOptions> = {};
  for (const item of arr.flatMap((e) => e.split(';'))) {
    const part = item.trim();
    if (part === 'debug') {
      opts.debug = true;
    }
  }
  return opts;
}
