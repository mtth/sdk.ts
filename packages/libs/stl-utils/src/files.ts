import {assert, unexpected} from '@mtth/stl-errors';
import fs from 'fs';
import {readFile} from 'fs/promises';
import {enclosingRoot} from 'inlinable-runtime';
import path from 'path';
import url from 'url';

const {posix} = path;

/** Platform-specific file path. */
export type LocalPath = string;

/** Local URL (file://). */
export type LocalUrl = URL;

/** Path-ish type. */
export type PathLike = LocalPath | LocalUrl;

/**
 * Represents the input as a platform-specific path. This path can be
 * manipulated by the `path` module's utilities.
 */
export function localPath(pl: PathLike, pp?: PosixPath): LocalPath {
  if (pp && posix.isAbsolute(pp)) {
    return path.normalize(pp);
  }
  const lp =
    pl instanceof URL || pl.startsWith('file://') ? url.fileURLToPath(pl) : pl;
  return pp ? path.join(lp, pp) : path.normalize(lp);
}

/** Returns a POSIX equivalent to the input path. */
export function posixPath(pl: PathLike): PosixPath {
  const lp = localPath(pl);
  return path.sep === path.posix.sep
    ? lp
    : lp.replaceAll(path.sep, path.posix.sep);
}

/**
 * Represents the input as a file URL. Paths without an explicit protocol will
 * be normalized. Throws if the returned URL does not have the `file:` protocol.
 */
export function localUrl(
  pl: PathLike,
  opts?: {
    /**
     * Parent URL to use when the input path-like is a relative path. Note that
     * unlike the `URL`'s `base` constructor argument, the full parent path will
     * always be used, even if does not end in a slash. By default the CWD is
     * used.
     */
    readonly parent?: LocalUrl;

    /**
     * When true, ensures the returned URL ends with a slash; when false,
     * ensures the URL does not (except if it is the root path). When not set,
     * keep the original path.
     */
    readonly trailingSlash?: boolean;
  }
): LocalUrl {
  const parent = opts?.parent;
  if (parent != null) {
    assert(parent.protocol === 'file:', 'Non-file parent:', parent);
  }

  const ret =
    pl instanceof URL
      ? new URL(pl)
      : pl.startsWith('file://')
        ? new URL(pl)
        : url.pathToFileURL(
            path.isAbsolute(pl)
              ? pl
              : parent
                ? path.join(url.fileURLToPath(parent), pl)
                : path.normalize(pl)
          );
  assert(ret.protocol === 'file:', 'Unexpected protocol: %s');

  const slash = opts?.trailingSlash;
  if (slash != null) {
    updateTrailingSlash(ret, slash);
  }

  return ret;
}

export function updateTrailingSlash(u: URL, include: boolean): void {
  const hasSlash = u.pathname.endsWith('/');
  if (include && !hasSlash) {
    u.pathname += '/';
  } else if (!include && hasSlash && u.pathname.length > 1) {
    u.pathname = u.pathname.slice(0, -1);
  }
}

/** `/`-delimited file path. */
export type PosixPath = string;
export type RelativePosixPath = PosixPath;
export type AbsolutePosixPath = PosixPath;

export const RESOURCES_FOLDER = 'resources';

/** Package resource. */
export interface Resource<V = string> {
  readonly contents: V;
  readonly url: LocalUrl;
}

/** Package resource loader */
export class ResourceLoader {
  private readonly root: LocalUrl;
  private constructor(
    root: LocalPath,
    readonly dependenciesFolder: string,
    readonly resourcesFolder: string
  ) {
    assert(fs.existsSync(root), 'Missing resource loader root: %j', root);
    this.root = localUrl(fs.realpathSync(root), {trailingSlash: true});
  }

  get rootPath(): LocalPath {
    return localPath(this.root);
  }

  /** Creates a new loader. */
  static create(opts?: {
    /** Defaults to `process.cwd()`. */
    readonly root?: PathLike;
    /** Defaults to `node_modules`. */
    readonly dependenciesFolder?: string;
    /** Defaults to `RESOURCES_FOLDER`. */
    readonly resourcesFolder?: string;
  }): ResourceLoader {
    return new ResourceLoader(
      localPath(opts?.root || '.'),
      opts?.dependenciesFolder ?? 'node_modules',
      opts?.resourcesFolder ?? RESOURCES_FOLDER
    );
  }

