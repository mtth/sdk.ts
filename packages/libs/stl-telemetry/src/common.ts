/** Library information. */
export interface LibInfo {
  /** The name of the package. */
  readonly name: string;

  /** The package's version. */
  readonly version?: string;
}

const PLACEHOLDER_VERSION = '0.0.0';

/** Returns whether a version is set to a non-zero value */
export function isExplicitVersion(arg: string | null | undefined): boolean {
  return !!arg && arg !== PLACEHOLDER_VERSION;
}
