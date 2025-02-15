import {assert, errorFactories} from '@mtth/stl-errors';
import {Telemetry} from '@mtth/stl-telemetry';
import {Bindable} from '@mtth/stl-utils/bindable';
import {ProcessEnv} from '@mtth/stl-utils/environment';
import {EventConsumer} from '@mtth/stl-utils/events';
import {AsyncOrSync} from 'ts-essentials';

import {packageInfo} from './common.js';

const [errors, errorCodes] = errorFactories({
  definitions: {
    initializationFailed: (cause: unknown) => ({
      message: 'Bindables could not be initialized',
      cause,
    }),
    runFailed: (cause: unknown, bindables: ReadonlyMap<string, Bindable>) => ({
      message: 'Bindable errored while running',
      tags: {bindables},
      cause,
    }),
  },
  prefix: 'ERR_BINDABLE_',
});

export {errorCodes};

/**
 * Returns a function which runs all the `Bindable` properties of the
 * initialized object. The function also adds SIGTERM and SIGINT handlers which
 * will stop the bindables then shutdown.
 */
export function bindablesRunner<C, B = object>(args: {
  /** Creates the configuration for the input environment */
  readonly configure: (env?: ProcessEnv) => AsyncOrSync<C>;
  /** Inializes all bindables from the configuration */
  readonly initialize: (cfg: C) => AsyncOrSync<B>;
  /** Shutdown hook, called after all bindables are unbound or one errored */
  readonly shutdown?: (cfg: C) => AsyncOrSync<void>;
  /** Telemetry instance */
  readonly telemetry: Telemetry;
  /** Signal handler, mostly useful for testing. Defaults to `process` */
  readonly signalHandler?: SignalHandler;
}): (env?: NodeJS.ProcessEnv) => Promise<void> {
  const {configure, initialize, shutdown} = args;
  const {logger: log} = args.telemetry.via(packageInfo);
  const handler: SignalHandler = args.signalHandler ?? process;

  return async (env) => {
    const config = await configure(env);
    const bindables = new Map<string, Bindable>();

    let stopping = false;
    function stop(): void {
      stopping = true;
      for (const b of bindables.values()) {
        b.stop();
      }
    }

    handler.on('SIGTERM', onSigterm);
    function onSigterm(): void {
      log.info('Received SIGTERM, initializing shutdown...');
      stop();
    }

    handler.on('SIGINT', onSigint);
    function onSigint(): void {
      if (stopping) {
        log.fatal('Received SIGINT during shutdown, terminating process...');
        handler.exit(130);
      } else {
        log.info('Received SIGINT, initializing shutdown...');
        stop();
      }
    }

    async function cleanup(): Promise<void> {
      try {
        await shutdown?.(config);
      } catch (err) {
        log.error({err}, 'Shutdown errored.');
      } finally {
        handler.removeListener('SIGTERM', onSigterm);
        handler.removeListener('SIGINT', onSigint);
      }
    }

    let initialized: any;
    try {
      initialized = await initialize(config);
    } catch (err) {
      await cleanup();
      throw errors.initializationFailed(err);
    }
    for (const [key, val] of Object.entries(initialized)) {
      if (val instanceof Bindable) {
        bindables.set(key, val);
      }
    }
    assert(bindables.size, 'No bindables found');
    log.debug(
      {data: {keys: [...bindables.keys()]}},
      'Initialized %s bindable(s).',
      bindables.size
    );

    try {
      await Promise.all([...bindables.values()].map((b) => b.run()));
      log.debug(
        'All %s bindable(s) are unbound; shutting down...',
        bindables.size
      );
    } catch (err) {
      stop();
      throw errors.runFailed(err, bindables);
    } finally {
      await cleanup();
    }
    log.info('Shutdown complete.');
  };
}

interface SignalListeners {
  SIGINT(): void;
  SIGTERM(): void;
}

interface SignalHandler extends EventConsumer<SignalListeners> {
  exit(code: number): void;
}
