import __inlinable from 'inlinable';

export const packageInfo = __inlinable((ctx) =>
  ctx.enclosing(import.meta.url).metadata()
);

export enum OtelAttr {
  METHOD = 'http.method',
  URL = 'http.url',
  REQUEST_CONTENT_ENCODING = 'http.request.content_encoding',
  REQUEST_CONTENT_TYPE = 'http.request.content_type',
  REQUEST_LENGTH = 'http.request.length',
  RESPONSE_CONTENT_ENCODING = 'http.response.content_encoding',
  RESPONSE_CONTENT_TYPE = 'http.response.content_type',
  STATUS_CODE = 'http.status_code',
  TARGET = 'http.target',
}

/** Commonly-used endpoint paths. */
export enum StandardEndpoints {
  /** GraphQL API. */
  GRAPHQL = '/graphql',

  /** Healthcheck. */
  HEALTH = '/.health',

  /** Metrics. */
  METRICS = '/.metrics',
}

/**
 * Koa context key under which koa-router stores the matched route (target in
 * OTel parlance).
 */
export const ROUTE_CONTEXT_KEY = '_matchedRoute';

/**
 * Koa context key where the route's name is stored by koa-router if specified.
 * See https://github.com/koajs/router/blob/HEAD/API.md#named-routes for more
 * information.
 */
export const ROUTE_NAME_CONTEXT_KEY = '_matchedRouteName';

export const allHttpMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export enum MimeTypes {
  JSON = 'application/json',
  PLAIN_TEXT = 'text/plain',
}
