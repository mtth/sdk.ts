import * as sut from '../../src/health';

test('unhealthy error', () => {
  const err = sut.unhealthyError();
  expect(err.tags.failures).toEqual([]);
});
