import * as sut from '../../src/telemetry/common.js';

describe('environment resource attributes', () => {
  test.each([
    ['unqualified app', {}, {name: 'foo'}, {'service.name': 'foo'}],
    [
      'qualified app',
      {},
      {name: '@bar/foo'},
      {'service.name': 'foo', 'service.namespace': 'bar'},
    ],
    [
      'explicit service name matches',
      {
        OTEL_RESOURCE_ATTRIBUTES:
          'service.name=foo-server,service.namespace=bar',
      },
      {name: '@bar/foo-server', version: '0.1.2'},
      {
        'service.name': 'foo-server',
        'service.namespace': 'bar',
        'service.version': '0.1.2',
      },
    ],
    [
      'explicit service name does not match',
      {OTEL_RESOURCE_ATTRIBUTES: 'service.name=foo-server'},
      {name: '@bar/foo-server', version: '0.1.2'},
      {'service.name': 'foo-server'},
    ],
  ])('handles %s case', (_desc, env, fb, want) => {
    expect(sut.appResourceAttrs(fb, env)).toEqual(want);
  });
});
