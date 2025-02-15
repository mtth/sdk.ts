import {assert} from '@mtth/stl-errors';
import fs from 'fs';
import * as runtime from 'inlinable-runtime';
import path from 'path';
import url from 'url';

export function newContext(): runtime.InlinableContext {
  return {enclosing, readTextFile, readJsonFile};
}

function readTextFile(fp: string): string {
  if (fp.startsWith('file://')) {
    fp = url.fileURLToPath(fp);
  }
  return fs.readFileSync(fp, 'utf8');
}

function readJsonFile<V = unknown>(
  fp: string,
  opts?: runtime.ReadJsonFileOptions
): V {
  const str = readTextFile(fp);
  const data = JSON.parse(str);
  if (opts?.fields == null) {
    return data;
  }
  const ret: any = {};
  for (const field of opts?.fields ?? []) {
    ret[field] = data[field];
  }
  return ret;
}

/**
 * Convenience function for reading files enclosed in the same package. The
 * path's parent directory is used if no enclosing package was detected.
 */
function enclosing(
  fp: string,
  opts?: runtime.EnclosingOptions
): runtime.EnclosingPackage {
  if (fp.startsWith('file://')) {
    fp = url.fileURLToPath(fp);
  }
  const root = runtime.enclosingRoot({
    path: fp,
    separator: path.sep,
    rootFolders: opts?.rootFolders,
  });
  return new RealEnclosingPackage(
    root ?? path.dirname(fp),
    opts?.resourceFolder ?? runtime.defaultResourceFolder
  );
}

class RealEnclosingPackage implements runtime.EnclosingPackage {
  constructor(
    readonly root: string,
    readonly resourceFolder: string
  ) {}

  metadataPath(): string {
    return path.join(this.root, 'package.json');
  }

  resourcePath(fp: string): string {
    return path.join(this.root, this.resourceFolder, ...fp.split('/'));
  }

  metadata(): {readonly name: string; readonly version?: string} {
    const str = fs.readFileSync(this.metadataPath(), 'utf8');
    const {name, version} = JSON.parse(str);
    assert(typeof name == 'string', 'Invalid package name: %s', name);
    assert(
      version == null || typeof version == 'string',
      'Invalid package version: %s',
      version
    );
    return {name, version};
  }
}
