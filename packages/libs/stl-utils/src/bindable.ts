import {assert, check, errors} from '@mtth/stl-errors';
import http from 'http';
import net from 'net';

import {TypedEmitter, waitForEvent, withEmitter} from './events.js';
import {resolvable} from './functions.js';

export type Port = number;

export class Host {
  private constructor(
    /** Hosname, if IPv6, it will be bracketed. */
    readonly name: string,
    /** Explicit port, if any. */
    readonly port?: Port
  ) {}

  /**
   * Parses a host from a string or host instance, optionally adding a default
   * port if it was missing.
   */
  static from(arg: string | Host, defaultPort: Port): Host & HasPort;
  static from(arg: string | Host, defaultPort?: Port): Host;
  static from(arg: string | Host, defaultPort?: Port): Host {
    if (typeof arg != 'string') {
      return new Host(arg.name, arg.port ?? defaultPort);
    }
    if (net.isIPv6(arg)) {
      arg = `[${arg}]`;
    }
    let base;
    try {
      base = new URL(PLACEHOLDER_PROTOCOL + arg);
    } catch (cause) {
      throw errors.invalid({
        message: `Invalid service host: ${arg}`,
        tags: {arg},
        cause,
      });
    }
    const {hostname, port} = base;
    return new Host(hostname, port ? +port : defaultPort);
  }

  toString(): string {
    const {name, port} = this;
    return port == null ? name : `${name}:${port}`;
  }
}

export interface HasPort {
  readonly port: Port;
}

const PLACEHOLDER_PROTOCOL = 'http://';

/**
 * Returns the (string-formatted) address to which the server is bound,
 * or nothing if the server is not listening. HTTP protocol is assumed.
 */
export function serverHost(server: http.Server): Host | undefined {
  const addr = server.address();
  if (!addr) {
    return undefined;
  }
  if (typeof addr == 'string') {
    return Host.from(addr);
  }
  const {address: hostname, port} = addr;
  return Host.from(hostname, port);
}

export interface BindableListeners {
  /** Emitted when the bindable was successfully bound to a given port. */
  bound(host: Host): void;

  /** Emitted when the bindable was unbound. */
  unbound(): void;
}

export type BindableStatus =
  | 'unbound'
  | 'binding'
  | 'bound'
  | 'unbinding'
  | 'error';

const isBindableMarker = '@mtth/stl-utils/bindable:isBindable+v1' as const;

export interface BindableOptions {
  /**
   * Emit events using process.send. Currently, the following events are
   * supported:
   *
   * * bindableBound, when the bindable is successfully bound.
   */
  readonly emitProcessEvents?: boolean;
}

export abstract class Bindable extends TypedEmitter<BindableListeners> {
  static override [Symbol.hasInstance](val: unknown): val is Bindable {
    return !!val && typeof val == 'object' && isBindableMarker in val;
  }

  private readonly [isBindableMarker]!: true;
  private readonly sendProcessEvent: typeof process.send;
  private status: BindableStatus = 'unbound';
  private activeHost: Promise<Host & HasPort> | undefined;
  protected constructor(opts?: BindableOptions) {
    super();
    Object.defineProperty(this, isBindableMarker, {value: true});
    this.sendProcessEvent = opts?.emitProcessEvents
      ? check.isPresent(process.send)
      : undefined;
  }

  /** Returns the host to bind to. Called internally by `start`. */
  protected abstract bind(): Promise<Host & HasPort>;

  private updateStatus(next: BindableStatus, prev?: BindableStatus): void {
    if (prev != null) {
      assert(this.status === prev, 'Unexpected status: %s', this.status);
    }
    this.status = next;
  }

  /** Resolves to the current host, throwing if unbound. */
  async host(): Promise<Host & HasPort> {
    assert(this.activeHost, 'Bindable is not bound or binding');
    return this.activeHost;
  }

  /**
   * Start listening The new host is available via the `'bound'` event and the
   * `host` method.
   */
  start(): this {
    this.updateStatus('binding', 'unbound');

    const [activeHost, setActiveHost] = resolvable<Host & HasPort>();
    this.activeHost = activeHost;

    withEmitter(this, async () => {
      let host: Host & HasPort;
      try {
        host = await this.bind();
      } catch (err) {
        this.updateStatus('error');
        this.activeHost = undefined;
        throw err;
      }
      setActiveHost(null, host);
      this.updateStatus('bound', 'binding');
      this.emit('bound', host);
      this.sendProcessEvent?.({
        event: 'bindableBound',
        port: host.port,
        address: host.name,
      });
    });

    return this;
  }

  /**
   * Stops listening. Safe to call multiple times. If the bindable is currently
   * binding it will be stopped right after it is bound. The returned promise
   * resolves when the bindable is unbound or immediately if it is not currently
   * bound.
   */
  async stop(): Promise<void> {
    const promise = this.activeHost;
    if (!promise) {
      return;
    }
    const host = await promise;
    if (this.status !== 'bound') {
      return;
    }
    this.updateStatus('unbinding');
    try {
      await this.onStop(host);
    } catch (err) {
      this.updateStatus('error');
      process.nextTick(() => void this.emit('error', err));
      return;
    }
    this.unbind();
  }

  /**
   * Unbinds a bindable. The promise should resolve when the host is not bound
   * to anymore. This function is guaranteed to be called only when a host is
   * currently bound (and at most once per binding).
   */
  protected abstract onStop(host: Host & HasPort): Promise<void>;

  /**
   * Marks the bindable as unbound. This can be useful when the underlying
   * server may become unbound from external sources.
   */
  protected unbind(): void {
    if (this.status === 'unbound') {
      return;
    }
    this.updateStatus('unbound');
    this.activeHost = undefined;
    process.nextTick(() => void this.emit('unbound'));
  }

  /** Starts the bindable then waits until it is unbound. */
  async run(): Promise<void> {
    await waitForEvent(this.start(), 'unbound');
  }
}
