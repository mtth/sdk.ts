import {fail} from '@mtth/stl-errors';

import * as sut from '../src/builtins.js';
import {settingsErrorCodes, settingsProvider} from '../src/common.js';

describe('URL setting', () => {
  test('valid source', () => {
    const settings = settingsProvider(() => sut.urlSetting('http://foo'));
    expect(settings()).toEqual(new URL('http://foo'));
  });

  test('invalid source', () => {
    const settings = settingsProvider(() => sut.urlSetting('bar'));
    try {
      settings();
      fail();
    } catch (err) {
      expect(err.code).toEqual('ERR_SETTINGS_VALIDATION_FAILED');
    }
  });

  const settings = settingsProvider((env) => ({
    asIs: sut.urlSetting(env.v),
    slash: sut.urlSetting(env.v, {trailingSlash: true}),
    noSlash: sut.urlSetting(env.v, {trailingSlash: false}),
  }));

  test('valid source with', () => {
    expect(settings({v: 'http://foo/bar/'})).toEqual({
      asIs: new URL('http://foo/bar/'),
      slash: new URL('http://foo/bar/'),
      noSlash: new URL('http://foo/bar'),
    });
  });

  test('valid source without', () => {
    expect(settings({v: 'http://foo/bar'})).toEqual({
      asIs: new URL('http://foo/bar'),
      slash: new URL('http://foo/bar/'),
      noSlash: new URL('http://foo/bar'),
    });
  });

  test('valid source root', () => {
    expect(settings({v: 'http://foo'})).toEqual({
      asIs: new URL('http://foo/'),
      slash: new URL('http://foo/'),
      noSlash: new URL('http://foo/'),
    });
  });

  test('invalid source', () => {
    const settings = settingsProvider(() => sut.urlSetting('bc'));
    try {
      settings();
      fail();
    } catch (err) {
      expect(err.code).toEqual('ERR_SETTINGS_VALIDATION_FAILED');
      expect(err.tags).toMatchObject({
        missingLocators: [],
        errors: [
          {
            code: settingsErrorCodes.InvalidSetting,
            tags: {locator: '$'},
            cause: {
              code: settingsErrorCodes.InvalidSettingValue,
              tags: {value: 'bc'},
            },
          },
        ],
      });
    }
  });
});

describe('enum setting', () => {
  test('valid source', () => {
    const settings = settingsProvider(() => ({
      level: sut.enumSetting('info', {symbols: ['debug', 'info']}),
    }));
    expect(settings()).toEqual({level: 'info'});
  });

  test('invalid source', () => {
    const settings = settingsProvider(() =>
      sut.enumSetting('b', {symbols: ['d']})
    );
    try {
      settings();
      fail();
    } catch (err) {
      expect(err).toMatchObject({
        code: settingsErrorCodes.SettingsValidationFailed,
        tags: {
          missingLocators: [],
          errors: [
            {
              code: settingsErrorCodes.InvalidSetting,
              tags: {locator: '$'},
              cause: {
                code: settingsErrorCodes.InvalidSettingValue,
                tags: {value: 'b'},
              },
            },
          ],
        },
      });
    }
  });
});

describe('string map setting', () => {
  test.each([['a=1,', new Map([['a', '1']])]])('%j', (src, want) => {
    const got = settingsProvider(() => sut.stringMapSetting(src))({});
    expect(got).toEqual(want);
  });
});
