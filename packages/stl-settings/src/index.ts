import {Setting} from './common.js';

export * from './builtins.js';
export * from './common.js';

/**
 * Returns the `Setting` type corresponding to an object. Optional and nullable
 * fields will be mapped to optional settings and others to settings with
 * defaults. The second type argument can be used to mark certain fields as
 * required.
 *
 * Sample usage:
 *
 *  ```typescript
 *  interface Options {
 *    readonly id: string;
 *    readonly fooSize: number;
 *    readonly barName?: string;
 *  }
 *
 *  function optionsSetting(env: SettingsEnv): SettingFor<Options, 'id'> {
 *    return {
 *       id: stringSetting(env.ID ?? invalidSource),
 *       fooSize: intSetting(env.FOO_SIZE ?? '2'),
 *       barName: stringSetting(env.BAR_NAME),
 *    };
 *  }
 *  ```
 *
 * Note that nested objects are not recursively handled. They are converted to
 * a single setting with composite value.
 */
export type SettingFor<O, R = never> = {
  readonly [K in keyof O]: Setting<
    K extends R
      ? string | false
      : {} extends Pick<O, K>
        ? string | undefined
        : O[K] extends undefined
          ? string | undefined
          : string,
    Exclude<O[K], undefined>
  >;
};

export type SettingDefaultsFor<O> = {
  readonly [K in keyof O]?: string;
};
