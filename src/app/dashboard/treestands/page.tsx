'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';
import {
    buildDefaultBoundary,
    distancePointToPolygonEdgeMeters,
    isPointInsidePolygon,
    polygonAreaAcres
} from '../property-map/map-engine';
import {
    enqueueSnapshotSync,
    loadCachedSnapshot,
    saveCachedSnapshot
} from '../property-map/offline-sync';
import { filesToAttachments, removeAttachmentById } from '../property-map/photo-attachments';
import { getGeolocationPermissionState, startGpsTracking, type GpsTrackingHandle } from '../property-map/gps-tracking';
import { ensureSharedMap, loadSnapshotFromSupabase, syncSnapshotToSupabase } from '../property-map/supabase-map-sync';
import type { GpsFix, Pinpoint, PropertyMapSnapshot } from '../property-map/types';
import type { MapActions } from '../property-map/LeafletMapCanvas';
import styles from '../property-map/PropertyMapWorkspace.module.css';

const LeafletMapCanvas = dynamic(() => import('../property-map/LeafletMapCanvas'), {
    ssr: false,
    loading: () => <div className={styles.mapLoading}>Loading map...</div>
});

type AccessWindow = 'day' | 'weekend' | 'custom';
type AccessStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
type RequestMode = 'supabase' | 'local';

type PropertyAccessRequest = {
    id: string;
    map_id: string;
    feature_id: string | null;
    requester_name: string;
    request_window: AccessWindow;
    requested_date: string;
    return_date: string | null;
    notes: string | null;
    status: AccessStatus;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
};

const LOCAL_PROPERTY_ACCESS_REQUESTS_KEY = 'family-land-local-property-access-requests';
const ACCESS_REQUEST_TABLES = ['property_map_access_requests'];
const MAP_TABLES = ['property_maps', 'property_map_features'];
const OFFLINE_MAP_ID = 'offline-local-map';
const STAND_PIN_TYPES: Pinpoint['pinType'][] = ['treestand', 'range'];

const formatDate = (value: string) => new Date(value).toLocaleString();

