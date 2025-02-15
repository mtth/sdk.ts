/** Sentinel module, only meant to be imported directly from `inlinable` */

/** Returns true if code is currently being inlined. */
export function isInlining(): boolean {
  // TODO: We could add more granularity, for example exposing the path of the
  // file currently being inlined as optional argument to `isInlining`.
  return globalThis.__isInlining != null;
}

export async function inlining(
  lp: string,
  fn: () => Promise<void>
): Promise<void> {
  let state: Set<string> = globalThis.__isInlining as any;
  if (!state) {
    state = new Set();
    globalThis.__isInlining = state;
  }
  if (state.has(lp)) {
    throw new Error(`Already inlining ${lp}`);
  }
  state.add(lp);
  try {
    await fn();
  } finally {
    state.delete(lp);
    if (!state.size) {
      delete globalThis.__isInlining;
    }
  }
}
