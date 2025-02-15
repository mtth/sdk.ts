import {firstElement} from '@mtth/stl-utils/collections';

/**
 * Returns a signal which aborts as soon as the first signal of the input
 * iterable aborts. This signal may or may not be one of the input ones as this
 * function will avoid creating new signals when possible.
 */
export function firstAborted(
  iter: Iterable<AbortSignal>
): AbortSignal | undefined {
  const sigs = [...iter];
  if (sigs.length < 2) {
    return firstElement(sigs);
  }
  for (const sig of sigs) {
    if (sig.aborted) {
      return sig;
    }
  }
  const ac = new AbortController();
  function onAbort(): void {
    for (const sig of sigs) {
      sig.removeEventListener('abort', onAbort);
    }
    ac.abort();
  }
  for (const sig of sigs) {
    sig.addEventListener('abort', onAbort);
  }
  return ac.signal;
}
