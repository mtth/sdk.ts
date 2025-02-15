import crypto from 'crypto';

import * as sut from '../src/opaques.js';

describe('slug', () => {
  test.each(['abc', 'a-valid-slug', '.a-valid-slug', '.latest'])(
    '%s is valid',
    (val) => {
      expect(() => {
        sut.newSlug(val, 20);
      }).not.toThrow();
      expect(sut.isSlug(val, 20)).toEqual(true);
    }
  );

  test.each([
    '',
    'Foo',
    '--abc',
    'a-too-long-slug',
    '1-first',
    'xx-??-abc',
    '.',
    '..foo',
  ])('%s is invalid', (val) => {
    expect(() => {
      sut.newSlug(val, 10);
    }).toThrow();
    expect(sut.isSlug(val, 10)).toEqual(false);
  });

  test('slugify', async () => {
    expect(sut.slugify('AnotherBrick')).toEqual('another-brick');
  });
});

describe('uuid', () => {
  test.each(['00000000-0000-0000-0000-000000000000', crypto.randomUUID()])(
    '%s is valid',
    (val) => {
      expect(() => {
        sut.newUuid(val);
      }).not.toThrow();
    }
  );

  test.each([
    '',
    '00000000-0000-0000-0000000000000000',
    '0x000000-0000-0000-0000-000000000000',
  ])('%s is invalid', (val) => {
    expect(() => {
      sut.newUuid(val);
    }).toThrow();
  });
});
