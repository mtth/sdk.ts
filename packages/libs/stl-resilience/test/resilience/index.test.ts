import {assert, errorCodes, defaultErrors, fail} from '@mtth/stl-errors';
import {settingsProvider} from '@mtth/stl-settings';
import {RecordingTelemetry} from '@mtth/stl-telemetry';
import {resolvable} from '@mtth/stl-utils/functions';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {Duration} from 'luxon';
import {setTimeout} from 'timers/promises';

import * as sut from '../../src/resilience/index.js';

const provider = new NodeTracerProvider();
provider.register();

const telemetry = RecordingTelemetry.forTesting();

describe('resilience', () => {
  beforeEach(() => {
    telemetry.reset();
  });

  test('ok', async () => {
    const ret = await sut.resilient('test', async () => 3).run({telemetry});
    expect(ret).toBe(3);
  });

  test('retry ok', async () => {
    const errs: string[] = [];
    let n = 0;
    const ret = await sut
      .resilient(
        't',
        {retryCount: 5, initialBackoff: 5, asymptoticBackoff: 100},
        run
      )
      .retrying((err: any, seqno: any) => {
        errs.push(err.message + seqno);
        return true;
      })
      .run({telemetry});
    expect(errs).toEqual(['boom1', 'boom2']);
    expect(ret).toBe(2);

    async function run(): Promise<number> {
      if (n < 2) {
        n++;
        throw new Error('boom');
      }
      return n;
    }
  });

  test('retry false predicate', async () => {
    let called = false;
    try {
      await sut
        .resilient('t', {retryCount: 5}, run)
        .retrying(() => false)
        .run({telemetry});
      fail();
    } catch (err) {
      expect(err.code).toBe(errorCodes.Illegal);
      expect(called).toBe(true);
    }

    async function run(): Promise<number> {
      assert(!called, 'Already run');
      called = true;
      throw defaultErrors.illegal();
    }
  });

  test('attempt timeout', async () => {
    let called = false;
    const [res, cb] = resolvable<number>();
    const ret = await sut
      .resilient(
        't',
        {attemptTimeout: 20, initialBackoff: 5, retryCount: 3},
        run
      )
      .on('lateAttemptValue', (val, seqno, delay) => {
        expect(seqno).toBe(1);
        expect(delay).toBeInstanceOf(Duration);
        cb(null, val);
      })
      .run({telemetry});
    expect(ret).toBe(2);
    expect(await res).toEqual(4);

    async function run(): Promise<number> {
      if (!called) {
        called = true;
        return setTimeout(50).then(() => 4);
      }
      return 2;
    }
  });

  test('emits retry events', async () => {
    const msgs: string[] = [];
    try {
      await sut
        .resilient(
          't',
          {attemptTimeout: 50, initialBackoff: 5, retryCount: 2},
          run
        )
        .retrying(() => true)
        .on('retry', (err: any, seqno) => {
          msgs.push(err.message + seqno);
        })
        .run({telemetry});
      fail();
    } catch (err) {
      expect(err.message).toBe('boom');
    }
    expect(msgs).toEqual(['boom1', 'boom2']);

    async function run(): Promise<string> {
      throw new Error('boom');
    }
  });

  test('emits late errors', async () => {
    const msgs: string[] = [];
    const [res, cb] = resolvable();
    try {
      await sut
        .resilient(
          't',
          {attemptTimeout: 10, initialBackoff: 5, retryCount: 1},
          run
        )
        .on('lateAttemptError', (err: any, seqno, delay) => {
          expect(typeof seqno).toEqual('number');
          expect(delay).toBeInstanceOf(Duration);
          msgs.push(err.message);
          if (msgs.length === 2) {
            cb(null);
          }
        })
        .retryingCodes(sut.deadlinesErrorCodes.DeadlineExceeded)
        .run({telemetry});
      fail();
    } catch (err) {
      expect(err.contents.code).toBe(sut.resilienceErrorCodes.DeadlineExceeded);
    }
    await res;
    expect(msgs).toEqual(['boom', 'boom']);

    async function run(): Promise<string> {
      return setTimeout(30).then(async () => {
        const err: any = new Error('boom');
        err.code = 'ERR_FOO';
        throw err;
      });
    }
  });

  test('stops retrying when signal is aborted', async () => {
    const ac = new AbortController();
    try {
      await sut
        .resilient('t', {retryCount: 2}, run)
        .retrying(() => true)
        .run({telemetry, signals: [ac.signal]});
      fail();
    } catch (err) {
      expect(err.contents.code).toBe(sut.resilienceErrorCodes.Aborted);
    }

    async function run(): Promise<number> {
      ac.abort();
      await setTimeout(10);
      throw new Error('boom');
    }
  });

  test('retries non errors', async () => {
    let called = false;
    const ret = await sut
      .resilient('t', {retryCount: 1}, run)
      .retrying((err) => err === 'bang')
      .run({telemetry});
    expect(ret).toBe(1);

    async function run(): Promise<number> {
      if (!called) {
        called = true;
        // eslint-disable-next-line no-throw-literal
        throw 'bang';
      }
      return 1;
    }
  });

  test('setting', () => {
    const settings = settingsProvider((env) => sut.resilienceSetting(env));
    expect(settings({BACKOFF_FACTOR: '3', RETRY_COUNT: '5'})).toEqual({
      backoffFactor: 3,
      retryCount: 5,
    });
  });
});
