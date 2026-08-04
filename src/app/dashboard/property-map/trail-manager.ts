import {
    createId,
    parseGpxTrailPoints,
    trailDistanceMeters,
    trailDurationSeconds,
    trailElevationMetrics,
    trailPaceSecondsPerKm,
    trailToGpx
} from './map-engine';
import { LatLngTuple, Pinpoint, PropertyMapSnapshot, Trail, TrailPoint, TrailType } from './types';

const SNAPSHOT_STORAGE_KEY = 'family-land-map-snapshot-v2';

const emptySnapshot: PropertyMapSnapshot = {
    mapId: '',
    boundary: {
        id: 'boundary-main',
        name: 'Family Land Boundary',
        polygon: [],
        updatedAt: new Date().toISOString()
    },
    trails: [],
    pinpoints: []
};

export const loadSnapshot = (): PropertyMapSnapshot => {
    if (typeof window === 'undefined') return emptySnapshot;
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return emptySnapshot;

    try {
        const parsed = JSON.parse(raw) as PropertyMapSnapshot;
        return {
            mapId: typeof parsed.mapId === 'string' ? parsed.mapId : '',
            boundary: parsed.boundary || emptySnapshot.boundary,
            trails: Array.isArray(parsed.trails) ? parsed.trails : [],
            pinpoints: Array.isArray(parsed.pinpoints) ? parsed.pinpoints : []
        };
    } catch {
        return emptySnapshot;
    }
};

export const saveSnapshot = (snapshot: PropertyMapSnapshot) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
};

export const createTrail = (name: string, type: TrailType, points: LatLngTuple[]): Trail => {
    const normalized: TrailPoint[] = points.map(point => ({
        lat: point[0],
        lng: point[1]
    }));
    const distanceMeters = trailDistanceMeters(normalized);
    const durationSeconds = trailDurationSeconds(normalized);
    const paceSecondsPerKm = trailPaceSecondsPerKm(distanceMeters, durationSeconds);
    const elevation = trailElevationMetrics(normalized);
    const now = new Date().toISOString();
    return {
        id: createId('trail'),
        name: name.trim() || (type === 'walked' ? 'Walked Trail' : 'Planned Trail'),
        type,
        points: normalized,
        photos: [],
        createdAt: now,
        updatedAt: now,
        distanceMeters,
        durationSeconds,
        paceSecondsPerKm,
        elevationGainMeters: elevation.gainMeters,
        elevationLossMeters: elevation.lossMeters
    };
};

export const createPinpoint = (position: LatLngTuple, indexHint: number): Pinpoint => {
    const now = new Date().toISOString();
    return {
        id: createId('pinpoint'),
        title: `Pinpoint ${indexHint + 1}`,
        description: '',
        pinType: 'note',
        position,
        photos: [],
        createdAt: now,
        updatedAt: now
    };
};

export const exportTrailGpx = (trail: Trail) => trailToGpx(trail);

export const importTrailFromGpx = (name: string, rawGpx: string): Trail | null => {
    const points = parseGpxTrailPoints(rawGpx);
    if (points.length < 2) return null;
    return createTrail(
        name || 'Imported GPX Trail',
        'planned',
        points.map(point => [point.lat, point.lng])
    );
};
