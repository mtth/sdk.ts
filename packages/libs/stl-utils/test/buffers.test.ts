import * as sut from '../src/buffers.js';

test('as buffer', () => {
  const arr = new Uint8Array([1, 2, 3]);
  const buf = sut.asBuffer(arr);
  arr[1] = 4;
  expect(buf[1]).toEqual(4);
});
