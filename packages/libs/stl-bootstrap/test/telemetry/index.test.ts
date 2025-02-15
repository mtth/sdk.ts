import {Telemetry} from '@mtth/stl-telemetry';

import * as sut from '../../src/telemetry/index.js';

test('app telemetry', () => {
  // Not a great test...
  const tel: Telemetry = sut.appTelemetry({name: 'test'});
  expect(tel.logger).toBeDefined();
  expect(tel.via({name: 'test'})).toBeDefined();
});

test('enable context propagation', async () => {
  sut.enableContextPropagation();
  expect(global.__contextPropagationEnabled).toBe(true);
});
