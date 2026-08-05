'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';
import { boundaryCenter, buildBoundary } from './boundary-manager';
import { startGpsTracking, type GpsTrackingHandle } from './gps-tracking';
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
    haversineMeters
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
import { BOTTOM_DRAWER_TABS, type BottomDrawerTab } from './ui-controls';
import type { MapActions, MapDiagnostics } from './LeafletMapCanvas';
import type { GpsFix, LatLngTuple, MapEntityRef, PropertyMapSnapshot, Trail, TrailPoint } from './types';
import styles from './PropertyMapWorkspace.module.css';

const LeafletMapCanvas = dynamic(() => import('./LeafletMapCanvas'), {
    ssr: false,
    loading: () => <div className={styles.mapLoading}>Loading map...</div>
});

type ToolMode = 'idle' | 'pin' | 'trail' | 'boundary';

const PIN_TYPES: Array<{ value: 'note' | 'treestand' | 'range' | 'water' | 'gate' | 'camera'; label: string }> = [
    { value: 'note', label: 'Note' },
    { value: 'treestand', label: 'Treestand' },
    { value: 'range', label: 'Range' },
    { value: 'water', label: 'Water' },
    { value: 'gate', label: 'Gate' },
    { value: 'camera', label: 'Camera' }
];

const defaultSnapshot: PropertyMapSnapshot = {
    mapId: 'offline-local-map',
    boundary: buildDefaultBoundary(),
    trails: [],
    pinpoints: []
};

const BASEMAP_MODE_STORAGE_KEY = 'family-land-map-basemap-mode-v1';
const OFFLINE_MAP_ID = 'offline-local-map';
const PROPERTY_MAP_BUILD_STAMP = 'pm-gps-pin-2026-08-05-3';
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

