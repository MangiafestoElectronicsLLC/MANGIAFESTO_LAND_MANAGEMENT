'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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

type TrailPoint = {
    x: number;
    y: number;
    lat?: number;
    lng?: number;
    altitudeMeters?: number | null;
    capturedAtIso?: string;
};

type TrailStats = {
    distanceFeet: number;
    elevationGainFeet: number;
    elevationLossFeet: number;
    durationSeconds: number | null;
    pointCount: number;
};

type TrailPlanMeta = {
    version: 1;
    trailPoints: TrailPoint[];
    drawnOn: string;
    stats?: TrailStats;
};

type FeatureAttachment = {
    name: string;
    url: string;
    path: string | null;
    createdAtIso: string;
};

type FeatureAttachmentsMeta = {
    version: 1;
    attachments: FeatureAttachment[];
};

type MapBoundsCalibration = {
    northLat: number;
    southLat: number;
    westLng: number;
    eastLng: number;
};

type LiveGpsState = {
    lat: number;
    lng: number;
    accuracyMeters: number;
    heading: number | null;
    speedMps: number | null;
    altitudeMeters: number | null;
    capturedAtIso: string;
};

const DEFAULT_ADDRESS = '825 West Ave, Brockport, NY';
const DEFAULT_LAT = 43.2180558;
const DEFAULT_LNG = -77.9778462;
const FORTY_ACRES_SQ_FT = 40 * 43560;
const ESTIMATED_SIDE_LENGTH_FEET = Math.round(Math.sqrt(FORTY_ACRES_SQ_FT));

const FEATURE_TYPES = ['build', 'trail', 'gate', 'road', 'utility', 'water', 'note'];
const FEATURE_STATUS = ['planned', 'active', 'completed', 'blocked'];
const LOCAL_PROPERTY_MAPS_KEY = 'family-land-local-property-maps';
const LOCAL_PROPERTY_MAP_FEATURES_KEY = 'family-land-local-property-map-features';
const LOCAL_MAP_CALIBRATIONS_KEY = 'family-land-map-calibrations';
const TRAIL_META_PREFIX = '[trail-plan]';
const ATTACHMENTS_META_PREFIX = '[feature-attachments]';
const MAX_MAP_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FEATURE_IMAGE_BYTES = 10 * 1024 * 1024;

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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const stripKnownMetadataLines = (description: string | null) => {
    if (!description) return '';
    return description
        .split('\n')
        .filter(line => {
            const trimmed = line.trim();
            return !trimmed.startsWith(TRAIL_META_PREFIX) && !trimmed.startsWith(ATTACHMENTS_META_PREFIX);
        })
        .join('\n')
        .trim();
};

const parseTrailPointsFromDescription = (description: string | null) => {
    if (!description) return [] as TrailPoint[];
    const trailLine = description
        .split('\n')
        .map(line => line.trim())
        .find(line => line.startsWith(TRAIL_META_PREFIX));

    if (!trailLine) return [] as TrailPoint[];

    try {
        const raw = trailLine.slice(TRAIL_META_PREFIX.length);
        const parsed = JSON.parse(raw) as TrailPlanMeta;
        if (!Array.isArray(parsed?.trailPoints)) return [] as TrailPoint[];

        return parsed.trailPoints
            .filter(point =>
                Number.isFinite(point?.x) &&
                Number.isFinite(point?.y) &&
                point.x >= 0 &&
                point.x <= 100 &&
                point.y >= 0 &&
                point.y <= 100
            )
            .map(point => ({
                ...point,
                x: Number(point.x),
                y: Number(point.y)
            }));
    } catch {
        return [] as TrailPoint[];
    }
};

const parseTrailMetaFromDescription = (description: string | null) => {
    if (!description) return null;
    const trailLine = description
        .split('\n')
        .map(line => line.trim())
        .find(line => line.startsWith(TRAIL_META_PREFIX));

    if (!trailLine) return null;

    try {
        const raw = trailLine.slice(TRAIL_META_PREFIX.length);
        const parsed = JSON.parse(raw) as TrailPlanMeta;
        return parsed;
    } catch {
        return null;
    }
};

const stripTrailMetadata = (description: string | null) => {
    return stripKnownMetadataLines(description);
};

const parseFeatureAttachmentsFromDescription = (description: string | null) => {
    if (!description) return [] as FeatureAttachment[];

    const attachmentLine = description
        .split('\n')
        .map(line => line.trim())
        .find(line => line.startsWith(ATTACHMENTS_META_PREFIX));

    if (!attachmentLine) return [] as FeatureAttachment[];

    try {
        const raw = attachmentLine.slice(ATTACHMENTS_META_PREFIX.length);
        const parsed = JSON.parse(raw) as FeatureAttachmentsMeta;
        if (!Array.isArray(parsed?.attachments)) return [] as FeatureAttachment[];

        return parsed.attachments.filter(attachment =>
            typeof attachment?.name === 'string' &&
            typeof attachment?.url === 'string' &&
            attachment.url.length > 0
        );
    } catch {
        return [] as FeatureAttachment[];
    }
};

const composeFeatureDescription = (
    plainDescription: string,
    trailPoints: TrailPoint[],
    attachments: FeatureAttachment[],
    includeTrailData: boolean,
    trailStats: TrailStats | null
) => {
    const lines: string[] = [];
    const cleaned = stripKnownMetadataLines(plainDescription);
    if (cleaned) {
        lines.push(cleaned);
    }

    if (includeTrailData && trailPoints.length >= 2) {
        const trailMeta: TrailPlanMeta = {
            version: 1,
            trailPoints,
            drawnOn: new Date().toISOString(),
            stats: trailStats || undefined
        };
        lines.push(`${TRAIL_META_PREFIX}${JSON.stringify(trailMeta)}`);
    }

    if (attachments.length > 0) {
        const attachmentsMeta: FeatureAttachmentsMeta = {
            version: 1,
            attachments
        };
        lines.push(`${ATTACHMENTS_META_PREFIX}${JSON.stringify(attachmentsMeta)}`);
    }

    if (lines.length === 0) return null;
    return lines.join('\n');
};

const appendTrailMetadata = (description: string, trailPoints: TrailPoint[]) => {
    const plainDescription = stripTrailMetadata(description);
    if (trailPoints.length < 2) {
        return plainDescription || null;
    }

    const metadata: TrailPlanMeta = {
        version: 1,
        trailPoints,
        drawnOn: new Date().toISOString()
    };

    const encoded = `${TRAIL_META_PREFIX}${JSON.stringify(metadata)}`;
    return plainDescription ? `${plainDescription}\n${encoded}` : encoded;
};

const extensionFromImageType = (mimeType: string) => {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    return 'jpg';
};

const readLocalCalibrations = () => {
    if (typeof window === 'undefined') return {} as Record<string, MapBoundsCalibration>;
    return parseJson<Record<string, MapBoundsCalibration>>(window.localStorage.getItem(LOCAL_MAP_CALIBRATIONS_KEY), {});
};

const saveLocalCalibrations = (nextCalibrations: Record<string, MapBoundsCalibration>) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_MAP_CALIBRATIONS_KEY, JSON.stringify(nextCalibrations));
};