const parseJson = <T,>(raw: string | null, fallback: T) => {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const requestWindowLabel = (value: AccessWindow) => {
    if (value === 'weekend') return 'Weekend';
    if (value === 'custom') return 'Custom';
    return 'Day';
};

const requestStatusLabel = (value: AccessStatus) => {
    if (value === 'approved') return 'Approved';
    if (value === 'declined') return 'Declined';
    if (value === 'cancelled') return 'Cancelled';
    return 'Pending';
};

const defaultSnapshot: PropertyMapSnapshot = {
    mapId: OFFLINE_MAP_ID,
    boundary: buildDefaultBoundary(),
    trails: [],
    pinpoints: []
};

const photoSrc = (photo: { url?: string; dataUrl?: string }) => photo.url || photo.dataUrl || '';

export default function TreestandsPage() {
    const router = useRouter();
    const supabase = supabaseClient();

    const [profileId, setProfileId] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<PropertyMapSnapshot>(defaultSnapshot);
    const [requestMode, setRequestMode] = useState<RequestMode>('supabase');
    const [setupNotice, setSetupNotice] = useState<string | null>(null);
    const [requests, setRequests] = useState<PropertyAccessRequest[]>([]);
    const [selectedPinId, setSelectedPinId] = useState('');
    const [requesterName, setRequesterName] = useState('');
    const [requestWindow, setRequestWindow] = useState<AccessWindow>('day');
    const [requestedDate, setRequestedDate] = useState(new Date().toISOString().slice(0, 10));
    const [returnDate, setReturnDate] = useState('');
    const [requestNotes, setRequestNotes] = useState('');
    const [loading, setLoading] = useState(true);
    const [savingRequest, setSavingRequest] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const [gpsOn, setGpsOn] = useState(false);
    const [liveGps, setLiveGps] = useState<GpsFix | null>(null);
    const gpsHandleRef = useRef<GpsTrackingHandle | null>(null);
    const mapActionsRef = useRef<MapActions | null>(null);

    const boundary = snapshot.boundary;

    const standPins = useMemo(
        () => snapshot.pinpoints.filter(pin => STAND_PIN_TYPES.includes(pin.pinType)),
        [snapshot.pinpoints]
    );

    const selectedPin = useMemo(
        () => standPins.find(pin => pin.id === selectedPinId) || standPins[0] || null,
        [standPins, selectedPinId]
    );

    const boundaryAreaAcres = useMemo(() => polygonAreaAcres(boundary.polygon), [boundary.polygon]);

    const requestsByPinId = useMemo(() => {
        const lookup = new Map<string, PropertyAccessRequest[]>();
        for (const request of requests) {
            if (!request.feature_id) continue;
            const existing = lookup.get(request.feature_id) || [];
            existing.push(request);
            lookup.set(request.feature_id, existing);
        }
        return lookup;
    }, [requests]);

    const activeRequests = useMemo(() => requests.filter(request => request.status === 'approved'), [requests]);

    const gpsStatusText = useMemo(() => {
        if (!liveGps) return null;
        if (boundary.polygon.length < 3) return 'GPS live, but no property boundary is saved yet.';

        const inside = isPointInsidePolygon([liveGps.lat, liveGps.lng], boundary.polygon);
        const edgeDistance = Math.max(0, Math.round(distancePointToPolygonEdgeMeters([liveGps.lat, liveGps.lng], boundary.polygon) ?? 0));

        return inside
            ? `You are inside the property boundary (~${edgeDistance}m from the nearest edge).`
            : `You are outside the property boundary (~${edgeDistance}m from the nearest edge).`;
    }, [liveGps, boundary.polygon]);

    const readLocalRequests = () => parseJson<PropertyAccessRequest[]>(window.localStorage.getItem(LOCAL_PROPERTY_ACCESS_REQUESTS_KEY), []);

    const loadRequests = async (mapId: string) => {
        if (!mapId) {
            setRequests([]);
            return;
        }

        if (requestMode === 'local') {
            setRequests(readLocalRequests().filter(request => request.map_id === mapId));
            return;
        }

        const { data, error: fetchError } = await supabase
            .from('property_map_access_requests')
            .select('*')
            .eq('map_id', mapId)
            .order('created_at', { ascending: false });

        if (fetchError) {
            throw fetchError;
        }

        setRequests((data || []) as PropertyAccessRequest[]);
    };

    useEffect(() => {
        const bootstrap = async () => {
            const cached = loadCachedSnapshot();
            if (cached) {
                setSnapshot(cached);
                setStatusMessage('Showing cached property map while connecting to shared data.');
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
                setRequesterName(user.email || 'Family Member');

                const map = await ensureSharedMap(supabase, user.id);
                const remoteSnapshot = await loadSnapshotFromSupabase(supabase, map.id);
                setSnapshot(remoteSnapshot);
                saveCachedSnapshot(remoteSnapshot);
                setStatusMessage('Live property map markers and photos loaded.');

                try {
                    await loadRequests(remoteSnapshot.mapId);
                } catch (err: any) {
                    if (isMissingTableSetupError(err, ACCESS_REQUEST_TABLES)) {
                        setRequestMode('local');
                        setSetupNotice('Property access requests table is missing. Requests are stored locally in this browser until you run supabase/property_map_access_requests.sql.');
                        setRequests(readLocalRequests().filter(request => request.map_id === remoteSnapshot.mapId));
                    } else {
                        setError(getSupabaseErrorMessage(err, 'Could not load access requests.'));
                    }
                }
            } catch (err: any) {
                const rawMessage = getSupabaseErrorMessage(err, '');
                const isFetchError = /failed to fetch/i.test(rawMessage);
                const missingMapTables = isMissingTableSetupError(err, MAP_TABLES);

                if (missingMapTables) {
                    setSetupNotice('Supabase property map tables are missing. Run supabase/property_maps.sql and supabase/storage_property_maps.sql, then add treestand/range markers on the Property Map page.');
                } else if (isFetchError) {
                    setError('Could not reach Supabase from this device. Check NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel and verify network access.');
                } else {
                    setError(getSupabaseErrorMessage(err, 'Could not load the property map.'));
                }
            } finally {
                setLoading(false);
            }
        };

        void bootstrap();

        return () => {
            gpsHandleRef.current?.stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedPinId && standPins[0]) {
            setSelectedPinId(standPins[0].id);
        }
    }, [selectedPinId, standPins]);

    const toggleGps = () => {
        if (gpsOn) {
            gpsHandleRef.current?.stop();
            gpsHandleRef.current = null;
            setGpsOn(false);
            return;
        }

        void getGeolocationPermissionState();
        const handle = startGpsTracking({
            onFix: fix => {
                setLiveGps(fix);
                setError(null);
            },
            onError: message => {
                setError(message);
                setGpsOn(false);
                gpsHandleRef.current = null;
            }
        });

        if (handle) {
            gpsHandleRef.current = handle;
            setGpsOn(true);
        }
    };

    const persistSnapshot = async (nextSnapshot: PropertyMapSnapshot, successMessage: string) => {
        setSnapshot(nextSnapshot);
        saveCachedSnapshot(nextSnapshot);

        if (!profileId) return;

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            enqueueSnapshotSync(nextSnapshot.mapId || OFFLINE_MAP_ID, nextSnapshot);
            setStatusMessage('Offline - saved on this device and will sync to the shared property map when back online.');
            return;
        }

        try {
            const synced = await syncSnapshotToSupabase(supabase, profileId, nextSnapshot);
            setSnapshot(synced);
            saveCachedSnapshot(synced);
            setStatusMessage(successMessage);
        } catch (err: any) {
            enqueueSnapshotSync(nextSnapshot.mapId || OFFLINE_MAP_ID, nextSnapshot);
            setError(getSupabaseErrorMessage(err, 'Could not sync to the shared property map. Saved on this device for now.'));
        }
    };

    const handleAddPhotos = async (event: ChangeEvent<HTMLInputElement>) => {
        if (!selectedPin) return;
        const files = event.target.files;
        event.target.value = '';
        if (!files || files.length === 0) return;

        setUploadingPhoto(true);
        setError(null);
        setStatusMessage(null);

        try {
            const newPhotos = await filesToAttachments(files);
            const nextSnapshot: PropertyMapSnapshot = {
                ...snapshot,
                pinpoints: snapshot.pinpoints.map(pin =>
                    pin.id === selectedPin.id
                        ? { ...pin, photos: [...pin.photos, ...newPhotos], updatedAt: new Date().toISOString() }
                        : pin
                )
            };

            await persistSnapshot(nextSnapshot, `Added ${newPhotos.length} photo(s) to ${selectedPin.title}. Visible on the Property Map page too.`);
        } catch (err: any) {
            setError(err?.message || 'Could not add photo.');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleRemovePhoto = async (photoId: string) => {
        if (!selectedPin) return;

        const nextSnapshot: PropertyMapSnapshot = {
            ...snapshot,
            pinpoints: snapshot.pinpoints.map(pin =>
                pin.id === selectedPin.id
                    ? { ...pin, photos: removeAttachmentById(pin.photos, photoId), updatedAt: new Date().toISOString() }
                    : pin
            )
        };

        await persistSnapshot(nextSnapshot, 'Photo removed and synced to the Property Map page.');
    };

    const saveRequest = async (event: FormEvent) => {
        event.preventDefault();

        if (!snapshot.mapId || !selectedPin) {
            setError('Choose a treestand or range first.');
            return;
        }

        const name = requesterName.trim();
        if (!name) {
            setError('Requester name is required.');
            return;
        }

        setSavingRequest(true);
        setError(null);
        setStatusMessage(null);

        const payload: PropertyAccessRequest = {
            id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            map_id: snapshot.mapId,
            feature_id: selectedPin.id,
            requester_name: name,
            request_window: requestWindow,
            requested_date: requestedDate,
            return_date: returnDate.trim() ? returnDate.trim() : null,
            notes: requestNotes.trim() || null,
            status: 'pending',
            created_by: profileId,
            updated_by: profileId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            if (requestMode === 'local') {
                const nextRequests = [payload, ...readLocalRequests()];
                window.localStorage.setItem(LOCAL_PROPERTY_ACCESS_REQUESTS_KEY, JSON.stringify(nextRequests));
                setRequests(nextRequests.filter(request => request.map_id === snapshot.mapId));
                setStatusMessage(`Saved a ${requestWindowLabel(requestWindow).toLowerCase()} request for ${selectedPin.title}.`);
                return;
            }

            const { error: insertError } = await supabase
                .from('property_map_access_requests')
                .insert(payload);

            if (insertError) {
                throw insertError;
            }

            await loadRequests(snapshot.mapId);
            setStatusMessage(`Saved a ${requestWindowLabel(requestWindow).toLowerCase()} request for ${selectedPin.title}.`);
        } catch (err: any) {
            if (isMissingTableSetupError(err, ACCESS_REQUEST_TABLES)) {
                setRequestMode('local');
                const nextRequests = [payload, ...readLocalRequests()];
                window.localStorage.setItem(LOCAL_PROPERTY_ACCESS_REQUESTS_KEY, JSON.stringify(nextRequests));
                setRequests(nextRequests.filter(request => request.map_id === snapshot.mapId));
                setSetupNotice(prev => prev
                    ? `${prev} Requests are stored locally until you run supabase/property_map_access_requests.sql.`
                    : 'Property access requests table is missing. Requests are stored locally in this browser until you run supabase/property_map_access_requests.sql.');
                setStatusMessage(`Saved a ${requestWindowLabel(requestWindow).toLowerCase()} request for ${selectedPin.title}.`);
            } else {
                setError(getSupabaseErrorMessage(err, 'Could not save access request.'));
            }
        } finally {
            setSavingRequest(false);
        }
    };

    const updateRequestStatus = async (requestId: string, nextStatus: AccessStatus) => {
        setError(null);
        setStatusMessage(null);

        try {
            if (requestMode === 'local') {
                const nowIso = new Date().toISOString();
                const nextRequests = readLocalRequests().map(request => (
                    request.id === requestId
                        ? { ...request, status: nextStatus, updated_at: nowIso }
                        : request
                ));

                window.localStorage.setItem(LOCAL_PROPERTY_ACCESS_REQUESTS_KEY, JSON.stringify(nextRequests));
                setRequests(nextRequests.filter(request => request.map_id === snapshot.mapId));
                return;
            }

            const { error: updateError } = await supabase
                .from('property_map_access_requests')
                .update({ status: nextStatus, updated_at: new Date().toISOString(), updated_by: profileId })
                .eq('id', requestId);

            if (updateError) {
                throw updateError;
            }

            await loadRequests(snapshot.mapId);
        } catch (err: any) {
            if (isMissingTableSetupError(err, ACCESS_REQUEST_TABLES)) {
                setRequestMode('local');
            }
            setError(getSupabaseErrorMessage(err, 'Could not update access request.'));
        }
    };

    if (loading) {
        return <div>Loading treestands and range markers...</div>;
    }

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link href="/dashboard" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Main Dashboard
                </Link>
                <Link href="/dashboard/property-map" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Property Map
                </Link>
                <Link href="/dashboard/treestands" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Treestands / Range
                </Link>
                <Link href="/dashboard/system" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    System Check
                </Link>
            </div>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gap: '0.25rem' }}>
                    <div style={{ fontSize: '0.84rem', opacity: 0.82 }}>Family Access Board</div>
                    <h2 style={{ margin: 0 }}>Treestands / Range</h2>
                    <div style={{ opacity: 0.8 }}>
                        Same boundary, markers, and photos as the Property Map page - keep the family aware of which stand or range is active and what needs to stay off-limits.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Markers: {standPins.length}</span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Approved requests: {activeRequests.length}</span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Property size: {boundaryAreaAcres.toFixed(2)} ac</span>
                </div>

                {setupNotice && (
                    <div style={{ border: '1px solid #d97706', borderRadius: 10, background: 'rgba(120, 53, 15, 0.38)', padding: '0.65rem 0.8rem', color: '#fde68a' }}>
                        {setupNotice}
                    </div>
                )}

                {statusMessage && <div style={{ color: '#86efac' }}>{statusMessage}</div>}
                {error && <div style={{ color: '#fca5a5' }}>{error}</div>}

                <div style={{ display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.5rem' }}>
                        <div style={{ fontWeight: 700 }}>Live Map View</div>
                        <div style={{ fontSize: '0.86rem', opacity: 0.78 }}>
                            The same boundary and markers saved on the property map page appear here automatically, including any photos attached to a treestand or range.
                        </div>

                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <button type="button" className="soft-button" onClick={toggleGps}>
                                {gpsOn ? 'Stop GPS' : 'Start GPS (where am I)'}
                            </button>
                            <button type="button" className="soft-button" onClick={() => mapActionsRef.current?.centerOnGps()} disabled={!liveGps}>
                                Center on Me
                            </button>
                            <button type="button" className="soft-button" onClick={() => mapActionsRef.current?.fitBoundary()}>
                                Fit Full Property
                            </button>
                        </div>

                        {gpsStatusText && <div style={{ fontSize: '0.86rem', opacity: 0.85 }}>{gpsStatusText}</div>}

                        <div className={styles.mapCanvasWrap} style={{ height: 360 }}>
                            <LeafletMapCanvas
                                boundary={boundary}
                                trails={[]}
                                selectedTrailId={null}
                                pinpoints={standPins}
                                walkedTrailDraft={[]}
                                plannedTrailDraft={[]}
                                boundaryDraft={[]}
                                liveGps={liveGps}
                                autoFollow={false}
                                basemapMode="satellite"
                                boundaryEditEnabled={false}
                                selectedPinId={selectedPin?.id || null}
                                onPinSelect={pinId => setSelectedPinId(pinId)}
                                onBoundaryDraftPointDrag={() => { }}
                                onBoundaryDraftInsertFromMidpoint={() => 0}
                                onMapClick={() => { }}
                                onMapReady={actions => {
                                    mapActionsRef.current = actions;
                                }}
                                onAutoFollowInterrupted={() => { }}
                                onDiagnosticsChange={() => { }}
                            />
                        </div>

                        {selectedPin && (
                            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.6rem', display: 'grid', gap: '0.45rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <div style={{ fontWeight: 700 }}>{selectedPin.title}</div>
                                    <div style={{ opacity: 0.8, textTransform: 'capitalize' }}>{selectedPin.pinType}</div>
                                </div>
                                <div style={{ fontSize: '0.88rem', opacity: 0.78 }}>
                                    {selectedPin.position[0].toFixed(6)}, {selectedPin.position[1].toFixed(6)}
                                </div>
                                {selectedPin.description && (
                                    <div style={{ fontSize: '0.86rem', opacity: 0.78 }}>{selectedPin.description}</div>
                                )}
                                <div style={{ fontSize: '0.86rem', opacity: 0.78 }}>
                                    Approved use: {requestsByPinId.get(selectedPin.id)?.find(request => request.status === 'approved')?.requester_name || 'None yet'}
                                </div>

                                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                    {selectedPin.photos.map(photo => (
                                        <div key={photo.id} style={{ position: 'relative' }}>
                                            <a href={photoSrc(photo)} target="_blank" rel="noreferrer">
                                                <img
                                                    src={photoSrc(photo)}
                                                    alt={photo.name}
                                                    style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #334155' }}
                                                />
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => void handleRemovePhoto(photo.id)}
                                                title="Remove photo"
                                                style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 999, border: '1px solid #334155', background: '#0f172a', color: '#fca5a5', cursor: 'pointer' }}
                                            >
                                                x
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <label className="soft-button" style={{ textAlign: 'center', cursor: 'pointer' }}>
                                    {uploadingPhoto ? 'Adding photo...' : 'Add Photo From Here'}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        multiple
                                        onChange={event => void handleAddPhotos(event)}
                                        disabled={uploadingPhoto}
                                        style={{ display: 'none' }}
                                    />
                                </label>

                                <Link href="/dashboard/property-map" className="soft-button" style={{ textDecoration: 'none', textAlign: 'center' }}>
                                    Edit on property map
                                </Link>
                            </div>
                        )}
                    </div>

                    <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.55rem' }}>
                        <div style={{ fontWeight: 700 }}>Request a Stand or Range</div>
                        <form onSubmit={saveRequest} style={{ display: 'grid', gap: '0.55rem' }}>
                            <label style={{ display: 'grid', gap: '0.25rem' }}>
                                <span>Choose marker</span>
                                <select value={selectedPin?.id || ''} onChange={e => setSelectedPinId(e.target.value)}>
                                    <option value="">Select a treestand or range</option>
                                    {standPins.map(pin => (
                                        <option key={pin.id} value={pin.id}>
                                            {pin.title} ({pin.pinType})
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ display: 'grid', gap: '0.25rem' }}>
                                <span>Your name</span>
                                <input value={requesterName} onChange={e => setRequesterName(e.target.value)} placeholder="Family member name" />
                            </label>
                            <div style={{ display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span>Use window</span>
                                    <select value={requestWindow} onChange={e => setRequestWindow(e.target.value as AccessWindow)}>
                                        <option value="day">Day</option>
                                        <option value="weekend">Weekend</option>
                                        <option value="custom">Custom</option>
                                    </select>
                                </label>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span>Requested date</span>
                                    <input type="date" value={requestedDate} onChange={e => setRequestedDate(e.target.value)} />
                                </label>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span>Return date / end date</span>
                                    <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
                                </label>
                            </div>
                            <label style={{ display: 'grid', gap: '0.25rem' }}>
                                <span>Notes</span>
                                <textarea value={requestNotes} onChange={e => setRequestNotes(e.target.value)} rows={3} placeholder="Who is going, what time, or any special notes" />
                            </label>
                            <button type="submit" className="soft-button" disabled={savingRequest}>
                                {savingRequest ? 'Saving request...' : 'Request use'}
                            </button>
                        </form>

                        <div style={{ borderTop: '1px solid #334155', paddingTop: '0.55rem', display: 'grid', gap: '0.45rem' }}>
                            <div style={{ fontWeight: 700 }}>Current Requests</div>
                            {requests.length === 0 && <div style={{ opacity: 0.75 }}>No requests yet.</div>}
                            {requests.map(request => {
                                const pin = standPins.find(item => item.id === request.feature_id) || null;
                                return (
                                    <div key={request.id} style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem', display: 'grid', gap: '0.35rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <strong>{request.requester_name}</strong>
                                            <span>{requestStatusLabel(request.status)} • {requestWindowLabel(request.request_window)}</span>
                                        </div>
                                        <div style={{ fontSize: '0.86rem', opacity: 0.8 }}>
                                            {pin?.title || 'Unknown marker'} • {request.requested_date}
                                            {request.return_date ? ` to ${request.return_date}` : ''}
                                        </div>
                                        {request.notes && <div style={{ fontSize: '0.84rem', opacity: 0.76 }}>{request.notes}</div>}
                                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                            <button type="button" className="soft-button" onClick={() => void updateRequestStatus(request.id, 'approved')}>
                                                Approve
                                            </button>
                                            <button type="button" className="soft-button" onClick={() => void updateRequestStatus(request.id, 'declined')}>
                                                Decline
                                            </button>
                                            <button type="button" className="soft-button" onClick={() => void updateRequestStatus(request.id, 'cancelled')}>
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gap: '0.45rem' }}>
                    <div style={{ fontWeight: 700 }}>Treestand / Range Database</div>
                    {standPins.length === 0 && <div style={{ opacity: 0.75 }}>No treestands or ranges have been mapped yet. Add one on the Property Map page.</div>}
                    {standPins.map(pin => {
                        const pinRequests = requestsByPinId.get(pin.id) || [];
                        const approved = pinRequests.find(request => request.status === 'approved');
                        const pending = pinRequests.filter(request => request.status === 'pending');
                        return (
                            <button
                                key={pin.id}
                                onClick={() => setSelectedPinId(pin.id)}
                                style={{
                                    textAlign: 'left',
                                    border: pin.id === selectedPin?.id ? '1px solid #60a5fa' : '1px solid #334155',
                                    borderRadius: 10,
                                    background: 'rgba(15, 23, 42, 0.78)',
                                    color: '#e2e8f0',
                                    padding: '0.65rem',
                                    cursor: 'pointer'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ fontWeight: 600 }}>{pin.title}</div>
                                    <div style={{ opacity: 0.78, textTransform: 'capitalize' }}>{pin.pinType} • {pin.photos.length} photo(s)</div>
                                </div>
                                <div style={{ opacity: 0.8, fontSize: '0.9rem', marginTop: '0.2rem' }}>
                                    Lat/Lng: {pin.position[0].toFixed(6)}, {pin.position[1].toFixed(6)}
                                    {approved ? ` • In use by ${approved.requester_name}` : ''}
                                    {pending.length > 0 ? ` • Pending requests: ${pending.length}` : ''}
                                </div>
                                <div style={{ opacity: 0.68, fontSize: '0.82rem', marginTop: '0.15rem' }}>
                                    Updated: {formatDate(pin.updatedAt)}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}