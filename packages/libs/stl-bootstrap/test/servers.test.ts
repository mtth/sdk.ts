import {RecordingTelemetry} from '@mtth/stl-telemetry';
import {Bindable, HasPort, Host} from '@mtth/stl-utils/bindable';
import {ProcessEnv} from '@mtth/stl-utils/environment';
import {resolvable} from '@mtth/stl-utils/functions';
import events from 'events';

import {packageInfo} from '../src/common.js';
import * as sut from '../src/servers.js';

const telemetry = RecordingTelemetry.forTesting(packageInfo, 'debug');

class SleepingBindable extends Bindable {
  private timeout: NodeJS.Timeout | undefined;
  constructor(private readonly millis: number) {
    super({emitProcessEvents: false});
  }

  protected override async bind(): Promise<Host & HasPort> {
    this.timeout = setTimeout(() => void this.stop(), this.millis);
    return Host.from('localhost', 4848);
  }

  protected override async onStop(): Promise<void> {
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }
}

interface Config {
  millis: number;
}

function configure(env?: ProcessEnv): Config {
  return {millis: +(env?.MILLIS ?? '10000')};
}

interface Bindables {
  readonly single: SleepingBindable;
  readonly triple: SleepingBindable;
}

function initialize(cfg: Config): Bindables {
  return {
    single: new SleepingBindable(cfg.millis),
    triple: new SleepingBindable(3 * cfg.millis),
  };
}

class SignalHandler extends events.EventEmitter {
  constructor(private readonly onExit?: (code?: number) => void) {
    super();
  }

  exit(code?: number): void {
    this.onExit?.(code);
  }
}

describe('bindables runner', () => {
  test('shuts down after all stop', async () => {
    const run = sut.bindablesRunner({configure, initialize, telemetry});
    await run({MILLIS: '10'});
  });

  describe('shuts down after signal', async () => {
    const handler = new SignalHandler();
    const run = sut.bindablesRunner({
      configure,
      initialize,
      telemetry,
      signalHandler: handler,
    });

    test.each(['SIGINT', 'SIGTERM'])('%s', async (sig) => {
      setTimeout(() => void handler.emit(sig), 100);
      await run();
    });
  });

  test('exits down after second sigint', async () => {
    const [exited, setExited] = resolvable();
    const handler = new SignalHandler((code) => {
      expect(code).toEqual(130);
      setExited();
    });
    const run = sut.bindablesRunner({
      configure,
      initialize,
      telemetry,
      shutdown: () => exited,
      signalHandler: handler,
    });
    setImmediate(() => {
      handler.emit('SIGINT');
      setImmediate(() => void handler.emit('SIGINT'));
    });
    await run();
    expect.assertions(1);
  });
});
