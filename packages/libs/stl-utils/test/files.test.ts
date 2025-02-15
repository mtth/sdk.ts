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
      /\/packages\/libs\/stl-errors\/resources\/schemas\/error\.yaml/
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
    expect(outer.rootPath).toMatch(/\/packages\/libs\/stl-errors\/$/);
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

describe('with temp dir', () => {
  test('simple', async () => {
    let dp: string | undefined;
    const ret = await sut.withTempDir(async (dp_) => {
      expectIsDir(dp_);
      dp = dp_;
      return 3;
    });
    expectIsAbsent(check.isPresent(dp));
    expect(ret).toBe(3);
  });

  test('simple throw', async () => {
    let dp: string | undefined;
    try {
      await sut.withTempDir(async (dp_) => {
        expectIsDir(dp_);
        dp = dp_;
        throw new Error('boom');
      });
      fail();
    } catch (err) {
      expect(err.message).toBe('boom');
      expectIsAbsent(check.isPresent(dp));
    }
  });

  test('keep on ok', async () => {
    let dp: string | undefined;
    await sut.withTempDir({}, async (dp_, keep) => {
      expectIsDir(dp_);
      keep();
      dp = dp_;
    });
    expectIsDir(check.isPresent(dp));
  });

  test('keep on throw', async () => {
    let dp: string | undefined;
    try {
      await sut.withTempDir(async (dp_, keep) => {
        expectIsDir(dp_);
        keep();
        dp = dp_;
        throw new Error('boom');
      });
      fail();
    } catch (err) {
      expect(err.message).toBe('boom');
      expectIsDir(check.isPresent(dp));
    }
  });

  async function expectIsDir(fp: string): Promise<void> {
    const s = await fs.stat(fp);
    expect(s.isDirectory()).toBe(true);
  }

  async function expectIsAbsent(fp: string): Promise<void> {
    try {
      await fs.stat(fp);
      fail();
    } catch (err) {
      expect(err.code).toBe('ENOENT');
    }
  }
});
