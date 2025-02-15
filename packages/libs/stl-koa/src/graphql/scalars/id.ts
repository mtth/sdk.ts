import avro from '@avro/types';
import * as stl from '@opvious/stl';
import crypto from 'crypto';
import * as gql from 'graphql';

import {AVRO_NAMESPACE, standardScalar} from './common.js';

export interface IdScalarOptions {
  /** Optional name override. */
  readonly name?: string;

  /**
   * Avro types for custom IDs. The default only supports string IDs. All record
   * types must have a name and names must be unique.
   */
  readonly types?: ReadonlyArray<avro.RecordType>;

  /**
   * Secret keys used to sign and verify IDs. The first key is used to sign,
   * other keys to verify signatures if previous ones failed.
   */
  readonly secretKeys?: ReadonlyArray<crypto.KeyObject>;

  /**
   * Allow parsing of unsigned user input. This option defaults to false if at
   * least one secret key is present and true otherwise.
   */
  readonly allowUnsigned?: boolean;
}

const idType = avro.Type.forSchema(
  [
    'string',
    {
      type: 'record',
      name: 'CustomId',
      namespace: AVRO_NAMESPACE,
      fields: [
        {name: 'name', type: 'string'},
        {name: 'data', type: 'bytes'},
      ],
    },
  ],
  {wrapUnions: false}
);

export class IdScalarCodec {
  private constructor(
    // For user-friendly validation messages.
    private readonly unionType: avro.Type,
    // Map of types used for stable ID encodings. Using a union directly would
    // yield different encodings as more IDs get added to the union.
    private readonly customTypes: ReadonlyMap<string, avro.RecordType>
  ) {}

  encodeId(id: unknown): Buffer {
    this.unionType.checkValid(id);
    const obj = stl.check.isRecord(id);
    const [key] = Object.keys(obj);
    const name = stl.check.isString(key);
    const tp = stl.check.isPresent(this.customTypes.get(name));
    const data = tp.binaryEncode(obj[name]);
    return idType.binaryEncode({name, data});
  }

  decodeId(name: string, data: Buffer): unknown {
    const tp = stl.check.isPresent(this.customTypes.get(name));
    return tp.binaryDecode(data).wrap();
  }

  static forTypes(
    tps: ReadonlyArray<avro.RecordType>
  ): IdScalarCodec | undefined {
    if (!tps.length) {
      return undefined;
    }
    const byName = new Map<string, avro.RecordType>();
    for (const tp of tps ?? []) {
      stl.assert(tp.name, 'ID is missing a name in %j', tp.schema());
      stl.assert(!byName.has(tp.name), 'Duplicate ID name %s', tp.name);
      byName.set(tp.name, tp);
    }
    const tp = avro.Type.forSchema(tps, {wrapUnions: true});
    return new IdScalarCodec(tp, byName);
  }
}

export function idScalar<V = unknown>(
  opts?: IdScalarOptions
): gql.GraphQLScalarType<V, string> {
  const {allowUnsigned, name, types, secretKeys} = opts ?? {};
  const scalarName = name ?? 'ID';
  const [key] = secretKeys ?? [];
  const toEnvOpts: stl.ToEnvelopeOptions = {
    protection:
      key || allowUnsigned === false
        ? {kind: 'sign', secretKey: stl.check.isPresent(key)}
        : undefined,
  };
  const fromEnvOpts: stl.FromEnvelopeOptions = {
    allowUnprotected: allowUnsigned,
    secretKeys,
  };
  const codec = IdScalarCodec.forTypes(types ?? []);
  return standardScalar({
    name: scalarName,
    description: 'Opaque ID',
    encode(arg: unknown): string {
      let data: Buffer;
      if (typeof arg == 'string') {
        data = idType.binaryEncode(arg);
      } else {
        data = stl.check.isPresent(codec).encodeId(arg);
      }
      return stl.toEnvelope({data}, toEnvOpts);
    },
    decode(arg: unknown): any {
      stl.assert(typeof arg == 'string', 'Non-string value');
      const {data} = stl.fromEnvelope(arg, fromEnvOpts);
      const ret = idType.binaryDecode(data);
      if (typeof ret == 'string') {
        return ret;
      }
      const name = stl.check.isString(ret.name);
      return stl.check.isPresent(codec).decodeId(name, ret.data);
    },
  });
}

/**
 * Utility to detect an encoded ID's type without fully decoding it. This can be
 * useful when stitching schemas from a gateway without having access to the
 * underlying types' schemas.
 */
export class IdScalarDetector {
  constructor(private readonly secretKeys?: ReadonlyArray<crypto.KeyObject>) {}

  /** Detects the ID type's name from a valid encoded ID. */
  detectName(arg: string): string | undefined {
    const {data} = stl.fromEnvelope(arg, {secretKeys: this.secretKeys});
    const ret = idType.binaryDecode(data);
    return typeof ret == 'string' ? undefined : ret.name;
  }
}
