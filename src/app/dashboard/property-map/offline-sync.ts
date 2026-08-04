import { PropertyMapSnapshot, SyncQueueItem } from './types';
import { createId } from './map-engine';

const SNAPSHOT_CACHE_KEY = 'family-land-map-snapshot-cache-v3';
const SYNC_QUEUE_KEY = 'family-land-map-sync-queue-v3';

const parseJson = <T,>(raw: string | null, fallback: T) => {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isLatLngTuple = (value: unknown): value is [number, number] =>
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    value[0] >= -90 &&
    value[0] <= 90 &&
    value[1] >= -180 &&
    value[1] <= 180;

const isTrailPoint = (value: unknown): value is { lat: number; lng: number } => {
    if (!value || typeof value !== 'object') return false;
    const point = value as { lat?: unknown; lng?: unknown };
    return isFiniteNumber(point.lat) && isFiniteNumber(point.lng);
};

const isValidSnapshot = (value: unknown): value is PropertyMapSnapshot => {
    if (!value || typeof value !== 'object') return false;

    const snapshot = value as {
        boundary?: { polygon?: unknown };
        trails?: Array<{ points?: unknown }>;
        pinpoints?: Array<{ position?: unknown }>;
    };

    const polygon = snapshot.boundary?.polygon;
    if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(point => isLatLngTuple(point))) {
        return false;
    }

    const trailsValid = Array.isArray(snapshot.trails)
        ? snapshot.trails.every(trail => Array.isArray(trail?.points) && trail.points.every(point => isTrailPoint(point)))
        : false;
    if (!trailsValid) return false;

    const pinsValid = Array.isArray(snapshot.pinpoints)
        ? snapshot.pinpoints.every(pin => isLatLngTuple(pin?.position))
        : false;

    return pinsValid;
};

export const loadCachedSnapshot = () => {
    const parsed = parseJson<PropertyMapSnapshot | null>(
        typeof window === 'undefined' ? null : window.localStorage.getItem(SNAPSHOT_CACHE_KEY),
        null
    );

    return isValidSnapshot(parsed) ? parsed : null;
};

export const saveCachedSnapshot = (snapshot: PropertyMapSnapshot) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
};

export const loadSyncQueue = () =>
    parseJson<SyncQueueItem[]>(typeof window === 'undefined' ? null : window.localStorage.getItem(SYNC_QUEUE_KEY), []);

const saveSyncQueue = (queue: SyncQueueItem[]) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
};

export const enqueueSnapshotSync = (mapId: string, snapshot: PropertyMapSnapshot) => {
    const existing = loadSyncQueue().filter(item => item.mapId !== mapId);
    const nextItem: SyncQueueItem = {
        id: createId('sync'),
        mapId,
        snapshot,
        createdAt: new Date().toISOString()
    };
    saveSyncQueue([...existing, nextItem]);
};

export const removeQueueItem = (itemId: string) => {
    const nextQueue = loadSyncQueue().filter(item => item.id !== itemId);
    saveSyncQueue(nextQueue);
};

export const queueLength = () => loadSyncQueue().length;

export const clearOfflineSnapshotCache = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(SNAPSHOT_CACHE_KEY);
};
