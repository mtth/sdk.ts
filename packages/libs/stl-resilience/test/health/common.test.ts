import {RecordingTelemetry} from '@mtth/stl-telemetry';

import * as sut from '../../src/health/common';

const telemetry = RecordingTelemetry.forTesting();

describe('health status merging', () => {
  test.each<[sut.HealthStatus, sut.HealthStatus, sut.HealthStatus]>([
    ['pass', 'pass', 'pass'],
    ['pass', 'fail', 'fail'],
    ['warn', 'pass', 'warn'],
    ['warn', 'warn', 'warn'],
    ['fail', 'warn', 'fail'],
  ])('%s + %s => %s', (arg1, arg2, want) => {
    expect(sut.mergeHealthStatuses(arg1, arg2)).toEqual(want);
  });
});

describe('health reporter', () => {
  test('generates OK report', () => {
    const reporter = sut.HealthReporter.create({
      telemetry,
      checks: [
        {
          component: 'abc',
          measurement: 'm',
          observe: () => ({status: 'pass'}),
        },
      ],
    });
    expect(reporter.report()).toEqual({
      status: 'pass',
      checks: {
        'abc:m': [{component: 'abc', measurement: 'm', status: 'pass'}],
      },
    });
  });
});
