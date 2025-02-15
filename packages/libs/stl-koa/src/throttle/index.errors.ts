import * as stl from '@opvious/stl';
import {DateTime} from 'luxon';

const [errors, errorCodes] = stl.errorFactories({
  definitions: {
    throttled: (retryAfter: DateTime, reason: string, remediation?: string) => {
      const cutoff = DateTime.max(retryAfter, DateTime.now());
      return {
        message:
          `Rate limit exceeded (${reason}). Please ` +
          (stl.ifPresent(remediation, (r) => r + ' or ') ?? '') +
          `retry ${cutoff.toRelative({padding: 1_000})}.`,
        tags: {retryAfter},
      };
    },
  },
});

export {errors};

export interface ThrottledErrorTags extends stl.ErrorTags {
  readonly retryAfter: DateTime;
}

export default errorCodes;
