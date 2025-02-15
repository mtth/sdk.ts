import {RecordingTelemetry} from '@mtth/stl-telemetry';
import {waitForEvent} from '@mtth/stl-utils/events';
import Koa from 'koa';

import * as sut from '../src/index.js';

const telemetry = RecordingTelemetry.forTesting();

test('app bindable', async () => {
  const app = new Koa().use((ctx) => {
    ctx.status = 204;
  });
  const bindable = sut.AppBindable.create({app, telemetry}).start();
  const [target] = await waitForEvent(bindable, 'bound');
  expect(target).toBeDefined();
  bindable.server.close();
});
