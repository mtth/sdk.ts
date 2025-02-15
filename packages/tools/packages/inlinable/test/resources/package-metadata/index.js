import __inline from '../../../lib/index.js';

const license = __inline((ctx) => {
  const meta = ctx.readJsonFile(ctx.enclosing(import.meta.url).metadataPath());
  return meta.license;
});
