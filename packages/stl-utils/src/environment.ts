/** Portable type compatible with `process.env`. */
export interface ProcessEnv {
  readonly [key: string]: string | undefined;
}

/**
 * Runs a function in a patched environment. The original environment is
 * restored after the function returns.
 */
export async function patchingEnv<V>(
  patch: ProcessEnv,
  fn: () => Promise<V>
): Promise<V>;
export async function patchingEnv<V>(
  patch: ProcessEnv,
  base: ProcessEnv,
  fn: () => Promise<V>
): Promise<V>;
export async function patchingEnv<V>(
  patch: ProcessEnv,
  arg1: any,
  arg2?: any
): Promise<V> {
  const base = typeof arg1 == 'function' ? process.env : arg1;
  const fn = arg2 ?? arg1;
  const vals = new Map<string, unknown>();
  for (const [key, val] of Object.entries(patch)) {
    vals.set(key, base[key]);
    base[key] = val;
  }
  let ret;
  try {
    ret = await fn();
  } finally {
    for (const [key, val] of vals) {
      if (val === undefined) {
        delete base[key];
      } else {
        base[key] = val;
      }
    }
  }
  return ret;
}

/** Environment checks interface. */
export interface Running {
  inProduction(): boolean;
  inTest(): boolean;
}

/** Default environment check implementation. */
export const running = ((): Running => {
  return {
    inProduction: () => process.env.NODE_ENV === 'production',
    inTest: () => process.env.NODE_ENV === 'test',
  };
})();
