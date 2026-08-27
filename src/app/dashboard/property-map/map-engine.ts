import { LatLngTuple, PropertyBoundary, Trail, TrailPoint } from './types';

// Verified via geocoding "825 West Ave, Brockport, NY 14420" (OpenStreetMap/Nominatim), 2026-08-25.
// The previous default center/polygon below was an unverified guess roughly 300m away from the
// real address, which made the starting boundary (and therefore GPS inside/outside status) wrong.
export const DEFAULT_CENTER: LatLngTuple = [43.2195770, -77.9754249];
export const DEFAULT_ZOOM = 17;
export const PROPERTY_MAP_MIN_ZOOM = 12;
export const PROPERTY_MAP_MAX_ZOOM = 21;

// Unsurveyed ~40 acre square centered on the verified address point above. This is still only a
// starting shape for the user to drag/trace onto the real tree lines - not a surveyed parcel.
const CANONICAL_BOUNDARY_POLYGON: LatLngTuple[] = [
    [43.221396, -77.977906],
    [43.221396, -77.972944],
    [43.217758, -77.972944],
    [43.217758, -77.977906]
];

export type BasemapMode = 'satellite' | 'street';

export const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_TILE_ATTRIBUTION = 'Tiles &copy; Esri, Maxar, Earthstar Geographics';

export const STREET_TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
export const STREET_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO';
export const STREET_FALLBACK_TILE_URL = 'https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png';
export const STREET_FALLBACK_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';

export const SATELLITE_LABEL_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';
export const SATELLITE_LABEL_TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO';

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

export const canonicalPropertyBoundary = (): LatLngTuple[] =>
    CANONICAL_BOUNDARY_POLYGON.map(([lat, lng]) => [roundCoord(lat, 7), roundCoord(lng, 7)] as LatLngTuple);

// Only sanity-checks the polygon shape (finite numbers, at least 3 points).
// Does NOT compare against the guessed default shape — a saved/edited boundary
// is the source of truth and must never be silently reverted.
export const normalizeBoundary = (boundary?: Partial<PropertyBoundary> | null): PropertyBoundary => {
    const fallback = buildDefaultBoundary();

    if (!boundary || !Array.isArray(boundary.polygon)) {
        return fallback;
    }

    const validPoints = boundary.polygon.filter(
        point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    ) as LatLngTuple[];

    if (validPoints.length < 3) {
        return fallback;
    }

    return {
        id: boundary.id || fallback.id,
        name: typeof boundary.name === 'string' && boundary.name.trim() ? boundary.name : fallback.name,
        polygon: validPoints.map(([lat, lng]) => [roundCoord(lat, 7), roundCoord(lng, 7)] as LatLngTuple),
        updatedAt: boundary.updatedAt || fallback.updatedAt,
        sourceFeatureId: boundary.sourceFeatureId || fallback.sourceFeatureId
    };
};

export const buildDefaultBoundary = (): PropertyBoundary => {
    return {
        id: createId('boundary'),
        name: '825 West Ave Property Boundary (unsurveyed estimate)',
        polygon: canonicalPropertyBoundary(),
        updatedAt: new Date().toISOString()
    };
};

export const buildBoundaryFromPoints = (
    points: LatLngTuple[],
    options?: { name?: string; paddingMeters?: number }
): PropertyBoundary | null => {
    if (points.length === 0) return null;

    const lats = points.map(point => point[0]);
    const lngs = points.map(point => point[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const centerLat = (minLat + maxLat) / 2;
    const paddingMeters = options?.paddingMeters ?? 28;
    const latPad = paddingMeters / 111320;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const lngPad = paddingMeters / Math.max(0.0001, 111320 * Math.abs(cosLat));

    return {
        id: createId('boundary'),
        name: options?.name?.trim() || 'Family Land Boundary',
        polygon: [
            [roundCoord(maxLat + latPad), roundCoord(minLng - lngPad)],
            [roundCoord(maxLat + latPad), roundCoord(maxLng + lngPad)],
            [roundCoord(minLat - latPad), roundCoord(maxLng + lngPad)],
            [roundCoord(minLat - latPad), roundCoord(minLng - lngPad)]
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

const METERS_PER_ACRE = 4046.8564224;

// Planar (equirectangular) area estimate - accurate enough for parcel-scale polygons like a 40 acre lot.
export const polygonAreaAcres = (polygon: LatLngTuple[]): number => {
    if (polygon.length < 3) return 0;

    const originLat = polygon[0][0];
    const cosLat = Math.cos((originLat * Math.PI) / 180);
    const toMeters = ([lat, lng]: LatLngTuple): [number, number] => [lng * 111320 * cosLat, lat * 110540];
    const points = polygon.map(toMeters);

    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
        const [x1, y1] = points[index];
        const [x2, y2] = points[(index + 1) % points.length];
        sum += x1 * y2 - x2 * y1;
    }

    const areaSquareMeters = Math.abs(sum) / 2;
    return areaSquareMeters / METERS_PER_ACRE;
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

const latLngToLocalMeters = (target: LatLngTuple, origin: LatLngTuple) => {
    const earthRadius = 6371000;
    const latRad = (origin[0] * Math.PI) / 180;
    const metersPerDegLat = (Math.PI / 180) * earthRadius;
    const metersPerDegLng = (Math.PI / 180) * earthRadius * Math.cos(latRad);

    return {
        x: (target[1] - origin[1]) * metersPerDegLng,
        y: (target[0] - origin[0]) * metersPerDegLat
    };
};

const pointToSegmentDistanceMeters = (
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number }
) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared <= Number.EPSILON) {
        const offsetX = point.x - start.x;
        const offsetY = point.y - start.y;
        return Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    }

    const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
    const t = Math.max(0, Math.min(1, projection));
    const nearestX = start.x + t * dx;
    const nearestY = start.y + t * dy;
    const offsetX = point.x - nearestX;
    const offsetY = point.y - nearestY;
    return Math.sqrt(offsetX * offsetX + offsetY * offsetY);
};

export const distancePointToPolygonEdgeMeters = (point: LatLngTuple, polygon: LatLngTuple[]) => {
    if (polygon.length < 2) return null;

    const pointLocal = latLngToLocalMeters(point, point);
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < polygon.length; index += 1) {
        const start = polygon[index];
        const end = polygon[(index + 1) % polygon.length];
        const startLocal = latLngToLocalMeters(start, point);
        const endLocal = latLngToLocalMeters(end, point);
        const distance = pointToSegmentDistanceMeters(pointLocal, startLocal, endLocal);
        if (distance < nearestDistance) {
            nearestDistance = distance;
        }
    }

    return Number.isFinite(nearestDistance) ? nearestDistance : null;
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

export const clampZoom = (zoom: number, min = PROPERTY_MAP_MIN_ZOOM, max = PROPERTY_MAP_MAX_ZOOM) =>
    Math.max(min, Math.min(max, zoom));

const escapeXml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
