import avro from '@avro/types';
import * as stl from '@opvious/stl';
import crypto from 'crypto';
import * as gql from 'graphql';
import http from 'http';
import Koa from 'koa';
import {DateTime, Duration} from 'luxon';
import request from 'supertest';

import * as sut from '../../../src/graphql/scalars/index.js';
import {standardYogaRouter} from '../../../src/graphql/yoga.js';
import {setup} from '../../../src/setup/index.js';

const telemetry = stl.RecordingTelemetry.forTesting();

interface CodecParams<V> {
  readonly scalar: gql.GraphQLScalarType<V, unknown>;
  readonly provide?: () => V;
  readonly consume?: (v: V) => void;
}

class Codec {
  constructor(
    private readonly scalar: gql.GraphQLScalarType,
    private readonly listener: http.RequestListener
  ) {}

  private async runQuery(query: string, variables?: any): Promise<any> {
    const res = await request(this.listener)
      .post('/graphql')
      .set('content-type', 'application/json')
      .send({query, variables})
      .expect(200);
    return res.body;
  }

  provide(): Promise<any> {
    return this.runQuery('{ provide }');
  }

  consumeVariable(arg: any): Promise<any> {
    return this.runQuery(
      `query Consume($arg:${this.scalar.name}!){consume(arg:$arg)}`,
      {arg}
    );
  }

  consumeLiteral(arg: string): Promise<any> {
    return this.runQuery(`{ consume(arg: ${arg}) }`);
  }

  static forParams<V>(params: CodecParams<V>): Codec {
    const name = params.scalar.name;
    const router = standardYogaRouter({
      schema: {
        typeDefs: `
          scalar ${name}
          type Query {
            consume(arg: ${name}!): Boolean!
            provide: ${name}!
          }
        `,
        resolvers: {
          [name]: params.scalar,
          Query: {
            consume: (_ctx, args) => {
              const fn = params.consume;
              if (!fn) {
                return false;
              }
              fn(args.arg);
              return true;
            },
            provide: () => params.provide?.(),
          },
        },
      },
      serverConfig: {
        graphiql: false,
      },
      telemetry,
      exposeGraphqlErrors: true,
    });
    const app = new Koa()
      .use(setup({telemetry}))
      .use(router.allowedMethods())
      .use(router.routes());
    return new Codec(params.scalar, app.callback());
  }
}

const fooIdType = avro.Type.forSchema<avro.RecordType>({
  type: 'record',
  name: 'FooId',
  fields: [{name: 'id', type: 'int'}],
});

const barIdType = avro.Type.forSchema<avro.RecordType>({
  type: 'record',
  name: 'BarId',
  fields: [
    {name: 'ns', type: 'string'},
    {name: 'key', type: 'int'},
  ],
});

