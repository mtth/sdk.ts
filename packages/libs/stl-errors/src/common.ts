/**
 * Returns the error message of a standard error, the message property of other
 * objects, the input if it is a string, and nothing otherwise.
 */
export function errorMessage(err: unknown): string | undefined {
  if (typeof err == 'string') {
    return err;
  }
  if (!err || typeof err != 'object') {
    return undefined;
  }
  return '' + (err as any).message;
}

/** Formats a string. */
export function format(fmt: string, ...args: any[]): string {
  const formatPattern = /(%?)(%([jds]))/g;
  if (args.length) {
    fmt = fmt.replace(formatPattern, (match, esc, _ptn, flag) => {
      let arg = args.shift();
      switch (flag) {
        case 's':
          arg = '' + arg;
          break;
        case 'd':
          arg = Number(arg);
          break;
        case 'j':
          arg = JSON.stringify(arg);
          break;
      }
      if (!esc) {
        return arg;
      }
      args.unshift(arg);
      return match;
    });
  }
  if (args.length) {
    fmt += ' ' + args.join(' ');
  }
  fmt = fmt.replace(/%{2,2}/g, '%');
  return '' + fmt;
}
