'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';

type StorageMode = 'supabase' | 'local';

type PropertyMap = {
    id: string;
    name: string;
    address: string;
    center_lat: number;
    center_lng: number;
    base_image_url: string | null;
    base_image_path: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

type PropertyMapFeature = {
    id: string;
    map_id: string;
    label: string;
    feature_type: string;
    status: string;
    description: string | null;
    x_percent: number;
    y_percent: number;
    lat: number | null;
    lng: number | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
};

type AccessWindow = 'day' | 'weekend' | 'custom';
type AccessStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

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

const LOCAL_PROPERTY_MAPS_KEY = 'family-land-local-property-maps';
const LOCAL_PROPERTY_MAP_FEATURES_KEY = 'family-land-local-property-map-features';
const LOCAL_PROPERTY_ACCESS_REQUESTS_KEY = 'family-land-local-property-access-requests';
const PROPERTY_MAP_TABLES = ['property_maps', 'property_map_features'];
const ACCESS_REQUEST_TABLES = ['property_map_access_requests'];
const FEATURE_TYPES = ['treestand', 'range'];

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

const featureStatusColor = (status: string) => {
    if (status === 'active') return '#22c55e';
    if (status === 'inactive') return '#64748b';
    if (status === 'requested') return '#f59e0b';
    if (status === 'blocked') return '#ef4444';
    if (status === 'completed') return '#10b981';
    return '#1d4ed8';
};

export default function TreestandsPage() {
    const router = useRouter();
    const supabase = supabaseClient();

    const [profileId, setProfileId] = useState<string | null>(null);
    const [storageMode, setStorageMode] = useState<StorageMode>('supabase');
    const [requestMode, setRequestMode] = useState<StorageMode>('supabase');
    const [setupNotice, setSetupNotice] = useState<string | null>(null);
    const [maps, setMaps] = useState<PropertyMap[]>([]);
    const [selectedMapId, setSelectedMapId] = useState('');
    const [features, setFeatures] = useState<PropertyMapFeature[]>([]);
    const [requests, setRequests] = useState<PropertyAccessRequest[]>([]);
    const [selectedFeatureId, setSelectedFeatureId] = useState('');
    const [requesterName, setRequesterName] = useState('');
    const [requestWindow, setRequestWindow] = useState<AccessWindow>('day');
    const [requestedDate, setRequestedDate] = useState(new Date().toISOString().slice(0, 10));
    const [returnDate, setReturnDate] = useState('');
    const [requestNotes, setRequestNotes] = useState('');
    const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingRequest, setSavingRequest] = useState(false);
    const [savingFeature, setSavingFeature] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const selectedMap = useMemo(
        () => maps.find(map => map.id === selectedMapId) || null,
        [maps, selectedMapId]
    );

    const treestandFeatures = useMemo(
        () => features.filter(feature => FEATURE_TYPES.includes(feature.feature_type)),
        [features]
    );

    const selectedFeature = useMemo(
        () => treestandFeatures.find(feature => feature.id === selectedFeatureId) || treestandFeatures[0] || null,
        [treestandFeatures, selectedFeatureId]
    );

    const requestsByFeatureId = useMemo(() => {
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
    const activeFeatureCount = useMemo(() => treestandFeatures.filter(feature => feature.status === 'active').length, [treestandFeatures]);
    const inactiveFeatureCount = useMemo(() => treestandFeatures.filter(feature => feature.status === 'inactive').length, [treestandFeatures]);

    const readLocalMaps = () => parseJson<PropertyMap[]>(window.localStorage.getItem(LOCAL_PROPERTY_MAPS_KEY), []);
    const readLocalFeatures = () => parseJson<PropertyMapFeature[]>(window.localStorage.getItem(LOCAL_PROPERTY_MAP_FEATURES_KEY), []);
    const readLocalRequests = () => parseJson<PropertyAccessRequest[]>(window.localStorage.getItem(LOCAL_PROPERTY_ACCESS_REQUESTS_KEY), []);

    const loadMaps = async () => {
        if (storageMode === 'local') {
            const localMaps = readLocalMaps();
            setMaps(localMaps);
            return localMaps[0]?.id || '';
        }

        const { data, error: fetchError } = await supabase
            .from('property_maps')
            .select('*')
            .order('created_at', { ascending: false });

        if (fetchError) {
            throw fetchError;
        }

        const nextMaps = (data || []) as PropertyMap[];
        setMaps(nextMaps);
        return nextMaps[0]?.id || '';
    };

    const loadFeatures = async (mapId: string) => {
        if (!mapId) {
            setFeatures([]);
            return [] as PropertyMapFeature[];
        }

        if (storageMode === 'local') {
            const localFeatures = readLocalFeatures().filter(feature => feature.map_id === mapId && FEATURE_TYPES.includes(feature.feature_type));
            setFeatures(localFeatures);
            return localFeatures;
        }

        const { data, error: fetchError } = await supabase
            .from('property_map_features')
            .select('*')
            .eq('map_id', mapId)
            .order('created_at', { ascending: true });

        if (fetchError) {
            throw fetchError;
        }

        const nextFeatures = ((data || []) as PropertyMapFeature[]).filter(feature => FEATURE_TYPES.includes(feature.feature_type));
        setFeatures(nextFeatures);
        return nextFeatures;
    };

    const loadRequests = async (mapId: string) => {
        if (!mapId) {
            setRequests([]);
            return;
        }

        if (requestMode === 'local') {
            const localRequests = readLocalRequests().filter(request => request.map_id === mapId);
            setRequests(localRequests);
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

    const resolveMapImageUrl = async (map: PropertyMap | null) => {
        if (!map) {
            setDisplayImageUrl(null);
            return;
        }

        if (storageMode === 'local') {
            setDisplayImageUrl(map.base_image_url);
            return;
        }

        if (!map.base_image_path) {
            setDisplayImageUrl(map.base_image_url);
            return;
        }

        const { data } = await supabase.storage
            .from('property-maps')
            .createSignedUrl(map.base_image_path, 60 * 60 * 24 * 14);

        setDisplayImageUrl(data?.signedUrl || map.base_image_url);
    };

    useEffect(() => {
        const bootstrap = async () => {
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

                let nextSelectedMapId = '';
                let useLocalMapData = false;

                try {
                    nextSelectedMapId = await loadMaps();
                } catch (err: any) {
                    if (isMissingTableSetupError(err, PROPERTY_MAP_TABLES)) {
                        useLocalMapData = true;
                        setStorageMode('local');
                        setSetupNotice('Supabase property map tables are missing. Treestands page is using local map data in this browser. Run supabase/property_maps.sql and supabase/storage_property_maps.sql to share data across devices.');
                        const localMaps = readLocalMaps();
                        setMaps(localMaps);
                        nextSelectedMapId = localMaps[0]?.id || '';
                    } else {
                        setError(getSupabaseErrorMessage(err, 'Could not load property maps.'));
                    }
                }

                setSelectedMapId(nextSelectedMapId);

                if (nextSelectedMapId) {
                    if (useLocalMapData) {
                        setFeatures(readLocalFeatures().filter(feature => feature.map_id === nextSelectedMapId && FEATURE_TYPES.includes(feature.feature_type)));
                        setRequests(readLocalRequests().filter(request => request.map_id === nextSelectedMapId));
                    } else {
                        try {
                            await loadFeatures(nextSelectedMapId);
                        } catch (err: any) {
                            setError(getSupabaseErrorMessage(err, 'Could not load treestand markers.'));
                        }

                        try {
                            await loadRequests(nextSelectedMapId);
                        } catch (err: any) {
                            if (isMissingTableSetupError(err, ACCESS_REQUEST_TABLES)) {
                                setRequestMode('local');
                                setSetupNotice(prev => prev
                                    ? `${prev} Requests are stored locally until you run supabase/property_map_access_requests.sql.`
                                    : 'Property access requests table is missing. Requests are stored locally in this browser until you run supabase/property_map_access_requests.sql.');
                                setRequests(readLocalRequests().filter(request => request.map_id === nextSelectedMapId));
                            } else {
                                setError(getSupabaseErrorMessage(err, 'Could not load access requests.'));
                            }
                        }
                    }
                }
            } catch (err: any) {
                setError(getSupabaseErrorMessage(err, 'Treestands page failed to load.'));
            } finally {
                setLoading(false);
            }
        };

        void bootstrap();
    }, []);

    useEffect(() => {
        void resolveMapImageUrl(selectedMap);
    }, [selectedMap?.id, selectedMap?.base_image_path, selectedMap?.base_image_url, storageMode]);

    useEffect(() => {
        if (!selectedFeatureId && treestandFeatures[0]) {
            setSelectedFeatureId(treestandFeatures[0].id);
        }
    }, [selectedFeatureId, treestandFeatures]);

    const featureRequestSummary = (featureId: string) => {
        const featureRequests = requestsByFeatureId.get(featureId) || [];
        const approved = featureRequests.find(request => request.status === 'approved') || null;
        const pending = featureRequests.filter(request => request.status === 'pending');
        return { approved, pending };
    };

    const saveFeatureStatus = async (featureId: string, nextStatus: string) => {
        setSavingFeature(featureId);
        setError(null);
        setStatusMessage(null);

        try {
            if (storageMode === 'local') {
                const nowIso = new Date().toISOString();
                const nextFeatures = readLocalFeatures().map(feature => (
                    feature.id === featureId
                        ? { ...feature, status: nextStatus, updated_at: nowIso }
                        : feature
                ));

                window.localStorage.setItem(LOCAL_PROPERTY_MAP_FEATURES_KEY, JSON.stringify(nextFeatures));
                setFeatures(nextFeatures.filter(feature => feature.map_id === selectedMapId && FEATURE_TYPES.includes(feature.feature_type)));
                setStatusMessage(`Updated ${selectedFeature?.label || 'feature'} to ${nextStatus}.`);
                return;
            }

            const { error: updateError } = await supabase
                .from('property_map_features')
                .update({ status: nextStatus, updated_at: new Date().toISOString(), updated_by: profileId })
                .eq('id', featureId);

            if (updateError) {
                throw updateError;
            }

            await loadFeatures(selectedMapId);
            setStatusMessage(`Updated ${selectedFeature?.label || 'feature'} to ${nextStatus}.`);
        } catch (err: any) {
            setError(getSupabaseErrorMessage(err, 'Could not update treestand status.'));
        } finally {
            setSavingFeature(null);
        }
    };

    const saveRequest = async (event: FormEvent) => {
        event.preventDefault();

        if (!selectedMapId || !selectedFeature) {
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
            map_id: selectedMapId,
            feature_id: selectedFeature.id,
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
                setRequests(nextRequests.filter(request => request.map_id === selectedMapId));
                setStatusMessage(`Saved a ${requestWindowLabel(requestWindow).toLowerCase()} request for ${selectedFeature.label}.`);
                return;
            }

            const { error: insertError } = await supabase
                .from('property_map_access_requests')
                .insert(payload);

            if (insertError) {
                throw insertError;
            }

            await loadRequests(selectedMapId);
            setStatusMessage(`Saved a ${requestWindowLabel(requestWindow).toLowerCase()} request for ${selectedFeature.label}.`);
        } catch (err: any) {
            if (isMissingTableSetupError(err, ACCESS_REQUEST_TABLES)) {
                setRequestMode('local');
                const nextRequests = [payload, ...readLocalRequests()];
                window.localStorage.setItem(LOCAL_PROPERTY_ACCESS_REQUESTS_KEY, JSON.stringify(nextRequests));
                setRequests(nextRequests.filter(request => request.map_id === selectedMapId));
                setSetupNotice(prev => prev
                    ? `${prev} Requests are stored locally until you run supabase/property_map_access_requests.sql.`
                    : 'Property access requests table is missing. Requests are stored locally in this browser until you run supabase/property_map_access_requests.sql.');
                setStatusMessage(`Saved a ${requestWindowLabel(requestWindow).toLowerCase()} request for ${selectedFeature.label}.`);
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
                setRequests(nextRequests.filter(request => request.map_id === selectedMapId));
                return;
            }

            const { error: updateError } = await supabase
                .from('property_map_access_requests')
                .update({ status: nextStatus, updated_at: new Date().toISOString(), updated_by: profileId })
                .eq('id', requestId);

            if (updateError) {
                throw updateError;
            }

            await loadRequests(selectedMapId);
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
                        Keep the family aware of which stand or range is active, who requested it, and what needs to stay off-limits.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Markers: {treestandFeatures.length}</span>
                    <span style={{ border: '1px solid #166534', borderRadius: 999, padding: '0.22rem 0.6rem', color: '#bbf7d0' }}>Active: {activeFeatureCount}</span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Inactive: {inactiveFeatureCount}</span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Approved requests: {activeRequests.length}</span>
                </div>

                {setupNotice && (
                    <div style={{ border: '1px solid #d97706', borderRadius: 10, background: 'rgba(120, 53, 15, 0.38)', padding: '0.65rem 0.8rem', color: '#fde68a' }}>
                        {setupNotice}
                    </div>
                )}

                {statusMessage && <div style={{ color: '#86efac' }}>{statusMessage}</div>}
                {error && <div style={{ color: '#fca5a5' }}>{error}</div>}

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {maps.map(map => (
                        <button
                            key={map.id}
                            onClick={async () => {
                                setSelectedMapId(map.id);
                                const nextFeatures = await loadFeatures(map.id);
                                setSelectedFeatureId(nextFeatures[0]?.id || '');
                                await loadRequests(map.id);
                            }}
                            className="soft-button"
                            style={{
                                borderColor: map.id === selectedMapId ? '#38bdf8' : '#475569',
                                background: map.id === selectedMapId ? 'rgba(30, 64, 175, 0.35)' : 'rgba(15, 23, 42, 0.8)'
                            }}
                        >
                            {map.name}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.5rem' }}>
                        <div style={{ fontWeight: 700 }}>Live Map View</div>
                        <div style={{ fontSize: '0.86rem', opacity: 0.78 }}>
                            The same markers saved on the property map page appear here automatically.
                        </div>
                        <div style={{ position: 'relative', width: '100%', minHeight: 320, borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', background: 'linear-gradient(145deg, #0b1220, #13213e)' }}>
                            {displayImageUrl ? (
                                <img
                                    src={displayImageUrl}
                                    alt="Property map base"
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                                />
                            ) : (
                                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: 0.8, padding: '1rem', textAlign: 'center' }}>
                                    Add or select a property map to see treestand and range markers here.
                                </div>
                            )}

                            {treestandFeatures.map(feature => {
                                const selected = feature.id === selectedFeature?.id;
                                const featureRequests = featureRequestSummary(feature.id);
                                return (
                                    <button
                                        key={feature.id}
                                        type="button"
                                        onClick={() => setSelectedFeatureId(feature.id)}
                                        style={{
                                            position: 'absolute',
                                            left: `${feature.x_percent}%`,
                                            top: `${feature.y_percent}%`,
                                            transform: 'translate(-50%, -50%)',
                                            width: selected ? 30 : 26,
                                            height: selected ? 30 : 26,
                                            borderRadius: 999,
                                            border: selected ? '2px solid #f8fafc' : '1px solid #93c5fd',
                                            background: featureStatusColor(feature.status),
                                            color: '#f8fafc',
                                            fontWeight: 700,
                                            display: 'grid',
                                            placeItems: 'center',
                                            cursor: 'pointer',
                                            boxShadow: selected ? '0 0 0 2px rgba(125, 211, 252, 0.35)' : 'none'
                                        }}
                                        title={`${feature.label} (${feature.feature_type})`}
                                    >
                                        {feature.feature_type === 'treestand' ? 'S' : 'R'}
                                        {featureRequests.approved && (
                                            <span style={{ position: 'absolute', top: -16, left: '50%', transform: 'translateX(-50%)', fontSize: '0.62rem', color: '#bbf7d0', whiteSpace: 'nowrap' }}>
                                                {featureRequests.approved.requester_name}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {selectedFeature && (
                            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.6rem', display: 'grid', gap: '0.45rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <div style={{ fontWeight: 700 }}>{selectedFeature.label}</div>
                                    <div style={{ opacity: 0.8, textTransform: 'capitalize' }}>{selectedFeature.feature_type} • {selectedFeature.status}</div>
                                </div>
                                <div style={{ fontSize: '0.88rem', opacity: 0.78 }}>
                                    X {selectedFeature.x_percent.toFixed(2)}% / Y {selectedFeature.y_percent.toFixed(2)}%
                                    {selectedFeature.lat !== null && selectedFeature.lng !== null ? ` • ${selectedFeature.lat}, ${selectedFeature.lng}` : ''}
                                </div>
                                <div style={{ fontSize: '0.86rem', opacity: 0.78 }}>
                                    Approved use: {featureRequestSummary(selectedFeature.id).approved?.requester_name || 'None yet'}
                                </div>
                                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                    <button type="button" className="soft-button" onClick={() => void saveFeatureStatus(selectedFeature.id, 'active')} disabled={savingFeature === selectedFeature.id}>
                                        Mark active
                                    </button>
                                    <button type="button" className="soft-button" onClick={() => void saveFeatureStatus(selectedFeature.id, 'inactive')} disabled={savingFeature === selectedFeature.id}>
                                        Mark inactive
                                    </button>
                                    <Link href="/dashboard/property-map" className="soft-button" style={{ textDecoration: 'none' }}>
                                        Edit on property map
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.55rem' }}>
                        <div style={{ fontWeight: 700 }}>Request a Stand or Range</div>
                        <form onSubmit={saveRequest} style={{ display: 'grid', gap: '0.55rem' }}>
                            <label style={{ display: 'grid', gap: '0.25rem' }}>
                                <span>Choose marker</span>
                                <select value={selectedFeature?.id || ''} onChange={e => setSelectedFeatureId(e.target.value)}>
                                    <option value="">Select a treestand or range</option>
                                    {treestandFeatures.map(feature => (
                                        <option key={feature.id} value={feature.id}>
                                            {feature.label} ({feature.feature_type})
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
                                const feature = treestandFeatures.find(item => item.id === request.feature_id) || null;
                                return (
                                    <div key={request.id} style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem', display: 'grid', gap: '0.35rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <strong>{request.requester_name}</strong>
                                            <span>{requestStatusLabel(request.status)} • {requestWindowLabel(request.request_window)}</span>
                                        </div>
                                        <div style={{ fontSize: '0.86rem', opacity: 0.8 }}>
                                            {feature?.label || 'Unknown marker'} • {request.requested_date}
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
                    {treestandFeatures.length === 0 && <div style={{ opacity: 0.75 }}>No treestands or ranges have been mapped yet.</div>}
                    {treestandFeatures.map(feature => {
                        const summary = featureRequestSummary(feature.id);
                        return (
                            <button
                                key={feature.id}
                                onClick={() => setSelectedFeatureId(feature.id)}
                                style={{
                                    textAlign: 'left',
                                    border: feature.id === selectedFeature?.id ? '1px solid #60a5fa' : '1px solid #334155',
                                    borderRadius: 10,
                                    background: 'rgba(15, 23, 42, 0.78)',
                                    color: '#e2e8f0',
                                    padding: '0.65rem',
                                    cursor: 'pointer'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ fontWeight: 600 }}>{feature.label}</div>
                                    <div style={{ opacity: 0.78, textTransform: 'capitalize' }}>{feature.feature_type} • {feature.status}</div>
                                </div>
                                <div style={{ opacity: 0.8, fontSize: '0.9rem', marginTop: '0.2rem' }}>
                                    X:{' '}{feature.x_percent.toFixed(2)}% Y:{' '}{feature.y_percent.toFixed(2)}%
                                    {feature.lat !== null && feature.lng !== null ? ` • Lat/Lng: ${feature.lat}, ${feature.lng}` : ''}
                                    {summary.approved ? ` • In use by ${summary.approved.requester_name}` : ''}
                                    {summary.pending.length > 0 ? ` • Pending requests: ${summary.pending.length}` : ''}
                                </div>
                                <div style={{ opacity: 0.68, fontSize: '0.82rem', marginTop: '0.15rem' }}>
                                    Updated: {formatDate(feature.updated_at)}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}