  /** Returns a loader scoped to the enclosing package. */
  static enclosing(pl: PathLike): ResourceLoader {
    const root = enclosingRoot({path: localPath(pl), separator: path.sep});
    assert(root, 'Unable to locate enclosing package for path %s', pl);
    return ResourceLoader.create({root});
  }

  /**
   * Returns a loader scoped to the input path (i.e. with updated root).
   * Relative paths are taken relative to the loader's current root.
   */
  scoped(pp: PosixPath): ResourceLoader {
    const {root, dependenciesFolder, resourcesFolder} = this;
    const depRoot = localPath(root, pp);
    return new ResourceLoader(depRoot, dependenciesFolder, resourcesFolder);
  }

  /**
   * Returns a resource loader scoped to the dependency. This assumes that the
   * `node_modules` dependency structure is identical to PNPM's
   * (https://pnpm.io/symlinked-node-modules-structure).
   */
  scopedToDependency(name: string): ResourceLoader {
    const {root, dependenciesFolder} = this;
    const prefix = root.pathname.split(posix.sep).includes(dependenciesFolder)
      ? name
          .split(posix.sep)
          .map(() => '..')
          .join(posix.sep)
      : dependenciesFolder;
    return this.scoped(posix.join(prefix, name));
  }

  /**
   * Returns a file URL pointing to the resource at the given path. Relative
   * paths are taken relative to the loader's current resource folder.
   */
  localUrl(...pps: PosixPath[]): LocalUrl {
    let pp = posix.join(...pps);
    if (!path.isAbsolute(pp)) {
      pp = posix.join(this.resourcesFolder, pp);
    }
    return new URL(pp, this.root);
  }

  /** Lists all file (including directory) URLs in the given path. */
  listLocalUrlsSync(...pps: PosixPath[]): ReadonlyArray<LocalUrl> {
    const lu = this.localUrl(...pps);
    const names = fs.readdirSync(lu);
    return names.map((n) => localUrl(n, {parent: lu}));
  }

  /**
   * Lists all file (non-directory) URLs under the given path (potentially
   * nested). Only files and directories under the target can be present (links,
   * sockets, etc. will cause an error).
   */
  walkLocalFileUrlsSync(...pps: PosixPath[]): ReadonlyArray<LocalUrl> {
    return [...walk(this.localUrl(...pps))];

    function* walk(lu: LocalUrl): Iterable<LocalUrl> {
      const es = fs.readdirSync(lu, {withFileTypes: true});
      for (const e of es) {
        const clu = localUrl(e.name, {parent: lu});
        if (e.isFile()) {
          yield clu;
        } else if (e.isDirectory()) {
          yield* walk(clu);
        } else {
          throw unexpected(e);
        }
      }
    }
  }

  /** Reads a text resource's contents from the given relative path. */
  async load(...pps: PosixPath[]): Promise<Resource> {
    const lu = this.localUrl(...pps);
    const contents = await readFile(lu, 'utf8');
    return {contents, url: lu};
  }
}

export interface WithTempDirOptions {
  readonly prefix?: string;
}

export type WithTempDirHandler<V> = (
  dp: string,
  keep: () => void
) => Promise<V>;

/**
 * Runs a handler with a temporary directory. The directory is deleted once the
 * handler returns.
 */
export async function withTempDir<V>(fn: WithTempDirHandler<V>): Promise<V>;
export async function withTempDir<V>(
  opts: WithTempDirOptions,
  fn: WithTempDirHandler<V>
): Promise<V>;
export async function withTempDir<V>(
  arg0: WithTempDirOptions | WithTempDirHandler<V>,
  arg1?: WithTempDirHandler<V>
): Promise<V> {
  let opts: WithTempDirOptions;
  let fn: WithTempDirHandler<V>;
  if (typeof arg0 == 'function') {
    opts = {};
    fn = arg0;
  } else {
    assertType('function', arg1);
    opts = arg0;
    fn = arg1;
  }
  const prefix = opts.prefix ?? defaultPrefix();
  const dp = await fs.mkdtemp(prefix);

  let shouldKeep = false;
  const keep = (): void => {
    shouldKeep = true;
  };

  let ret;
  try {
    ret = await fn(dp, keep);
  } finally {
    if (!shouldKeep) {
      await fs.rm(dp, {recursive: true});
    }
  }
  return ret;
}

function defaultPrefix(): string {
  return path.join(os.tmpdir(), 'stl-');
}

