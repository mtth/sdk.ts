import {assert, defaultErrors} from '@mtth/stl-errors';
import picomatch from 'picomatch';

/** Upper-cases the first character of the string if not empty. */
export function upperCaseFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Converts standard boolean string values to a boolean: `always`, `true`, `y`,
 * `yes` for true; `n`, `no`, `never`, `false` for false (case-insensitive).
 */
export function parseBoolean(s: string): boolean {
  switch (s.toLowerCase()) {
    case 'always':
    case 'true':
    case 'y':
    case 'yes':
      return true;
    case 'n':
    case 'no':
    case 'never':
    case 'false':
      return false;
    default:
      throw defaultErrors.invalid({message: `Invalid boolean string: ${s}`});
  }
}

/**
 * Builds a function which checks whether a string matches the input glob.
 * Details on the globbing logic can be found in the underlying implementation:
 * https://github.com/micromatch/picomatch. The following options are different
 * from the default:
 *
 * + `bash` is true,
 * + `dot` is true,
 */
export function globPredicate(glob: string): GlobPredicate {
  return picomatch(glob, {bash: true, dot: true});
}

/** Convenience more explicit type-alias. */
export type GlobPredicate = (s: string) => boolean;

/**
 * Utility class for generating a mapping using globs as keys. This is useful
 * for example to control log level overrides and other environment-based
 * settings.
 */
export class GlobMapper<V> {
  private constructor(
    private readonly entries: ReadonlyArray<GlobEntry<V>>,
    readonly fallback: V | undefined
  ) {}

  /**
   * Builds a new mapping from the input spec. Specs are comma-separated lists
   * of `<glob>=<value>` entries. Both globs and values are trimmed from
   * whitespace. An optional mapping function (the second argument) can be
   * applied to each value.
   *
   * Later values override earlier ones when multiple matches occur. This allows
   * setting a global default first and overriding it for later entries. For
   * example `*=info,bar=trace` will yield the value `info` for everything
   * except `bar`. As a convenience, it's possible to omit the `<glob>=` part in
   * spec entries, which is interpreted as a global default (same as `*`).
   *
   * Details on the globbing logic can be found in the underlying
   * implementation: https://github.com/micromatch/picomatch. This class uses
   * the same options as `globPredicate` above.
   */
  static forSpec(spec: string): GlobMapper<string>;
  static forSpec<V = string>(spec: string, fn: (s: string) => V): GlobMapper<V>;
  static forSpec<V = string>(
    spec: string,
    fn?: (s: string) => any
  ): GlobMapper<V> {
    const entries = new Map<string, GlobEntry<V>>();
    let fallback: V | undefined;
    for (const item of spec.split(SPEC_DELIMITER)) {
      const part = item.trim();
      if (!part) {
        continue;
      }
      const match = entryPattern.exec(part.trim());
      if (match) {
        const key = match[1]?.trim();
        const raw = match[2]?.trim();
        assert(key && raw, 'Bad match: %j', match);
        entries.set(key, {
          predicate: globPredicate(key),
          value: fn ? fn(raw) : raw,
        });
      } else {
        fallback = fn ? fn(part) : part;
      }
    }
    return new GlobMapper([...entries.values()], fallback);
  }

  /**
   * Returns a mapper which accepts booleans as values. These must be written in
   * a form compatible with `parseBoolean`. For example: `y` (always true`),
   * `n,foo=y` (false except for `foo`).
   */
  static predicating(spec: string): GlobMapper<boolean> {
    return GlobMapper.forSpec(spec, parseBoolean);
  }

  /** Returns the mapper's value for a given string */
  map(arg: string): V | undefined {
    let val = this.fallback;
    for (const {predicate, value} of this.entries) {
      if (predicate(arg)) {
        val = value;
      }
    }
    return val;
  }
}

interface GlobEntry<V> {
  readonly predicate: GlobPredicate;
  readonly value: V;
}

const SPEC_DELIMITER = ',';
const entryPattern = /^([^=]+)=(.+)$/;

/** Splits input on comma and trims each element. */
export function commaSeparated(str: string): ReadonlyArray<string> {
  return str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s);
}

/**
 * Returns a sentence starting with "Please" and non-empty alternatives joined
 * with "or".
 */
export function please(...alts: (string | undefined)[]): string {
  const valid = alts.filter((a) => a);
  assert(valid.length, 'Empty alternatives');
  return `Please ${valid.join(' or ')}.`;
}
