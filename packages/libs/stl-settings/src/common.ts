import {
  assertType,
  errorFactories,
  errorMessage,
  StandardError,
} from '@mtth/stl-errors';

const [errors, codes] = errorFactories({
  definitions: {
    /** At least one setting was invalid or missing. */
    settingsValidationFailed: (issues: ValidationIssues) => ({
      message: validationErrorMessage(issues),
      tags: {...issues},
    }),

    /** A setting failed to parse */
    invalidSetting: (loc: string, cause: unknown) => ({
      message: `${loc}: ${errorMessage(cause)}`,
      tags: {locator: loc},
      cause,
    }),

    /**
     * The setting's value was not valid for its type. For example a non-numeric
     * source was passed in for an integer setting.
     */
    invalidSettingValue: (val: unknown, cause: unknown) => ({
      message: `${JSON.stringify(val)} [${errorMessage(cause)}]`,
      tags: {value: val},
      cause,
    }),
  },
});
export const settingsErrorCodes = codes;

interface ValidationIssues {
  readonly missingLocators: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<StandardError>;
}

function validationErrorMessage(issues: ValidationIssues): string {
  const {missingLocators: missing, errors} = issues;
  const reasons: string[] = [];
  if (missing.length) {
    reasons.push(`${missing.length} missing (${missing.join(', ')})`);
  }
  if (errors.length) {
    reasons.push(
      `${errors.length} invalid (${errors.map((e) => e.message).join(', ')})`
    );
  }
  return 'Settings validation failed: ' + reasons.join(' and ');
}

/**
 * Acceptable types for use as source when defining a setting. `InvalidSource`
 * means the setting is required: an error will be thrown if its source
 * evaluates to this value.
 */
export type SettingSource = string | undefined | InvalidSource;

/**
 * Sentinel used to represent invalid sources. This allows more explicit
 * signatures than using `false` directly. Note that the actual choice of
 * representation doesn't matter other than it can't collide with valid sources.
 */
export const invalidSource = false as const;
export type InvalidSource = typeof invalidSource;

// Convenience type to propagate undefined-ability.
type Sourced<S, V> = S extends undefined ? V | undefined : V;

const isSettingMarker = '@mtth/stl-settings:isSetting+v1' as const;

/**
 * Configuration value. Instances should be created via `newSetting` and the
 * variety of convenience factory methods (`intSetting`, `stringSetting`, etc.).
 */
export interface Setting<S, V> {
  readonly [isSettingMarker]: true;
  resource(): Resource<S, V> | InvalidSource | undefined;
}

function isSetting(arg: unknown): arg is Setting<any, any> {
  return !!(arg && (arg as any)[isSettingMarker]);
}

/**
 * Holder class for a configuration value. Instances should be created via
 * `newSetting` and the variety of convenience factory methods (`intSetting`,
 * `stringSetting`, etc.).
 */
class RealSetting<S, V> implements Setting<S, V> {
  readonly [isSettingMarker]!: true;
  constructor(
    private readonly source: S,
    private readonly transform: (s: any) => V,
    private readonly options: SettingOptions
  ) {
    Object.defineProperty(this, isSettingMarker, {value: true});
  }

  private values(arg: any): any {
    try {
      return this.transform(arg);
    } catch (err) {
      throw errors.invalidSettingValue(arg, err);
    }
  }

  resource(): Resource | InvalidSource | undefined {
    const {options: opts} = this;
    const src = this.source as any;
    if (src === undefined || src === invalidSource) {
      return src;
    }
    let res;
    if (typeof src == 'string') {
      res = {sources: src, values: this.values(src)};
    } else {
      const nested = nestedResource(src);
      res = {sources: nested.sources, values: this.values(nested.values)};
    }
    return {sources: opts.sensitive ? null : res.sources, values: res.values};
  }
}

interface Resource<V = any, S = any> {
  readonly values: V;
  readonly sources: S;
}

const ROOT_KEY = '$';

