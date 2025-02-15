import {assert} from '@mtth/stl-errors';
import {parseBoolean} from '@mtth/stl-utils/strings';

import {newSetting, Setting, SettingOptions, SettingSource} from './common.js';

/** Convenience type for settings created from the standard parameters. */
export type SimpleSettingFactory<V> = <S extends SettingSource>(
  s: S,
  opts?: SettingOptions
) => Setting<S, V>;

/**
 * Returns a custom setting factory from a transform function. This can be used
 * to implement settings of many different types, see `stringSetting` and others
 * below for examples.
 */
export function simpleSettingFactory<V>(
  fn: (s: string) => V
): SimpleSettingFactory<V> {
  return <S extends SettingSource>(
    s: S,
    opts?: SettingOptions
  ): Setting<S, V> => newSetting(s, opts, fn);
}

/** String-valued setting. */
export const stringSetting = simpleSettingFactory((s): string => s);

/** Float-valued setting. */
export const floatSetting = simpleSettingFactory((s): number => {
  const f = +s;
  assert(s.trim() && !isNaN(f), 'Not a valid float');
  return f;
});

/** Integer-valued setting. */
export const intSetting = simpleSettingFactory((s): number => {
  const n = +s;
  assert(s.trim() && (n | 0) === n, 'Not a valid integer');
  return n;
});

/** Setting holding arbitrary JSON values. */
export const jsonSetting = simpleSettingFactory(JSON.parse);

/**
 * Boolean-valued setting. 'true' and 'always' (resp. 'false' and 'never') are
 * accepted as source for `true` (resp. `false`), along with their other cased
 * variants. Other strings will throw an error.
 */
export const boolSetting = simpleSettingFactory(parseBoolean);

/**
 * Setting holding a comma-separated array of strings. Each element of the array
 * is trimmed and empty elements discarded. Examples: `a,b,c`, `10,`.
 */
export const stringArraySetting = simpleSettingFactory(
  (s): ReadonlyArray<string> => {
    const parts: string[] = [];
    for (const p of s.split(',')) {
      const t = p.trim();
      if (t) {
        parts.push(t);
      }
    }
    return parts;
  }
);

/**
 * Setting holding a comma-separated array of equal-delimited entries. Each
 * element is trimmed and empty entries discarded. Examples: `a=1,b=20`, `a=a,`.
 */
export const stringMapSetting = simpleSettingFactory(
  (s): ReadonlyMap<string, string> => {
    const ret = new Map<string, string>();
    for (const p of s.split(',')) {
      const t = p.trim();
      if (t) {
        const [k, v, ...rest] = t.split('=');
        assert(k != null && v != null && !rest.length, 'Invalid entry: %s', t);
        ret.set(k.trim(), v.trim());
      }
    }
    return ret;
  }
);

/** URL setting creation parameters. */
export interface UrlSettingOptions extends SettingOptions {
  /**
   * Whether to explicit add or remove a trailing slash. If undefined, the
   * original URL is used. Note that the `URL` class _always_ adds a slash after
   * the origin - this can't be changed, even by setting this option to false.
   */
  readonly trailingSlash?: boolean;
}

/** Creates a  URL-valued setting. */
export function urlSetting<S extends SettingSource>(
  source: S,
  opts?: UrlSettingOptions
): Setting<S, URL> {
  const slash = opts?.trailingSlash;
  return newSetting(source, opts, (s: string): any => {
    if (slash !== undefined) {
      s = s.replace(/\/*$/, slash ? '/' : '');
    }
    return new URL(s);
  });
}

/** Enum setting creation parameters. */
export interface EnumSettingParams<E extends string> extends SettingOptions {
  /** Allowed enum values. */
  readonly symbols: ReadonlyArray<E>;
}

/** Creates a new enum setting. */
export function enumSetting<E extends string, S extends SettingSource>(
  source: S,
  params: EnumSettingParams<E>
): Setting<S, E> {
  return newSetting(source, params, (s): any => {
    if (!~params.symbols.indexOf(s as any)) {
      throw new Error('Invalid enum value');
    }
    return s;
  });
}
