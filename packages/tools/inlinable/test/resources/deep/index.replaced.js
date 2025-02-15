export const withinConstructor = new Date(/* BAZ */ 1234);

function stringify(arg) {
  return "" + arg;
}

const withinFunctionCall = stringify(true);