describe('standard scalars', () => {
  test.each([
    [
      'datetime',
      sut.dateTimeScalar({zone: 'utc'}),
      DateTime.fromISO('2024-02-03T03:44:20Z', {setZone: true}),
      '2024-02-03T03:44:20.000Z',
    ],
    ['duration', sut.durationScalar(), Duration.fromMillis(505), 505],
    ['string id', sut.idScalar(), 'abcd', expect.any(String)],
    [
      'custom id',
      sut.idScalar({types: [fooIdType]}),
      {FooId: {id: 456}},
      expect.any(String),
    ],
    [
      'string id with custom',
      sut.idScalar({types: [fooIdType]}),
      'foo',
      expect.any(String),
    ],
    ['timestamp', sut.timestampScalar(), DateTime.fromMillis(678), 678],
    ['slug', sut.slugScalar(), 'abcd-efg', undefined],
    ['safe string', sut.safeStringScalar('title'), 'Any value', undefined],
    ['uuid', sut.uuidScalar(), crypto.randomUUID(), undefined],
    [
      'url',
      sut.urlScalar(),
      new URL('http://localhost/aa'),
      'http://localhost/aa',
    ],
  ])('%s roundtrips', async (_msg, scalar, val, exp) => {
    const consumer = vi.fn();
    const codec = Codec.forParams({
      scalar,
      provide: () => val,
      consume: consumer,
    });
    const res1 = await codec.provide();
    expect(res1.errors).toBeUndefined();
    expect(res1.data).toEqual({provide: exp ?? val});
    const res2 = await codec.consumeLiteral(JSON.stringify(res1.data.provide));
    expect(res2.errors).toBeUndefined();
    expect(consumer).toBeCalledWith(val);
  });

  test.each([
    ['int date', sut.dateTimeScalar(), 123],
    ['int id', sut.idScalar(), 123],
    ['long safe string', sut.safeStringScalar('title', {maxLength: 2}), 'abc'],
  ])('%s fails to serialize', async (_msg, scalar, val) => {
    const codec = Codec.forParams<any>({scalar, provide: () => val});
    const res = await codec.provide();
    expect(res.errors).toMatchObject([{message: 'Unknown error'}]);
  });

  test.each([
    ['int date', sut.dateTimeScalar(), 123],
    ['int id', sut.idScalar(), 123],
    ['empty id', sut.idScalar(), ''],
    ['string timestamp', sut.timestampScalar(), 'abc'],
    ['slug number', sut.slugScalar(), 134],
    ['uuid number', sut.uuidScalar(), 134],
    ['uuid invalid string', sut.uuidScalar(), 'abcd'],
    ['dash-starting slug', sut.slugScalar(), '--efg'],
    ['non-url string', sut.urlScalar(), 'foo'],
  ])('%s fails to parse as variable', async (_msg, scalar, val) => {
    const codec = Codec.forParams<any>({scalar});
    const res = await codec.consumeVariable(val);
    expect(res.errors).toMatchObject([
      {
        extensions: {
          status: 'INVALID_ARGUMENT',
          exception: {
            code: 'ERR_GRAPHQL_SCALARS_UNPARSEABLE_VALUE',
            tags: {name: scalar.name, value: val},
          },
        },
      },
    ]);
  });

  test.each([
    ['int date', sut.dateTimeScalar(), '123'],
    ['int id', sut.idScalar(), '566'],
    ['string timestamp', sut.timestampScalar(), '"123"'],
  ])('%s fails to parse as literal', async (_msg, scalar, lit) => {
    const codec = Codec.forParams<any>({scalar});
    const res = await codec.consumeLiteral(lit);
    expect(res.errors).toMatchObject([
      {
        extensions: {
          status: 'INVALID_ARGUMENT',
          exception: {
            code: 'ERR_GRAPHQL_SCALARS_UNPARSEABLE_VALUE',
            tags: {name: scalar.name, value: JSON.parse(lit)},
          },
        },
      },
    ]);
  });

  describe('id scalar', () => {
    test('id stability', async () => {
      const key = stl.envelopeKey('test');
      const barId = {BarId: {ns: 'abc', key: 12}};

      const codec1 = Codec.forParams<any>({
        scalar: sut.idScalar({
          types: [fooIdType, barIdType],
          secretKeys: [key],
        }),
        provide: () => barId,
      });
      const res1 = await codec1.provide();
      expect(res1.errors).toBeUndefined();
      const str = res1.data.provide;

      const consumer = vi.fn();
      const codec2 = Codec.forParams<any>({
        scalar: sut.idScalar({
          types: [barIdType],
          secretKeys: [key],
        }),
        consume: consumer,
      });
      await codec2.consumeVariable(str);

      expect(consumer).toBeCalledWith(barId);
    });

    test('detect name', async () => {
      const scalar = sut.idScalar({types: [fooIdType, barIdType]});
      const detector = new sut.IdScalarDetector();

      const barId = await encodeId({BarId: {ns: 'abc', key: 12}});
      expect(detector.detectName(barId)).toEqual('BarId');

      const strId = await encodeId('abc');
      expect(detector.detectName(strId)).toBeUndefined();

      async function encodeId(id: any): Promise<string> {
        const codec = Codec.forParams<any>({scalar, provide: () => id});
        const res = await codec.provide();
        expect(res.errors).toBeUndefined();
        return res.data.provide;
      }
    });
  });
});
