import {fail} from '@mtth/stl-errors';
import events from 'events';
import stream from 'stream';
import {setImmediate} from 'timers/promises';

import {fromAsyncIterable} from '../src/collections.js';
import * as sut from '../src/events.js';
import {resolvable} from '../src/functions.js';

interface LogListeners {
  log(msg: string, lvl: number): void;
}

interface OtherListeners {
  other(flag: boolean): void;
}

interface Listeners extends LogListeners, OtherListeners {}

test('handles producer casts', () => {
  // Can't generalize
  const ee = sut.typedEmitter<LogListeners>();
  // @ts-expect-error incompatible listeners
  const _ee2: sut.EventProducer<OtherListeners> = ee;
  // TODO:
  // ts-expect-error partial listeners
  // const _ee3: sut.EventProducer<Listeners> = ee;

  // Can specialize
  const ee4 = sut.typedEmitter<Listeners>();
  const _ee5: sut.EventProducer<LogListeners> = ee4;
});

describe('yield events', () => {
  test('ok listener', async () => {
    const ee = sut.typedEmitter<Listeners>();
    const got: any[] = [];
    const ac = new AbortController();

    async function read() {
      for await (const [msg, lvl] of sut.yieldEvents(ee, 'log', ac)) {
        got.push({msg, lvl});
      }
    }

    async function write() {
      ee.emit('log', 'abc', 2);
      await setImmediate();
      ee.emit('log', 'def', 1);
      await setImmediate();
      ac.abort();
      ee.emit('log', 'ghi', 3);
    }

    await Promise.all([read(), write()]);
    expect(got).toEqual([
      {msg: 'abc', lvl: 2},
      {msg: 'def', lvl: 1},
    ]);
  });

  test('ok consumer', async () => {
    const ee = sut.typedEmitter<Listeners>();
    const got: any[] = [];
    const ac = new AbortController();

    async function read() {
      const c: sut.EventConsumer<Listeners> = ee;
      for await (const [msg, lvl] of sut.yieldEvents(c, 'log', ac)) {
        got.push({msg, lvl});
      }
    }

    async function write() {
      ee.emit('log', 'abc', 2);
      await setImmediate();
      ee.emit('log', 'def', 1);
      await setImmediate();
      ac.abort();
      ee.emit('log', 'ghi', 3);
    }

    await Promise.all([read(), write()]);
    expect(got).toEqual([
      {msg: 'abc', lvl: 2},
      {msg: 'def', lvl: 1},
    ]);
  });

  test('error', async () => {
    const ee = sut.typedEmitter<Listeners>();

    const got: any[] = [];
    async function read() {
      for await (const [msg, lvl] of sut.yieldEvents(ee, 'log')) {
        got.push({msg, lvl});
      }
    }

    async function write() {
      ee.emit('log', 'abc', 2);
      await setImmediate();
      ee.emit('error', new Error('boom'));
    }

    try {
      await Promise.all([read(), write()]);
      fail();
    } catch (err) {
      expect(err.message).toBe('boom');
    }
    expect(got).toEqual([{msg: 'abc', lvl: 2}]);
  });

  test('until', async () => {
    const ee = sut.typedEmitter<Listeners>();

    const got: any[] = [];
    async function read() {
      for await (const [msg, lvl] of sut.yieldEvents(ee, 'log', {
        until: ['other'],
      })) {
        got.push({msg, lvl});
      }
    }

    async function write() {
      ee.emit('log', 'abc', 2);
      await setImmediate();
      ee.emit('other', true);
      ee.emit('log', 'def', 1);
    }

    await Promise.all([read(), write()]);
    expect(got).toEqual([{msg: 'abc', lvl: 2}]);
  });
});

describe('with emitter', () => {
  test('stream', async () => {
    const readable = sut.withEmitter(new stream.PassThrough(), (pt) => {
      pt.write('hi');
      pt.end('there');
    });
    const bufs = await fromAsyncIterable(readable);
    expect(Buffer.concat(bufs).toString()).toEqual('hithere');
  });
});

