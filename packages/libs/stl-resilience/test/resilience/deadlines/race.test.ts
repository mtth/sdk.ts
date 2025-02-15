import {fail} from '@mtth/stl-errors';
import {RecordingTelemetry} from '@mtth/stl-telemetry';
import {resolvable} from '@mtth/stl-utils/functions';
import * as otel from '@opentelemetry/api';
import {NodeTracerProvider} from '@opentelemetry/sdk-trace-node';
import {setImmediate, setTimeout} from 'timers/promises';

import {codes, deadlines} from '../../../src/resilience/deadlines/common.js';
import * as sut from '../../../src/resilience/deadlines/race.js';

const provider = new NodeTracerProvider();
provider.register();

describe('simple race', () => {
  test('race called', async () => {
    const p = () => setTimeout(20).then(() => 4);
    const ret = await sut.simpleRace(deadlines.distant(), p).run();
    expect(ret).toBe(4);
  });

  test('race ok', async () => {
    const d = deadlines.create(150);
    const p = () => setTimeout(20).then(() => 4);
    const ret = await sut.simpleRace(d, p).run();
    expect(ret).toBe(4);
  });

  test('race exceeded', async () => {
    const dd = deadlines.create(10);
    try {
      await sut.simpleRace(dd, () => setTimeout(20).then(() => 5)).run();
      fail();
    } catch (err) {
      expect(err.contents.code).toBe(codes.DeadlineExceeded);
    }
  });

  test('race candidate using state', async () => {
    const dd = deadlines.create(10);
    const ret = await sut
      .simpleRace(dd, (rs) => Promise.resolve([rs.isWon(), rs.isLost()]))
      .run();
    expect(ret).toEqual([undefined, undefined]);
  });

  test('on loss callback', async () => {
    const dd = deadlines.create(10);
    const race = sut.simpleRace(dd, () => setTimeout(20).then(() => 5));
    let cause: any = null;
    race.state.onLoss((err) => {
      cause = err;
    });
    try {
      await race.run();
      fail();
    } catch (err) {
      expect(cause).toBe(err);
    }
  });

  test('signal abort', async () => {
    const ac = new AbortController();
    const dd = deadlines.distant();
    const [loss, setLoss] = resolvable<Error>();
    const race = sut.simpleRace(dd, [ac.signal], async (ra) => {
      ra.throwIfLost();
      ac.abort();
      ra.onLoss((err) => setLoss(null, err));
      return 3;
    });
    try {
      await race.run();
      fail();
    } catch (err) {
      expect(err.contents.code).toBe(sut.codes.Aborted);
      const cause = await loss;
      expect(cause).toBe(err);
    }
  });
});

