import path from 'path';
import url from 'url';

import * as sut from '../src/files.js';

describe('local path', () => {
  test.each([
    ['./', './'],
    [new URL('file:///bar'), '/bar'],
  ])('%s -> %s', (pl, want) => {
    expect(sut.localPath(pl)).toEqual(want);
  });

  test('suffix', () => {
    expect(sut.localPath('foo/bar', 'baz')).toEqual('foo/bar/baz');
    expect(sut.localPath(new URL('file:///ok/here'), '/root/a')).toEqual(
      '/root/a'
    );
  });
});

describe('posix path', () => {
  test.each([
    ['./', './'],
    [new URL('file:///bar'), '/bar'],
  ])('%s -> %s', (pl, want) => {
    expect(sut.posixPath(pl)).toEqual(want);
  });
});

describe('local url', () => {
  test.each([
    ['.', url.pathToFileURL(process.cwd())],
    ['/bar', new URL('file:///bar')],
    ['file:///bax/one', new URL('file:///bax/one')],
  ])('%s -> %s', (pl, want) => {
    expect('' + sut.localUrl(pl)).toEqual('' + want);
  });

  test('parent', () => {
    const got = sut.localUrl('foo/bar', {parent: new URL('file:///bar/baz')});
    expect('' + got).toEqual('file:///bar/baz/foo/bar');
  });
});

describe('resource loader', () => {
  const loader = sut.ResourceLoader.enclosing(__dirname);

  test('relative file url', () => {
    const lu = '' + loader.localUrl('foo');
    expect(lu).toMatch(/resources\/foo$/);
  });

  test('package file url', () => {
    const lu = '' + loader.localUrl('/foo/bar');
    expect(lu).toEqual('file:///foo/bar');
  });

  test('package dependency file url', () => {
    const lu =
      '' +
      loader
        .scopedToDependency('@mtth/stl-errors')
        .localUrl('schemas/error.yaml');
    expect(lu).toMatch(
      /\/packages\/stl-errors\/resources\/schemas\/error\.yaml/
    );
  });

  test('load dependency resources', async () => {
    const res = await loader
      .scopedToDependency('@mtth/stl-errors')
      .load('schemas/error.yaml');
    expect(res.contents).toContain('additionalProperties');
  });

  test('scoped', () => {
    const scoped = loader.scoped('test');
    expect(scoped.rootPath).toMatch(/stl-utils\/test\/$/);
  });

  test('scoped to dependency', () => {
    const outer = loader.scopedToDependency('@mtth/stl-errors');
    expect(outer.rootPath).toMatch(/\/packages\/stl-errors\/$/);
    const inner = outer.scopedToDependency('change-case');
    expect(inner.rootPath).toMatch(
      /\/node_modules\/\.pnpm\/.*\/change-case\/$/
    );
  });

  test('list local urls sync', () => {
    const scoped = loader.scopedToDependency('@mtth/stl-errors');
    const lus = scoped.listLocalUrlsSync('schemas');
    expect(lus.map((u) => path.posix.basename(u.pathname))).toEqual([
      'error-status.yaml',
      'error.yaml',
      'failure.yaml',
    ]);
  });

  test('walk local file urls sync', () => {
    const scoped = loader.scopedToDependency('@mtth/stl-errors');
    const root = scoped.localUrl('.').pathname;
    const lus = scoped.walkLocalFileUrlsSync('.');
    expect(lus.map((u) => path.posix.relative(root, u.pathname))).toEqual([
      'schemas/error-status.yaml',
      'schemas/error.yaml',
      'schemas/failure.yaml',
    ]);
  });
});
