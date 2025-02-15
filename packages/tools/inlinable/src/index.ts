import {Inline} from 'inlinable-runtime';

import {registerInlinable} from './inline/index.js';

export type * from 'inlinable-runtime';

/** Marks a function as inlinable. */
const __inline: Inline = registerInlinable;

export default __inline;
