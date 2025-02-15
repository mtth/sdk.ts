import {assert} from '@mtth/stl-errors';
import {running} from '@mtth/stl-utils/environment';
import {GlobMapper} from '@mtth/stl-utils/strings';
import {isInlining} from 'inlinable-runtime';
import {Level, levels} from 'pino';

export interface MinLevels {
  readonly fallback: Level | 'silent';
  readonly libraryOverrides?: ReadonlyMap<string, Level>;
}

export type LevelNumber = number;

export const levelNumbers = levels.values as Readonly<
  Record<Level, LevelNumber>
>;

export function levelNumber(lvl: string): number {
  return levelNumbers[checkIsLevel(lvl)];
}

export function checkIsLevel(lvl: string): Level {
  assert(levelNumbers[lvl as Level] !== undefined, 'Unknown log level', lvl);
  return lvl as any;
}

export type LogThresholder = (lib?: string) => number;

export function logThresholder(spec?: string): LogThresholder {
  const fallback = fallbackLevelNumber();
  const overrides = GlobMapper.forSpec(
    spec || process.env.LL || process.env.LOG_LEVEL || '',
    levelNumber
  );
  return (lib?: string): number => {
    return (lib ? overrides.map(lib) : overrides.fallback) ?? fallback;
  };
}

function fallbackLevelNumber(): LevelNumber {
  const lvl = isInlining()
    ? 'error'
    : running.inTest()
      ? process.env.CI
        ? 'error'
        : 'fatal'
      : running.inProduction()
        ? 'info'
        : 'debug';
  return levelNumber(lvl);
}
