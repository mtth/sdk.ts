import __inlinable from '../../../lib/index.js';

const license = __inlinable((ctx) => {
  const meta = ctx.readJsonFile(ctx.enclosing(import.meta.url).metadataPath());
  return meta.license;
});
