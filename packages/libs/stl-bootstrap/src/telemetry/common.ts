import {assert} from '@mtth/stl-errors';
import {isExplicitVersion, LibInfo} from '@mtth/stl-telemetry';
import {ProcessEnv} from '@mtth/stl-utils/environment';
import resources from '@opentelemetry/resources';
import {Writable} from 'ts-essentials';

/**
 * Environment variable containing a comma-separated list of attributes for the
 * monitored resource.
 * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/sdk-environment-variables.md
 */
const RESOURCE_ATTRS_EVAR = 'OTEL_RESOURCE_ATTRIBUTES';

const resourceAttrPartPattern = /\s*([^=]+)=(\S+)\s*/;

const appNamePattern = /@([^/]+)\/(.*)/;

/**
 * Parses OTel resource attributes from the environment, filling in service
 * information from the application's info if absent.
 */
export function appResourceAttrs(
  app: LibInfo,
  env: ProcessEnv = process.env
): AppResourceAttrs {
  const partial: Writable<Partial<AppResourceAttrs>> = {};

  // Parse environment
  const str = env[RESOURCE_ATTRS_EVAR] ?? '';
  for (const part of str.split(',')) {
    const match = resourceAttrPartPattern.exec(part);
    if (match?.[1] && match[2]) {
      partial[match[1]] = match[2];
    }
  }

  // Fill-in using the application information if no service in environment
  if (partial['service.name'] == null) {
    const match = appNamePattern.exec(app.name);
    if (match) {
      partial['service.name'] = match[2];
      partial['service.namespace'] = match[1];
    } else {
      partial['service.name'] = app.name;
    }
  }
  assert(partial['service.name'] != null, 'Missing service name');
  const attrs = partial as Writable<AppResourceAttrs>;

  if (appMatchesService(app, attrs) && isExplicitVersion(app.version)) {
    attrs['service.version'] = app.version;
  }
  return attrs;
}

export interface AppResourceAttrs extends resources.ResourceAttributes {
  readonly 'service.name': string;
  readonly 'service.namespace'?: string;
  readonly 'service.version'?: string;
}

/** Checks whether the application matches the service in the resources. */
export function appMatchesService(
  app: LibInfo,
  attrs: AppResourceAttrs
): boolean {
  const match = appNamePattern.exec(app.name);
  if (match) {
    return (
      attrs['service.name'] === match[2] &&
      attrs['service.namespace'] === match[1]
    );
  }
  return attrs['service.name'] === app.name;
}
