export type MapBoundsCalibration = {
    northLat: number;
    southLat: number;
    westLng: number;
    eastLng: number;
};

export type GpsProjectionResult = {
    x: number;
    y: number;
    rawX: number;
    rawY: number;
    insideMap: boolean;
    clamped: boolean;
};

export type LatLngPoint = {
    lat: number;
    lng: number;
};

export type PercentPoint = {
    x: number;
    y: number;
};

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const projectGpsToMapPercent = (
    gps: LatLngPoint,
    calibration: MapBoundsCalibration
): GpsProjectionResult | null => {
    const latSpan = calibration.northLat - calibration.southLat;
    const lngSpan = calibration.eastLng - calibration.westLng;

    if (!Number.isFinite(latSpan) || !Number.isFinite(lngSpan) || latSpan <= 0 || lngSpan <= 0) {
        return null;
    }

    const rawX = ((gps.lng - calibration.westLng) / lngSpan) * 100;
    const rawY = ((calibration.northLat - gps.lat) / latSpan) * 100;

    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
        return null;
    }

    const clampedX = clamp(rawX, 0, 100);
    const clampedY = clamp(rawY, 0, 100);
    const clamped = rawX < 0 || rawX > 100 || rawY < 0 || rawY > 100;

    return {
        x: Number(clampedX.toFixed(4)),
        y: Number(clampedY.toFixed(4)),
        rawX: Number(rawX.toFixed(4)),
        rawY: Number(rawY.toFixed(4)),
        insideMap: !clamped,
        clamped
    };
};

export const projectLatLngToMapPercent = (
    lat: number,
    lng: number,
    calibration: MapBoundsCalibration
): GpsProjectionResult | null => projectGpsToMapPercent({ lat, lng }, calibration);

export const unprojectMapPercentToLatLng = (
    point: PercentPoint,
    calibration: MapBoundsCalibration
) => {
    const latSpan = calibration.northLat - calibration.southLat;
    const lngSpan = calibration.eastLng - calibration.westLng;

    if (!Number.isFinite(latSpan) || !Number.isFinite(lngSpan) || latSpan <= 0 || lngSpan <= 0) {
        return null;
    }

    return {
        lat: calibration.northLat - (point.y / 100) * latSpan,
        lng: calibration.westLng + (point.x / 100) * lngSpan
    };
};
