'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';
import { boundaryCenter, buildBoundary } from './boundary-manager';
import {
    getGeolocationPermissionState,
    startGpsTracking,
    type GeolocationPermissionState,
    type GpsTrackingHandle
} from './gps-tracking';
import {
    type BasemapMode,
    buildDefaultBoundary,
    buildElevationSeries,
    buildTrailSplits,
    createId,
    distancePointToPolygonEdgeMeters,
    formatDistance,
    formatDuration,
    formatPace,
    haversineMeters,
    normalizeBoundary,
    polygonAreaAcres
} from './map-engine';
import {
    clearOfflineSnapshotCache,
    enqueueSnapshotSync,
    loadCachedSnapshot,
    loadSyncQueue,
    removeQueueItem,
    saveCachedSnapshot
} from './offline-sync';
import { filesToAttachments, removeAttachmentById } from './photo-attachments';
import { createPinpoint, createTrail, exportTrailGpx, importTrailFromGpx } from './trail-manager';
import { ensureSharedMap, loadSnapshotFromSupabase, syncSnapshotToSupabase } from './supabase-map-sync';
import type { MapActions, MapDiagnostics } from './LeafletMapCanvas';
import type { GpsFix, LatLngTuple, Pinpoint, PropertyMapSnapshot, Trail, TrailPoint } from './types';
import styles from './PropertyMapWorkspace.module.css';

const LeafletMapCanvas = dynamic(() => import('./LeafletMapCanvas'), {
    ssr: false,
    loading: () => <div className={styles.mapLoading}>Loading map...</div>
});

type ToolMode = 'idle' | 'pin' | 'trail' | 'boundary';
type PinType = 'note' | 'treestand' | 'range' | 'water' | 'gate' | 'camera' | 'sign';

const PIN_TYPES: Array<{ value: PinType; label: string }> = [
    { value: 'note', label: 'Note' },
    { value: 'treestand', label: 'Treestand' },
    { value: 'range', label: 'Range' },
    { value: 'water', label: 'Water' },
    { value: 'gate', label: 'Gate' },
    { value: 'camera', label: 'Camera' },
    { value: 'sign', label: 'Posted Sign' }
];

const defaultSnapshot: PropertyMapSnapshot = {
    mapId: 'offline-local-map',
    boundary: buildDefaultBoundary(),
    trails: [],
    pinpoints: []
};

const BASEMAP_MODE_STORAGE_KEY = 'family-land-map-basemap-mode-v2';
const OFFLINE_MAP_ID = 'offline-local-map';
const PROPERTY_MAP_BUILD_STAMP = 'pm-boundary-south-2026-08-05-6';
const PROPERTY_MAP_RUNTIME_HASH = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'local-dev').slice(0, 12);
const PROPERTY_MAP_DEPLOYED_AT = (() => {
    const raw = process.env.NEXT_PUBLIC_DEPLOYED_AT_UTC || '';
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }
    return 'unknown';
})();

const updateTrail = (trails: Trail[], trailId: string, updater: (trail: Trail) => Trail) =>
    trails.map(trail => (trail.id === trailId ? updater(trail) : trail));

const downloadTextFile = (fileName: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
};

const paceFromLiveDraft = (points: TrailPoint[]) => {
    if (points.length < 2) return null;
    const first = points[0].timestamp;
    const last = points[points.length - 1].timestamp;
    if (!Number.isFinite(first) || !Number.isFinite(last) || (last as number) <= (first as number)) return null;

    let distance = 0;
    for (let index = 1; index < points.length; index += 1) {
        distance += haversineMeters([points[index - 1].lat, points[index - 1].lng], [points[index].lat, points[index].lng]);
    }

    if (distance <= 0) return null;
    const seconds = Math.round(((last as number) - (first as number)) / 1000);
    return Math.round(seconds / (distance / 1000));
};

