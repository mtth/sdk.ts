import {assert, check} from '@mtth/stl-errors';
import {simpleSettingFactory} from '@mtth/stl-settings';
import {ifPresent} from '@mtth/stl-utils/functions';

export interface ThrottleRate {
  readonly steady: ThrottlePointSource;
  readonly burst?: ThrottlePointSource;
}

export interface ThrottlePointSource {
  readonly points: number;
  readonly seconds: number;
}

const ratePattern = /^(\d+\/\d+)(\+\d+\/\d+)?$/;

export function throttleRate(s: string): ThrottleRate {
  const match = ratePattern.exec(s);
  assert(match, 'Unexpected throttle rate: %s', s);
  return {
    steady: parsePointSource(match[1]!),
    burst: ifPresent(match[2], (s) => parsePointSource(s.slice(1))),
  };
}

const pointSourcePattern = /^(\d+)\/(\d+)$/;

function parsePointSource(s: string): ThrottlePointSource {
  const match = pointSourcePattern.exec(s);
  assert(match, 'Unexpected point source: %s', s);
  const src: ThrottlePointSource = {
    points: check.isNonNegativeInteger(+match[1]!),
    seconds: check.isNonNegativeInteger(+match[2]!),
  };
  assert(
    src.seconds > 0 === src.points > 0,
    'Points should be 0 iff seconds are'
  );
  return src;
}

export const throttleRateSetting = simpleSettingFactory(throttleRate);
