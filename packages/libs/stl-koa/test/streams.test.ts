import * as stl from '@opvious/stl';
import Koa from 'koa';
import stream from 'stream';
import request from 'supertest';
import util from 'util';

import {setup} from '../src/setup/index.js';
import * as sut from '../src/streams.js';

const finished = util.promisify(stream.finished);

const telemetry = stl.noopTelemetry();

function into(arr: unknown[]): stream.Writable {
  return new stream.Writable({
    objectMode: true,
    write(chunk, _encoding, cb): void {
      arr.push(chunk);
      cb();
    },
  });
}

describe('stream request', () => {
  let app: Koa;

  beforeEach(() => {
    app = new Koa().use(setup({telemetry}));
  });

  test('streams ok', async () => {
    const buf = Buffer.from('hello');
    const bufs: Buffer[] = [];
    const writable = into(bufs);
    app.use(async (ctx) => {
      sut.streamRequest(ctx, writable);
      await finished(writable);
      ctx.status = 204;
    });
    await request(app.callback()).post('/').send(buf);
    expect(Buffer.concat(bufs)).toEqual(buf);
  });
});

describe('stream response', () => {
  let app: Koa;

  beforeEach(() => {
    app = new Koa();
  });

  test('streams ok', async () => {
    const buf = Buffer.from('hello');
    app.use(async (ctx) => {
      sut.streamResponse(ctx, stream.Readable.from([buf]));
    });
    const res = await request(app.callback()).get('/').responseType('blob');
    expect(res.body).toEqual(buf);
  });

  test('aborts on stream error', async () => {
    let called = false;
    app.use(async (ctx) => {
      const duplex = new stream.PassThrough().on('error', () => {
        called = true;
      });
      sut.streamResponse(ctx, duplex, telemetry);
      process.nextTick(() => {
        duplex.emit('error', new Error('boom'));
      });
    });
    try {
      await request(app.callback()).get('/').responseType('blob');
      stl.fail();
    } catch (err: any) {
      expect(err.code).toEqual('ECONNRESET');
    }
    expect(called).toBe(true);
  });

  test('throws on destroyed stream', async () => {
    const duplex = new stream.PassThrough();
    duplex.destroy();
    try {
      sut.streamResponse({} as any, duplex);
      stl.fail();
    } catch (err: any) {
      expect(err.message).toContain('already destroyed');
    }
  });
});
