import {mergeErrorCodes} from '@mtth/stl-errors';

import {errorCodes as patch} from './patch.js';
import {errorCodes as state} from './state.js';

export default mergeErrorCodes({...patch, ...state});
