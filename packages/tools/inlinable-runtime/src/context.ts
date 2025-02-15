/** A candidate for inlining. */
export type Inlinable<V> = (ctx: InlinableContext) => V;

/** Inlining utilities. */
export interface InlinableContext {
  readonly enclosing: (fp: string, opts?: EnclosingOptions) => EnclosingPackage;
  readonly readTextFile: (fp: string) => string;
  readonly readJsonFile: <V = any>(fp: string, opts?: ReadJsonFileOptions) => V;
}

/**
 * Returns the deepest root containing the first argument, if any. A root is
 * defined as a parent folder of one of the folders passed in as second argument
 * (defaulting to `defaultRootFolders`).
 */
export function enclosingRoot(args: {
  readonly path: string;
  readonly separator: string;
  readonly rootFolders?: ReadonlyArray<string>;
}): string | undefined {
  const sep = args.separator;
  const sentinels = args.rootFolders ?? defaultRootFolders;
  const pat = new RegExp(`${sep}(${sentinels.join('|')})(${sep}|$)`, 'g');
  const matches = [...args.path.matchAll(pat)];
  return matches.length
    ? args.path.slice(0, matches[matches.length - 1]?.index)
    : undefined;
}

export interface EnclosingOptions {
  /** Defaults to `defaultRootFolders`. */
  readonly rootFolders?: ReadonlyArray<string>;
  /** Defaults to `defaultResourceFolder`. */
  readonly resourceFolder?: string;
}

export const defaultRootFolders: ReadonlyArray<string> = [
  'src',
  'lib',
  'test',
  '.next',
];

export const defaultResourceFolder = 'resources';

export interface ReadJsonFileOptions {
  readonly fields?: ReadonlyArray<string>;
}

export interface EnclosingPackage {
  metadataPath(): string;
  resourcePath(...comps: string[]): string;
  metadata(): {readonly name: string; readonly version?: string};
}
