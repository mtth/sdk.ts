import {mergeErrorCodes} from '@mtth/stl-errors';

import {codes as commonErrorCodes} from './common.js';
import {codes as raceErrorCodes} from './race.js';

export {
  Deadline,
  DeadlineCleanup,
  DeadlineExceededError,
  deadlines,
  isInDistantFuture,
  TimeoutLike,
} from './common.js';
export {
  AbortedError,
  activeDeadline,
  activeSignal,
  activeSignals,
  instrumentedRace,
  InstrumentedRaceParams,
  isAbandoned,
  Race,
  RaceEvents,
  RaceLossError,
  raceLossErrorCodes,
  RaceState,
  RaceStatus,
  rejectIfAbandoned,
  throwIfAbandoned,
} from './race.js';

export const deadlinesErrorCodes = mergeErrorCodes({
  ...commonErrorCodes,
  ...raceErrorCodes,
});
