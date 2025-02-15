import * as stl from '@opvious/stl';
import rateLimiterFlexible from 'rate-limiter-flexible';
import {Mocked} from 'vitest';

import * as sut from '../../src/throttle/index.js';

vi.mock('rate-limiter-flexible');

const telemetry = stl.RecordingTelemetry.forTesting();

describe('throttle', () => {
  let limiter: Mocked<rateLimiterFlexible.RateLimiterMemory>;

  beforeEach(() => {
    limiter = new rateLimiterFlexible.RateLimiterMemory({}) as any;
    vi.mocked(rateLimiterFlexible.RateLimiterMemory).mockImplementation(
      () => limiter
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('consumes steady points', async () => {
    limiter.consume.mockResolvedValueOnce({} as any);
    const throttle = sut.createThrottle({
      id: 't1',
      rate: sut.throttleRate('1/2'),
      reason: 'too much fun',
      telemetry,
    });
    await throttle.consume('k', {points: 1});
    expect(limiter.consume).toBeCalledTimes(1);
  });

  test('rejects when out', async () => {
    const res: any = new rateLimiterFlexible.RateLimiterRes();
    res.msBeforeNext = 123;
    limiter.consume.mockRejectedValue(res);
    const throttle = sut.createThrottle({
      id: 't1',
      rate: sut.throttleRate('1/2+2/20'),
      reason: 'too much fun',
      telemetry,
    });
    try {
      await throttle.consume('k', {remediation: 'sit down'});
    } catch (err) {
      expect(limiter.consume).toBeCalledTimes(2);
      expect(err.message).toContain('sit down');
    }
    expect.assertions(2);
  });

  test('inactive throttle', async () => {
    const throttle = sut.createThrottle({
      id: 't1',
      rate: sut.throttleRate('0/0'),
      reason: 'too much fun',
      telemetry,
    });
    await throttle.consume('k');
    expect(limiter.consume).not.toBeCalled();
  });
});
