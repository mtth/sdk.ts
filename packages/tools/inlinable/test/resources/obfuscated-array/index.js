import __inline from '../../../lib/index.js';

const foo = 'abc';

export const array = __inline('obfuscate', () => [1, `foo:${foo}`, 3]);
