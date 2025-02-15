/**
 * Utilities for dealing with the original client's IP. The name here is
 * inspired by CloudFlare's headers:
 * https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers
 */

import {check} from '@mtth/stl-errors';
import * as otel from '@opentelemetry/api';
import Koa from 'koa';

export const CONNECTING_IP_HEADER = 'mtth-connecting-ip';

const contextKey = otel.createContextKey(CONNECTING_IP_HEADER);

/** Returns a new context with the connecting IP set */
export function setConnectingIp(
  ctx: otel.Context,
  ip: string | undefined
): otel.Context {
  return ctx.setValue(contextKey, ip);
}

/** Reads the connecting IP from the context */
export function getConnectingIp(ctx?: otel.Context): string | undefined {
  const val = (ctx ?? otel.context.active()).getValue(contextKey) ?? undefined;
  return check.isString.orAbsent(val);
}

/** Reads the connecting IP from Koa's context (via headers) */
export function extractConnectingIp(ctx: Koa.Context): string | undefined {
  return ctx.get(CONNECTING_IP_HEADER) || undefined;
}
