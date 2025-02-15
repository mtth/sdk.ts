import {errorFactories, ErrorTags} from '@mtth/stl-errors';
import {ifPresent} from '@mtth/stl-utils/functions';
import {DateTime} from 'luxon';

const [errors, errorCodes] = errorFactories({
  definitions: {
    throttled: (retryAfter: DateTime, reason: string, remediation?: string) => {
      const cutoff = DateTime.max(retryAfter, DateTime.now());
      return {
        message:
          `Rate limit exceeded (${reason}). Please ` +
          (ifPresent(remediation, (r) => r + ' or ') ?? '') +
          `retry ${cutoff.toRelative({padding: 1_000})}.`,
        tags: {retryAfter},
      };
    },
  },
});

export {errors};

export interface ThrottledErrorTags extends ErrorTags {
  readonly retryAfter: DateTime;
}

export default errorCodes;
