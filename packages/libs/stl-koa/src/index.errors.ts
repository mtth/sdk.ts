import {mergeErrorCodes} from '@mtth/stl-errors';

import {errorCodes as codecs} from './codecs.js';
import {errorCodes as streams} from './streams.js';
import throttle from './throttle/index.errors.js';

const codes = mergeErrorCodes({codecs, streams, throttle});

export default codes;