const mapGpsToPercent = (gps: LiveGpsState, calibration: MapBoundsCalibration) => {
    const latSpan = calibration.northLat - calibration.southLat;
    const lngSpan = calibration.eastLng - calibration.westLng;
    if (latSpan <= 0 || lngSpan <= 0) return null;

    const x = ((gps.lng - calibration.westLng) / lngSpan) * 100;
    const y = ((calibration.northLat - gps.lat) / latSpan) * 100;

    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    return {
        x,
        y,
        insideMap: x >= 0 && x <= 100 && y >= 0 && y <= 100
    };
};

const estimateCalibrationFromCenter = (centerLat: number, centerLng: number) => {
    const halfSideFeet = ESTIMATED_SIDE_LENGTH_FEET / 2;
    const feetPerDegreeLat = 364000;
    const feetPerDegreeLng = 364000 * Math.cos((centerLat * Math.PI) / 180);

    const latDelta = halfSideFeet / feetPerDegreeLat;
    const lngDelta = halfSideFeet / Math.max(1, feetPerDegreeLng);

    return {
        northLat: Number((centerLat + latDelta).toFixed(7)),
        southLat: Number((centerLat - latDelta).toFixed(7)),
        westLng: Number((centerLng - lngDelta).toFixed(7)),
        eastLng: Number((centerLng + lngDelta).toFixed(7))
    } as MapBoundsCalibration;
};

const gpsAccuracyMetersToPercent = (accuracyMeters: number, calibration: MapBoundsCalibration) => {
    const centerLat = (calibration.northLat + calibration.southLat) / 2;
    const latSpanMeters = (calibration.northLat - calibration.southLat) * 111320;
    const lngSpanMeters = (calibration.eastLng - calibration.westLng) * 111320 * Math.cos((centerLat * Math.PI) / 180);
    const averageMetersPerPercent = Math.max(0.01, (latSpanMeters + lngSpanMeters) / 200);
    return Math.min(25, Math.max(0, accuracyMeters / averageMetersPerPercent));
};

const formatGpsSpeedMph = (speedMps: number | null) => {
    if (speedMps === null || !Number.isFinite(speedMps) || speedMps < 0) return 'N/A';
    return `${(speedMps * 2.23694).toFixed(1)} mph`;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const earthRadiusMeters = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
};

const xyPointToLatLng = (point: TrailPoint, calibration: MapBoundsCalibration) => {
    const latSpan = calibration.northLat - calibration.southLat;
    const lngSpan = calibration.eastLng - calibration.westLng;
    return {
        lat: calibration.northLat - (point.y / 100) * latSpan,
        lng: calibration.westLng + (point.x / 100) * lngSpan
    };
};

const computeTrailStats = (trailPoints: TrailPoint[], calibration: MapBoundsCalibration | null): TrailStats | null => {
    if (trailPoints.length < 2) return null;

    let totalMeters = 0;
    let elevationGainMeters = 0;
    let elevationLossMeters = 0;

    for (let idx = 1; idx < trailPoints.length; idx += 1) {
        const prev = trailPoints[idx - 1];
        const next = trailPoints[idx];

        let prevLat = prev.lat;
        let prevLng = prev.lng;
        let nextLat = next.lat;
        let nextLng = next.lng;

        if ((!Number.isFinite(prevLat) || !Number.isFinite(prevLng) || !Number.isFinite(nextLat) || !Number.isFinite(nextLng)) && calibration) {
            const prevConverted = xyPointToLatLng(prev, calibration);
            const nextConverted = xyPointToLatLng(next, calibration);
            prevLat = prevConverted.lat;
            prevLng = prevConverted.lng;
            nextLat = nextConverted.lat;
            nextLng = nextConverted.lng;
        }

        if (Number.isFinite(prevLat) && Number.isFinite(prevLng) && Number.isFinite(nextLat) && Number.isFinite(nextLng)) {
            totalMeters += haversineMeters(prevLat as number, prevLng as number, nextLat as number, nextLng as number);
        }

        if (Number.isFinite(prev.altitudeMeters) && Number.isFinite(next.altitudeMeters)) {
            const delta = (next.altitudeMeters as number) - (prev.altitudeMeters as number);
            if (delta > 0) {
                elevationGainMeters += delta;
            } else {
                elevationLossMeters += Math.abs(delta);
            }
        }
    }

    const firstTime = trailPoints[0].capturedAtIso ? Date.parse(trailPoints[0].capturedAtIso) : NaN;
    const lastTime = trailPoints[trailPoints.length - 1].capturedAtIso ? Date.parse(trailPoints[trailPoints.length - 1].capturedAtIso) : NaN;
    const durationSeconds = Number.isFinite(firstTime) && Number.isFinite(lastTime) && lastTime >= firstTime
        ? Math.round((lastTime - firstTime) / 1000)
        : null;

    return {
        distanceFeet: totalMeters * 3.28084,
        elevationGainFeet: elevationGainMeters * 3.28084,
        elevationLossFeet: elevationLossMeters * 3.28084,
        durationSeconds,
        pointCount: trailPoints.length
    };
};

const formatTrailDistance = (distanceFeet: number) => {
    if (distanceFeet >= 5280) {
        return `${(distanceFeet / 5280).toFixed(2)} mi`;
    }
    return `${Math.round(distanceFeet)} ft`;
};

const formatTrailElevation = (feet: number) => `${Math.round(feet)} ft`;

