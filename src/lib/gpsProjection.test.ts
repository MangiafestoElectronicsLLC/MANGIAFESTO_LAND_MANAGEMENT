import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGpsToMapPercent } from './gpsProjection';

test('projects off-property coordinates into clamped map pixels', () => {
    const calibration = {
        northLat: 43.2200,
        southLat: 43.2100,
        westLng: -77.9900,
        eastLng: -77.9700
    };

    const result = projectGpsToMapPercent({
        lat: 43.2250,
        lng: -77.9950
    }, calibration);

    assert.ok(result);
    assert.equal(result.x, 0);
    assert.equal(result.y, 0);
    assert.equal(result.clamped, true);
    assert.equal(result.insideMap, false);
});
