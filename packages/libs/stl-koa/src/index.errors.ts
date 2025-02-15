import * as stl from '@opvious/stl';

import {errorCodes as codecs} from './codecs.js';
import {errorCodes as streams} from './streams.js';
import throttle from './throttle/index.errors.js';

const codes = stl.mergeErrorCodes({codecs, streams, throttle});

export default codes;