const buildElevationPath = (series: Array<{ distanceMeters: number; altitudeMeters: number }>) => {
    if (series.length < 2) return '';

    const width = 640;
    const height = 180;
    const minAltitude = Math.min(...series.map(item => item.altitudeMeters));
    const maxAltitude = Math.max(...series.map(item => item.altitudeMeters));
    const altitudeSpan = Math.max(1, maxAltitude - minAltitude);
    const maxDistance = Math.max(1, series[series.length - 1].distanceMeters);

    return series
        .map((point, index) => {
            const x = (point.distanceMeters / maxDistance) * width;
            const y = height - ((point.altitudeMeters - minAltitude) / altitudeSpan) * height;
            return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');
};

const metersToLat = (meters: number) => meters / 111320;

const metersToLng = (meters: number, atLatitude: number) => {
    const cosLat = Math.cos((atLatitude * Math.PI) / 180);
    const denominator = Math.max(0.0001, 111320 * Math.abs(cosLat));
    return meters / denominator;
};

const buildRectangleBoundaryFromPoints = (points: LatLngTuple[], paddingMeters = 28): LatLngTuple[] | null => {
    if (points.length === 0) return null;

    const lats = points.map(point => point[0]);
    const lngs = points.map(point => point[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const centerLat = (minLat + maxLat) / 2;
    const latPad = metersToLat(paddingMeters);
    const lngPad = metersToLng(paddingMeters, centerLat);

    return [
        [maxLat + latPad, minLng - lngPad],
        [maxLat + latPad, maxLng + lngPad],
        [minLat - latPad, maxLng + lngPad],
        [minLat - latPad, minLng - lngPad]
    ];
};

// Upgrade any cached default boundary (4-pt rectangle or any previous 6-pt default) to current shape.
// Leaves user-customised polygons (7+ points, or already matching current default) untouched.
const CORRECT_DEFAULT_NW: LatLngTuple = [43.2199, -77.9793];
const migrateBoundary = (snap: PropertyMapSnapshot): PropertyMapSnapshot => {
    const normalized = normalizeBoundary(snap.boundary);
    if (normalized.polygon.length === snap.boundary.polygon.length &&
        normalized.polygon.every((point, index) => {
            const existing = snap.boundary.polygon[index];
            return existing && Math.abs(point[0] - existing[0]) < 0.000001 && Math.abs(point[1] - existing[1]) < 0.000001;
        })) {
        return snap;
    }

    return {
        ...snap,
        boundary: { ...normalized, sourceFeatureId: snap.boundary.sourceFeatureId }
    };
};

export default function PropertyMapWorkspace() {
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('Loading property map...');
    const [error, setError] = useState<string | null>(null);
    const [toolMode, setToolMode] = useState<ToolMode>('idle');
    const [pinDraftType, setPinDraftType] = useState<PinType>('note');

    const [snapshot, setSnapshot] = useState<PropertyMapSnapshot>(defaultSnapshot);
    const [gpsEnabled, setGpsEnabled] = useState(false);
    const [autoFollow, setAutoFollow] = useState(true);
    const [recordingTrail, setRecordingTrail] = useState(false);
    const [basemapMode, setBasemapMode] = useState<BasemapMode>('satellite');

    const [liveGps, setLiveGps] = useState<GpsFix | null>(null);
    const [locationPermission, setLocationPermission] = useState<GeolocationPermissionState | null>(null);
    const [walkedTrailDraft, setWalkedTrailDraft] = useState<TrailPoint[]>([]);
    const [plannedTrailDraft, setPlannedTrailDraft] = useState<LatLngTuple[]>([]);
    const [boundaryDraft, setBoundaryDraft] = useState<LatLngTuple[]>([]);

    const [selectedTrailId, setSelectedTrailId] = useState<string>('');
    const [newTrailName, setNewTrailName] = useState('');

    const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'queued' | 'offline'>('idle');
    const [profileId, setProfileId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [networkOnline, setNetworkOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    const [mapDiagnostics, setMapDiagnostics] = useState<MapDiagnostics>({
        center: defaultSnapshot.boundary.polygon[0],
        zoom: 0,
        boundaryPointCount: defaultSnapshot.boundary.polygon.length,
        tileErrorCount: 0,
        activeBasemapMode: 'street'
    });

    const gpsHandleRef = useRef<GpsTrackingHandle | null>(null);
    const mapActionsRef = useRef<MapActions | null>(null);
    const syncInFlightRef = useRef(false);
    const dirtyRef = useRef(false);

    const router = useRouter();
    const supabase = supabaseClient();

    const boundary = snapshot.boundary;
    const pinpoints = snapshot.pinpoints;
    const trails = snapshot.trails;

    const runSync = useCallback(async () => {
        if (syncInFlightRef.current || !dirtyRef.current || !profileId) return;

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            enqueueSnapshotSync(snapshot.mapId || OFFLINE_MAP_ID, snapshot);
            setSyncState('offline');
            return;
        }

        syncInFlightRef.current = true;
        setSyncState('syncing');

        try {
            let activeMapId = snapshot.mapId;
            if (!activeMapId || activeMapId === OFFLINE_MAP_ID) {
                const sharedMap = await ensureSharedMap(supabase, profileId);
                activeMapId = sharedMap.id;
            }

            const synced = await syncSnapshotToSupabase(supabase, profileId, {
                ...snapshot,
                mapId: activeMapId
            });
            setSnapshot(synced);
            saveCachedSnapshot(synced);
            dirtyRef.current = false;
            setSyncState('idle');
            setStatus(`Synced to family shared map at ${new Date().toLocaleTimeString()}.`);
        } catch {
            enqueueSnapshotSync(snapshot.mapId || OFFLINE_MAP_ID, snapshot);
            setSyncState('queued');
        } finally {
            syncInFlightRef.current = false;
        }
    }, [profileId, snapshot, supabase]);

    // Explicit save actions (e.g. Save Boundary) must not depend on the passive debounce timer below,
    // which gets cancelled (and the sync silently dropped) if the user navigates away within the delay.
    const persistSnapshotNow = useCallback(
        async (nextSnapshot: PropertyMapSnapshot) => {
            if (!profileId) return;

            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                enqueueSnapshotSync(nextSnapshot.mapId || OFFLINE_MAP_ID, nextSnapshot);
                setSyncState('offline');
                return;
            }

            syncInFlightRef.current = true;
            setSyncState('syncing');

            try {
                let activeMapId = nextSnapshot.mapId;
                if (!activeMapId || activeMapId === OFFLINE_MAP_ID) {
                    const sharedMap = await ensureSharedMap(supabase, profileId);
                    activeMapId = sharedMap.id;
                }

                const synced = await syncSnapshotToSupabase(supabase, profileId, {
                    ...nextSnapshot,
                    mapId: activeMapId
                });
                setSnapshot(synced);
                saveCachedSnapshot(synced);
                dirtyRef.current = false;
                setSyncState('idle');
                setStatus(`Boundary saved and synced to family shared map at ${new Date().toLocaleTimeString()}.`);
            } catch (err: any) {
                enqueueSnapshotSync(nextSnapshot.mapId || OFFLINE_MAP_ID, nextSnapshot);
                setSyncState('queued');
                setStatus('Boundary saved locally. Will sync to shared map once connection is available.');
                setError(getSupabaseErrorMessage(err, 'Could not sync boundary to Supabase right now; it is queued and will retry automatically.'));
            } finally {
                syncInFlightRef.current = false;
            }
        },
        [profileId, supabase]
    );

    const flushQueue = useCallback(async () => {
        if (!profileId) return;
        const queue = loadSyncQueue();
        if (queue.length === 0) return;

        setSyncState('syncing');

        for (const item of queue) {
            try {
                let nextMapId = item.snapshot.mapId;
                if (!nextMapId || nextMapId === OFFLINE_MAP_ID) {
                    const sharedMap = await ensureSharedMap(supabase, profileId);
                    nextMapId = sharedMap.id;
                }

                await syncSnapshotToSupabase(supabase, profileId, {
                    ...item.snapshot,
                    mapId: nextMapId
                });
                removeQueueItem(item.id);
            } catch {
                setSyncState('queued');
                return;
            }
        }

        setSyncState('idle');
        setStatus('Offline updates synced successfully.');
    }, [profileId, supabase]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const stored = window.localStorage.getItem(BASEMAP_MODE_STORAGE_KEY);
        if (stored === 'street' || stored === 'satellite') {
            setBasemapMode(stored);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(BASEMAP_MODE_STORAGE_KEY, basemapMode);
    }, [basemapMode]);

    const refreshLocationPermission = useCallback(() => {
        void getGeolocationPermissionState().then(setLocationPermission);
    }, []);

    useEffect(() => {
        refreshLocationPermission();
        if (typeof document === 'undefined') return;
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                refreshLocationPermission();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [refreshLocationPermission]);

    useEffect(() => {
        const hydrate = async () => {
            const cached = loadCachedSnapshot();
            if (cached) {
                setSnapshot({
                    ...migrateBoundary(cached),
                    mapId: cached.mapId || OFFLINE_MAP_ID
                });
                setStatus('Loaded cached map while reconnecting to shared data.');
            }

            try {
                const {
                    data: { user }
                } = await supabase.auth.getUser();

                if (!user) {
                    router.push('/');
                    return;
                }

                setProfileId(user.id);
                const map = await ensureSharedMap(supabase, user.id);
                const remoteSnapshot = await loadSnapshotFromSupabase(supabase, map.id);
                const effectiveSnapshot = migrateBoundary({
                    ...remoteSnapshot,
                    mapId: map.id
                });

                setSnapshot(effectiveSnapshot);
                saveCachedSnapshot(effectiveSnapshot);
                setStatus('Family shared map is live and synced.');

                await flushQueue();
            } catch (err: any) {
                const rawMessage = getSupabaseErrorMessage(err, '');
                const isFetchError = /failed to fetch/i.test(rawMessage);
                const missingMapTables = isMissingTableSetupError(err, ['property_maps', 'property_map_features']);
                if (!cached) {
                    setSnapshot({ ...defaultSnapshot, mapId: OFFLINE_MAP_ID });
                }
                setStatus('Using offline map cache. Changes will sync once connection is restored.');
                setError(
                    missingMapTables
                        ? 'Supabase property map tables are missing. Run supabase/property_maps.sql and supabase/storage_property_maps.sql, then retry connection.'
                        : isFetchError
                            ? 'Could not reach Supabase from this device. Check NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel and verify network access.'
                            : (getSupabaseErrorMessage(err, 'Unable to load Supabase property map data.') || null)
                );
                setSyncState('offline');
            } finally {
                setLoading(false);
            }
        };

        hydrate();

        const onOnline = () => {
            setNetworkOnline(true);
            setSyncState('idle');
            void flushQueue();
            void runSync();
        };

        const onOffline = () => {
            setNetworkOnline(false);
            setSyncState('offline');
            setStatus('You are offline. Updates are queued for sync.');
        };

        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);

        return () => {
            gpsHandleRef.current?.stop();
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [flushQueue, router, runSync, supabase, supabase.auth]);

    useEffect(() => {
        if (loading) return;
        saveCachedSnapshot(snapshot);

        if (!snapshot.mapId) {
            return;
        }

        dirtyRef.current = true;
        const timer = window.setTimeout(() => {
            void runSync();
        }, 900);
        return () => window.clearTimeout(timer);
    }, [snapshot, loading, runSync]);

    useEffect(() => {
        if (!gpsEnabled) {
            gpsHandleRef.current?.stop();
            gpsHandleRef.current = null;
            setLiveGps(null);
            return;
        }

        const handle = startGpsTracking({
            onFix: fix => {
                setLiveGps(fix);
                setError(null);
                setStatus('Live GPS lock acquired. Your location is now visible on the property map.');
                setAutoFollow(true);

                if (!recordingTrail) return;

                setWalkedTrailDraft(previous => {
                    const nextPoint: TrailPoint = {
                        lat: fix.lat,
                        lng: fix.lng,
                        timestamp: fix.timestamp,
                        altitudeMeters: fix.altitudeMeters
                    };

                    if (previous.length === 0) {
                        return [nextPoint];
                    }

                    const last = previous[previous.length - 1];
                    const meters = haversineMeters([last.lat, last.lng], [nextPoint.lat, nextPoint.lng]);
                    if (meters < 3) return previous;
                    return [...previous, nextPoint];
                });
            },
            onError: message => {
                setError(message);
                setGpsEnabled(false);
                refreshLocationPermission();
            }
        });

        gpsHandleRef.current = handle;

        if (!handle) {
            setGpsEnabled(false);
            return;
        }

        return () => {
            handle.stop();
        };
    }, [gpsEnabled, recordingTrail, refreshLocationPermission]);

    useEffect(() => {
        if (toolMode !== 'boundary') return;

        const refreshNow = window.setTimeout(() => {
            mapActionsRef.current?.refresh();
        }, 0);

        const refreshAfterLayout = window.setTimeout(() => {
            mapActionsRef.current?.refresh();
        }, 180);

        return () => {
            window.clearTimeout(refreshNow);
            window.clearTimeout(refreshAfterLayout);
        };
    }, [toolMode]);

    const boundaryAreaAcres = useMemo(() => polygonAreaAcres(boundary.polygon), [boundary.polygon]);
    const boundaryDraftAreaAcres = useMemo(
        () => (boundaryDraft.length >= 3 ? polygonAreaAcres(boundaryDraft) : null),
        [boundaryDraft]
    );

    const gpsInsideBoundary = useMemo(() => {
        if (!liveGps || boundary.polygon.length < 3) return null;

        const x = liveGps.lng;
        const y = liveGps.lat;
        let inside = false;

        for (let i = 0, j = boundary.polygon.length - 1; i < boundary.polygon.length; j = i++) {
            const xi = boundary.polygon[i][1];
            const yi = boundary.polygon[i][0];
            const xj = boundary.polygon[j][1];
            const yj = boundary.polygon[j][0];

            const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
            if (intersects) inside = !inside;
        }

        return inside;
    }, [boundary.polygon, liveGps]);

    const walkedDistanceMeters = useMemo(() => {
        if (walkedTrailDraft.length < 2) return 0;
        let total = 0;
        for (let index = 1; index < walkedTrailDraft.length; index += 1) {
            total += haversineMeters(
                [walkedTrailDraft[index - 1].lat, walkedTrailDraft[index - 1].lng],
                [walkedTrailDraft[index].lat, walkedTrailDraft[index].lng]
            );
        }
        return total;
    }, [walkedTrailDraft]);

    const boundaryEdgeDistanceMeters = useMemo(() => {
        if (!liveGps || boundary.polygon.length < 2) return null;
        return distancePointToPolygonEdgeMeters([liveGps.lat, liveGps.lng], boundary.polygon);
    }, [boundary.polygon, liveGps]);

    const boundaryConfidenceText = useMemo(() => {
        if (!liveGps || gpsInsideBoundary === null || boundaryEdgeDistanceMeters === null) return null;

        const roundedDistance = Math.max(0, Math.round(boundaryEdgeDistanceMeters));
        const roundedAccuracy = Math.max(1, Math.round(liveGps.accuracyMeters));
        const uncertain = roundedAccuracy >= Math.max(roundedDistance, 10);

        if (gpsInsideBoundary) {
            if (roundedDistance >= 60) {
                return `Boundary confidence: deep inside (~${roundedDistance}m from edge).`;
            }

            return uncertain
                ? `Boundary confidence: likely inside (~${roundedDistance}m from edge, GPS +/-${roundedAccuracy}m).`
                : `Boundary confidence: inside (~${roundedDistance}m from edge).`;
        }

        if (roundedDistance <= 25) {
            return uncertain
                ? `Boundary confidence: near boundary (~${roundedDistance}m outside, GPS +/-${roundedAccuracy}m).`
                : `Boundary confidence: just outside (~${roundedDistance}m from edge).`;
        }

        if (roundedDistance <= 120) {
            return `Boundary confidence: near property (~${roundedDistance}m outside boundary).`;
        }

        return `Boundary confidence: away from property (~${roundedDistance}m outside boundary).`;
    }, [boundaryEdgeDistanceMeters, gpsInsideBoundary, liveGps]);

    const boundaryConfidenceLevel = useMemo<'high' | 'medium' | 'low' | null>(() => {
        if (!liveGps || gpsInsideBoundary === null || boundaryEdgeDistanceMeters === null) return null;

        const roundedDistance = Math.max(0, Math.round(boundaryEdgeDistanceMeters));
        const roundedAccuracy = Math.max(1, Math.round(liveGps.accuracyMeters));
        const uncertain = roundedAccuracy >= Math.max(roundedDistance, 10);

        if (gpsInsideBoundary) {
            return uncertain ? 'medium' : 'high';
        }

        if (roundedDistance <= 25) {
            return uncertain ? 'medium' : 'low';
        }

        return roundedDistance <= 120 ? 'medium' : 'low';
    }, [boundaryEdgeDistanceMeters, gpsInsideBoundary, liveGps]);

    const boundaryConfidenceBadgeLabel = useMemo(() => {
        if (!boundaryConfidenceLevel) return null;
        if (boundaryConfidenceLevel === 'high') return 'Confidence: High';
        if (boundaryConfidenceLevel === 'medium') return 'Confidence: Medium';
        return 'Confidence: Low';
    }, [boundaryConfidenceLevel]);

    const onMapReady = useCallback((actions: MapActions) => {
        mapActionsRef.current = actions;
        setMapReady(true);
    }, []);

    const onMapDiagnosticsChange = useCallback((nextDiagnostics: MapDiagnostics) => {
        setMapDiagnostics(previous => {
            const sameCenter =
                Math.abs(previous.center[0] - nextDiagnostics.center[0]) < 0.0000005 &&
                Math.abs(previous.center[1] - nextDiagnostics.center[1]) < 0.0000005;
            const sameZoom = Math.abs(previous.zoom - nextDiagnostics.zoom) < 0.0001;

            if (
                sameCenter &&
                sameZoom &&
                previous.boundaryPointCount === nextDiagnostics.boundaryPointCount &&
                previous.tileErrorCount === nextDiagnostics.tileErrorCount
            ) {
                return previous;
            }

            return nextDiagnostics;
        });
    }, []);

    const onAutoFollowInterrupted = useCallback(() => {
        setAutoFollow(previous => (previous ? false : previous));
        setStatus('Auto-follow paused so you can pan/zoom manually. Turn it back on when ready.');
    }, []);

    const onBoundaryDraftPointDrag = useCallback((index: number, position: LatLngTuple) => {
        setBoundaryDraft(previous => {
            if (previous.length === 0) return previous;
            const safeIndex = Math.max(0, Math.min(index, previous.length - 1));
            return previous.map((point, pointIndex) => (pointIndex === safeIndex ? position : point));
        });
        setStatus(`Moved boundary corner ${index + 1}. Save Boundary Polygon when alignment looks right.`);
    }, []);

    const onBoundaryDraftInsertFromMidpoint = useCallback((edgeIndex: number, position: LatLngTuple) => {
        let insertedIndex = -1;

        setBoundaryDraft(previous => {
            if (previous.length < 3) return previous;

            const safeEdgeIndex = Math.max(0, Math.min(edgeIndex, previous.length - 1));
            insertedIndex = safeEdgeIndex + 1;

            const next = [...previous];
            next.splice(insertedIndex, 0, position);
            return next;
        });

        if (insertedIndex >= 0) {
            setStatus(`Added boundary corner ${insertedIndex + 1}. Drag to fine-tune, then save boundary.`);
        }

        return insertedIndex;
    }, []);

    const onMapClick = (position: LatLngTuple) => {
        setError(null);

        if (toolMode === 'pin') {
            setSnapshot(previous => ({
                ...previous,
                pinpoints: [
                    {
                        ...createPinpoint(position, previous.pinpoints.length),
                        pinType: pinDraftType
                    },
                    ...previous.pinpoints
                ]
            }));
            setStatus('Pinpoint added. Add photos from the Photo Attachments tab.');
            return;
        }

        if (toolMode === 'trail') {
            setPlannedTrailDraft(previous => [...previous, position]);
            setStatus('Trail point added. Save from Trail Manager when done.');
            return;
        }

        if (toolMode === 'boundary') {
            setBoundaryDraft(previous => [...previous, position]);
            setStatus('Boundary point added. Use Save Boundary to apply polygon.');
            return;
        }

        setStatus('Tip: choose Add Pinpoint, Add Trail Point, or Boundary Edit before clicking map.');
    };

    const savePlannedTrail = () => {
        if (plannedTrailDraft.length < 2) {
            setError('Add at least 2 trail points before saving a planned trail.');
            return;
        }

        const nextTrail = createTrail(newTrailName || `Planned Trail ${trails.length + 1}`, 'planned', plannedTrailDraft);
        setSnapshot(previous => ({
            ...previous,
            trails: [nextTrail, ...previous.trails]
        }));
        setSelectedTrailId(nextTrail.id);
        setPlannedTrailDraft([]);
        setNewTrailName('');
        setStatus(`Saved ${nextTrail.name}.`);
        setToolMode('idle');
    };

    // Top toolbar's Save Trail button covers both manual (tap-to-add) and GPS-recorded trails.
    const saveActiveTrail = () => {
        if (plannedTrailDraft.length >= 2) {
            savePlannedTrail();
            return;
        }
        saveWalkedTrail();
    };

    const saveWalkedTrail = () => {
        if (walkedTrailDraft.length < 2) {
            setError('Record at least two GPS points before saving a walked trail.');
            return;
        }

        const nextTrail = createTrail(
            `Walked Trail ${new Date().toLocaleDateString()}`,
            'walked',
            walkedTrailDraft.map(point => [point.lat, point.lng])
        );
        nextTrail.points = walkedTrailDraft;

        setSnapshot(previous => ({
            ...previous,
            trails: [nextTrail, ...previous.trails]
        }));

        setSelectedTrailId(nextTrail.id);
        setWalkedTrailDraft([]);
        setRecordingTrail(false);
        setStatus(`Saved ${nextTrail.name}.`);
    };

    const saveBoundaryDraft = () => {
        if (boundaryDraft.length < 3) {
            setError('Add at least 3 points to create a boundary polygon.');
            return;
        }

        const nextBoundary = buildBoundary(boundaryDraft, boundary.name);
        nextBoundary.sourceFeatureId = boundary.sourceFeatureId || createId('boundary');

        const nextSnapshot = { ...snapshot, boundary: nextBoundary };
        setSnapshot(nextSnapshot);
        setBoundaryDraft([]);
        setToolMode('idle');
        setStatus('Boundary polygon saved. Syncing to shared map now...');
        // Sync immediately instead of waiting on the passive debounce timer, which gets
        // cancelled (losing the edit) if the user navigates away right after saving.
        void persistSnapshotNow(nextSnapshot);
        window.setTimeout(() => {
            mapActionsRef.current?.fitBoundary();
            mapActionsRef.current?.refresh();
        }, 60);
    };

    const importGpxFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const raw = await file.text();
            const imported = importTrailFromGpx(file.name.replace(/\.gpx$/i, ''), raw);

            if (!imported) {
                setError('GPX file has no usable track points.');
                return;
            }

            setSnapshot(previous => ({
                ...previous,
                trails: [imported, ...previous.trails]
            }));
            setSelectedTrailId(imported.id);
            setStatus(`Imported trail ${imported.name} from GPX.`);
        } catch {
            setError('Failed to import GPX file.');
        } finally {
            event.target.value = '';
        }
    };

    const exportSnapshot = () => {
        downloadTextFile(
            `property-map-${new Date().toISOString().slice(0, 10)}.json`,
            JSON.stringify(snapshot, null, 2),
            'application/json'
        );
    };

    const importSnapshot = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const parsed = JSON.parse(await file.text()) as PropertyMapSnapshot;
            setSnapshot(previous => ({
                ...parsed,
                mapId: previous.mapId
            }));
            setStatus('Imported map snapshot.');
        } catch {
            setError('Snapshot import failed. Use a JSON file exported from this page.');
        } finally {
            event.target.value = '';
        }
    };

    const uploadPhotosForPin = async (pinId: string, files: FileList | null) => {
        try {
            const photos = await filesToAttachments(files);
            if (photos.length === 0) return;

            setSnapshot(previous => ({
                ...previous,
                pinpoints: previous.pinpoints.map(pin =>
                    pin.id === pinId
                        ? { ...pin, photos: [...pin.photos, ...photos], updatedAt: new Date().toISOString() }
                        : pin
                )
            }));
            setStatus(`${photos.length} photo(s) attached. They will upload to Supabase on sync.`);
        } catch (err: any) {
            setError(err?.message || 'Photo upload failed.');
        }
    };

    const removePinPhoto = (pinId: string, photoId: string) => {
        setSnapshot(previous => ({
            ...previous,
            pinpoints: previous.pinpoints.map(pin =>
                pin.id === pinId
                    ? { ...pin, photos: removeAttachmentById(pin.photos, photoId), updatedAt: new Date().toISOString() }
                    : pin
            )
        }));
    };

    const uploadPhotosForTrail = async (trailId: string, files: FileList | null) => {
        try {
            const photos = await filesToAttachments(files);
            if (photos.length === 0) return;

            setSnapshot(previous => ({
                ...previous,
                trails: updateTrail(previous.trails, trailId, trail => ({
                    ...trail,
                    photos: [...trail.photos, ...photos],
                    updatedAt: new Date().toISOString()
                }))
            }));
            setStatus(`${photos.length} photo(s) attached. They will upload to Supabase on sync.`);
        } catch (err: any) {
            setError(err?.message || 'Photo upload failed.');
        }
    };

    const removeTrailPhoto = (trailId: string, photoId: string) => {
        setSnapshot(previous => ({
            ...previous,
            trails: updateTrail(previous.trails, trailId, trail => ({
                ...trail,
                photos: removeAttachmentById(trail.photos, photoId),
                updatedAt: new Date().toISOString()
            }))
        }));
    };

    const updatePinpointField = (pinId: string, updates: Partial<Pick<Pinpoint, 'title' | 'description' | 'pinType'>>) => {
        setSnapshot(previous => ({
            ...previous,
            pinpoints: previous.pinpoints.map(pin =>
                pin.id === pinId ? { ...pin, ...updates, updatedAt: new Date().toISOString() } : pin
            )
        }));
    };

    const deletePinpoint = (pinId: string) => {
        setSnapshot(previous => ({
            ...previous,
            pinpoints: previous.pinpoints.filter(pin => pin.id !== pinId)
        }));
        setStatus('Pinpoint deleted.');
    };

    const exportTrail = (trail: Trail) => {
        downloadTextFile(`${trail.name.replace(/\s+/g, '-').toLowerCase() || createId('trail')}.gpx`, exportTrailGpx(trail), 'application/gpx+xml');
    };

    const resetOfflineCache = () => {
        clearOfflineSnapshotCache();
        setSnapshot(defaultSnapshot);
        setBoundaryDraft([]);
        setPlannedTrailDraft([]);
        setWalkedTrailDraft([]);
        setStatus('Local property-map cache cleared. Reloading shared map...');
        setError(null);
        window.location.reload();
    };

    const retrySupabaseConnection = () => {
        setStatus('Retrying Supabase connection...');
        setError(null);
        window.location.reload();
    };

    const loadCurrentBoundaryIntoDraft = () => {
        if (boundary.polygon.length < 3) {
            setError('Current boundary is not available yet.');
            return;
        }

        setBoundaryDraft(boundary.polygon.map(point => [point[0], point[1]]));
        setToolMode('boundary');
        setStatus('Loaded current boundary into draft. Use nudge/resize controls and save when aligned.');
    };

    const resetToPropertyShape = () => {
        const preset = buildDefaultBoundary();
        setBoundaryDraft(preset.polygon);
        setToolMode('boundary');
        setStatus('ONX property shape loaded into draft. Drag corners to fine-tune, then Save Boundary Polygon.');
        window.setTimeout(() => mapActionsRef.current?.fitBoundary(), 60);
    };

    // Entering Edit Boundary mode must auto-load the saved polygon into the draft, otherwise no
    // draggable corner/midpoint handles render and taps on the map just append stray new points.
    const selectToolMode = (mode: ToolMode) => {
        if (mode === 'boundary' && toolMode !== 'boundary') {
            if (boundaryDraft.length < 3 && boundary.polygon.length >= 3) {
                setBoundaryDraft(boundary.polygon.map(point => [point[0], point[1]]));
            }
            setStatus('Boundary edit mode on. Drag the orange corner dots / blue midpoints, then Save Boundary.');
        } else if (toolMode === 'boundary' && mode !== 'boundary') {
            setBoundaryDraft([]);
        }
        setToolMode(mode);
    };

    const nudgeBoundaryDraft = (northMeters: number, eastMeters: number) => {
        setBoundaryDraft(previous => {
            const source = previous.length >= 3 ? previous : boundary.polygon;
            if (source.length < 3) return previous;

            return source.map(point => {
                const nextLat = point[0] + metersToLat(northMeters);
                const nextLng = point[1] + metersToLng(eastMeters, point[0]);
                return [nextLat, nextLng] as LatLngTuple;
            });
        });
        setToolMode('boundary');
        setStatus(`Boundary nudged ${northMeters !== 0 ? `${northMeters > 0 ? 'north' : 'south'} ${Math.abs(northMeters)}m` : ''}${northMeters !== 0 && eastMeters !== 0 ? ' and ' : ''}${eastMeters !== 0 ? `${eastMeters > 0 ? 'east' : 'west'} ${Math.abs(eastMeters)}m` : ''}.`);
    };

    const scaleBoundaryDraft = (factor: number) => {
        setBoundaryDraft(previous => {
            const source = previous.length >= 3 ? previous : boundary.polygon;
            if (source.length < 3) return previous;

            const centerLat = source.reduce((sum, point) => sum + point[0], 0) / source.length;
            const centerLng = source.reduce((sum, point) => sum + point[1], 0) / source.length;

            return source.map(point => [
                centerLat + (point[0] - centerLat) * factor,
                centerLng + (point[1] - centerLng) * factor
            ] as LatLngTuple);
        });
        setToolMode('boundary');
        setStatus(factor > 1 ? 'Boundary draft expanded.' : 'Boundary draft tightened.');
    };

    const autoDraftBoundaryFromSavedData = () => {
        const dataPoints: LatLngTuple[] = [
            ...pinpoints.map(pin => pin.position),
            ...trails.flatMap(trail => trail.points.map(point => [point.lat, point.lng] as LatLngTuple))
        ];

        if (dataPoints.length === 0 && liveGps) {
            const gpsPoint: LatLngTuple = [liveGps.lat, liveGps.lng];
            const fallback = buildRectangleBoundaryFromPoints([
                [gpsPoint[0] + metersToLat(25), gpsPoint[1] - metersToLng(25, gpsPoint[0])],
                [gpsPoint[0] + metersToLat(25), gpsPoint[1] + metersToLng(25, gpsPoint[0])],
                [gpsPoint[0] - metersToLat(25), gpsPoint[1] + metersToLng(25, gpsPoint[0])],
                [gpsPoint[0] - metersToLat(25), gpsPoint[1] - metersToLng(25, gpsPoint[0])]
            ]);
            if (fallback) {
                setBoundaryDraft(fallback);
                setToolMode('boundary');
                setStatus('Created draft boundary around your live GPS. Drag corners and save when aligned to your land.');
            }
            return;
        }

        const derived = buildRectangleBoundaryFromPoints(dataPoints);
        if (!derived) {
            setError('Need at least one saved pinpoint/trail point or a live GPS fix to auto-draft a boundary.');
            return;
        }

        setBoundaryDraft(derived);
        setToolMode('boundary');
        setStatus('Draft boundary auto-generated from saved map points. Fine-tune corners, then save boundary.');
        window.setTimeout(() => {
            mapActionsRef.current?.fitBoundary();
        }, 30);
    };

    const selectedTrail = useMemo(() => trails.find(trail => trail.id === selectedTrailId) || trails[0] || null, [selectedTrailId, trails]);
    const selectedTrailSplits = useMemo(() => (selectedTrail ? buildTrailSplits(selectedTrail.points) : []), [selectedTrail]);
    const selectedTrailElevation = useMemo(() => (selectedTrail ? buildElevationSeries(selectedTrail.points) : []), [selectedTrail]);
    const currentDraftPace = useMemo(() => formatPace(paceFromLiveDraft(walkedTrailDraft)), [walkedTrailDraft]);

    if (loading) {
        return <div className="panel-soft">Loading property map...</div>;
    }

    const modeOptions: Array<{ mode: ToolMode; label: string }> = [
        { mode: 'idle', label: 'View' },
        { mode: 'pin', label: 'Add Pinpoint' },
        { mode: 'trail', label: 'Draw Trail' },
        { mode: 'boundary', label: 'Edit Boundary' }
    ];

    return (
        <div className={styles.pageStack}>
            <div className={styles.breadcrumbRow}>
                <Link href="/dashboard" className="chip-link">Main Dashboard</Link>
                <Link href="/dashboard/tickets" className="chip-link">Tickets</Link>
                <Link href="/dashboard/treestands" className="chip-link">Treestands / Range</Link>
                <Link href="/dashboard/system" className="chip-link">System Check</Link>
            </div>

            <section className={`panel ${styles.hero}`}>
                <div className={styles.heroText}>
                    <div className="section-eyebrow">Property Planner</div>
                    <h2>Property Map: Shared Family GPS Workspace</h2>
                    <p>825 West Ave, Brockport NY - {boundaryAreaAcres.toFixed(2)} acres mapped. Everything below is always visible - no hidden tabs.</p>
                </div>
                <div className={styles.heroBadges}>
                    <span className={styles.badge}>{trails.length} trails</span>
                    <span className={styles.badge}>{pinpoints.length} pinpoints</span>
                    <span className={styles.badge}>Sync: {syncState}</span>
                    <span className={`${styles.badge} ${networkOnline ? styles.diagnosticsChipOk : styles.diagnosticsChipWarn}`}>
                        {networkOnline ? 'Online' : 'Offline'}
                    </span>
                </div>
            </section>

            {error && (
                <div className={styles.errorBox}>
                    <div>{error}</div>
                    {locationPermission === 'denied' && (
                        <div style={{ marginTop: '0.4rem', opacity: 0.9 }}>
                            Tip: if you use a VPN, it will not cause a &quot;blocked&quot; permission, but it can make GPS
                            fixes slower or less accurate once location is allowed &mdash; try disabling it if fixes
                            still fail after allowing location.
                        </div>
                    )}
                    <div className={styles.inlineActions} style={{ marginTop: '0.55rem' }}>
                        <button type="button" className="soft-button" onClick={retrySupabaseConnection}>
                            Retry Connection
                        </button>
                        <button type="button" className="soft-button" onClick={resetOfflineCache}>
                            Reset Offline Cache
                        </button>
                        {locationPermission === 'denied' && (
                            <button
                                type="button"
                                className="soft-button"
                                onClick={() => {
                                    refreshLocationPermission();
                                    setGpsEnabled(true);
                                }}
                            >
                                I Fixed It, Retry GPS
                            </button>
                        )}
                    </div>
                </div>
            )}

            <section className={`panel ${styles.workspacePanel}`}>
                <div className={styles.modeRow}>
                    {modeOptions.map(option => (
                        <button
                            key={option.mode}
                            type="button"
                            className={toolMode === option.mode ? styles.modeButtonActive : styles.modeButton}
                            onClick={() => selectToolMode(option.mode)}
                        >
                            {option.label}
                        </button>
                    ))}
                    {toolMode === 'pin' && (
                        <select value={pinDraftType} onChange={event => setPinDraftType(event.target.value as PinType)}>
                            {PIN_TYPES.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    )}
                </div>

                {toolMode === 'trail' && (
                    <div className={styles.contextBar}>
                        <span>Tap the map to add trail points ({plannedTrailDraft.length} placed).</span>
                        <div className={styles.inlineActions}>
                            <input value={newTrailName} onChange={event => setNewTrailName(event.target.value)} placeholder="Trail name (optional)" />
                            <button type="button" className="soft-button" onClick={() => setPlannedTrailDraft(prev => prev.slice(0, -1))} disabled={plannedTrailDraft.length === 0}>
                                Undo Point
                            </button>
                            <button type="button" className="soft-button" onClick={() => setPlannedTrailDraft([])} disabled={plannedTrailDraft.length === 0}>
                                Clear
                            </button>
                            <button type="button" className="soft-button" onClick={savePlannedTrail} disabled={plannedTrailDraft.length < 2}>
                                Save Trail
                            </button>
                        </div>
                    </div>
                )}

                {toolMode === 'boundary' && (
                    <div className={styles.contextBar}>
                        <span>
                            Drag orange corner dots / blue midpoints on the map. Draft: <strong>{boundaryDraft.length}</strong> pts
                            {boundaryDraftAreaAcres !== null && <> - <strong>{boundaryDraftAreaAcres.toFixed(2)} ac</strong> (target ~40 ac)</>}
                        </span>
                        <div className={styles.inlineActions}>
                            <button type="button" className="soft-button" onClick={() => setBoundaryDraft(prev => prev.slice(0, -1))} disabled={boundaryDraft.length === 0}>
                                Undo Point
                            </button>
                            <button type="button" className="soft-button" onClick={() => setBoundaryDraft([])} disabled={boundaryDraft.length === 0}>
                                Clear
                            </button>
                            <button type="button" className="soft-button" onClick={saveBoundaryDraft} disabled={boundaryDraft.length < 3}>
                                Save Boundary
                            </button>
                        </div>
                    </div>
                )}

                <div className={styles.mapToolsRow}>
                    <button type="button" className="soft-button" onClick={() => setGpsEnabled(prev => !prev)}>
                        {gpsEnabled ? 'Stop GPS' : 'Start GPS'}
                    </button>
                    <button type="button" className="soft-button" onClick={() => mapActionsRef.current?.centerOnGps()} disabled={!liveGps || !mapReady}>
                        Center Me
                    </button>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => {
                            setRecordingTrail(prev => !prev);
                            setStatus(recordingTrail ? 'Walked trail recording stopped.' : 'Walked trail recording started.');
                        }}
                        disabled={!gpsEnabled}
                    >
                        {recordingTrail ? 'Stop Recording' : 'Record Walked Trail'}
                    </button>
                    <button type="button" className="soft-button" onClick={saveActiveTrail} disabled={plannedTrailDraft.length < 2 && walkedTrailDraft.length < 2}>
                        {plannedTrailDraft.length >= 2 ? `Save Manual Trail (${plannedTrailDraft.length})` : 'Save Walked Trail'}
                    </button>
                    <button type="button" className="soft-button" onClick={() => mapActionsRef.current?.fitBoundary()} disabled={!mapReady}>
                        Fit Full Property
                    </button>
                    <button type="button" className="soft-button" onClick={() => mapActionsRef.current?.zoomIn()} disabled={!mapReady}>
                        Zoom In
                    </button>
                    <button type="button" className="soft-button" onClick={() => mapActionsRef.current?.zoomOut()} disabled={!mapReady}>
                        Zoom Out
                    </button>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => {
                            mapActionsRef.current?.refresh();
                            setStatus('Map tiles refreshed.');
                        }}
                        disabled={!mapReady}
                    >
                        Refresh Tiles
                    </button>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => setBasemapMode(previous => (previous === 'satellite' ? 'street' : 'satellite'))}
                    >
                        {basemapMode === 'satellite' ? 'Street View' : 'Satellite View'}
                    </button>
                    <button
                        type="button"
                        className={autoFollow ? styles.modeButtonActive : styles.modeButton}
                        onClick={() => setAutoFollow(prev => !prev)}
                    >
                        {autoFollow ? 'Auto-follow On' : 'Auto-follow Off'}
                    </button>
                </div>

                <div className={styles.mapRegion}>
                    <div className={styles.mapCanvasWrap}>
                        <LeafletMapCanvas
                            boundary={boundary}
                            trails={trails}
                            selectedTrailId={selectedTrail?.id || null}
                            pinpoints={pinpoints}
                            walkedTrailDraft={walkedTrailDraft}
                            plannedTrailDraft={plannedTrailDraft}
                            boundaryDraft={boundaryDraft}
                            liveGps={liveGps}
                            autoFollow={autoFollow}
                            basemapMode={basemapMode}
                            boundaryEditEnabled={toolMode === 'boundary'}
                            onBoundaryDraftPointDrag={onBoundaryDraftPointDrag}
                            onBoundaryDraftInsertFromMidpoint={onBoundaryDraftInsertFromMidpoint}
                            onMapClick={onMapClick}
                            onMapReady={onMapReady}
                            onAutoFollowInterrupted={onAutoFollowInterrupted}
                            onDiagnosticsChange={onMapDiagnosticsChange}
                        />
                    </div>
                </div>

                <div className={styles.statusRow}>
                    <span>
                        GPS: {!gpsEnabled ? 'Off' : liveGps ? `Locked (+/-${Math.round(liveGps.accuracyMeters)}m)` : 'Searching...'}
                    </span>
                    {locationPermission === 'denied' && <span className={styles.outside}>Location blocked in browser settings</span>}
                    {gpsInsideBoundary !== null && (
                        <span className={gpsInsideBoundary ? styles.inside : styles.outside}>
                            {gpsInsideBoundary ? 'Inside property boundary' : 'Outside property boundary'}
                        </span>
                    )}
                    {boundaryConfidenceText && (
                        <span className={styles.confidenceRow}>
                            {boundaryConfidenceBadgeLabel && (
                                <span
                                    className={`${styles.confidenceBadge} ${boundaryConfidenceLevel === 'high'
                                        ? styles.confidenceHigh
                                        : boundaryConfidenceLevel === 'medium'
                                            ? styles.confidenceMedium
                                            : styles.confidenceLow
                                        }`}
                                >
                                    {boundaryConfidenceBadgeLabel}
                                </span>
                            )}
                            <span>{boundaryConfidenceText}</span>
                        </span>
                    )}
                    {walkedTrailDraft.length >= 2 && (
                        <span>
                            Current walk: {formatDistance(walkedDistanceMeters)} | Pace {currentDraftPace}
                        </span>
                    )}
                </div>
                <div className={styles.helpText}>{status}</div>
            </section>

            <section className={`panel ${styles.groupCard}`}>
                <h4>Property Boundary</h4>
                <div className={styles.helpText}>
                    The starting shape is an unsurveyed estimate. Choose <strong>Edit Boundary</strong> above, then drag the orange
                    corner dots and blue midpoint dots on the satellite view to trace your real tree lines and field edges.
                    Your saved shape is kept exactly as you draw it.
                </div>
                <div className={styles.helpText}>
                    Saved boundary is currently <strong>{boundaryAreaAcres.toFixed(2)} acres</strong> (target ~40 acres for 825 West Ave).
                </div>
                <div className={styles.inlineActions}>
                    <button type="button" className="soft-button" onClick={loadCurrentBoundaryIntoDraft}>
                        Load Current Boundary Into Editor
                    </button>
                    <button type="button" className="soft-button" onClick={resetToPropertyShape}>
                        Reset to Verified Address Shape
                    </button>
                    <button type="button" className="soft-button" onClick={autoDraftBoundaryFromSavedData}>
                        Auto-Draft From Map Data
                    </button>
                </div>
                <div className={styles.inlineActions}>
                    <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(8, 0)}>Nudge North</button>
                    <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(-8, 0)}>Nudge South</button>
                    <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(0, -8)}>Nudge West</button>
                    <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(0, 8)}>Nudge East</button>
                    <button type="button" className="soft-button" onClick={() => scaleBoundaryDraft(1.01)}>Expand 1%</button>
                    <button type="button" className="soft-button" onClick={() => scaleBoundaryDraft(0.99)}>Tighten 1%</button>
                </div>
            </section>

            <section className={`panel ${styles.groupCard}`}>
                <h4>Pinpoints ({pinpoints.length})</h4>
                <div className={styles.helpText}>
                    Rename, retype (Treestand, Range, Posted Sign, Gate, Water, Camera, Note), add notes, attach photos, or delete any marker.
                </div>
                <div className={styles.itemList}>
                    {pinpoints.length === 0 && <div className={styles.helpText}>No pinpoints yet. Choose Add Pinpoint above, then tap the map.</div>}
                    {pinpoints.map(pin => (
                        <div key={pin.id} className={styles.itemRow}>
                            <div style={{ display: 'grid', gap: '0.4rem', flex: 1 }}>
                                <input
                                    value={pin.title}
                                    onChange={event => updatePinpointField(pin.id, { title: event.target.value })}
                                    placeholder="Pinpoint label"
                                />
                                <div className={styles.inlineActions}>
                                    <select
                                        value={pin.pinType}
                                        onChange={event => updatePinpointField(pin.id, { pinType: event.target.value as Pinpoint['pinType'] })}
                                    >
                                        {PIN_TYPES.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                    <span className={styles.helpText}>
                                        {pin.position[0].toFixed(6)}, {pin.position[1].toFixed(6)}
                                    </span>
                                </div>
                                <textarea
                                    value={pin.description}
                                    onChange={event => updatePinpointField(pin.id, { description: event.target.value })}
                                    placeholder="Notes (e.g. posted sign wording, gate combo, etc.)"
                                    rows={2}
                                />
                                <div className={styles.inlineActions}>
                                    {pin.photos.map(photo => (
                                        <div key={photo.id} style={{ position: 'relative' }}>
                                            {photo.url || photo.dataUrl ? (
                                                <Image src={photo.url || (photo.dataUrl as string)} alt={photo.name} width={64} height={64} unoptimized style={{ borderRadius: 8, objectFit: 'cover' }} />
                                            ) : null}
                                            <button
                                                type="button"
                                                onClick={() => removePinPhoto(pin.id, photo.id)}
                                                title="Remove photo"
                                                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: '1px solid #334155', background: '#0f172a', color: '#fca5a5', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1 }}
                                            >
                                                x
                                            </button>
                                        </div>
                                    ))}
                                    <label className={styles.fileButton}>
                                        Add Photo
                                        <input type="file" accept="image/*" multiple onChange={event => { void uploadPhotosForPin(pin.id, event.target.files); event.target.value = ''; }} />
                                    </label>
                                </div>
                            </div>
                            <div className={styles.inlineActions}>
                                <button type="button" className="soft-button" onClick={() => deletePinpoint(pin.id)}>
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className={`panel ${styles.groupCard}`}>
                <h4>Trails ({trails.length})</h4>
                <div className={styles.helpText}>Draw Trail above for manual tap-to-place paths, or Record Walked Trail while carrying your phone.</div>
                <label className={styles.fileButton}>
                    Import GPX File
                    <input type="file" accept=".gpx,application/gpx+xml,text/xml" onChange={importGpxFile} />
                </label>
                <div className={styles.itemList}>
                    {trails.length === 0 && <div className={styles.helpText}>No saved trails yet.</div>}
                    {trails.map(trail => (
                        <div key={trail.id} className={styles.itemRow}>
                            <div style={{ flex: 1 }}>
                                <div className={styles.itemTitle}>{trail.name}</div>
                                <div className={styles.helpText}>
                                    {trail.type} | {trail.points.length} points | {formatDistance(trail.distanceMeters)} | {formatDuration(trail.durationSeconds)}
                                </div>
                                <div className={styles.inlineActions}>
                                    {trail.photos.map(photo => (
                                        <div key={photo.id} style={{ position: 'relative' }}>
                                            {photo.url || photo.dataUrl ? (
                                                <Image src={photo.url || (photo.dataUrl as string)} alt={photo.name} width={64} height={64} unoptimized style={{ borderRadius: 8, objectFit: 'cover' }} />
                                            ) : null}
                                            <button
                                                type="button"
                                                onClick={() => removeTrailPhoto(trail.id, photo.id)}
                                                title="Remove photo"
                                                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: '1px solid #334155', background: '#0f172a', color: '#fca5a5', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1 }}
                                            >
                                                x
                                            </button>
                                        </div>
                                    ))}
                                    <label className={styles.fileButton}>
                                        Add Photo
                                        <input type="file" accept="image/*" multiple onChange={event => { void uploadPhotosForTrail(trail.id, event.target.files); event.target.value = ''; }} />
                                    </label>
                                </div>
                            </div>
                            <div className={styles.inlineActions}>
                                <button type="button" className="soft-button" onClick={() => setSelectedTrailId(trail.id)}>
                                    Analytics
                                </button>
                                <button type="button" className="soft-button" onClick={() => exportTrail(trail)}>
                                    GPX
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() =>
                                        setSnapshot(previous => ({
                                            ...previous,
                                            trails: previous.trails.filter(item => item.id !== trail.id)
                                        }))
                                    }
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {selectedTrail && (
                    <div className={styles.groupCard}>
                        <h4>Trail Analytics: {selectedTrail.name}</h4>
                        <div className={styles.helpText}>
                            Distance {formatDistance(selectedTrail.distanceMeters)} | Duration {formatDuration(selectedTrail.durationSeconds)} | Pace {formatPace(selectedTrail.paceSecondsPerKm)}
                        </div>
                        <div className={styles.helpText}>
                            Elevation gain {Math.round(selectedTrail.elevationGainMeters)}m | Elevation loss {Math.round(selectedTrail.elevationLossMeters)}m | Splits {selectedTrailSplits.length}
                        </div>
                        {selectedTrailElevation.length >= 2 ? (
                            <svg viewBox="0 0 640 180" role="img" aria-label="Elevation profile" className={styles.elevationChart}>
                                <path d={buildElevationPath(selectedTrailElevation)} fill="none" stroke="#22d3ee" strokeWidth="3" />
                            </svg>
                        ) : (
                            <div className={styles.helpText}>No elevation points captured for this trail yet.</div>
                        )}
                    </div>
                )}
            </section>

            <details className={styles.groupCard}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Import / Export &amp; Diagnostics</summary>
                <div className={styles.inlineActions} style={{ marginTop: '0.6rem' }}>
                    <button type="button" className="soft-button" onClick={() => void runSync()}>
                        Sync Now
                    </button>
                    <button type="button" className="soft-button" onClick={() => void flushQueue()}>
                        Flush Offline Queue ({loadSyncQueue().length})
                    </button>
                    <button type="button" className="soft-button" onClick={exportSnapshot}>
                        Export Full Map JSON
                    </button>
                    <label className={styles.fileButton}>
                        Import Full Map JSON
                        <input type="file" accept="application/json,.json" onChange={importSnapshot} />
                    </label>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => {
                            const center = boundaryCenter(boundary);
                            mapActionsRef.current?.recenter();
                            setStatus(`Map recentered near ${center[0].toFixed(5)}, ${center[1].toFixed(5)}.`);
                        }}
                        disabled={!mapReady}
                    >
                        Recenter to Boundary
                    </button>
                </div>
                <div className={styles.diagnosticsRow} style={{ marginTop: '0.6rem' }}>
                    <span className={styles.diagnosticsChip}>Build: {PROPERTY_MAP_BUILD_STAMP}</span>
                    <span className={styles.diagnosticsChip}>Runtime: {PROPERTY_MAP_RUNTIME_HASH}</span>
                    <span className={styles.diagnosticsChip}>Center: {mapDiagnostics.center[0].toFixed(5)}, {mapDiagnostics.center[1].toFixed(5)}</span>
                    <span className={styles.diagnosticsChip}>Zoom: {mapDiagnostics.zoom.toFixed(2)}</span>
                    <span className={styles.diagnosticsChip}>Boundary points: {mapDiagnostics.boundaryPointCount}</span>
                </div>
            </details>
        </div>
    );
}

