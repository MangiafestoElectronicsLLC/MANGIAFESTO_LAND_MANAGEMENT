'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorCode, getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';
import ConnectionDiagnostics from '@/components/ConnectionDiagnostics';

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

const DEFAULT_ADDRESS = '825 West Ave, Brockport, NY';
const DEFAULT_LAT = 43.2180558;
const DEFAULT_LNG = -77.9778462;

const FEATURE_TYPES = ['build', 'trail', 'gate', 'road', 'utility', 'water', 'note'];
const FEATURE_STATUS = ['planned', 'active', 'completed', 'blocked'];
const LOCAL_PROPERTY_MAPS_KEY = 'family-land-local-property-maps';
const LOCAL_PROPERTY_MAP_FEATURES_KEY = 'family-land-local-property-map-features';

const parseJson = <T,>(raw: string | null, fallback: T) => {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const PROPERTY_MAP_TABLES = ['property_maps', 'property_map_features'];

const formatDate = (value: string) => new Date(value).toLocaleString();

export default function PropertyMapPage() {
    const router = useRouter();
    const supabase = supabaseClient();

    const [profileId, setProfileId] = useState<string | null>(null);
    const [storageMode, setStorageMode] = useState<StorageMode>('supabase');
    const [setupNotice, setSetupNotice] = useState<string | null>(null);
    const [maps, setMaps] = useState<PropertyMap[]>([]);
    const [selectedMapId, setSelectedMapId] = useState<string>('');
    const [features, setFeatures] = useState<PropertyMapFeature[]>([]);
    const [selectedFeatureId, setSelectedFeatureId] = useState<string>('');

    const [mapName, setMapName] = useState('Family Property Map');
    const [mapAddress, setMapAddress] = useState(DEFAULT_ADDRESS);
    const [mapLat, setMapLat] = useState(String(DEFAULT_LAT));
    const [mapLng, setMapLng] = useState(String(DEFAULT_LNG));
    const [mapImageFile, setMapImageFile] = useState<File | null>(null);

    const [featureLabel, setFeatureLabel] = useState('');
    const [featureType, setFeatureType] = useState('build');
    const [featureStatus, setFeatureStatus] = useState('planned');
    const [featureDescription, setFeatureDescription] = useState('');
    const [featureX, setFeatureX] = useState('50');
    const [featureY, setFeatureY] = useState('50');
    const [featureLat, setFeatureLat] = useState('');
    const [featureLng, setFeatureLng] = useState('');

    const [loading, setLoading] = useState(true);
    const [savingMap, setSavingMap] = useState(false);
    const [savingFeature, setSavingFeature] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [diagnosticLastOperation, setDiagnosticLastOperation] = useState('Startup checks');
    const [diagnosticLastUpdatedAt, setDiagnosticLastUpdatedAt] = useState<string | null>(null);
    const [diagnosticErrorCode, setDiagnosticErrorCode] = useState<string | null>(null);
    const [diagnosticErrorMessage, setDiagnosticErrorMessage] = useState<string | null>(null);

    const selectedMap = useMemo(
        () => maps.find(map => map.id === selectedMapId) || null,
        [maps, selectedMapId]
    );

    const selectedFeature = useMemo(
        () => features.find(feature => feature.id === selectedFeatureId) || null,
        [features, selectedFeatureId]
    );

    const setDiagnosticSuccess = (operation: string) => {
        setDiagnosticLastOperation(operation);
        setDiagnosticLastUpdatedAt(new Date().toISOString());
        setDiagnosticErrorCode(null);
        setDiagnosticErrorMessage(null);
    };

    const setDiagnosticFailure = (operation: string, err: unknown, fallbackMessage: string) => {
        const message = getSupabaseErrorMessage(err, fallbackMessage);
        const code = getSupabaseErrorCode(err);
        setDiagnosticLastOperation(operation);
        setDiagnosticLastUpdatedAt(new Date().toISOString());
        setDiagnosticErrorCode(code);
        setDiagnosticErrorMessage(message);
        return message;
    };

    const readLocalMaps = () =>
        parseJson<PropertyMap[]>(window.localStorage.getItem(LOCAL_PROPERTY_MAPS_KEY), []);

    const readLocalFeatures = () =>
        parseJson<PropertyMapFeature[]>(window.localStorage.getItem(LOCAL_PROPERTY_MAP_FEATURES_KEY), []);

    const saveLocalMaps = (nextMaps: PropertyMap[]) => {
        window.localStorage.setItem(LOCAL_PROPERTY_MAPS_KEY, JSON.stringify(nextMaps));
    };

    const saveLocalFeatures = (nextFeatures: PropertyMapFeature[]) => {
        window.localStorage.setItem(LOCAL_PROPERTY_MAP_FEATURES_KEY, JSON.stringify(nextFeatures));
    };

    const loadFeatures = async (mapId: string) => {
        if (!mapId) {
            setFeatures([]);
            return;
        }

        if (storageMode === 'local') {
            const localFeatures = readLocalFeatures().filter(feature => feature.map_id === mapId);
            setFeatures(localFeatures);
            return;
        }

        const { data, error: fetchError } = await supabase
            .from('property_map_features')
            .select('*')
            .eq('map_id', mapId)
            .order('created_at', { ascending: true });

        if (fetchError) {
            throw fetchError;
        }

        setFeatures((data || []) as PropertyMapFeature[]);
    };

    const loadMaps = async () => {
        if (storageMode === 'local') {
            const localMaps = readLocalMaps();
            setMaps(localMaps);

            const nextSelectedMapId = selectedMapId || localMaps[0]?.id || '';
            setSelectedMapId(nextSelectedMapId);
            if (nextSelectedMapId) {
                await loadFeatures(nextSelectedMapId);
            } else {
                setFeatures([]);
            }
            return;
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

        const nextSelectedMapId = selectedMapId || nextMaps[0]?.id || '';
        setSelectedMapId(nextSelectedMapId);
        if (nextSelectedMapId) {
            await loadFeatures(nextSelectedMapId);
        } else {
            setFeatures([]);
        }
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
                await loadMaps();
                setDiagnosticSuccess('Load maps and features');
            } catch (err: any) {
                const message = setDiagnosticFailure('Load maps and features', err, 'Could not load property maps.');
                if (isMissingTableSetupError(err, PROPERTY_MAP_TABLES)) {
                    setStorageMode('local');
                    setSetupNotice('Supabase property map tables are missing. Local property map mode is active for this browser. Run supabase/property_maps.sql and supabase/storage_property_maps.sql, then refresh to return to Supabase mode.');
                    const localMaps = readLocalMaps();
                    const localFeatures = readLocalFeatures();
                    setMaps(localMaps);
                    const nextSelectedMapId = localMaps[0]?.id || '';
                    setSelectedMapId(nextSelectedMapId);
                    setFeatures(localFeatures.filter(feature => feature.map_id === nextSelectedMapId));
                } else {
                    setError(message);
                }
            } finally {
                setLoading(false);
            }
        };

        bootstrap();
    }, []);

    const retrySupabaseMode = async () => {
        setError(null);
        setStatusMessage('Retrying Supabase property map mode...');

        try {
            const { data: nextMapsData, error: mapsError } = await supabase
                .from('property_maps')
                .select('*')
                .order('created_at', { ascending: false });

            if (mapsError) {
                throw mapsError;
            }

            const nextMaps = (nextMapsData || []) as PropertyMap[];
            const nextSelectedMapId = nextMaps[0]?.id || '';

            let nextFeatures: PropertyMapFeature[] = [];
            if (nextSelectedMapId) {
                const { data: nextFeaturesData, error: featuresError } = await supabase
                    .from('property_map_features')
                    .select('*')
                    .eq('map_id', nextSelectedMapId)
                    .order('created_at', { ascending: true });

                if (featuresError) {
                    throw featuresError;
                }

                nextFeatures = (nextFeaturesData || []) as PropertyMapFeature[];
            }

            setStorageMode('supabase');
            setSetupNotice(null);
            setMaps(nextMaps);
            setSelectedMapId(nextSelectedMapId);
            setSelectedFeatureId('');
            setFeatures(nextFeatures);
            setDiagnosticSuccess('Retry Supabase mode');
            setStatusMessage('Supabase mode restored.');
        } catch (err: any) {
            const message = setDiagnosticFailure('Retry Supabase mode', err, 'Supabase property map mode is still unavailable.');
            if (isMissingTableSetupError(err, PROPERTY_MAP_TABLES)) {
                setStorageMode('local');
                setSetupNotice('Supabase property map tables are still unavailable. Keep using local mode or run supabase/property_maps.sql and supabase/storage_property_maps.sql, then retry.');
            } else {
                setStorageMode('supabase');
                setSetupNotice(null);
            }
            setError(message);
        }
    };

    useEffect(() => {
        if (!selectedMap) return;

        setMapName(selectedMap.name || 'Family Property Map');
        setMapAddress(selectedMap.address || DEFAULT_ADDRESS);
        setMapLat(String(selectedMap.center_lat || DEFAULT_LAT));
        setMapLng(String(selectedMap.center_lng || DEFAULT_LNG));
    }, [selectedMap]);

    useEffect(() => {
        if (!selectedFeature) {
            setFeatureLabel('');
            setFeatureType('build');
            setFeatureStatus('planned');
            setFeatureDescription('');
            return;
        }

        setFeatureLabel(selectedFeature.label);
        setFeatureType(selectedFeature.feature_type);
        setFeatureStatus(selectedFeature.status);
        setFeatureDescription(selectedFeature.description || '');
        setFeatureX(String(selectedFeature.x_percent));
        setFeatureY(String(selectedFeature.y_percent));
        setFeatureLat(selectedFeature.lat === null ? '' : String(selectedFeature.lat));
        setFeatureLng(selectedFeature.lng === null ? '' : String(selectedFeature.lng));
    }, [selectedFeature]);

    const mapCenterHref = useMemo(() => {
        const addressQuery = mapAddress.trim();
        if (addressQuery) {
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`;
        }

        const lat = Number(mapLat);
        const lng = Number(mapLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapAddress || DEFAULT_ADDRESS)}`;
        }

        return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }, [mapAddress, mapLat, mapLng]);

    const mapCoordinatesHref = useMemo(() => {
        const lat = Number(mapLat);
        const lng = Number(mapLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(DEFAULT_ADDRESS)}`;
        }
        return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }, [mapLat, mapLng]);

    const saveMap = async (e: FormEvent) => {
        e.preventDefault();
        setSavingMap(true);
        setError(null);
        setStatusMessage(null);

        try {
            const lat = Number(mapLat);
            const lng = Number(mapLng);

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                setError('Map center latitude/longitude must be valid numbers.');
                setSavingMap(false);
                return;
            }

            let nextImageUrl = selectedMap?.base_image_url || null;
            let nextImagePath = selectedMap?.base_image_path || null;

            if (mapImageFile && profileId && storageMode === 'supabase') {
                const extension = mapImageFile.name.split('.').pop() || 'jpg';
                const filePath = `${profileId}/${Date.now()}-property-map.${extension}`;

                const { error: uploadError } = await supabase.storage
                    .from('property-maps')
                    .upload(filePath, mapImageFile, { upsert: true });

                if (uploadError) {
                    throw uploadError;
                }

                const { data: publicData } = supabase.storage
                    .from('property-maps')
                    .getPublicUrl(filePath);

                nextImagePath = filePath;
                nextImageUrl = publicData.publicUrl;
            } else if (mapImageFile && storageMode === 'local') {
                nextImageUrl = URL.createObjectURL(mapImageFile);
                nextImagePath = null;
            }

            if (storageMode === 'local') {
                const nowIso = new Date().toISOString();
                const nextMap: PropertyMap = selectedMap
                    ? {
                        ...selectedMap,
                        name: mapName.trim() || 'Family Property Map',
                        address: mapAddress.trim() || DEFAULT_ADDRESS,
                        center_lat: lat,
                        center_lng: lng,
                        base_image_url: nextImageUrl,
                        base_image_path: nextImagePath,
                        updated_at: nowIso
                    }
                    : {
                        id: `local-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        name: mapName.trim() || 'Family Property Map',
                        address: mapAddress.trim() || DEFAULT_ADDRESS,
                        center_lat: lat,
                        center_lng: lng,
                        base_image_url: nextImageUrl,
                        base_image_path: nextImagePath,
                        created_by: profileId,
                        created_at: nowIso,
                        updated_at: nowIso
                    };

                const nextMaps = selectedMap
                    ? maps.map(map => (map.id === selectedMap.id ? nextMap : map))
                    : [nextMap, ...maps];

                setMaps(nextMaps);
                saveLocalMaps(nextMaps);
                setSelectedMapId(nextMap.id);
                setStatusMessage(selectedMap ? 'Property map updated in local mode.' : 'Property map created in local mode.');
                setMapImageFile(null);
                setSavingMap(false);
                return;
            }

            if (!selectedMap?.id) {
                const { data, error: insertError } = await supabase
                    .from('property_maps')
                    .insert({
                        name: mapName.trim() || 'Family Property Map',
                        address: mapAddress.trim() || DEFAULT_ADDRESS,
                        center_lat: lat,
                        center_lng: lng,
                        base_image_url: nextImageUrl,
                        base_image_path: nextImagePath,
                        created_by: profileId
                    })
                    .select('*')
                    .single();

                if (insertError) {
                    throw insertError;
                }

                const createdMap = data as PropertyMap;
                setSelectedMapId(createdMap.id);
                setStatusMessage('Property map created. You can now add features like builds and trails.');
            } else {
                const { error: updateError } = await supabase
                    .from('property_maps')
                    .update({
                        name: mapName.trim() || 'Family Property Map',
                        address: mapAddress.trim() || DEFAULT_ADDRESS,
                        center_lat: lat,
                        center_lng: lng,
                        base_image_url: nextImageUrl,
                        base_image_path: nextImagePath,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', selectedMap.id);

                if (updateError) {
                    throw updateError;
                }

                setStatusMessage('Property map updated.');
            }

            setMapImageFile(null);
            await loadMaps();
        } catch (err: any) {
            setError(err?.message || 'Could not save property map.');
        } finally {
            setSavingMap(false);
        }
    };

    const onMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;

        setFeatureX(Math.min(100, Math.max(0, x)).toFixed(2));
        setFeatureY(Math.min(100, Math.max(0, y)).toFixed(2));
    };

    const saveFeature = async (e: FormEvent) => {
        e.preventDefault();
        if (!selectedMap?.id) {
            setError('Create or select a property map first.');
            return;
        }

        setSavingFeature(true);
        setError(null);
        setStatusMessage(null);

        try {
            const xPercent = Number(featureX);
            const yPercent = Number(featureY);
            if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
                setError('Marker X/Y percentages must be valid numbers.');
                setSavingFeature(false);
                return;
            }

            const payload = {
                map_id: selectedMap.id,
                label: featureLabel.trim() || 'Map feature',
                feature_type: featureType,
                status: featureStatus,
                description: featureDescription.trim() || null,
                x_percent: Math.min(100, Math.max(0, xPercent)),
                y_percent: Math.min(100, Math.max(0, yPercent)),
                lat: featureLat.trim() ? Number(featureLat) : null,
                lng: featureLng.trim() ? Number(featureLng) : null,
                created_by: profileId,
                updated_by: profileId
            };

            if (storageMode === 'local') {
                const nowIso = new Date().toISOString();
                const nextFeatures = selectedFeature
                    ? readLocalFeatures().map(feature =>
                        feature.id === selectedFeature.id
                            ? {
                                ...feature,
                                ...payload,
                                id: feature.id,
                                created_at: feature.created_at,
                                updated_at: nowIso
                            }
                            : feature
                    )
                    : [
                        ...readLocalFeatures(),
                        {
                            id: `local-feature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            ...payload,
                            created_at: nowIso,
                            updated_at: nowIso
                        } as PropertyMapFeature
                    ];

                saveLocalFeatures(nextFeatures);
                setFeatures(nextFeatures.filter(feature => feature.map_id === selectedMap.id));
                setSelectedFeatureId('');
                setStatusMessage(selectedFeature ? 'Feature updated in local mode.' : 'Feature added in local mode.');
                setSavingFeature(false);
                return;
            }

            if (selectedFeature?.id) {
                const { error: updateError } = await supabase
                    .from('property_map_features')
                    .update({
                        ...payload,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', selectedFeature.id);

                if (updateError) {
                    throw updateError;
                }

                setStatusMessage('Feature updated.');
            } else {
                const { error: insertError } = await supabase
                    .from('property_map_features')
                    .insert(payload);

                if (insertError) {
                    throw insertError;
                }

                setStatusMessage('Feature added to property map.');
            }

            setSelectedFeatureId('');
            await loadFeatures(selectedMap.id);
        } catch (err: any) {
            setError(err?.message || 'Could not save map feature.');
        } finally {
            setSavingFeature(false);
        }
    };

    const deleteFeature = async () => {
        if (!selectedFeature?.id || !selectedMap?.id) return;

        setError(null);
        setStatusMessage(null);

        if (storageMode === 'local') {
            const nextFeatures = readLocalFeatures().filter(feature => feature.id !== selectedFeature.id);
            saveLocalFeatures(nextFeatures);
            setFeatures(nextFeatures.filter(feature => feature.map_id === selectedMap.id));
            setSelectedFeatureId('');
            setStatusMessage('Feature deleted in local mode.');
            return;
        }

        const { error: deleteError } = await supabase
            .from('property_map_features')
            .delete()
            .eq('id', selectedFeature.id);

        if (deleteError) {
            setError(deleteError.message || 'Could not delete feature.');
            return;
        }

        setSelectedFeatureId('');
        setStatusMessage('Feature deleted.');
        await loadFeatures(selectedMap.id);
    };

    if (loading) {
        return <div>Loading property maps...</div>;
    }

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link href="/dashboard" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Main Dashboard
                </Link>
                <Link href="/dashboard/tickets" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Tickets
                </Link>
                <Link href="/dashboard/system" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    System Check
                </Link>
            </div>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gap: '0.25rem' }}>
                    <div style={{ fontSize: '0.84rem', opacity: 0.82 }}>Property Planner</div>
                    <h2 style={{ margin: 0 }}>Property Map: 825 West Ave, Brockport</h2>
                    <div style={{ opacity: 0.8 }}>
                        Add and update build plans, trails, gates, and notes on the property map. Click the map to position feature markers.
                    </div>
                </div>

                {statusMessage && <div style={{ color: '#86efac' }}>{statusMessage}</div>}
                {error && <div style={{ color: '#fca5a5' }}>{error}</div>}
                <ConnectionDiagnostics
                    mode={storageMode}
                    contextLabel="Property map"
                    lastOperation={diagnosticLastOperation}
                    lastUpdatedAt={diagnosticLastUpdatedAt}
                    errorCode={diagnosticErrorCode}
                    errorMessage={diagnosticErrorMessage}
                />
                {setupNotice && (
                    <div
                        style={{
                            border: '1px solid #d97706',
                            borderRadius: 10,
                            background: 'rgba(120, 53, 15, 0.38)',
                            padding: '0.65rem 0.8rem',
                            color: '#fde68a',
                            display: 'grid',
                            gap: '0.5rem'
                        }}
                    >
                        <div>{setupNotice}</div>
                        <button
                            type="button"
                            onClick={retrySupabaseMode}
                            className="soft-button"
                            style={{ width: 'fit-content', borderColor: '#f59e0b', color: '#fde68a' }}
                        >
                            Retry Supabase mode
                        </button>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    {maps.map(map => (
                        <button
                            key={map.id}
                            onClick={async () => {
                                setSelectedMapId(map.id);
                                setSelectedFeatureId('');
                                await loadFeatures(map.id);
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

                <form onSubmit={saveMap} style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Map name</span>
                        <input value={mapName} onChange={e => setMapName(e.target.value)} placeholder="Family Property Map" />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Address</span>
                        <input value={mapAddress} onChange={e => setMapAddress(e.target.value)} placeholder={DEFAULT_ADDRESS} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Center latitude</span>
                        <input value={mapLat} onChange={e => setMapLat(e.target.value)} placeholder={String(DEFAULT_LAT)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Center longitude</span>
                        <input value={mapLng} onChange={e => setMapLng(e.target.value)} placeholder={String(DEFAULT_LNG)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Base map image (optional)</span>
                        <input type="file" accept="image/*" onChange={e => setMapImageFile(e.target.files?.[0] || null)} />
                    </label>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="submit" className="soft-button" disabled={savingMap}>
                            {savingMap ? 'Saving map...' : selectedMap ? 'Update map' : 'Create map'}
                        </button>
                        <a href={mapCenterHref} target="_blank" rel="noreferrer" className="soft-button" style={{ textDecoration: 'none' }}>
                            Open address in Google Maps
                        </a>
                        <a href={mapCoordinatesHref} target="_blank" rel="noreferrer" className="soft-button" style={{ textDecoration: 'none' }}>
                            Open lat/lng in Google Maps
                        </a>
                    </div>
                </form>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gap: '0.2rem' }}>
                    <div style={{ fontWeight: 700 }}>Map Canvas</div>
                    <div style={{ opacity: 0.78, fontSize: '0.9rem' }}>Click anywhere on the map area to set marker position for the next feature.</div>
                </div>

                <div
                    onClick={onMapClick}
                    style={{
                        position: 'relative',
                        width: '100%',
                        minHeight: 360,
                        borderRadius: 14,
                        border: '1px solid #334155',
                        background: selectedMap?.base_image_url
                            ? `url(${selectedMap.base_image_url}) center/cover no-repeat`
                            : 'linear-gradient(145deg, #0b1220, #13213e)',
                        overflow: 'hidden',
                        cursor: 'crosshair'
                    }}
                >
                    {!selectedMap?.base_image_url && (
                        <div style={{ position: 'absolute', left: 12, top: 12, opacity: 0.85 }}>
                            No base image uploaded yet. You can still map features by relative position.
                        </div>
                    )}

                    {features.map(feature => {
                        const selected = feature.id === selectedFeatureId;
                        return (
                            <button
                                key={feature.id}
                                onClick={e => {
                                    e.stopPropagation();
                                    setSelectedFeatureId(feature.id);
                                }}
                                title={`${feature.label} (${feature.feature_type})`}
                                style={{
                                    position: 'absolute',
                                    left: `${feature.x_percent}%`,
                                    top: `${feature.y_percent}%`,
                                    transform: 'translate(-50%, -50%)',
                                    width: 18,
                                    height: 18,
                                    borderRadius: 999,
                                    border: selected ? '2px solid #f8fafc' : '1px solid #93c5fd',
                                    background: feature.status === 'completed' ? '#22c55e' : feature.status === 'blocked' ? '#ef4444' : '#f59e0b',
                                    cursor: 'pointer'
                                }}
                            />
                        );
                    })}
                </div>

                <form onSubmit={saveFeature} style={{ display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Feature label</span>
                        <input value={featureLabel} onChange={e => setFeatureLabel(e.target.value)} placeholder="North trail extension" required />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Type</span>
                        <select value={featureType} onChange={e => setFeatureType(e.target.value)}>
                            {FEATURE_TYPES.map(option => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Status</span>
                        <select value={featureStatus} onChange={e => setFeatureStatus(e.target.value)}>
                            {FEATURE_STATUS.map(option => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>X %</span>
                        <input value={featureX} onChange={e => setFeatureX(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Y %</span>
                        <input value={featureY} onChange={e => setFeatureY(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Latitude (optional)</span>
                        <input value={featureLat} onChange={e => setFeatureLat(e.target.value)} placeholder="43.2137" />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Longitude (optional)</span>
                        <input value={featureLng} onChange={e => setFeatureLng(e.target.value)} placeholder="-77.9417" />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem', gridColumn: '1 / -1' }}>
                        <span>Description</span>
                        <textarea value={featureDescription} onChange={e => setFeatureDescription(e.target.value)} rows={3} placeholder="Scope, materials, access, notes..." />
                    </label>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="submit" className="soft-button" disabled={savingFeature || !selectedMap}>
                            {savingFeature ? 'Saving feature...' : selectedFeature ? 'Update feature' : 'Add feature'}
                        </button>
                        {selectedFeature && (
                            <button type="button" onClick={deleteFeature} className="soft-button" style={{ borderColor: '#ef4444', color: '#fecaca' }}>
                                Delete feature
                            </button>
                        )}
                        {selectedFeature && (
                            <button
                                type="button"
                                onClick={() => setSelectedFeatureId('')}
                                className="soft-button"
                                style={{ borderColor: '#64748b', color: '#cbd5e1' }}
                            >
                                Clear selection
                            </button>
                        )}
                    </div>
                </form>

                <div style={{ display: 'grid', gap: '0.45rem' }}>
                    <div style={{ fontWeight: 700 }}>Feature Database</div>
                    {features.length === 0 && <div style={{ opacity: 0.75 }}>No features yet for this map.</div>}
                    {features.map(feature => (
                        <button
                            key={feature.id}
                            onClick={() => setSelectedFeatureId(feature.id)}
                            style={{
                                textAlign: 'left',
                                border: feature.id === selectedFeatureId ? '1px solid #60a5fa' : '1px solid #334155',
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
                            </div>
                            <div style={{ opacity: 0.68, fontSize: '0.82rem', marginTop: '0.15rem' }}>
                                Updated: {formatDate(feature.updated_at)}
                            </div>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}