describe('with typed emitter', () => {
  test('simple', async () => {
    interface SimpleListeners {
      count(value: number): void;
    }

    const ee = sut.withTypedEmitter<SimpleListeners>((ee) => {
      ee.emit('count', 123);
    });
    const args = await events.once(ee, 'count');
    expect(args).toEqual([123]);
  });

  test('custom error', async () => {
    interface CustomListeners {
      done(): void;
      error(err: unknown, ctx: string): void;
    }

    const ee = sut.withTypedEmitter<CustomListeners>((ee) => {
      ee.emit('error', new Error('boom'), 'abc');
    });

    const [ctx, setCtx] = resolvable<string>();
    ee.on('error', (_err, ctx_) => {
      setCtx(null, ctx_);
    });

    expect(await ctx).toEqual('abc');
  });

  test('setup sync error', async () => {
    const ee = sut.withTypedEmitter(() => {
      throw new Error('boom');
    });

    const [done, isDone] = resolvable();
    ee.on('error', (err) => {
      expect(err).toMatchObject({message: 'boom'});
      isDone();
    });
    await done;
  });

  test('setup async error', async () => {
    const ee = sut.withTypedEmitter(async () => {
      await setImmediate();
      throw new Error('boom');
    });

    const [done, isDone] = resolvable();
    ee.on('error', (err) => {
      expect(err).toMatchObject({message: 'boom'});
      isDone();
    });

    await done;
  });
});

describe('map events', () => {
  interface Listeners {
    foo(): void;
    bar(arg: boolean): void;
    baz(arg1: number, arg2: number): void;
  }

  test('ok', async () => {
    const ee = sut.typedEmitter<Listeners>();
    const iter = sut.mapEvents<Listeners, string>(ee, (exit) => ({
      foo: () => 'foo',
      bar: (arg) => {
        if (arg) {
          exit();
        }
        return 'end';
      },
      baz: (arg1, arg2) => `${arg1} ${arg2}`,
    }));
    process.nextTick(async () => {
      ee.emit('foo');
      await setImmediate();
      ee.emit('baz', 1, 2);
      await setImmediate();
      ee.emit('foo');
      await setImmediate();
      ee.emit('bar', true);
    });

    const vals = [...(await fromAsyncIterable(iter))];
    expect(vals).toEqual(['foo', '1 2', 'foo', 'end']);
  });

  test('ok single tick', async () => {
    const ee = sut.typedEmitter<Listeners>();
    const iter = sut.mapEvents<Listeners, string>(ee, (exit) => ({
      foo: () => 'foo',
      bar: (arg) => {
        if (arg) {
          exit();
        }
        return 'end';
      },
      baz: (arg1, arg2) => `${arg1} ${arg2}`,
    }));
    process.nextTick(async () => {
      ee.emit('foo');
      ee.emit('baz', 1, 2);
      ee.emit('foo');
      ee.emit('bar', true);
      ee.emit('foo');
    });

    const vals = [...(await fromAsyncIterable(iter))];
    expect(vals).toEqual(['foo', '1 2', 'foo', 'end']);
  });

  test('handles async mapper error', async () => {
    const ee = sut.typedEmitter<Listeners>();
    const iter = sut.mapEvents<Listeners, string>(ee, () => ({
      foo: () => 'foo',
      bar: async () => {
        await setImmediate();
        throw new Error('boom');
      },
    }));
    process.nextTick(async () => {
      ee.emit('foo');
      ee.emit('bar', true);
    });

    const got: string[] = [];
    try {
      for await (const str of iter) {
        got.push(str);
      }
      fail();
    } catch (err) {
      expect(err.message).toEqual('boom');
    }
    expect(got).toEqual(['foo']);
  });

  test('handles consumer error', async () => {
    const ee = sut.typedEmitter<Listeners>();
    const iter = sut.mapEvents<Listeners, string>(ee, () => ({
      foo: () => 'foo',
    }));
    process.nextTick(async () => {
      ee.emit('foo');
      ee.emit('error', new Error('bang'));
      ee.emit('foo');
    });

    const got: string[] = [];
    try {
      for await (const str of iter) {
        got.push(str);
      }
      fail();
    } catch (err) {
      expect(err.message).toEqual('bang');
    }
    expect(got).toEqual(['foo']);
  });
});

describe('wait for event', () => {
  interface Listeners {
    foo(): void;
    bar(arg: boolean): void;
    baz(arg1: number, arg2: number): void;
  }

  test('ok', async () => {
    const ee = sut.withTypedEmitter<Listeners>((ee) => {
      ee.emit('foo');
      ee.emit('baz', 1, 2);
    });
    const [n1, n2] = await sut.waitForEvent(ee, 'baz');
    expect(n1).toEqual(1);
    expect(n2).toEqual(2);
  });

  test('error', async () => {
    const ee = sut.withTypedEmitter<Listeners>(() => {
      throw new Error('boom');
    });
    try {
      await sut.waitForEvent(ee, 'foo');
      fail();
    } catch (err) {
      expect(err).toMatchObject({message: 'boom'});
    }
  });
});
