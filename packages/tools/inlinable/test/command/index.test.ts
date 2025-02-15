import {localPath, localUrl, ResourceLoader} from '@mtth/stl-utils/files';
import {statSync} from 'fs';

import * as sut from '../../src/command/index.js';

const loader = ResourceLoader.enclosing(import.meta.url).scoped('test');

const cases = loader
  .listLocalUrlsSync()
  .filter((lu) => statSync(lu).isDirectory())
  .map((lu) => localPath(lu));

const command = sut.mainCommand();

describe.each(cases)('%s', (lp) => {
  beforeEach(() => {
    vi.resetModules(); // Clear import cache
  });

  test('replace', async () => {
    await runCommand(
      'replace',
      '--file-suffix=.replaced.actual',
      '--package-name=../../../lib/index.js'
    );
    const [original, patched] = await Promise.all([
      loader.load(lp, 'index.replaced.actual.js'),
      loader.load(lp, 'index.replaced.js'),
    ]);
    expect(original.contents).toEqual(patched.contents);
  });

  async function runCommand(...args: string[]): Promise<void> {
    await command.parseAsync([
      'node',
      'inlinable.js', // Ignored
      '--quiet',
      ...args,
      localPath(localUrl('index.js', {parent: localUrl(lp)})),
    ]);
  }
});
