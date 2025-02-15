import * as stl from '@opvious/stl';
import {enableContextPropagation} from '@opvious/stl-bootstrap';

import * as sut from '../../src/graphql/yoga.js';

enableContextPropagation();

const telemetry = stl.RecordingTelemetry.forTesting();

test('Yoga state', async () => {
  const ks: any = {};
  await telemetry.withActiveSpan({name: 't'}, async (span) => {
    expect(sut.tryGetYogaCallAttr(ks, 'k')).toBeUndefined();
    sut.initializeYogaCallAttrs(ks, span);
    expect(sut.getYogaCallAttr(ks, 'k')).toBeUndefined();
    expect(sut.tryGetYogaCallAttr(ks, 'k')).toBeUndefined();
    sut.setYogaCallAttr(ks, 'k', 1);
    expect(sut.tryGetYogaCallAttr(ks, 'k')).toEqual(1);
    expect(sut.getYogaCallAttr(ks, 'k')).toEqual(1);
  });
});
