import __deep from '../../../lib/index.js';

export const withinConstructor = new Date(/* BAZ */ __deep(/*BAR*/ () => /*FOO*/ 1234));

function stringify(arg) {
  return '' + arg;
}

const withinFunctionCall = stringify(__deep(() => true));
