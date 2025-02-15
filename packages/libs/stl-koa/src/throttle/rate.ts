import * as stl from '@opvious/stl';

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
  stl.assert(match, 'Unexpected throttle rate: %s', s);
  return {
    steady: parsePointSource(match[1]!),
    burst: stl.ifPresent(match[2], (s) => parsePointSource(s.slice(1))),
  };
}

const pointSourcePattern = /^(\d+)\/(\d+)$/;

function parsePointSource(s: string): ThrottlePointSource {
  const match = pointSourcePattern.exec(s);
  stl.assert(match, 'Unexpected point source: %s', s);
  const src: ThrottlePointSource = {
    points: stl.check.isNonNegativeInteger(+match[1]!),
    seconds: stl.check.isNonNegativeInteger(+match[2]!),
  };
  stl.assert(
    src.seconds > 0 === src.points > 0,
    'Points should be 0 iff seconds are'
  );
  return src;
}

export const throttleRateSetting = stl.simpleSettingFactory(throttleRate);