function nestedResource(obj: any): Resource {
  const missingLocators: string[] = [];
  const errs: StandardError[] = [];
  const rootV: any = {};
  const rootS: any = {};

  walk({[ROOT_KEY]: obj}, rootV, rootS, '');
  const errCount = missingLocators.length + errs.length;
  if (errCount) {
    throw errors.settingsValidationFailed({missingLocators, errors: errs});
  } else {
    return {values: rootV[ROOT_KEY], sources: rootS[ROOT_KEY]};
  }

  function walk(o: any, v: any, s: any, loc: string): void {
    if (!o || typeof o != 'object') {
      throw new TypeError();
    }
    for (const [key, val] of Object.entries(o)) {
      const valLoc = (loc ? loc + '.' : '') + key;
      if (isSetting(val)) {
        let res;
        try {
          res = val.resource();
        } catch (err) {
          errs.push(errors.invalidSetting(valLoc, err));
        }
        if (res === undefined) {
          continue;
        }
        if (res === false) {
          missingLocators.push(valLoc);
        } else {
          s[key] = res.sources;
          v[key] = res.values;
        }
      } else {
        s[key] = {};
        v[key] = {};
        walk(val, v[key], s[key], valLoc);
      }
    }
  }
}

/** Setting creation options. */
export interface SettingOptions {
  /**
   * Whether the source's raw value should be omitted when returned from the
   * setting provider's `sources` attribute.
   */
  readonly sensitive?: boolean;
}

/** Setting value transformer. */
export type SettingFunction<S, V> = (
  s: Exclude<Settings<S>, InvalidSource | undefined>
) => V;

/** One or more nested settings. */
export type Settings<S> =
  S extends Setting<infer S, infer V>
    ? Sourced<S, V>
    : {readonly [K in keyof S]: Settings<S[K]>};

/** Creates a new setting using an explicit mapping function. */
export function newSetting<S, V>(
  source: S,
  opts: SettingOptions | undefined,
  fn: SettingFunction<S, V>
): Setting<S, V>;
export function newSetting<S, V>(
  source: S,
  fn: SettingFunction<S, V>
): Setting<S, V>;
export function newSetting<S, V>(
  source: S,
  arg1: any,
  arg2?: any
): Setting<S, V> {
  let opts: SettingOptions;
  let fn;
  if (typeof arg2 == 'function') {
    opts = arg1 ?? {};
    fn = arg2;
  } else {
    assertType('function', arg1);
    opts = {};
    fn = arg1;
  }
  return new RealSetting(source, fn, opts);
}

/** Sanitized sources exported by the setting provider. */
export type SettingsSources =
  /** Non-sensitive source value. */
  | string
  /** Sensitive source value. */
  | null
  /** Nested values. */
  | {readonly [key: string]: SettingsSources};

/**
 * Setting resource manager. Values are cached for identical environment calls
 * and lazily returned to ease testing and integrate more easily with WebPack
 * and other frameworks which do not handle top-level errors well (WebPack will
 * abort an imported module at the first error, causing opaque reference errors
 * elsewhere).
 */
export type SettingsManager<O> = <T>(
  fn: (v: Settings<O>, s: SettingsSources) => T
) => (env?: SettingsEnv) => T;

export interface SettingsEnv {
  readonly [name: string]: string | undefined;
}

/** Returns a setting factory for the input setting or specification object. */
export function settingsManager<O>(
  fn: (env: SettingsEnv) => O
): SettingsManager<O> {
  return <T>(tx: (v: any, s: any) => T): ((env?: SettingsEnv) => T) => {
    const ref = new ProcessEnvRef();
    let ret: T | undefined;
    return (env?: SettingsEnv): T => {
      env = env ?? process.env;
      if (ref.replace(env) || ret === undefined) {
        const res = nestedResource(fn(env));
        ret = tx(res.values, res.sources);
      }
      return ret;
    };
  };
}

/**
 * Returns a provider which directly returns the parsed setting values. This is
 * a convenience for simple use-cases which do not use derived config types.
 */
export function settingsProvider<O>(
  fn: (env: SettingsEnv) => O
): (env?: SettingsEnv) => Settings<O> {
  return settingsManager(fn)((v) => v);
}

/**
 * Convenience type to get the underlying settings type from the output of
 * `settingsManager` and `settingsProvider`. For example:
 *
 *    const inputs = settingsProvider(...);
 *    type Inputs = SettingsType<typeof settings>;
 */
export type SettingsType<V> =
  V extends SettingsManager<infer O>
    ? Settings<O>
    : V extends (...args: any[]) => infer R
      ? R
      : never;

/** WeakRef emulator. WeakRefs are only available in recent environments. */
class ProcessEnvRef {
  private refs: WeakSet<SettingsEnv> | undefined;

  /** Returns true if the new value replaced the old one. */
  replace(env: SettingsEnv): boolean {
    if (this.refs?.has(env)) {
      return false;
    }
    this.refs = new WeakSet();
    this.refs.add(env);
    return true;
  }
}