describe('instrumented race', () => {
  const telemetry = RecordingTelemetry.forTesting();

  beforeEach(() => {
    telemetry.reset();
  });

  test('race ok', async () => {
    const ret = await sut
      .instrumentedRace(
        {spanName: 't', telemetry, timeout: 100},
        async (_ra, _span, log) => {
          log.info('Handled.');
          return 48;
        }
      )
      .run();
    expect(ret).toBe(48);

    await telemetry.waitForPendingSpans();
    expect(telemetry.spanRecords).toMatchObject([
      {
        name: 't',
        attributes: {
          'mtth.race.deadline_timeout_ms': expect.any(Number),
          'mtth.race.signal_count': undefined,
        },
        status: {code: otel.SpanStatusCode.OK},
      },
    ]);
  });

  test('race error', async () => {
    const err = new Error('boom');
    try {
      await sut
        .instrumentedRace(
          {spanName: 't', telemetry, timeout: 100},
          async () => {
            throw err;
          }
        )
        .run();
      fail();
    } catch (cause) {
      expect(cause).toBe(err);
    }

    await telemetry.waitForPendingSpans();
    expect(telemetry.spanRecords).toMatchObject([
      {name: 't', status: {code: otel.SpanStatusCode.ERROR}},
    ]);
  });

  test('race aborted', async () => {
    const ac = new AbortController();
    try {
      await sut
        .instrumentedRace(
          {spanName: 't', telemetry, timeout: Infinity, signals: [ac.signal]},
          async () => {
            ac.abort();
            await setTimeout(100);
            throw new Error('boom');
          }
        )
        .run();
      fail();
    } catch (err) {
      expect(err.contents).toMatchObject({code: sut.codes.Aborted});
    }

    await telemetry.waitForPendingSpans();
    expect(telemetry.spanRecords).toMatchObject([
      {
        name: 't',
        status: {code: otel.SpanStatusCode.ERROR},
        exceptions: [{contents: {code: sut.codes.Aborted}}, {message: 'boom'}],
      },
    ]);
  });

  test('throws if lost', async () => {
    try {
      await sut
        .instrumentedRace(
          {spanName: 't', telemetry, timeout: 10},
          async (rs) => {
            expect(rs.lossError).toBeUndefined();
            await setTimeout(100);
            expect(rs.lossError).toBeDefined();
            rs.throwIfLost();
            fail();
          }
        )
        .run();
      fail();
    } catch (err) {
      expect(err.contents).toMatchObject({code: codes.DeadlineExceeded});
    }

    await telemetry.waitForPendingSpans();
    expect(telemetry.spanRecords).toMatchObject([
      {
        name: 't',
        status: {code: otel.SpanStatusCode.ERROR},
        exceptions: [
          {contents: {code: codes.DeadlineExceeded}},
          {code: sut.codes.Abandoned},
        ],
      },
    ]);
  });

  test('rejects if abandoned', async () => {
    const ac = new AbortController();
    expect(sut.activeSignal()).toBeUndefined();
    try {
      await sut
        .instrumentedRace(
          {spanName: 't', telemetry, timeout: Infinity, signals: [ac.signal]},
          async () => {
            expect(sut.activeSignals()).toHaveLength(1);
            expect(sut.activeSignal()).toBeDefined();
            expect(sut.isAbandoned()).toEqual(false);
            ac.abort();
            expect(sut.isAbandoned()).toEqual(true);
            await sut.rejectIfAbandoned();
            fail();
          }
        )
        .run();
      fail();
    } catch (err) {
      expect(err.contents).toMatchObject({code: sut.codes.Aborted});
    }

    await telemetry.waitForPendingSpans();
    expect(telemetry.spanRecords).toMatchObject([
      {
        name: 't',
        status: {code: otel.SpanStatusCode.ERROR},
        exceptions: [
          {contents: {code: sut.codes.Aborted}},
          {code: sut.codes.Abandoned},
        ],
      },
    ]);
  });

  test('already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    let called = false;
    try {
      await sut
        .instrumentedRace(
          {spanName: 't', telemetry, timeout: Infinity, signals: [ac.signal]},
          async () => {
            called = true;
            await setImmediate();
            throw new Error('bang');
          }
        )
        .run();
      fail();
    } catch (err) {
      expect(err.contents).toMatchObject({code: sut.codes.Aborted});
    }
    expect(called).toEqual(true);

    await telemetry.waitForPendingSpans();
    expect(telemetry.spanRecords).toMatchObject([
      {
        name: 't',
        status: {code: otel.SpanStatusCode.ERROR},
        exceptions: [{contents: {code: sut.codes.Aborted}}, {message: 'bang'}],
      },
    ]);
  });

  test('is abandoned', async () => {
    expect(sut.isAbandoned()).toEqual(false);
    const [done, setDone] = resolvable();
    let abandoned: boolean | undefined;
    try {
      await sut
        .instrumentedRace({spanName: 't', telemetry, timeout: 10}, async () => {
          await setTimeout(20);
          abandoned = sut.isAbandoned();
          setDone();
        })
        .run();
      fail();
    } catch (err) {
      expect(err.contents.code).toBe(codes.DeadlineExceeded);
    }
    await done;
    expect(abandoned).toEqual(true);
  });
});
