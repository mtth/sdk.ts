import {assert, fail} from '@mtth/stl-errors';

import * as sut from '../src/index.js';

describe('settings manager', () => {
  test('single setting', () => {
    const withSettings = sut.settingsManager(() => sut.intSetting('3'));
    const res = withSettings((v, s) => {
      expect(s).toEqual('3');
      return v + 1;
    });
    expect(res()).toEqual(4);
  });

  test('nested settings', () => {
    const withSettings = sut.settingsManager(() => ({
      missingString: sut.stringSetting(undefined),
      presentString: sut.stringSetting('abc', {sensitive: true}),
      presentFloat: sut.floatSetting('3.0'),
      missingURL: sut.urlSetting(undefined),
      nested: {
        presentBool: sut.boolSetting('true'),
        missingJSON: sut.jsonSetting(undefined),
        singletonArray: sut.stringArraySetting('foo,'),
      },
    }));
    const res = withSettings((v, s) => {
      expect(v).toEqual({
        missingString: undefined,
        presentString: 'abc',
        presentFloat: 3,
        missingURL: undefined,
        nested: {
          presentBool: true,
          missingJSON: undefined,
          singletonArray: ['foo'],
        },
      });
      expect(s).toEqual({
        presentString: null,
        presentFloat: '3.0',
        nested: {
          presentBool: 'true',
          singletonArray: 'foo,',
        },
      });
      return true;
    });
    expect(res()).toBe(true);
  });

  test('computation caching', () => {
    const withSettings = sut.settingsManager((env) => ({
      foo: sut.intSetting(env.foo ?? '5'),
    }));
    let called = 0;
    const config = withSettings((v) => {
      called++;
      return v.foo + 1;
    });
    expect(called).toEqual(0);
    const env1 = {foo: '2', bar: '10'};
    expect(config(env1)).toEqual(3);
    expect(called).toEqual(1);
    expect(config(env1)).toEqual(3);
    expect(called).toEqual(1);
    expect(config({foo: '1'})).toEqual(2);
    expect(called).toEqual(2);
  });
});

describe('settings provider', () => {
  test('single setting', () => {
    const settings = sut.settingsProvider(() => sut.intSetting('3'));
    expect(settings()).toEqual(3);
  });

  test('setting object', () => {
    const settings = sut.settingsProvider(() => ({
      missingString: sut.stringSetting(undefined),
      presentString: sut.stringSetting('abc', {sensitive: true}),
      presentFloat: sut.floatSetting('3.0'),
      missingURL: sut.urlSetting(undefined),
      nested: {
        presentBool: sut.boolSetting('true'),
        missingJSON: sut.jsonSetting(undefined),
        singletonArray: sut.stringArraySetting('foo,'),
      },
    }));
    expect(settings()).toEqual({
      missingString: undefined,
      presentString: 'abc',
      presentFloat: 3,
      missingURL: undefined,
      nested: {
        presentBool: true,
        missingJSON: undefined,
        singletonArray: ['foo'],
      },
    });
  });

  test('explicit env', () => {
    const settings = sut.settingsProvider((env) => ({
      foo: sut.stringSetting(env.FOO),
      bar: sut.stringSetting(env.BAR ?? 'hi'),
    }));
    expect(settings({FOO: 'hey'})).toEqual({foo: 'hey', bar: 'hi'});
  });

  test('invalid settings spec', () => {
    expect(() => sut.settingsProvider(() => 1)()).toThrow(TypeError);
  });

  test('invalid settings', () => {
    const settings = sut.settingsProvider(() => ({
      ok: sut.boolSetting('false'),
      missing1: sut.intSetting(sut.invalidSource),
      nested: {
        missing2: sut.stringSetting(sut.invalidSource),
        invalid: sut.floatSetting('aa'),
      },
    }));
    try {
      settings();
      fail();
    } catch (err) {
      expect(err).toMatchObject({
        code: sut.settingsErrorCodes.SettingsValidationFailed,
        tags: {
          missingLocators: ['$.missing1', '$.nested.missing2'],
          errors: [expect.any(Error)],
        },
      });
    }
  });

  test('invalid boolean setting', () => {
    const settings = sut.settingsProvider(() => sut.boolSetting('foo'));
    try {
      settings();
      fail();
    } catch (err) {
      expect(err).toMatchObject({
        code: 'ERR_SETTINGS_VALIDATION_FAILED',
        tags: {
          missingLocators: [],
          errors: [
            {
              code: 'ERR_INVALID_SETTING',
              tags: {locator: '$'},
              cause: {
                code: 'ERR_INVALID_SETTING_VALUE',
                tags: {value: 'foo'},
              },
            },
          ],
        },
      });
    }
  });
});

test('setting for', () => {
  interface FooOptions {
    readonly id: string;
    readonly fooSize: number;
    readonly barName?: string;
  }

  function fooSetting(env: sut.SettingsEnv): sut.SettingFor<FooOptions, 'id'> {
    return {
      id: sut.stringSetting(env.ID ?? sut.invalidSource),
      fooSize: sut.intSetting(env.FOO_SIZE ?? '2'),
      barName: sut.stringSetting(env.BAR_NAME),
    };
  }

  const settings = sut.settingsProvider(fooSetting);
  expect(settings({ID: 'ab1'})).toEqual({id: 'ab1', fooSize: 2});
});

function exactlyOne<
  S extends {readonly [key: string]: sut.Setting<unknown, unknown>},
>(source: S): sut.Setting<S, S> {
  return sut.newSetting(source, (s) => {
    let obj: any;
    for (const [key, val] of Object.entries(s)) {
      if (val === undefined) {
        continue;
      }
      assert(obj === undefined, 'Too many settings');
      obj = {[key]: val};
    }
    assert(obj, 'Missing setting');
    return obj;
  });
}

describe('derived setting', () => {
  describe('exactly one', () => {
    const settings = sut.settingsProvider((env) =>
      exactlyOne({
        one: sut.intSetting(env.ONE),
        two: sut.intSetting(env.TWO),
      })
    );

    test.each([
      [{ONE: '1'}, {one: 1}],
      [{TWO: '22', THREE: '4'}, {two: 22}],
    ])('handles %j', (arg, want) => {
      expect(settings(arg)).toEqual(want);
    });

    test.each([{ONE: '1', TWO: '22'}, {}])('rejects %j', (arg) => {
      try {
        settings(arg);
        fail();
      } catch (err) {
        expect(err).toMatchObject({code: 'ERR_SETTINGS_VALIDATION_FAILED'});
      }
    });
  });
});