export default function PropertyMapWorkspace() {
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('Loading property map...');
    const [error, setError] = useState<string | null>(null);
    const [toolMode, setToolMode] = useState<ToolMode>('idle');
    const [drawerTab, setDrawerTab] = useState<BottomDrawerTab>('boundary');
    const [pinDraftType, setPinDraftType] = useState<'note' | 'treestand' | 'range' | 'water' | 'gate' | 'camera'>('note');

    const [snapshot, setSnapshot] = useState<PropertyMapSnapshot>(defaultSnapshot);
    const [gpsEnabled, setGpsEnabled] = useState(false);
    const [autoFollow, setAutoFollow] = useState(true);
    const [recordingTrail, setRecordingTrail] = useState(false);
    const [basemapMode, setBasemapMode] = useState<BasemapMode>('satellite');

    const [liveGps, setLiveGps] = useState<GpsFix | null>(null);
    const [walkedTrailDraft, setWalkedTrailDraft] = useState<TrailPoint[]>([]);
    const [plannedTrailDraft, setPlannedTrailDraft] = useState<LatLngTuple[]>([]);
    const [boundaryDraft, setBoundaryDraft] = useState<LatLngTuple[]>([]);

    const [selectedEntity, setSelectedEntity] = useState<MapEntityRef | null>(null);
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
    const gpsFirstFixRef = useRef(false);

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

    useEffect(() => {
        const hydrate = async () => {
            const cached = loadCachedSnapshot();
            if (cached) {
                setSnapshot({
                    ...cached,
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
                const effectiveSnapshot = {
                    ...remoteSnapshot,
                    mapId: map.id
                };

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
            return;
        }

        gpsFirstFixRef.current = false;

        const handle = startGpsTracking({
            onFix: fix => {
                setLiveGps(fix);
                setError(null);

                if (!gpsFirstFixRef.current) {
                    gpsFirstFixRef.current = true;
                    window.setTimeout(() => {
                        mapActionsRef.current?.centerOnGps();
                    }, 150);
                }

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
    }, [gpsEnabled, recordingTrail]);

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

        setSnapshot(previous => ({
            ...previous,
            boundary: nextBoundary
        }));
        setBoundaryDraft([]);
        setToolMode('idle');
        setStatus('Boundary polygon saved. GPS containment checks now use this shape.');
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

    const uploadPhotosToSelected = async (event: ChangeEvent<HTMLInputElement>) => {
        if (!selectedEntity) {
            setError('Select a trail or pinpoint before uploading photos.');
            event.target.value = '';
            return;
        }

        try {
            const photos = await filesToAttachments(event.target.files);
            if (photos.length === 0) return;

            setSnapshot(previous => {
                if (selectedEntity.type === 'pinpoint') {
                    return {
                        ...previous,
                        pinpoints: previous.pinpoints.map(pin =>
                            pin.id === selectedEntity.id
                                ? {
                                    ...pin,
                                    photos: [...pin.photos, ...photos],
                                    updatedAt: new Date().toISOString()
                                }
                                : pin
                        )
                    };
                }

                return {
                    ...previous,
                    trails: updateTrail(previous.trails, selectedEntity.id, trail => ({
                        ...trail,
                        photos: [...trail.photos, ...photos],
                        updatedAt: new Date().toISOString()
                    }))
                };
            });

            setStatus(`${photos.length} photo(s) attached. They will upload to Supabase on sync.`);
        } catch (err: any) {
            setError(err?.message || 'Photo upload failed.');
        } finally {
            event.target.value = '';
        }
    };

    const selectedEntityPhotos = useMemo(() => {
        if (!selectedEntity) return [];
        if (selectedEntity.type === 'pinpoint') {
            return pinpoints.find(pin => pin.id === selectedEntity.id)?.photos || [];
        }
        return trails.find(trail => trail.id === selectedEntity.id)?.photos || [];
    }, [pinpoints, selectedEntity, trails]);

    const removePhoto = (photoId: string) => {
        if (!selectedEntity) return;

        setSnapshot(previous => {
            if (selectedEntity.type === 'pinpoint') {
                return {
                    ...previous,
                    pinpoints: previous.pinpoints.map(pin =>
                        pin.id === selectedEntity.id
                            ? {
                                ...pin,
                                photos: removeAttachmentById(pin.photos, photoId),
                                updatedAt: new Date().toISOString()
                            }
                            : pin
                    )
                };
            }

            return {
                ...previous,
                trails: updateTrail(previous.trails, selectedEntity.id, trail => ({
                    ...trail,
                    photos: removeAttachmentById(trail.photos, photoId),
                    updatedAt: new Date().toISOString()
                }))
            };
        });
    };

    const selectedEntityOptions = useMemo(
        () => [
            ...pinpoints.map(pin => ({ value: `pinpoint:${pin.id}`, label: `Pinpoint: ${pin.title}` })),
            ...trails.map(trail => ({ value: `trail:${trail.id}`, label: `Trail: ${trail.name}` }))
        ],
        [pinpoints, trails]
    );

    const onSelectEntity = (value: string) => {
        if (!value) {
            setSelectedEntity(null);
            return;
        }

        const [type, id] = value.split(':');
        if ((type === 'pinpoint' || type === 'trail') && id) {
            setSelectedEntity({ type, id } as MapEntityRef);
        }
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

    const toggleBoundaryEditMode = () => {
        setToolMode(previous => {
            if (previous === 'boundary') {
                setStatus('Boundary edit mode off.');
                return 'idle';
            }

            if (boundaryDraft.length < 3 && boundary.polygon.length >= 3) {
                setBoundaryDraft(boundary.polygon.map(point => [point[0], point[1]]));
                setStatus('Boundary edit mode on. Drag corner handles directly on map and save when ready.');
            } else {
                setStatus('Boundary edit mode on. Drag corner handles directly on map and save when ready.');
            }
            return 'boundary';
        });
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
                    <p>
                        Real map tiles, family-shared Supabase sync, offline queue, and richer trail analytics with split markers and elevation profile.
                    </p>
                </div>
                <div className={styles.heroBadges}>
                    <span className={styles.badge}>{gpsEnabled ? 'GPS Live' : 'GPS Off'}</span>
                    <span className={styles.badge}>{recordingTrail ? 'Recording Trail' : 'Not Recording'}</span>
                    <span className={styles.badge}>{autoFollow ? 'Auto-follow On' : 'Auto-follow Off'}</span>
                    <span className={styles.badge}>{trails.length} trails</span>
                    <span className={styles.badge}>{pinpoints.length} pinpoints</span>
                    <span className={styles.badge}>Map: {basemapMode === 'satellite' ? 'Satellite' : 'Street'}</span>
                    <span className={styles.badge}>Sync: {syncState}</span>
                </div>
            </section>

            <section className={`panel ${styles.workspacePanel}`}>
                <div className={styles.topBar}>
                    <button type="button" className="soft-button" onClick={() => setGpsEnabled(prev => !prev)}>
                        {gpsEnabled ? 'Stop GPS' : 'GPS On/Off'}
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
                        {recordingTrail ? 'Stop Recording' : 'Record Trail'}
                    </button>
                    <button type="button" className="soft-button" onClick={saveWalkedTrail} disabled={walkedTrailDraft.length < 2}>
                        Save Trail
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

                    <aside className={styles.rightTools}>
                        <button
                            type="button"
                            className={toolMode === 'pin' ? styles.toolActive : styles.toolBtn}
                            onClick={() => setToolMode(prev => (prev === 'pin' ? 'idle' : 'pin'))}
                        >
                            {toolMode === 'pin' ? 'Pinpoint Mode On' : 'Add Pinpoint'}
                        </button>
                        <select value={pinDraftType} onChange={event => setPinDraftType(event.target.value as typeof pinDraftType)}>
                            {PIN_TYPES.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            className={toolMode === 'trail' ? styles.toolActive : styles.toolBtn}
                            onClick={() => setToolMode(prev => (prev === 'trail' ? 'idle' : 'trail'))}
                        >
                            {toolMode === 'trail' ? 'Trail Point Mode On' : 'Add Trail Point'}
                        </button>
                        <button
                            type="button"
                            className={autoFollow ? styles.toolActive : styles.toolBtn}
                            onClick={() => setAutoFollow(prev => !prev)}
                        >
                            {autoFollow ? 'Auto-follow On' : 'Auto-follow Off'}
                        </button>
                        <button type="button" className={styles.toolBtn} onClick={() => mapActionsRef.current?.fitBoundary()} disabled={!mapReady}>
                            Recenter Map
                        </button>
                        <button
                            type="button"
                            className={styles.toolBtn}
                            onClick={() => {
                                mapActionsRef.current?.refresh();
                                setStatus('Map tiles refreshed.');
                            }}
                            disabled={!mapReady}
                        >
                            Refresh Map Tiles
                        </button>
                        <button
                            type="button"
                            className={styles.toolBtn}
                            onClick={() => setBasemapMode(previous => (previous === 'satellite' ? 'street' : 'satellite'))}
                        >
                            {basemapMode === 'satellite' ? 'Switch to Street' : 'Switch to Satellite'}
                        </button>
                    </aside>
                </div>

                <div className={styles.diagnosticsRow}>
                    <span className={styles.diagnosticsChip}>Build: {PROPERTY_MAP_BUILD_STAMP}</span>
                    <span className={styles.diagnosticsChip}>Runtime SHA: {PROPERTY_MAP_RUNTIME_HASH}</span>
                    <span className={styles.diagnosticsChip}>Deployed At: {PROPERTY_MAP_DEPLOYED_AT}</span>
                    <span
                        className={`${styles.diagnosticsChip} ${mapDiagnostics.activeBasemapMode === 'forced-street-fallback'
                            ? styles.basemapChipForcedFallback
                            : mapDiagnostics.activeBasemapMode === 'satellite'
                                ? styles.basemapChipSatellite
                                : styles.basemapChipStreet
                            }`}
                    >
                        Basemap: {mapDiagnostics.activeBasemapMode === 'forced-street-fallback' ? 'forced-street-fallback' : mapDiagnostics.activeBasemapMode}
                    </span>
                    <span className={styles.diagnosticsChip}>Center: {mapDiagnostics.center[0].toFixed(5)}, {mapDiagnostics.center[1].toFixed(5)}</span>
                    <span className={styles.diagnosticsChip}>Zoom: {mapDiagnostics.zoom.toFixed(2)}</span>
                    <span className={styles.diagnosticsChip}>Boundary points: {mapDiagnostics.boundaryPointCount}</span>
                    <span className={`${styles.diagnosticsChip} ${mapDiagnostics.tileErrorCount > 0 ? styles.diagnosticsChipWarn : styles.diagnosticsChipOk}`}>
                        Tile errors: {mapDiagnostics.tileErrorCount}
                    </span>
                    <span className={`${styles.diagnosticsChip} ${networkOnline ? styles.diagnosticsChipOk : styles.diagnosticsChipWarn}`}>
                        Network: {networkOnline ? 'Online' : 'Offline'}
                    </span>
                </div>

                <div className={styles.statusRow}>
                    <span>{status}</span>
                    {liveGps && (
                        <span>
                            GPS {liveGps.lat.toFixed(6)}, {liveGps.lng.toFixed(6)} | Accuracy +/-{Math.round(liveGps.accuracyMeters)}m
                        </span>
                    )}
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
                {error && (
                    <div className={styles.errorBox}>
                        <div>{error}</div>
                        <div className={styles.inlineActions} style={{ marginTop: '0.55rem' }}>
                            <button type="button" className="soft-button" onClick={retrySupabaseConnection}>
                                Retry Connection
                            </button>
                            <button type="button" className="soft-button" onClick={resetOfflineCache}>
                                Reset Offline Cache
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section className={`panel ${styles.drawer}`}>
                <div className={styles.drawerTabs}>
                    {BOTTOM_DRAWER_TABS.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            className={drawerTab === tab.id ? styles.drawerTabActive : styles.drawerTab}
                            onClick={() => setDrawerTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {drawerTab === 'boundary' && (
                    <div className={styles.drawerContent}>
                        <div className={styles.inlineActions}>
                            <button type="button" className="soft-button" onClick={toggleBoundaryEditMode}>
                                {toolMode === 'boundary' ? 'Stop Editing Boundary' : 'Edit Boundary'}
                            </button>
                            <button type="button" className="soft-button" onClick={() => setBoundaryDraft(prev => prev.slice(0, -1))} disabled={boundaryDraft.length === 0}>
                                Undo Last Point
                            </button>
                            <button type="button" className="soft-button" onClick={() => setBoundaryDraft([])} disabled={boundaryDraft.length === 0}>
                                Clear Draft
                            </button>
                            <button type="button" className="soft-button" onClick={saveBoundaryDraft} disabled={boundaryDraft.length < 3}>
                                Save Boundary Polygon
                            </button>
                            <button type="button" className="soft-button" onClick={() => mapActionsRef.current?.fitBoundary()} disabled={!mapReady}>
                                Fit Full Property
                            </button>
                            <button type="button" className="soft-button" onClick={loadCurrentBoundaryIntoDraft}>
                                Load Current Boundary
                            </button>
                            <button type="button" className="soft-button" onClick={autoDraftBoundaryFromSavedData}>
                                Auto-Draft From Map Data
                            </button>
                        </div>
                        <div className={styles.inlineActions}>
                            <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(8, 0)}>
                                Nudge North
                            </button>
                            <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(-8, 0)}>
                                Nudge South
                            </button>
                            <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(0, -8)}>
                                Nudge West
                            </button>
                            <button type="button" className="soft-button" onClick={() => nudgeBoundaryDraft(0, 8)}>
                                Nudge East
                            </button>
                            <button type="button" className="soft-button" onClick={() => scaleBoundaryDraft(1.01)}>
                                Expand 1%
                            </button>
                            <button type="button" className="soft-button" onClick={() => scaleBoundaryDraft(0.99)}>
                                Tighten 1%
                            </button>
                        </div>
                        <div className={styles.helpText}>
                            Boundary polygon is synced to Supabase and shared with all family devices. Drag orange corners to move points, or drag blue midpoint handles to add new corners.
                        </div>
                    </div>
                )}

                {drawerTab === 'trails' && (
                    <div className={styles.drawerContent}>
                        <div className={styles.groupCard}>
                            <h4>Planned Trail Draft</h4>
                            <div className={styles.inlineActions}>
                                <input value={newTrailName} onChange={event => setNewTrailName(event.target.value)} placeholder="Trail name (optional)" />
                                <button type="button" className="soft-button" onClick={savePlannedTrail} disabled={plannedTrailDraft.length < 2}>
                                    Save Planned Trail
                                </button>
                                <button type="button" className="soft-button" onClick={() => setPlannedTrailDraft([])} disabled={plannedTrailDraft.length === 0}>
                                    Clear Draft Trail
                                </button>
                                <label className={styles.fileButton}>
                                    Import GPX
                                    <input type="file" accept=".gpx,application/gpx+xml,text/xml" onChange={importGpxFile} />
                                </label>
                            </div>
                            <div className={styles.helpText}>Draft points: {plannedTrailDraft.length}</div>
                        </div>

                        <div className={styles.groupCard}>
                            <h4>Saved Trails</h4>
                            <div className={styles.itemList}>
                                {trails.length === 0 && <div className={styles.helpText}>No saved trails yet.</div>}
                                {trails.map(trail => (
                                    <div key={trail.id} className={styles.itemRow}>
                                        <div>
                                            <div className={styles.itemTitle}>{trail.name}</div>
                                            <div className={styles.helpText}>
                                                {trail.type} | {trail.points.length} points | {formatDistance(trail.distanceMeters)} | {formatDuration(trail.durationSeconds)}
                                            </div>
                                        </div>
                                        <div className={styles.inlineActions}>
                                            <button type="button" className="soft-button" onClick={() => setSelectedTrailId(trail.id)}>
                                                Analytics
                                            </button>
                                            <button type="button" className="soft-button" onClick={() => setSelectedEntity({ type: 'trail', id: trail.id })}>
                                                Photos
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
                    </div>
                )}

                {drawerTab === 'photos' && (
                    <div className={styles.drawerContent}>
                        <div className={styles.groupCard}>
                            <h4>Attach Photos to Trail or Pinpoint</h4>
                            <div className={styles.inlineActions}>
                                <select
                                    value={selectedEntity ? `${selectedEntity.type}:${selectedEntity.id}` : ''}
                                    onChange={event => onSelectEntity(event.target.value)}
                                >
                                    <option value="">Select trail or pinpoint</option>
                                    {selectedEntityOptions.map(option => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <label className={styles.fileButton}>
                                    Upload Photos
                                    <input type="file" accept="image/*" multiple onChange={uploadPhotosToSelected} />
                                </label>
                            </div>
                        </div>

                        <div className={styles.photoGrid}>
                            {selectedEntityPhotos.length === 0 && <div className={styles.helpText}>No photos attached for the selected item yet.</div>}
                            {selectedEntityPhotos.map(photo => (
                                <figure key={photo.id} className={styles.photoCard}>
                                    {photo.url || photo.dataUrl ? (
                                        <Image src={photo.url || (photo.dataUrl as string)} alt={photo.name} width={300} height={200} unoptimized />
                                    ) : (
                                        <div className={styles.helpText}>Photo source unavailable until sync completes.</div>
                                    )}
                                    <figcaption>{photo.name}</figcaption>
                                    <button type="button" className="soft-button" onClick={() => removePhoto(photo.id)}>
                                        Remove Photo
                                    </button>
                                </figure>
                            ))}
                        </div>
                    </div>
                )}

                {drawerTab === 'io' && (
                    <div className={styles.drawerContent}>
                        <div className={styles.inlineActions}>
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
                        <div className={styles.helpText}>
                            Import/export gives device backup; Supabase sync and queue flush share updates across phones and PCs.
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
