/** Opaque type utilities. */

import {defaultErrors} from '@mtth/stl-errors';
import {kebabCase} from 'change-case';
import {Opaque} from 'ts-essentials';

/** Dash-separated string, with optional `.` prefix. */
export type Slug = Opaque<string, 'slug'>;

const slugFirstCharRegexp = /[a-z]/;
const slugPartRegexp = /^[a-z0-9]+$/;

const DEFAULT_MAX_SLUG_LENGTH = 64;

/**
 * Promotes a string to a `Slug` instance, throwing `if the input is not a valid
 * slug.
 */
export function newSlug(arg: string, maxLength?: number): Slug {
  if (!arg?.length) {
    throw defaultErrors.invalid({
      message: `Slug ${arg} is empty or undefined`,
      tags: {arg},
    });
  }
  const length = maxLength ?? DEFAULT_MAX_SLUG_LENGTH;
  if (arg.length > length) {
    throw defaultErrors.invalid({
      message:
        `Slug ${arg} is too long: its length (${arg.length}) is ` +
        `greater than the allowed limit ${length}`,
      tags: {arg},
    });
  }
  const name = arg.startsWith('.') ? arg.slice(1) : arg;
  if (!slugFirstCharRegexp.test(name.charAt(0))) {
    throw defaultErrors.invalid({
      message: `Slug ${arg} does not start with a lower-case ASCII char`,
      tags: {arg},
    });
  }
  const parts = name.split('-');
  if (!parts.every((s) => slugPartRegexp.test(s))) {
    throw defaultErrors.invalid({
      message:
        `Slug ${arg} is not a dash-separated sequence of ` + slugPartRegexp,
      tags: {arg},
    });
  }
  return arg as Slug;
}

/** Checks whether the string is a valid slug. */
export function isSlug(arg: string, maxLength?: number): arg is Slug {
  const length = maxLength ?? DEFAULT_MAX_SLUG_LENGTH;
  if (!arg.length || arg.length > length) {
    return false;
  }
  const name = arg.startsWith('.') ? arg.slice(1) : arg;
  return (
    slugFirstCharRegexp.test(name.charAt(0)) &&
    name.split('-').every((s) => slugPartRegexp.test(s))
  );
}

/** Attempts to transform the string into a valid slug. */
export function slugify(arg: string, maxLength?: number): Slug {
  return newSlug(kebabCase(arg), maxLength);
}

/** Standard UUID. */
export type Uuid = Opaque<string, 'uuid'>;

const uuidRegexp =
  // eslint-disable-next-line max-len
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

/**
 * Promotes a string to a `Uuid` instance, throwing if the input is not a valid
 * UUID.
 */
export function newUuid(arg: string): Uuid {
  if (!isUuid(arg)) {
    throw defaultErrors.invalid({
      message: `${arg} is not a valid UUID`,
      tags: {arg},
    });
  }
  return arg;
}

/** Checks whether the string is a valid UUID. */
export function isUuid(arg: string): arg is Uuid {
  return uuidRegexp.test(arg);
}
