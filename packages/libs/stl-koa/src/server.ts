import * as stl from '@opvious/stl';
import events from 'events';
import getPort, {portNumbers} from 'get-port';
import http from 'http';
import Koa from 'koa';

import {packageInfo} from './common.js';

const HEADERS_TIMEOUT_MS = 0;
const SOCKET_TIMEOUT_MS = 45_000;

type ServerFactory = (fn: http.RequestListener) => http.Server;

const defaultServerFactory: ServerFactory = (fn) => {
  const server = http.createServer(fn);
  server.timeout = SOCKET_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
};

/**
 * A Koa application bound to an HTTP server. When the server is successfully
 * started, the bindable also adds a SIGTERM handler to shut it down gracefully.
 */
export class AppBindable extends stl.Bindable {
  private constructor(
    readonly server: http.Server,
    private readonly telemetry: stl.Telemetry,
    private readonly port: stl.Port | undefined,
    private readonly address: string | undefined,
    opts?: stl.BindableOptions
  ) {
    super(opts);
    server.on('close', () => void this.unbind());
  }

  static create(args: {
    /** Application to start. */
    readonly app: Koa<any, any>;

    /** Underlying telemetry. */
    readonly telemetry: stl.Telemetry;

    /**
     * Defaults to `$APP_PORT` or, if unset:
     *
     * + A random free port within [53050, 53059] in testing environments;
     * + Port 8080 otherwise.
     */
    readonly port?: number;

    /** Defaults to `::`. */
    readonly address?: string;

    /**
     * Server creation function. This can be useful to use an HTTPS server for
     * example. The default factory is an HTTP server with socket timeout set to
     * 45s and header timeout to 0.
     */
    readonly serverFactory?: ServerFactory;

    /** Underlying bindable options. */
    readonly options?: stl.BindableOptions;
  }): AppBindable {
    const newServer = args.serverFactory ?? defaultServerFactory;
    const server = newServer(args.app.callback());
    return new AppBindable(
      server,
      args.telemetry.via(packageInfo),
      args.port,
      args.address,
      args.options
    );
  }

  protected override async bind(): Promise<stl.Host & stl.HasPort> {
    const {logger: log} = this.telemetry;
    log.debug('Starting Koa application...');

    const {server} = this;
    const addr = this.address ?? DEFAULT_APP_ADDRESS;
    const port = this.port ?? (await defaultAppPort());
    const target = stl.Host.from(addr, port);

    process.nextTick(() => void server.listen(port, addr));
    await events.once(server, 'listening');
    log.info(
      {data: {target}},
      'Started Koa application, listening... [port=%s]',
      target.port
    );

    return target;
  }

  protected override onStop(): Promise<void> {
    const {logger: log} = this.telemetry;
    log.debug('Shutting down Koa application...');
    return new Promise((ok, fail) => {
      this.server.close((err) => {
        if (err) {
          fail(err);
          return;
        }
        log.info('Shut down Koa application.');
        ok();
      });
    });
  }
}

export const DEFAULT_APP_PROTOCOL = 'http://';
export const DEFAULT_APP_ADDRESS = '::';
export const DEFAULT_APP_PORT = 8080;
export const APP_PORT_EVAR = 'APP_PORT';

/** Convenience application URL factory method. */
export function appUrl(host: string | stl.Host, opts?: AppUrlOptions): URL {
  const target = stl.Host.from(host, opts?.fallbackPort ?? DEFAULT_APP_PORT);
  const protocol = opts?.protocol ?? DEFAULT_APP_PROTOCOL;
  const endpoint = opts?.endpoint ?? '/';
  return new URL(`${protocol}${target}${endpoint}`);
}

export interface AppUrlOptions {
  /** Defaults to `DEFAULT_APP_PROTOCOL`. */
  readonly protocol?: string;

  /** Defaults to the empty path. */
  readonly endpoint?: string;

  /** Default port if unspecified in the host argument. */
  readonly fallbackPort?: number;
}

/**
 * Returns the value of the `$APP_PORT` evar if set, otherwise a random free
 * port within 5305X if running in tests and 8080 otherwise.
 */
export async function defaultAppPort(): Promise<number> {
  const port = process.env[APP_PORT_EVAR];
  if (port !== undefined) {
    return stl.check.isNonNegativeInteger(+port);
  }
  if (stl.running.inTest()) {
    return getPort({port: portNumbers(...APP_PORT_TEST_RANGE)});
  }
  return DEFAULT_APP_PORT;
}

const APP_PORT_TEST_RANGE = [53050, 53059] as const;
