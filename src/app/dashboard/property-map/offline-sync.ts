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

export const loadCachedSnapshot = () =>
    parseJson<PropertyMapSnapshot | null>(
        typeof window === 'undefined' ? null : window.localStorage.getItem(SNAPSHOT_CACHE_KEY),
        null
    );

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