const formatTrailDuration = (durationSeconds: number | null) => {
    if (durationSeconds === null || durationSeconds < 0) return 'N/A';
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m ${seconds}s`;
};

const buildCheckpointIndexes = (pointCount: number) => {
    if (pointCount < 2) return [] as number[];
    if (pointCount <= 8) {
        return Array.from({ length: pointCount }, (_, idx) => idx);
    }

    const checkpoints: number[] = [0];
    const step = Math.ceil((pointCount - 2) / 6);
    for (let idx = step; idx < pointCount - 1; idx += step) {
        checkpoints.push(idx);
    }
    checkpoints.push(pointCount - 1);
    return Array.from(new Set(checkpoints));
};

const buildMapTransform = (zoomPercent: number, followPoint: { x: number; y: number } | null) => {
    const scale = clamp(zoomPercent, 100, 350) / 100;

    if (!followPoint) {
        return {
            scale,
            translateXPercent: 0,
            translateYPercent: 0
        };
    }

    const minTranslatePercent = 100 / scale - 100;
    const maxTranslatePercent = 0;
    const targetTx = 50 / scale - followPoint.x;
    const targetTy = 50 / scale - followPoint.y;

    return {
        scale,
        translateXPercent: clamp(targetTx, minTranslatePercent, maxTranslatePercent),
        translateYPercent: clamp(targetTy, minTranslatePercent, maxTranslatePercent)
    };
};

const smoothTrailPoint = (
    previousPoint: TrailPoint | null,
    incomingPoint: TrailPoint,
    smoothingStrength: number,
    gpsAccuracyMeters: number | null
) => {
    if (!previousPoint) return incomingPoint;

    const baseAlpha = clamp(smoothingStrength, 0.05, 0.95);
    let effectiveAlpha = baseAlpha;

    if (Number.isFinite(gpsAccuracyMeters) && (gpsAccuracyMeters as number) > 15) {
        effectiveAlpha *= 0.6;
    }
    if (Number.isFinite(gpsAccuracyMeters) && (gpsAccuracyMeters as number) > 30) {
        effectiveAlpha *= 0.5;
    }

    const blend = (prev: number | undefined | null, next: number | undefined | null) => {
        if (!Number.isFinite(next)) return prev ?? null;
        if (!Number.isFinite(prev)) return next;
        return (prev as number) + effectiveAlpha * ((next as number) - (prev as number));
    };

    return {
        ...incomingPoint,
        x: clamp(blend(previousPoint.x, incomingPoint.x) as number, 0, 100),
        y: clamp(blend(previousPoint.y, incomingPoint.y) as number, 0, 100),
        lat: blend(previousPoint.lat ?? null, incomingPoint.lat ?? null) ?? undefined,
        lng: blend(previousPoint.lng ?? null, incomingPoint.lng ?? null) ?? undefined,
        altitudeMeters: blend(previousPoint.altitudeMeters ?? null, incomingPoint.altitudeMeters ?? null),
        capturedAtIso: incomingPoint.capturedAtIso
    };
};

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

    const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
    const [mapImageFitMode, setMapImageFitMode] = useState<'contain' | 'cover'>('contain');
    const [trailDraftPoints, setTrailDraftPoints] = useState<TrailPoint[]>([]);
    const [isTrailPlanning, setIsTrailPlanning] = useState(false);
    const [featureImageFiles, setFeatureImageFiles] = useState<File[]>([]);
    const [existingAttachments, setExistingAttachments] = useState<FeatureAttachment[]>([]);

    const [northLatInput, setNorthLatInput] = useState('');
    const [southLatInput, setSouthLatInput] = useState('');
    const [westLngInput, setWestLngInput] = useState('');
    const [eastLngInput, setEastLngInput] = useState('');
    const [liveGps, setLiveGps] = useState<LiveGpsState | null>(null);
    const [isGpsTracking, setIsGpsTracking] = useState(false);
    const [gpsError, setGpsError] = useState<string | null>(null);
    const gpsWatchIdRef = useRef<number | null>(null);
    const [autoFollowGps, setAutoFollowGps] = useState(true);
    const [mapZoomPercent, setMapZoomPercent] = useState(145);
    const [breadcrumbPoints, setBreadcrumbPoints] = useState<TrailPoint[]>([]);
    const [isBreadcrumbTracking, setIsBreadcrumbTracking] = useState(false);
    const [isWalkTrailRecording, setIsWalkTrailRecording] = useState(false);
    const [walkTrailLabel, setWalkTrailLabel] = useState('Live hike trail');
    const [enableGpsSmoothing, setEnableGpsSmoothing] = useState(true);
    const [gpsSmoothingStrength, setGpsSmoothingStrength] = useState(0.35);
    const breadcrumbSmoothPointRef = useRef<TrailPoint | null>(null);
    const walkTrailSmoothPointRef = useRef<TrailPoint | null>(null);

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

    const activeCalibration = useMemo(() => {
        const northLat = Number(northLatInput);
        const southLat = Number(southLatInput);
        const westLng = Number(westLngInput);
        const eastLng = Number(eastLngInput);

        if (!Number.isFinite(northLat) || !Number.isFinite(southLat) || !Number.isFinite(westLng) || !Number.isFinite(eastLng)) {
            return null;
        }

        if (northLat <= southLat || eastLng <= westLng) {
            return null;
        }

        return { northLat, southLat, westLng, eastLng } as MapBoundsCalibration;
    }, [northLatInput, southLatInput, westLngInput, eastLngInput]);

    const savedTrails = useMemo(
        () =>
            features
                .map(feature => {
                    const trailMeta = parseTrailMetaFromDescription(feature.description);
                    const points = parseTrailPointsFromDescription(feature.description);
                    const stats = trailMeta?.stats || computeTrailStats(points, activeCalibration);
                    return { feature, points, stats };
                })
                .filter(entry => entry.feature.feature_type === 'trail' && entry.points.length >= 2),
        [features, activeCalibration]
    );

    const draftTrailStats = useMemo(() => computeTrailStats(trailDraftPoints, activeCalibration), [trailDraftPoints, activeCalibration]);

    const trailByFeatureId = useMemo(() => {
        const lookup = new Map<string, { points: TrailPoint[]; stats: TrailStats | null }>();
        for (const trail of savedTrails) {
            lookup.set(trail.feature.id, { points: trail.points, stats: trail.stats || null });
        }
        return lookup;
    }, [savedTrails]);

    const gpsMapPoint = useMemo(() => {
        if (!liveGps || !activeCalibration) return null;
        return mapGpsToPercent(liveGps, activeCalibration);
    }, [liveGps, activeCalibration]);

    const gpsAccuracyRadiusPercent = useMemo(() => {
        if (!liveGps || !activeCalibration) return 0;
        return gpsAccuracyMetersToPercent(liveGps.accuracyMeters, activeCalibration);
    }, [liveGps, activeCalibration]);

    const mapTransform = useMemo(() => {
        const followPoint = autoFollowGps && gpsMapPoint ? { x: gpsMapPoint.x, y: gpsMapPoint.y } : null;
        return buildMapTransform(mapZoomPercent, followPoint);
    }, [autoFollowGps, gpsMapPoint, mapZoomPercent]);

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

        const { data, error: signedUrlError } = await supabase.storage
            .from('property-maps')
            .createSignedUrl(map.base_image_path, 60 * 60 * 24 * 14);

        if (!signedUrlError && data?.signedUrl) {
            setDisplayImageUrl(data.signedUrl);
            return;
        }

        setDisplayImageUrl(map.base_image_url);
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

        const storedCalibration = readLocalCalibrations()[selectedMap.id];
        if (storedCalibration) {
            setNorthLatInput(String(storedCalibration.northLat));
            setSouthLatInput(String(storedCalibration.southLat));
            setWestLngInput(String(storedCalibration.westLng));
            setEastLngInput(String(storedCalibration.eastLng));
            return;
        }

        const estimated = estimateCalibrationFromCenter(selectedMap.center_lat || DEFAULT_LAT, selectedMap.center_lng || DEFAULT_LNG);
        setNorthLatInput(String(estimated.northLat));
        setSouthLatInput(String(estimated.southLat));
        setWestLngInput(String(estimated.westLng));
        setEastLngInput(String(estimated.eastLng));
    }, [selectedMap]);

    useEffect(() => {
        resolveMapImageUrl(selectedMap);
    }, [selectedMap?.id, selectedMap?.base_image_path, selectedMap?.base_image_url, storageMode]);

    useEffect(() => {
        return () => {
            if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
                navigator.geolocation.clearWatch(gpsWatchIdRef.current);
                gpsWatchIdRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!selectedFeature) {
            setFeatureLabel('');
            setFeatureType('build');
            setFeatureStatus('planned');
            setFeatureDescription('');
            setTrailDraftPoints([]);
            setFeatureImageFiles([]);
            setExistingAttachments([]);
            return;
        }

        setFeatureLabel(selectedFeature.label);
        setFeatureType(selectedFeature.feature_type);
        setFeatureStatus(selectedFeature.status);
        setFeatureDescription(stripTrailMetadata(selectedFeature.description));
        setFeatureX(String(selectedFeature.x_percent));
        setFeatureY(String(selectedFeature.y_percent));
        setFeatureLat(selectedFeature.lat === null ? '' : String(selectedFeature.lat));
        setFeatureLng(selectedFeature.lng === null ? '' : String(selectedFeature.lng));
        setExistingAttachments(parseFeatureAttachmentsFromDescription(selectedFeature.description));
        setFeatureImageFiles([]);

        if (selectedFeature.feature_type === 'trail') {
            setTrailDraftPoints(parseTrailPointsFromDescription(selectedFeature.description));
        } else {
            setTrailDraftPoints([]);
        }
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
                const extension = extensionFromImageType(mapImageFile.type || mapImageFile.name);
                const filePath = `${profileId}/${Date.now()}-property-map.${extension}`;

                const { error: uploadError } = await supabase.storage
                    .from('property-maps')
                    .upload(filePath, mapImageFile, {
                        upsert: true,
                        contentType: mapImageFile.type || undefined,
                        cacheControl: '3600'
                    });

                if (uploadError) {
                    throw uploadError;
                }

                const { data: signedData } = await supabase.storage
                    .from('property-maps')
                    .createSignedUrl(filePath, 60 * 60 * 24 * 14);

                const { data: publicData } = supabase.storage
                    .from('property-maps')
                    .getPublicUrl(filePath);

                nextImagePath = filePath;
                nextImageUrl = signedData?.signedUrl || publicData.publicUrl;
            } else if (mapImageFile && storageMode === 'local') {
                if (selectedMap?.base_image_url?.startsWith('blob:')) {
                    URL.revokeObjectURL(selectedMap.base_image_url);
                }
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
            await resolveMapImageUrl({
                ...(selectedMap || {
                    id: '',
                    name: '',
                    address: '',
                    center_lat: lat,
                    center_lng: lng,
                    created_by: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }),
                base_image_url: nextImageUrl,
                base_image_path: nextImagePath
            });
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
        const clampedX = Number(Math.min(100, Math.max(0, x)).toFixed(2));
        const clampedY = Number(Math.min(100, Math.max(0, y)).toFixed(2));

        if (isTrailPlanning) {
            setFeatureType('trail');
            if (!featureLabel.trim()) {
                setFeatureLabel('Hiking trail route');
            }
            setTrailDraftPoints(prev => {
                const next = [...prev, { x: clampedX, y: clampedY }];
                if (next.length === 1) {
                    setFeatureX(String(clampedX));
                    setFeatureY(String(clampedY));
                }
                return next;
            });
            return;
        }

        setFeatureX(String(clampedX));
        setFeatureY(String(clampedY));
    };

    const saveCalibration = () => {
        if (!selectedMap?.id) {
            setError('Create or select a property map first.');
            return;
        }

        if (!activeCalibration) {
            setError('Calibration bounds are invalid. North must be greater than south, and east greater than west.');
            return;
        }

        const nextCalibrations = {
            ...readLocalCalibrations(),
            [selectedMap.id]: activeCalibration
        };
        saveLocalCalibrations(nextCalibrations);
        setError(null);
        setStatusMessage('Map GPS calibration saved for this property map on this device.');
    };

    const stopGpsTracking = () => {
        if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.clearWatch(gpsWatchIdRef.current);
            gpsWatchIdRef.current = null;
        }
        setIsGpsTracking(false);
        setIsBreadcrumbTracking(false);
        setIsWalkTrailRecording(false);
        breadcrumbSmoothPointRef.current = null;
        walkTrailSmoothPointRef.current = null;
    };

    const startGpsTracking = () => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            setGpsError('GPS is not available in this browser.');
            return;
        }

        if (!activeCalibration) {
            setGpsError('Set valid map GPS bounds before starting tracking.');
            return;
        }

        setGpsError(null);
        setError(null);
        setStatusMessage('Starting live GPS tracking...');

        if (gpsWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        }

        gpsWatchIdRef.current = navigator.geolocation.watchPosition(
            position => {
                setLiveGps({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracyMeters: position.coords.accuracy,
                    heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
                    speedMps: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
                    altitudeMeters: Number.isFinite(position.coords.altitude) ? position.coords.altitude : null,
                    capturedAtIso: new Date(position.timestamp).toISOString()
                });
                setIsGpsTracking(true);
                setGpsError(null);
            },
            err => {
                setGpsError(err.message || 'Unable to read current GPS location.');
                setIsGpsTracking(false);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 3000,
                timeout: 15000
            }
        );
    };

    const startBreadcrumbTracking = () => {
        if (!isGpsTracking) {
            setGpsError('Start phone GPS first, then start breadcrumbs.');
            return;
        }
        setBreadcrumbPoints([]);
        setIsBreadcrumbTracking(true);
        breadcrumbSmoothPointRef.current = null;
        setStatusMessage('Breadcrumb tracking started.');
    };

    const stopBreadcrumbTracking = () => {
        setIsBreadcrumbTracking(false);
        breadcrumbSmoothPointRef.current = null;
        setStatusMessage('Breadcrumb tracking stopped.');
    };

    const startWalkTrailRecording = () => {
        if (!isGpsTracking) {
            setGpsError('Start phone GPS before recording a walked trail.');
            return;
        }

        if (!activeCalibration) {
            setGpsError('Set valid map bounds first.');
            return;
        }

        setFeatureType('trail');
        setFeatureLabel(walkTrailLabel.trim() || 'Live hike trail');
        setTrailDraftPoints([]);
        setIsWalkTrailRecording(true);
        walkTrailSmoothPointRef.current = null;
        setStatusMessage('Walk trail recording started. Move with your phone to map the path.');
    };

    const stopWalkTrailRecording = () => {
        setIsWalkTrailRecording(false);
        walkTrailSmoothPointRef.current = null;
        setStatusMessage('Walk trail recording stopped. Save feature to keep this trail.');
    };

    const useBreadcrumbAsTrail = () => {
        if (breadcrumbPoints.length < 2) {
            setError('You need at least 2 breadcrumb points to create a trail.');
            return;
        }

        setFeatureType('trail');
        if (!featureLabel.trim()) {
            setFeatureLabel('Hike breadcrumb trail');
        }
        setTrailDraftPoints(breadcrumbPoints);
        setFeatureX(String(breadcrumbPoints[0].x));
        setFeatureY(String(breadcrumbPoints[0].y));
        setStatusMessage('Breadcrumb path loaded into trail draft. Save feature when ready.');
    };

    const saveWalkedTrailNow = async () => {
        if (!selectedMap?.id) {
            setError('Create or select a property map first.');
            return;
        }

        if (trailDraftPoints.length < 2) {
            setError('Walked trail needs at least 2 GPS points before saving.');
            return;
        }

        setSavingFeature(true);
        setError(null);

        try {
            const normalizedTrailPoints = trailDraftPoints.map(point => ({
                ...point,
                x: clamp(Number(point.x.toFixed(2)), 0, 100),
                y: clamp(Number(point.y.toFixed(2)), 0, 100)
            }));
            const trailStats = computeTrailStats(normalizedTrailPoints, activeCalibration);
            const description = composeFeatureDescription(
                featureDescription || 'Auto-recorded while walking on property.',
                normalizedTrailPoints,
                [],
                true,
                trailStats
            );

            const payload = {
                map_id: selectedMap.id,
                label: walkTrailLabel.trim() || 'Live hike trail',
                feature_type: 'trail',
                status: 'completed',
                description,
                x_percent: normalizedTrailPoints[0].x,
                y_percent: normalizedTrailPoints[0].y,
                lat: normalizedTrailPoints[0].lat ?? null,
                lng: normalizedTrailPoints[0].lng ?? null,
                created_by: profileId,
                updated_by: profileId
            };

            if (storageMode === 'local') {
                const nowIso = new Date().toISOString();
                const nextFeatures = [
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
            } else {
                const { error: insertError } = await supabase.from('property_map_features').insert(payload);
                if (insertError) {
                    throw insertError;
                }
                await loadFeatures(selectedMap.id);
            }

            setSelectedFeatureId('');
            setFeatureType('trail');
            setFeatureLabel(walkTrailLabel.trim() || 'Live hike trail');
            setTrailDraftPoints([]);
            setIsWalkTrailRecording(false);
            setStatusMessage('Walked trail saved as completed.');
        } catch (err: any) {
            setError(err?.message || 'Could not save walked trail.');
        } finally {
            setSavingFeature(false);
        }
    };

    useEffect(() => {
        if (!gpsMapPoint || !gpsMapPoint.insideMap) return;
        const rawPoint = {
            x: Number(gpsMapPoint.x.toFixed(2)),
            y: Number(gpsMapPoint.y.toFixed(2)),
            lat: liveGps?.lat,
            lng: liveGps?.lng,
            altitudeMeters: liveGps?.altitudeMeters ?? null,
            capturedAtIso: liveGps?.capturedAtIso
        };

        if (isBreadcrumbTracking) {
            const breadcrumbPoint = enableGpsSmoothing
                ? smoothTrailPoint(
                    breadcrumbSmoothPointRef.current,
                    rawPoint,
                    gpsSmoothingStrength,
                    liveGps?.accuracyMeters ?? null
                )
                : rawPoint;

            breadcrumbSmoothPointRef.current = breadcrumbPoint;

            setBreadcrumbPoints(prev => {
                if (prev.length === 0) return [breadcrumbPoint];
                const last = prev[prev.length - 1];
                const delta = Math.hypot(breadcrumbPoint.x - last.x, breadcrumbPoint.y - last.y);
                if (delta < 0.12) return prev;
                return [...prev, breadcrumbPoint];
            });
        }

        if (isWalkTrailRecording) {
            const walkPoint = enableGpsSmoothing
                ? smoothTrailPoint(
                    walkTrailSmoothPointRef.current,
                    rawPoint,
                    gpsSmoothingStrength,
                    liveGps?.accuracyMeters ?? null
                )
                : rawPoint;

            walkTrailSmoothPointRef.current = walkPoint;

            setTrailDraftPoints(prev => {
                if (prev.length === 0) {
                    setFeatureX(String(walkPoint.x));
                    setFeatureY(String(walkPoint.y));
                    return [walkPoint];
                }
                const last = prev[prev.length - 1];
                const delta = Math.hypot(walkPoint.x - last.x, walkPoint.y - last.y);
                if (delta < 0.12) return prev;
                return [...prev, walkPoint];
            });
        }
    }, [gpsMapPoint, isBreadcrumbTracking, isWalkTrailRecording, liveGps, enableGpsSmoothing, gpsSmoothingStrength]);

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
            const parsedLat = featureLat.trim() ? Number(featureLat) : null;
            const parsedLng = featureLng.trim() ? Number(featureLng) : null;

            if (featureType !== 'trail' && (!Number.isFinite(xPercent) || !Number.isFinite(yPercent))) {
                setError('Marker X/Y percentages must be valid numbers.');
                setSavingFeature(false);
                return;
            }

            const normalizedTrailPoints = trailDraftPoints
                .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
                .map(point => ({
                    x: clamp(Number(point.x.toFixed(2)), 0, 100),
                    y: clamp(Number(point.y.toFixed(2)), 0, 100)
                }));

            if (featureType === 'trail' && normalizedTrailPoints.length < 2) {
                setError('Trail planning requires at least 2 clicked points on the map.');
                setSavingFeature(false);
                return;
            }

            if (parsedLat !== null && !Number.isFinite(parsedLat)) {
                setError('Feature latitude must be a valid number when provided.');
                setSavingFeature(false);
                return;
            }

            if (parsedLng !== null && !Number.isFinite(parsedLng)) {
                setError('Feature longitude must be a valid number when provided.');
                setSavingFeature(false);
                return;
            }

            const uploadedAttachments: FeatureAttachment[] = [];

            if (featureImageFiles.length > 0 && storageMode === 'supabase') {
                if (!profileId) {
                    throw new Error('You must be signed in to upload trail images.');
                }

                for (let index = 0; index < featureImageFiles.length; index += 1) {
                    const file = featureImageFiles[index];
                    const extension = extensionFromImageType(file.type || file.name);
                    const filePath = `${profileId}/feature-images/${selectedMap.id}/${Date.now()}-${index}.${extension}`;

                    const { error: uploadError } = await supabase.storage
                        .from('property-maps')
                        .upload(filePath, file, {
                            upsert: true,
                            contentType: file.type || undefined,
                            cacheControl: '3600'
                        });

                    if (uploadError) {
                        throw uploadError;
                    }

                    const { data: publicData } = supabase.storage
                        .from('property-maps')
                        .getPublicUrl(filePath);

                    uploadedAttachments.push({
                        name: file.name,
                        url: publicData.publicUrl,
                        path: filePath,
                        createdAtIso: new Date().toISOString()
                    });
                }
            }

            if (featureImageFiles.length > 0 && storageMode === 'local') {
                for (const file of featureImageFiles) {
                    uploadedAttachments.push({
                        name: file.name,
                        url: URL.createObjectURL(file),
                        path: null,
                        createdAtIso: new Date().toISOString()
                    });
                }
            }

            const allAttachments = [...existingAttachments, ...uploadedAttachments];

            const descriptionWithMetadata = composeFeatureDescription(
                featureDescription,
                normalizedTrailPoints,
                allAttachments,
                featureType === 'trail',
                featureType === 'trail' ? computeTrailStats(normalizedTrailPoints, activeCalibration) : null
            );

            const payload = {
                map_id: selectedMap.id,
                label: featureLabel.trim() || 'Map feature',
                feature_type: featureType,
                status: featureStatus,
                description: descriptionWithMetadata,
                x_percent:
                    featureType === 'trail'
                        ? normalizedTrailPoints[0].x
                        : clamp(xPercent, 0, 100),
                y_percent:
                    featureType === 'trail'
                        ? normalizedTrailPoints[0].y
                        : clamp(yPercent, 0, 100),
                lat: parsedLat,
                lng: parsedLng,
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
                setTrailDraftPoints([]);
                setFeatureImageFiles([]);
                setExistingAttachments([]);
                setIsWalkTrailRecording(false);
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
            setTrailDraftPoints([]);
            setFeatureImageFiles([]);
            setExistingAttachments([]);
            setIsWalkTrailRecording(false);
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
            setTrailDraftPoints([]);
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
        setTrailDraftPoints([]);
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
                    <h2 style={{ margin: 0 }}>Property Map: 825 Brockport, New York</h2>
                    <div style={{ opacity: 0.8 }}>
                        Plan all 40 acres with full-image view, then click the map to place points and draft hiking trails.
                    </div>
                    <div style={{ opacity: 0.72, fontSize: '0.88rem' }}>
                        40 acres is about {ESTIMATED_SIDE_LENGTH_FEET} ft x {ESTIMATED_SIDE_LENGTH_FEET} ft when square. Use contain mode to avoid cropping.
                    </div>
                    <div style={{ opacity: 0.72, fontSize: '0.86rem' }}>
                        For live phone tracking, open this page from your phone browser over HTTPS, then enable GPS tracking below.
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
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={e => {
                                const selectedFile = e.target.files?.[0] || null;
                                if (!selectedFile) {
                                    setMapImageFile(null);
                                    return;
                                }

                                if (!selectedFile.type.startsWith('image/')) {
                                    setError('Please select a valid image file.');
                                    setMapImageFile(null);
                                    return;
                                }

                                if (selectedFile.size > MAX_MAP_IMAGE_BYTES) {
                                    setError('Image is too large. Please upload an image under 20 MB.');
                                    setMapImageFile(null);
                                    return;
                                }

                                setError(null);
                                setMapImageFile(selectedFile);
                                setStatusMessage(`Selected image: ${selectedFile.name}`);
                            }}
                        />
                        <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>PNG, JPG, WEBP, or GIF up to 20 MB.</span>
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

                <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.55rem' }}>
                    <div style={{ fontWeight: 700 }}>GPS Calibration + Live Tracking</div>
                    <div style={{ opacity: 0.76, fontSize: '0.88rem' }}>
                        Enter map edge coordinates so your phone GPS can be projected on this property image.
                    </div>
                    <div style={{ display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span>North edge latitude</span>
                            <input value={northLatInput} onChange={e => setNorthLatInput(e.target.value)} placeholder="43.2200000" />
                        </label>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span>South edge latitude</span>
                            <input value={southLatInput} onChange={e => setSouthLatInput(e.target.value)} placeholder="43.2160000" />
                        </label>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span>West edge longitude</span>
                            <input value={westLngInput} onChange={e => setWestLngInput(e.target.value)} placeholder="-77.9820000" />
                        </label>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span>East edge longitude</span>
                            <input value={eastLngInput} onChange={e => setEastLngInput(e.target.value)} placeholder="-77.9730000" />
                        </label>
                    </div>
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={() => {
                                const lat = Number(mapLat);
                                const lng = Number(mapLng);
                                if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                                    setError('Map center coordinates must be valid to estimate 40-acre bounds.');
                                    return;
                                }
                                const estimated = estimateCalibrationFromCenter(lat, lng);
                                setNorthLatInput(String(estimated.northLat));
                                setSouthLatInput(String(estimated.southLat));
                                setWestLngInput(String(estimated.westLng));
                                setEastLngInput(String(estimated.eastLng));
                                setStatusMessage('Estimated bounds loaded from map center for 40 acres. Fine tune for best accuracy.');
                            }}
                        >
                            Estimate 40-acre bounds
                        </button>
                        <button type="button" className="soft-button" onClick={saveCalibration}>
                            Save GPS calibration
                        </button>
                        {!isGpsTracking ? (
                            <button type="button" className="soft-button" onClick={startGpsTracking}>
                                Start phone GPS
                            </button>
                        ) : (
                            <button type="button" className="soft-button" onClick={stopGpsTracking} style={{ borderColor: '#ef4444', color: '#fecaca' }}>
                                Stop phone GPS
                            </button>
                        )}
                        {!isBreadcrumbTracking ? (
                            <button type="button" className="soft-button" onClick={startBreadcrumbTracking} disabled={!isGpsTracking}>
                                Start breadcrumbs
                            </button>
                        ) : (
                            <button type="button" className="soft-button" onClick={stopBreadcrumbTracking}>
                                Stop breadcrumbs
                            </button>
                        )}
                        <button
                            type="button"
                            className="soft-button"
                            onClick={useBreadcrumbAsTrail}
                            disabled={breadcrumbPoints.length < 2}
                        >
                            Create trail from breadcrumbs
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <input
                                type="checkbox"
                                checked={enableGpsSmoothing}
                                onChange={e => {
                                    setEnableGpsSmoothing(e.target.checked);
                                    breadcrumbSmoothPointRef.current = null;
                                    walkTrailSmoothPointRef.current = null;
                                }}
                            />
                            <span style={{ fontSize: '0.86rem', opacity: 0.84 }}>Smooth GPS jitter</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.84rem', opacity: 0.78 }}>Smoothing</span>
                            <input
                                type="range"
                                min={10}
                                max={80}
                                step={5}
                                value={Math.round(gpsSmoothingStrength * 100)}
                                onChange={e => setGpsSmoothingStrength(clamp(Number(e.target.value) / 100, 0.1, 0.8))}
                                disabled={!enableGpsSmoothing}
                            />
                            <span style={{ fontSize: '0.82rem', opacity: 0.72 }}>{Math.round(gpsSmoothingStrength * 100)}%</span>
                        </label>
                    </div>
                    {gpsError && <div style={{ color: '#fca5a5' }}>{gpsError}</div>}
                    {liveGps && (
                        <div style={{ opacity: 0.82, fontSize: '0.86rem' }}>
                            GPS: {liveGps.lat.toFixed(6)}, {liveGps.lng.toFixed(6)} | Accuracy: {Math.round(liveGps.accuracyMeters)} m | Speed: {formatGpsSpeedMph(liveGps.speedMps)}
                        </div>
                    )}
                    {liveGps && (
                        <div style={{ opacity: 0.76, fontSize: '0.84rem' }}>
                            Heading: {liveGps.heading === null ? 'N/A' : `${Math.round(liveGps.heading)}°`} | Breadcrumb points: {breadcrumbPoints.length} | Smoothing: {enableGpsSmoothing ? `${Math.round(gpsSmoothingStrength * 100)}%` : 'Off'}
                        </div>
                    )}
                    {liveGps && gpsMapPoint && !gpsMapPoint.insideMap && (
                        <div style={{ color: '#facc15', fontSize: '0.86rem' }}>
                            Your live position is currently outside the calibrated map bounds.
                        </div>
                    )}
                </div>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gap: '0.2rem' }}>
                    <div style={{ fontWeight: 700 }}>Map Canvas</div>
                    <div style={{ opacity: 0.78, fontSize: '0.9rem' }}>
                        Click map to place one marker, or turn on trail planning to click a sequence of path points.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => setMapImageFitMode('contain')}
                        style={{ borderColor: mapImageFitMode === 'contain' ? '#38bdf8' : '#475569' }}
                    >
                        Full acreage view
                    </button>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => setMapImageFitMode('cover')}
                        style={{ borderColor: mapImageFitMode === 'cover' ? '#38bdf8' : '#475569' }}
                    >
                        Fill canvas
                    </button>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => {
                            setIsTrailPlanning(prev => !prev);
                            setFeatureType('trail');
                        }}
                        style={{ borderColor: isTrailPlanning ? '#22c55e' : '#475569', color: isTrailPlanning ? '#bbf7d0' : '#cbd5e1' }}
                    >
                        {isTrailPlanning ? 'Trail planning on' : 'Start trail planning'}
                    </button>
                    {!isWalkTrailRecording ? (
                        <button type="button" className="soft-button" onClick={startWalkTrailRecording} disabled={!isGpsTracking}>
                            Start walk-to-map trail
                        </button>
                    ) : (
                        <button type="button" className="soft-button" onClick={stopWalkTrailRecording} style={{ borderColor: '#ef4444', color: '#fecaca' }}>
                            Stop walk trail
                        </button>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.88rem', opacity: 0.82 }}>Walk trail label</span>
                        <input
                            value={walkTrailLabel}
                            onChange={e => setWalkTrailLabel(e.target.value)}
                            placeholder="Live hike trail"
                            style={{ minWidth: 180 }}
                        />
                    </label>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={saveWalkedTrailNow}
                        disabled={trailDraftPoints.length < 2 || savingFeature}
                        style={{ borderColor: '#22c55e', color: '#bbf7d0' }}
                    >
                        Save walked trail now
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input type="checkbox" checked={autoFollowGps} onChange={e => setAutoFollowGps(e.target.checked)} />
                        <span style={{ fontSize: '0.88rem', opacity: 0.82 }}>Auto-follow GPS</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.88rem', opacity: 0.82 }}>Zoom {mapZoomPercent}%</span>
                        <input
                            type="range"
                            min={100}
                            max={300}
                            step={5}
                            value={mapZoomPercent}
                            onChange={e => setMapZoomPercent(Number(e.target.value))}
                        />
                    </label>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => setTrailDraftPoints(points => points.slice(0, -1))}
                        disabled={trailDraftPoints.length === 0}
                    >
                        Undo trail point
                    </button>
                    <button
                        type="button"
                        className="soft-button"
                        onClick={() => setTrailDraftPoints([])}
                        disabled={trailDraftPoints.length === 0}
                    >
                        Clear draft trail
                    </button>
                    {trailDraftPoints.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', opacity: 0.8, fontSize: '0.9rem' }}>
                            Draft points: {trailDraftPoints.length}
                        </div>
                    )}
                    {draftTrailStats && (
                        <div style={{ display: 'flex', alignItems: 'center', opacity: 0.84, fontSize: '0.88rem' }}>
                            Draft stats: {formatTrailDistance(draftTrailStats.distanceFeet)} | Gain {formatTrailElevation(draftTrailStats.elevationGainFeet)} | Loss {formatTrailElevation(draftTrailStats.elevationLossFeet)} | Time {formatTrailDuration(draftTrailStats.durationSeconds)}
                        </div>
                    )}
                </div>

                <div
                    onClick={onMapClick}
                    style={{
                        position: 'relative',
                        width: '100%',
                        minHeight: 420,
                        borderRadius: 14,
                        border: '1px solid #334155',
                        background: 'linear-gradient(145deg, #0b1220, #13213e)',
                        overflow: 'hidden',
                        cursor: isTrailPlanning ? 'copy' : 'crosshair'
                    }}
                >
                    {!displayImageUrl && (
                        <div style={{ position: 'absolute', left: 12, top: 12, opacity: 0.85 }}>
                            No base image uploaded yet. You can still map features by relative position.
                        </div>
                    )}

                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            transformOrigin: 'top left',
                            transform: `translate(${mapTransform.translateXPercent}%, ${mapTransform.translateYPercent}%) scale(${mapTransform.scale})`
                        }}
                    >
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                background: displayImageUrl
                                    ? `url(${displayImageUrl}) center/${mapImageFitMode} no-repeat`
                                    : 'linear-gradient(145deg, #0b1220, #13213e)'
                            }}
                        />

                        <svg
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                        >
                            {savedTrails.map(({ feature, points }) => {
                                const start = points[0];
                                const end = points[points.length - 1];
                                const checkpointIndexes = buildCheckpointIndexes(points.length);

                                return (
                                    <g key={`trail-${feature.id}`}>
                                        <polyline
                                            points={points.map(point => `${point.x},${point.y}`).join(' ')}
                                            fill="none"
                                            stroke={feature.id === selectedFeatureId ? '#f8fafc' : '#22d3ee'}
                                            strokeWidth={feature.id === selectedFeatureId ? 0.95 : 0.65}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            opacity={0.95}
                                        />

                                        <circle cx={start.x} cy={start.y} r={1.05} fill="#22c55e" stroke="#f8fafc" strokeWidth={0.25} />
                                        <rect
                                            x={end.x - 1}
                                            y={end.y - 1}
                                            width={2}
                                            height={2}
                                            fill="#ef4444"
                                            stroke="#f8fafc"
                                            strokeWidth={0.25}
                                        />

                                        {checkpointIndexes.map(index => {
                                            const checkpoint = points[index];
                                            return (
                                                <g key={`trail-${feature.id}-checkpoint-${index}`}>
                                                    <circle cx={checkpoint.x} cy={checkpoint.y} r={0.75} fill="#0f172a" stroke="#a5f3fc" strokeWidth={0.22} />
                                                    <text
                                                        x={checkpoint.x}
                                                        y={checkpoint.y + 0.18}
                                                        textAnchor="middle"
                                                        fontSize="1.35"
                                                        fill="#e0f2fe"
                                                    >
                                                        {index + 1}
                                                    </text>
                                                </g>
                                            );
                                        })}
                                    </g>
                                );
                            })}

                            {breadcrumbPoints.length >= 2 && (
                                <polyline
                                    points={breadcrumbPoints.map(point => `${point.x},${point.y}`).join(' ')}
                                    fill="none"
                                    stroke="#34d399"
                                    strokeWidth={0.58}
                                    strokeDasharray="1.3 1.0"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    opacity={0.95}
                                />
                            )}

                            {trailDraftPoints.length >= 2 && (
                                <>
                                    <polyline
                                        points={trailDraftPoints.map(point => `${point.x},${point.y}`).join(' ')}
                                        fill="none"
                                        stroke="#f59e0b"
                                        strokeWidth={0.9}
                                        strokeDasharray="1.8 1.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    <circle cx={trailDraftPoints[0].x} cy={trailDraftPoints[0].y} r={0.95} fill="#22c55e" stroke="#f8fafc" strokeWidth={0.22} />
                                    <rect
                                        x={trailDraftPoints[trailDraftPoints.length - 1].x - 0.95}
                                        y={trailDraftPoints[trailDraftPoints.length - 1].y - 0.95}
                                        width={1.9}
                                        height={1.9}
                                        fill="#ef4444"
                                        stroke="#f8fafc"
                                        strokeWidth={0.22}
                                    />
                                </>
                            )}
                            {trailDraftPoints.map((point, index) => (
                                <circle key={`draft-point-${index}`} cx={point.x} cy={point.y} r={0.8} fill="#fbbf24" />
                            ))}

                            {liveGps && gpsMapPoint && (
                                <>
                                    <circle
                                        cx={gpsMapPoint.x}
                                        cy={gpsMapPoint.y}
                                        r={gpsAccuracyRadiusPercent}
                                        fill="rgba(56, 189, 248, 0.2)"
                                        stroke="rgba(56, 189, 248, 0.45)"
                                        strokeWidth={0.35}
                                    />
                                    {liveGps.heading !== null && (
                                        <g transform={`rotate(${liveGps.heading} ${gpsMapPoint.x} ${gpsMapPoint.y})`}>
                                            <polygon
                                                points={`${gpsMapPoint.x},${gpsMapPoint.y - 2.2} ${gpsMapPoint.x - 0.85},${gpsMapPoint.y - 0.25} ${gpsMapPoint.x + 0.85},${gpsMapPoint.y - 0.25}`}
                                                fill="#7dd3fc"
                                                stroke="#f8fafc"
                                                strokeWidth={0.2}
                                            />
                                        </g>
                                    )}
                                    <circle cx={gpsMapPoint.x} cy={gpsMapPoint.y} r={1.15} fill="#38bdf8" stroke="#f8fafc" strokeWidth={0.4} />
                                </>
                            )}
                        </svg>

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
                                        cursor: 'pointer',
                                        zIndex: 2
                                    }}
                                />
                            );
                        })}
                    </div>
                </div>

                <form onSubmit={saveFeature} style={{ display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Feature label</span>
                        <input value={featureLabel} onChange={e => setFeatureLabel(e.target.value)} placeholder="North trail extension" required />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                        <span>Type</span>
                        <select
                            value={featureType}
                            onChange={e => {
                                const nextType = e.target.value;
                                setFeatureType(nextType);
                                if (nextType !== 'trail') {
                                    setIsTrailPlanning(false);
                                    setTrailDraftPoints([]);
                                }
                            }}
                        >
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
                    <label style={{ display: 'grid', gap: '0.3rem', gridColumn: '1 / -1' }}>
                        <span>Add trail/marker images (optional)</span>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            multiple
                            onChange={e => {
                                const selectedFiles = Array.from(e.target.files || []);
                                if (selectedFiles.length === 0) {
                                    setFeatureImageFiles([]);
                                    return;
                                }

                                const invalidFile = selectedFiles.find(file => !file.type.startsWith('image/'));
                                if (invalidFile) {
                                    setError('Only image files are allowed for trail/marker attachments.');
                                    return;
                                }

                                const oversizedFile = selectedFiles.find(file => file.size > MAX_FEATURE_IMAGE_BYTES);
                                if (oversizedFile) {
                                    setError(`Attachment ${oversizedFile.name} is too large. Use images under 10 MB each.`);
                                    return;
                                }

                                setError(null);
                                setFeatureImageFiles(selectedFiles);
                                setStatusMessage(`${selectedFiles.length} image(s) selected for this feature.`);
                            }}
                        />
                        <span style={{ opacity: 0.7, fontSize: '0.8rem' }}>
                            Add photos of trail condition, hazards, or fixes. Up to 10 MB each.
                        </span>
                    </label>

                    {(existingAttachments.length > 0 || featureImageFiles.length > 0) && (
                        <div style={{ gridColumn: '1 / -1', display: 'grid', gap: '0.45rem' }}>
                            <div style={{ fontSize: '0.86rem', opacity: 0.86 }}>Feature images</div>
                            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                {existingAttachments.map((attachment, idx) => (
                                    <div
                                        key={`${attachment.url}-${idx}`}
                                        style={{
                                            border: '1px solid #334155',
                                            borderRadius: 8,
                                            padding: '0.35rem',
                                            width: 142,
                                            display: 'grid',
                                            gap: '0.25rem'
                                        }}
                                    >
                                        <a href={attachment.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                                            <img
                                                src={attachment.url}
                                                alt={attachment.name}
                                                style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                                            />
                                        </a>
                                        <div style={{ fontSize: '0.72rem', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {attachment.name}
                                        </div>
                                        <button
                                            type="button"
                                            className="soft-button"
                                            onClick={() => setExistingAttachments(prev => prev.filter((_, existingIdx) => existingIdx !== idx))}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}

                                {featureImageFiles.map((file, idx) => (
                                    <div
                                        key={`${file.name}-${idx}`}
                                        style={{
                                            border: '1px dashed #475569',
                                            borderRadius: 8,
                                            padding: '0.35rem',
                                            width: 142,
                                            display: 'grid',
                                            gap: '0.25rem'
                                        }}
                                    >
                                        <div style={{ fontSize: '0.74rem', opacity: 0.9 }}>{file.name}</div>
                                        <div style={{ fontSize: '0.72rem', opacity: 0.68 }}>Queued for upload</div>
                                        <button
                                            type="button"
                                            className="soft-button"
                                            onClick={() => setFeatureImageFiles(prev => prev.filter((_, pendingIdx) => pendingIdx !== idx))}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="submit" className="soft-button" disabled={savingFeature || !selectedMap}>
                            {savingFeature ? 'Saving feature...' : selectedFeature ? 'Update feature' : 'Add feature'}
                        </button>
                        {featureType === 'trail' && (
                            <div style={{ display: 'flex', alignItems: 'center', opacity: 0.78, fontSize: '0.88rem' }}>
                                Trail features save clicked route points from the map canvas.
                            </div>
                        )}
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
                            {(() => {
                                const trailSummary = trailByFeatureId.get(feature.id);
                                const attachmentCount = parseFeatureAttachmentsFromDescription(feature.description).length;
                                return (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <div style={{ fontWeight: 600 }}>{feature.label}</div>
                                            <div style={{ opacity: 0.78, textTransform: 'capitalize' }}>{feature.feature_type} • {feature.status}</div>
                                        </div>
                                        <div style={{ opacity: 0.8, fontSize: '0.9rem', marginTop: '0.2rem' }}>
                                            X:{' '}{feature.x_percent.toFixed(2)}% Y:{' '}{feature.y_percent.toFixed(2)}%
                                            {feature.lat !== null && feature.lng !== null ? ` • Lat/Lng: ${feature.lat}, ${feature.lng}` : ''}
                                            {feature.feature_type === 'trail' && trailSummary ? ` • Trail points: ${trailSummary.points.length}` : ''}
                                            {attachmentCount > 0
                                                ? ` • Images: ${attachmentCount}`
                                                : ''}
                                        </div>
                                        {feature.feature_type === 'trail' && trailSummary?.stats && (
                                            <div style={{ opacity: 0.78, fontSize: '0.84rem', marginTop: '0.12rem' }}>
                                                Distance: {formatTrailDistance(trailSummary.stats.distanceFeet)} | Gain: {formatTrailElevation(trailSummary.stats.elevationGainFeet)} | Loss: {formatTrailElevation(trailSummary.stats.elevationLossFeet)} | Duration: {formatTrailDuration(trailSummary.stats.durationSeconds)}
                                            </div>
                                        )}
                                        <div style={{ opacity: 0.68, fontSize: '0.82rem', marginTop: '0.15rem' }}>
                                            Updated: {formatDate(feature.updated_at)}
                                        </div>
                                    </>
                                );
                            })()}
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}
