import { LatLngTuple, PropertyBoundary, Trail, TrailPoint } from './types';

export const DEFAULT_CENTER: LatLngTuple = [43.2180558, -77.9778462];
export const DEFAULT_ZOOM = 17;

export const MAP_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAP_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';

export const createId = (_prefix?: string) => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = (Math.random() * 16) | 0;
        const value = character === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
};

export const roundCoord = (value: number, digits = 7) => Number(value.toFixed(digits));

export const buildDefaultBoundary = (): PropertyBoundary => {
    const [lat, lng] = DEFAULT_CENTER;
    const latDelta = 0.0018;
    const lngDelta = 0.00245;

    return {
        id: createId('boundary'),
        name: 'Family Land Boundary',
        polygon: [
            [roundCoord(lat + latDelta), roundCoord(lng - lngDelta)],
            [roundCoord(lat + latDelta), roundCoord(lng + lngDelta)],
            [roundCoord(lat - latDelta), roundCoord(lng + lngDelta)],
            [roundCoord(lat - latDelta), roundCoord(lng - lngDelta)]
        ],
        updatedAt: new Date().toISOString()
    };
};

export const haversineMeters = (a: LatLngTuple, b: LatLngTuple) => {
    const earthRadius = 6371000;
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLng = ((b[1] - a[1]) * Math.PI) / 180;
    const lat1 = (a[0] * Math.PI) / 180;
    const lat2 = (b[0] * Math.PI) / 180;

    const h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

    return 2 * earthRadius * Math.asin(Math.sqrt(h));
};

export const trailDistanceMeters = (points: TrailPoint[]) => {
    if (points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
        total += haversineMeters([points[i - 1].lat, points[i - 1].lng], [points[i].lat, points[i].lng]);
    }
    return total;
};

export const trailDurationSeconds = (points: TrailPoint[]) => {
    if (points.length < 2) return 0;
    const first = points[0].timestamp;
    const last = points[points.length - 1].timestamp;
    if (!Number.isFinite(first) || !Number.isFinite(last) || (last as number) <= (first as number)) {
        return 0;
    }
    return Math.round(((last as number) - (first as number)) / 1000);
};

export const trailElevationMetrics = (points: TrailPoint[]) => {
    let gain = 0;
    let loss = 0;
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1].altitudeMeters;
        const next = points[index].altitudeMeters;
        if (!Number.isFinite(previous) || !Number.isFinite(next)) continue;

        const delta = (next as number) - (previous as number);
        if (delta > 0) gain += delta;
        if (delta < 0) loss += Math.abs(delta);
    }
    return {
        gainMeters: gain,
        lossMeters: loss
    };
};

export const trailPaceSecondsPerKm = (distanceMeters: number, durationSeconds: number) => {
    if (distanceMeters <= 0 || durationSeconds <= 0) return null;
    return Math.round(durationSeconds / (distanceMeters / 1000));
};

export const formatDistance = (meters: number) => {
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }

    const miles = meters / 1609.344;
    return `${miles.toFixed(2)} mi`;
};

export const formatDuration = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
};

export const formatPace = (paceSecondsPerKm: number | null) => {
    if (!paceSecondsPerKm) return 'N/A';
    const minutes = Math.floor(paceSecondsPerKm / 60);
    const seconds = paceSecondsPerKm % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')} / km`;
};

export const buildTrailSplits = (points: TrailPoint[], splitDistanceMeters = 402.336) => {
    if (points.length < 2) return [] as Array<{ point: TrailPoint; label: string; distanceMeters: number }>;

    const splits: Array<{ point: TrailPoint; label: string; distanceMeters: number }> = [];
    let traveled = 0;
    let nextSplitTarget = splitDistanceMeters;

    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const segment = haversineMeters([previous.lat, previous.lng], [current.lat, current.lng]);

        traveled += segment;
        while (traveled >= nextSplitTarget) {
            splits.push({
                point: current,
                label: `${(nextSplitTarget / 1609.344).toFixed(2)} mi`,
                distanceMeters: nextSplitTarget
            });
            nextSplitTarget += splitDistanceMeters;
        }
    }

    return splits;
};

export const buildElevationSeries = (points: TrailPoint[]) => {
    const withElevation = points.filter(point => Number.isFinite(point.altitudeMeters));
    if (withElevation.length < 2) return [] as Array<{ distanceMeters: number; altitudeMeters: number }>;

    const series: Array<{ distanceMeters: number; altitudeMeters: number }> = [];
    let distance = 0;
    series.push({ distanceMeters: 0, altitudeMeters: withElevation[0].altitudeMeters as number });

    for (let index = 1; index < withElevation.length; index += 1) {
        const previous = withElevation[index - 1];
        const current = withElevation[index];
        distance += haversineMeters([previous.lat, previous.lng], [current.lat, current.lng]);
        series.push({ distanceMeters: distance, altitudeMeters: current.altitudeMeters as number });
    }

    return series;
};

export const polygonCenter = (polygon: LatLngTuple[]): LatLngTuple => {
    if (polygon.length === 0) return DEFAULT_CENTER;

    const sums = polygon.reduce(
        (acc, point) => {
            acc.lat += point[0];
            acc.lng += point[1];
            return acc;
        },
        { lat: 0, lng: 0 }
    );

    return [sums.lat / polygon.length, sums.lng / polygon.length];
};

export const isPointInsidePolygon = (point: LatLngTuple, polygon: LatLngTuple[]) => {
    if (polygon.length < 3) return false;

    const x = point[1];
    const y = point[0];
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][1];
        const yi = polygon[i][0];
        const xj = polygon[j][1];
        const yj = polygon[j][0];

        const intersects =
            yi > y !== yj > y &&
            x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;

        if (intersects) inside = !inside;
    }

    return inside;
};

export const trailToGpx = (trail: Trail) => {
    const name = escapeXml(trail.name);
    const now = new Date().toISOString();
    const pointsXml = trail.points
        .map(
            point => {
                const elevation = Number.isFinite(point.altitudeMeters) ? `<ele>${(point.altitudeMeters as number).toFixed(2)}</ele>` : '';
                const time = Number.isFinite(point.timestamp) ? `<time>${new Date(point.timestamp as number).toISOString()}</time>` : '';
                return `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}">${elevation}${time}</trkpt>`;
            }
        )
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Family Land Board" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${now}</time>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${pointsXml}
    </trkseg>
  </trk>
</gpx>`;
};

export const parseGpxTrailPoints = (rawGpx: string): TrailPoint[] => {
    const matches = rawGpx.matchAll(/<trkpt[^>]*lat="([\d.+-]+)"[^>]*lon="([\d.+-]+)"[^>]*>/g);
    const points: TrailPoint[] = [];

    for (const match of matches) {
        const lat = Number(match[1]);
        const lng = Number(match[2]);

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            points.push({ lat, lng });
        }
    }

    return points;
};

export const clampZoom = (zoom: number, min = 14, max = 21) => Math.max(min, Math.min(max, zoom));

const escapeXml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
