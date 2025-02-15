import {assert} from '@mtth/stl-errors';
import events from 'events';
import http from 'http';

import * as sut from '../src/bindable.js';
import {waitForEvent} from '../src/events.js';

describe('host', () => {
  test.each([
    ['my-host', undefined, {name: 'my-host'}],
    ['my-host', 555, {name: 'my-host', port: 555}],
    ['localhost:111', undefined, {name: 'localhost', port: 111}],
    ['localhost:111', 22, {name: 'localhost', port: 111}],
    ['::', undefined, {name: '[::]'}],
    ['::', 33, {name: '[::]', port: 33}],
    ['[::]:50051', undefined, {name: '[::]', port: 50051}],
    ['[::]:50051', 111, {name: '[::]', port: 50051}],
    [{name: '[::]', port: 50}, undefined, {name: '[::]', port: 50}],
    [{name: '[::]', port: 50}, 22, {name: '[::]', port: 50}],
    [{name: '[::]'}, 22, {name: '[::]', port: 22}],
  ])('parses %s (%s) to %j', (arg, port, want) => {
    expect(sut.Host.from(arg, port)).toEqual(want);
  });

  test('rejects invalid', () => {
    try {
      sut.Host.from(':12');
    } catch (err) {
      expect(err).toMatchObject({code: 'ERR_INVALID'});
    }
    expect.assertions(1);
  });

  test('serializes', () => {
    expect(sut.Host.from('abc', 80).toString()).toEqual('abc:80');
  });
});

describe('server bindable target', () => {
  test('bound server URL', async () => {
    const server = http.createServer();
    server.listen();
    await events.on(server, 'listen');
    const host = sut.serverHost(server);
    expect(host).toMatchObject({
      name: expect.any(String),
      port: expect.any(Number),
    });
    server.close();
  });

  test('unbound server URL', () => {
    const server = http.createServer();
    expect(sut.serverHost(server)).toBeUndefined();
  });
});

class SleepingBindable extends sut.Bindable {
  private timeout: NodeJS.Timeout | undefined;
  constructor(private readonly millis: number) {
    super();
  }

  protected override async bind(): Promise<sut.Host & sut.HasPort> {
    this.timeout = setTimeout(() => void this.stop(), this.millis);
    return sut.Host.from('localhost', 4848);
  }

  protected override async onStop(): Promise<void> {
    assert(this.timeout, 'Missing timeout');
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }
}

describe('bindable', () => {
  test('lifecycle', async () => {
    const bindable = new SleepingBindable(5_000);
    bindable.start();
    setImmediate(() => void bindable.stop());
    await waitForEvent(bindable, 'unbound');
  });

  test('is bindable', () => {
    const bindable = new SleepingBindable(1_000);
    expect(bindable instanceof sut.Bindable).toBe(true);
  });
});
