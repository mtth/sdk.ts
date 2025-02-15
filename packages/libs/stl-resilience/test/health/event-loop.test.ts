import {assert} from '@mtth/stl-errors';
import {RecordingTelemetry} from '@mtth/stl-telemetry';
import {Duration} from 'luxon';
import {setTimeout} from 'timers/promises';

import {packageInfo} from '../../src/common';
import * as sut from '../../src/health/event-loop';

const telemetry = RecordingTelemetry.forTesting(
  packageInfo,
  `silent,${packageInfo.name}=trace`
);

afterEach(() => {
  telemetry.reset();
});

describe('delay health check', () => {
  test('logs delays', async () => {
    const [check, ...rest] = sut.eventLoopHealthChecks({
      telemetry,
      pollInterval: Duration.fromMillis(25),
    });
    assert(
      check instanceof sut.EventLoopDelayHealthCheck && !rest.length,
      'unexpected checks'
    );
    await setTimeout(100);
    const records = telemetry.logRecords;
    expect(records[0]).toMatchObject({
      data: {delay: expect.any(Number)},
    });
    check.stop();
  });
});
