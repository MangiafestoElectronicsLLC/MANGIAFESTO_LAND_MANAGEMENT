'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorCode, getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';
import ConnectionDiagnostics from '@/components/ConnectionDiagnostics';
import { projectGpsToMapPercent, projectLatLngToMapPercent, unprojectMapPercentToLatLng } from '@/lib/gpsProjection';
import { parseMockGpsPath } from '@/lib/mockGps';

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

type FeatureVisualMeta = {
    version: 1;
    iconKey?: string;
    trailColor?: string;
    trailWidth?: number;
    trailPattern?: 'solid' | 'dashed' | 'dotted';
};

type MapBoundsCalibration = {
    northLat: number;
    southLat: number;
    westLng: number;
    eastLng: number;
};

type MapImageFraming = {
    fitMode: 'contain' | 'cover';
    scalePercent: number;
    offsetXPercent: number;
    offsetYPercent: number;
    rotationDeg: number;
    flipX: boolean;
    flipY: boolean;
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

type MapPercentPoint = {
    x: number;
    y: number;
};

type EdgeCalibrationMode = 'auto' | 'north' | 'east-west';

const DEFAULT_ADDRESS = '825 West Ave, Brockport, NY';
const DEFAULT_LAT = 43.2180558;
const DEFAULT_LNG = -77.9778462;
const FORTY_ACRES_SQ_FT = 40 * 43560;
const ESTIMATED_SIDE_LENGTH_FEET = Math.round(Math.sqrt(FORTY_ACRES_SQ_FT));

const FEATURE_TYPES = ['build', 'trail', 'gate', 'road', 'utility', 'water', 'note', 'treestand', 'range'];
const FEATURE_STATUS = ['planned', 'active', 'inactive', 'requested', 'completed', 'blocked'];
const LOCAL_PROPERTY_MAPS_KEY = 'family-land-local-property-maps';
const LOCAL_PROPERTY_MAP_FEATURES_KEY = 'family-land-local-property-map-features';
const LOCAL_MAP_CALIBRATIONS_KEY = 'family-land-map-calibrations';
const LOCAL_MAP_IMAGE_FRAMING_KEY = 'family-land-map-image-framing';
const LOCAL_ONX_IMPORT_CURSOR_KEY = 'family-land-onx-import-cursor';
const LOCAL_ONX_IMPORTED_SIGNATURES_KEY = 'family-land-onx-imported-signatures';
const TRAIL_META_PREFIX = '[trail-plan]';
const ATTACHMENTS_META_PREFIX = '[feature-attachments]';
const VISUAL_META_PREFIX = '[feature-visual]';
const MAX_MAP_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FEATURE_IMAGE_BYTES = 10 * 1024 * 1024;
const ONX_HUNT_WEBMAP_URL = 'https://webmap.onxmaps.com/hunt';
const ONX_HUNT_APP_DEEP_LINK = 'onxhunt://';
const DEFAULT_TRAIL_COLOR = '#22d3ee';
const DEFAULT_TRAIL_WIDTH = 1;
const DEFAULT_TRAIL_PATTERN: 'solid' | 'dashed' | 'dotted' = 'solid';

const getFeatureStatusColor = (status: string) => {
    if (status === 'active') return '#22c55e';
    if (status === 'inactive') return '#64748b';
    if (status === 'requested') return '#f59e0b';
    if (status === 'completed') return '#10b981';
    if (status === 'blocked') return '#ef4444';
    return '#1d4ed8';
};

const LANDMARK_ICON_OPTIONS: Array<{ key: string; label: string; glyph: string }> = [
    { key: 'pin', label: 'Pin', glyph: 'P' },
    { key: 'trail', label: 'Trail', glyph: 'T' },
    { key: 'gate', label: 'Gate', glyph: 'G' },
    { key: 'water', label: 'Water', glyph: 'W' },
    { key: 'camp', label: 'Camp', glyph: 'C' },
    { key: 'stand', label: 'Stand', glyph: 'S' },
    { key: 'camera', label: 'Cam', glyph: 'M' },
    { key: 'note', label: 'Note', glyph: 'N' }
];

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

const normalizeSignedAngle = (degrees: number) => {
    const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
    return Number(normalized.toFixed(2));
};

const calculateNorthAlignmentRotationDelta = (first: MapPercentPoint, second: MapPercentPoint) => {
    const northPoint = first.y <= second.y ? first : second;
    const southPoint = first.y <= second.y ? second : first;
    const dx = northPoint.x - southPoint.x;
    const dy = northPoint.y - southPoint.y;
    const length = Math.hypot(dx, dy);

    if (length < 1) {
        return null;
    }

    const edgeAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const targetNorthAngleDeg = -90;
    return normalizeSignedAngle(targetNorthAngleDeg - edgeAngleDeg);
};

const calculateEastWestAlignmentRotationDelta = (first: MapPercentPoint, second: MapPercentPoint) => {
    const westPoint = first.x <= second.x ? first : second;
    const eastPoint = first.x <= second.x ? second : first;
    const dx = eastPoint.x - westPoint.x;
    const dy = eastPoint.y - westPoint.y;
    const length = Math.hypot(dx, dy);

    if (length < 1) {
        return null;
    }

    const edgeAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const targetEastWestAngleDeg = 0;
    return normalizeSignedAngle(targetEastWestAngleDeg - edgeAngleDeg);
};

const sanitizeFileStem = (value: string) =>
    value
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9-_ ]/g, '')
        .trim();

const escapeXml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

const stripKnownMetadataLines = (description: string | null) => {
    if (!description) return '';
    return description
        .split('\n')
        .filter(line => {
            const trimmed = line.trim();
            return !trimmed.startsWith(TRAIL_META_PREFIX) && !trimmed.startsWith(ATTACHMENTS_META_PREFIX) && !trimmed.startsWith(VISUAL_META_PREFIX);
        })
        .join('\n')
        .trim();
};

const readVisualMetaFromDescription = (description: string | null): FeatureVisualMeta | null => {
    if (!description) return null;

    const visualLine = description
        .split('\n')
        .map(line => line.trim())
        .find(line => line.startsWith(VISUAL_META_PREFIX));

    if (!visualLine) return null;

    try {
        const raw = visualLine.slice(VISUAL_META_PREFIX.length);
        const parsed = JSON.parse(raw) as FeatureVisualMeta;
        return parsed;
    } catch {
        return null;
    }
};

const markerGlyphForIcon = (iconKey: string) => {
    const matched = LANDMARK_ICON_OPTIONS.find(option => option.key === iconKey);
    return matched?.glyph || 'P';
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
    trailStats: TrailStats | null,
    visualMeta: FeatureVisualMeta | null
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

    if (visualMeta) {
        lines.push(`${VISUAL_META_PREFIX}${JSON.stringify(visualMeta)}`);
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

const readLocalMapImageFraming = () => {
    if (typeof window === 'undefined') return {} as Record<string, MapImageFraming>;
    return parseJson<Record<string, MapImageFraming>>(window.localStorage.getItem(LOCAL_MAP_IMAGE_FRAMING_KEY), {});
};

const saveLocalMapImageFraming = (nextFraming: Record<string, MapImageFraming>) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_MAP_IMAGE_FRAMING_KEY, JSON.stringify(nextFraming));
};

const mapGpsToPercent = (gps: LiveGpsState, calibration: MapBoundsCalibration) => {
    return projectGpsToMapPercent({ lat: gps.lat, lng: gps.lng }, calibration);
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

const gpsConfidenceFromAccuracy = (accuracyMeters: number) => {
    if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) {
        return {
            level: 'unknown',
            label: 'Unknown',
            color: '#94a3b8',
            hint: 'Waiting for reliable GPS fix.'
        };
    }

    if (accuracyMeters <= 8) {
        return {
            level: 'high',
            label: 'High',
            color: '#22c55e',
            hint: 'Great for saving trail points.'
        };
    }

    if (accuracyMeters <= 20) {
        return {
            level: 'medium',
            label: 'Medium',
            color: '#facc15',
            hint: 'Usable, but pause for tighter accuracy if needed.'
        };
    }

    return {
        level: 'low',
        label: 'Low',
        color: '#ef4444',
        hint: 'Wait before saving critical trail points.'
    };
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
    return unprojectMapPercentToLatLng({ x: point.x, y: point.y }, calibration) || {
        lat: Number.NaN,
        lng: Number.NaN
    };
};

const latLngToXyPoint = (lat: number, lng: number, calibration: MapBoundsCalibration) => {
    return projectLatLngToMapPercent(lat, lng, calibration);
};

const buildGpxFromTrail = (
    trailPoints: TrailPoint[],
    calibration: MapBoundsCalibration,
    trailName: string
) => {
    const gpxPoints = trailPoints
        .map(point => {
            const latLng =
                Number.isFinite(point.lat) && Number.isFinite(point.lng)
                    ? { lat: point.lat as number, lng: point.lng as number }
                    : xyPointToLatLng(point, calibration);
            return {
                lat: latLng.lat,
                lng: latLng.lng,
                ele: Number.isFinite(point.altitudeMeters) ? (point.altitudeMeters as number) : null,
                time: point.capturedAtIso || null
            };
        })
        .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    if (gpxPoints.length < 2) {
        return null;
    }

    const encodePointXml = (point: { lat: number; lng: number; ele: number | null; time: string | null }, tagName: 'trkpt' | 'rtept') => {
        const elePart = point.ele !== null ? `<ele>${point.ele.toFixed(2)}</ele>` : '';
        const timePart = point.time ? `<time>${escapeXml(point.time)}</time>` : '';
        return `<${tagName} lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}">${elePart}${timePart}</${tagName}>`;
    };

    const encodedRoutePoints = gpxPoints.map(point => encodePointXml(point, 'rtept')).join('');
    const encodedTrackPoints = gpxPoints.map(point => encodePointXml(point, 'trkpt')).join('');
    const description = 'Trail exported from Mangiafesto Land Management for ONX Hunt and other GPX apps.';

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mangiafesto Land App" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(trailName)}</name>
    <desc>${escapeXml(description)}</desc>
  </metadata>
  <rte>
    <name>${escapeXml(trailName)}</name>
    ${encodedRoutePoints}
  </rte>
  <trk>
    <name>${escapeXml(trailName)}</name>
    <trkseg>${encodedTrackPoints}</trkseg>
  </trk>
</gpx>`;
};

const getNodeLocalName = (node: Element) => (node.localName || node.tagName.toLowerCase());

const getNamedChildText = (node: Element | null, childName: string) => {
    if (!node) return '';
    const matchingChild = Array.from(node.children).find(child => getNodeLocalName(child) === childName);
    return matchingChild?.textContent?.trim() || '';
};

const parseGpxToTrailPoints = (rawGpx: string, calibration: MapBoundsCalibration) => {
    const parser = new DOMParser();
    const xml = parser.parseFromString(rawGpx, 'application/xml');
    const parserError = xml.querySelector('parsererror');
    if (parserError) {
        throw new Error('GPX file could not be parsed.');
    }

    const pointNodes: Element[] = [];
    const visit = (node: Element) => {
        const localName = getNodeLocalName(node);
        if (localName === 'trkpt' || localName === 'rtept' || localName === 'wpt') {
            pointNodes.push(node);
        }

        Array.from(node.children).forEach(child => visit(child as Element));
    };

    visit(xml.documentElement);

    const points: TrailPoint[] = [];

    for (const node of pointNodes) {
        const latValue = node.getAttribute('lat') || node.getAttribute('latitude');
        const lngValue = node.getAttribute('lon') || node.getAttribute('lng') || node.getAttribute('longitude');
        const lat = Number(latValue);
        const lng = Number(lngValue);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const projected = latLngToXyPoint(lat, lng, calibration);
        if (!projected) continue;

        const eleRaw = getNamedChildText(node, 'ele');
        const timeRaw = getNamedChildText(node, 'time');
        const parsedElevation = Number(eleRaw);

        points.push({
            x: Number(projected.x.toFixed(2)),
            y: Number(projected.y.toFixed(2)),
            lat,
            lng,
            altitudeMeters: Number.isFinite(parsedElevation) ? parsedElevation : null,
            capturedAtIso: timeRaw || undefined
        });
    }

    return points;
};

const triggerTextDownload = (contents: string, filename: string) => {
    const blob = new Blob([contents], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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

    const firstCapturedAt = trailPoints[0]?.capturedAtIso;
    const lastCapturedAt = trailPoints[trailPoints.length - 1]?.capturedAtIso;
    const firstTime = typeof firstCapturedAt === 'string' ? Date.parse(firstCapturedAt) : NaN;
    const lastTime = typeof lastCapturedAt === 'string' ? Date.parse(lastCapturedAt) : NaN;
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
    const [featureIconKey, setFeatureIconKey] = useState('pin');
    const [trailColor, setTrailColor] = useState(DEFAULT_TRAIL_COLOR);
    const [trailWidth, setTrailWidth] = useState(DEFAULT_TRAIL_WIDTH);
    const [trailPattern, setTrailPattern] = useState<'solid' | 'dashed' | 'dotted'>(DEFAULT_TRAIL_PATTERN);
    const [featureDescription, setFeatureDescription] = useState('');
    const [featureX, setFeatureX] = useState('50');
    const [featureY, setFeatureY] = useState('50');
    const [featureLat, setFeatureLat] = useState('');
    const [featureLng, setFeatureLng] = useState('');

    const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
    const [mapImageFitMode, setMapImageFitMode] = useState<'contain' | 'cover'>('contain');
    const [mapImageScalePercent, setMapImageScalePercent] = useState(100);
    const [mapImageOffsetXPercent, setMapImageOffsetXPercent] = useState(0);
    const [mapImageOffsetYPercent, setMapImageOffsetYPercent] = useState(0);
    const [mapImageRotationDeg, setMapImageRotationDeg] = useState(0);
    const [mapImageFlipX, setMapImageFlipX] = useState(false);
    const [mapImageFlipY, setMapImageFlipY] = useState(false);
    const [trailDraftPoints, setTrailDraftPoints] = useState<TrailPoint[]>([]);
    const [isTrailPlanning, setIsTrailPlanning] = useState(false);
    const [isTrailEditMode, setIsTrailEditMode] = useState(false);
    const [selectedDraftPointIndex, setSelectedDraftPointIndex] = useState<number | null>(null);
    const [lastMapClickPoint, setLastMapClickPoint] = useState<MapPercentPoint | null>(null);
    const [featureImageFiles, setFeatureImageFiles] = useState<File[]>([]);
    const [existingAttachments, setExistingAttachments] = useState<FeatureAttachment[]>([]);
    const [trailQuickImageFiles, setTrailQuickImageFiles] = useState<Record<string, File[]>>({});
    const [onxGpxFile, setOnxGpxFile] = useState<File | null>(null);
    const [onxDropActive, setOnxDropActive] = useState(false);
    const [onxAutoImportEnabled, setOnxAutoImportEnabled] = useState(false);
    const [onxAutoArchiveEnabled, setOnxAutoArchiveEnabled] = useState(false);
    const [onxAutoImportIntervalSec, setOnxAutoImportIntervalSec] = useState(60);
    const [onxAutoImportLastRun, setOnxAutoImportLastRun] = useState<string | null>(null);
    const [onxAutoImportInFlight, setOnxAutoImportInFlight] = useState(false);
    const onxAutoImportRunningRef = useRef(false);

    const [draggingFeatureId, setDraggingFeatureId] = useState<string | null>(null);
    const draggingFeatureIdRef = useRef<string | null>(null);
    const mapCanvasRef = useRef<HTMLDivElement | null>(null);
    const suppressNextMapClickRef = useRef(false);
    const [edgeCalibrationMode, setEdgeCalibrationMode] = useState<EdgeCalibrationMode | null>(null);
    const [edgeCalibrationStartPoint, setEdgeCalibrationStartPoint] = useState<MapPercentPoint | null>(null);
    const [edgeCalibrationPreviewPoint, setEdgeCalibrationPreviewPoint] = useState<MapPercentPoint | null>(null);
    const [gpsAnchorPickMode, setGpsAnchorPickMode] = useState(false);
    const [gpsAnchorPoint, setGpsAnchorPoint] = useState<MapPercentPoint | null>(null);

    const [northLatInput, setNorthLatInput] = useState('');
    const [southLatInput, setSouthLatInput] = useState('');
    const [westLngInput, setWestLngInput] = useState('');
    const [eastLngInput, setEastLngInput] = useState('');
    const [liveGps, setLiveGps] = useState<LiveGpsState | null>(null);
    const [isGpsTracking, setIsGpsTracking] = useState(false);
    const [gpsError, setGpsError] = useState<string | null>(null);
    const gpsWatchIdRef = useRef<number | null>(null);
    const [autoFollowGps, setAutoFollowGps] = useState(false);
    const [mockGpsInput, setMockGpsInput] = useState('43.2140, -77.9800\n43.2148, -77.9795\n43.2157, -77.9790');
    const [mockGpsPathPoints, setMockGpsPathPoints] = useState<Array<{ lat: number; lng: number }>>([]);
    const [mockGpsPlaybackIndex, setMockGpsPlaybackIndex] = useState(0);
    const [mockGpsEnabled, setMockGpsEnabled] = useState(false);
    const mockGpsTimerRef = useRef<number | null>(null);
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
    const [simpleLayout, setSimpleLayout] = useState(true);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [isTrailFieldMode, setIsTrailFieldMode] = useState(false);
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

    const trailLibraryEntries = useMemo(() => {
        return features
            .filter(feature => feature.feature_type === 'trail')
            .map(feature => {
                const summary = trailByFeatureId.get(feature.id) || { points: [] as TrailPoint[], stats: null as TrailStats | null };
                return {
                    feature,
                    points: summary.points,
                    stats: summary.stats,
                    attachments: parseFeatureAttachmentsFromDescription(feature.description)
                };
            });
    }, [features, trailByFeatureId]);

    const featureVisualById = useMemo(() => {
        const lookup = new Map<string, FeatureVisualMeta>();
        for (const feature of features) {
            const visualMeta = readVisualMetaFromDescription(feature.description);
            if (visualMeta) {
                lookup.set(feature.id, visualMeta);
            }
        }
        return lookup;
    }, [features]);

    const gpsMapPoint = useMemo(() => {
        if (!liveGps || !activeCalibration) return null;
        return mapGpsToPercent(liveGps, activeCalibration);
    }, [liveGps, activeCalibration]);

    const gpsAccuracyRadiusPercent = useMemo(() => {
        if (!liveGps || !activeCalibration) return 0;
        return gpsAccuracyMetersToPercent(liveGps.accuracyMeters, activeCalibration);
    }, [liveGps, activeCalibration]);

    const gpsConfidence = useMemo(() => {
        if (!liveGps) return null;
        return gpsConfidenceFromAccuracy(liveGps.accuracyMeters);
    }, [liveGps]);

    const mapTransform = useMemo(() => {
        const followPoint = autoFollowGps && isGpsTracking && gpsMapPoint
            ? { x: gpsMapPoint.x, y: gpsMapPoint.y }
            : null;
        return buildMapTransform(mapZoomPercent, followPoint);
    }, [autoFollowGps, isGpsTracking, gpsMapPoint, mapZoomPercent]);

    const mapNorthCompassAngleDeg = useMemo(() => {
        return normalizeSignedAngle(mapImageRotationDeg + (mapImageFlipY ? 180 : 0));
    }, [mapImageRotationDeg, mapImageFlipY]);

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

    const onxCursorStorageKey = useMemo(
        () => `${LOCAL_ONX_IMPORT_CURSOR_KEY}-${selectedMapId || 'none'}`,
        [selectedMapId]
    );

    const onxSignaturesStorageKey = useMemo(
        () => `${LOCAL_ONX_IMPORTED_SIGNATURES_KEY}-${selectedMapId || 'none'}`,
        [selectedMapId]
    );

    const readOnxImportCursor = () => {
        if (typeof window === 'undefined') return 0;
        const raw = window.localStorage.getItem(onxCursorStorageKey);
        const parsed = Number(raw || '0');
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const writeOnxImportCursor = (cursorMs: number) => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(onxCursorStorageKey, String(cursorMs));
    };

    const readOnxImportedSignatures = () => {
        if (typeof window === 'undefined') return new Set<string>();
        const parsed = parseJson<string[]>(window.localStorage.getItem(onxSignaturesStorageKey), []);
        return new Set(parsed);
    };

    const writeOnxImportedSignatures = (signatures: Set<string>) => {
        if (typeof window === 'undefined') return;
        const compact = Array.from(signatures).slice(-300);
        window.localStorage.setItem(onxSignaturesStorageKey, JSON.stringify(compact));
    };

    const persistFeaturePosition = async (featureId: string, nextX: number, nextY: number) => {
        const nowIso = new Date().toISOString();

        if (storageMode === 'local') {
            const nextFeatures = readLocalFeatures().map(feature =>
                feature.id === featureId
                    ? {
                        ...feature,
                        x_percent: nextX,
                        y_percent: nextY,
                        updated_at: nowIso
                    }
                    : feature
            );

            saveLocalFeatures(nextFeatures);
            setFeatures(nextFeatures.filter(feature => feature.map_id === selectedMapId));
            return;
        }

        const { error: updateError } = await supabase
            .from('property_map_features')
            .update({
                x_percent: nextX,
                y_percent: nextY,
                updated_at: nowIso,
                updated_by: profileId
            })
            .eq('id', featureId);

        if (updateError) {
            throw updateError;
        }
    };

    const createTrailFeatureFromPoints = async (
        trailPoints: TrailPoint[],
        label: string,
        sourceDescription: string,
        visualOverrides?: Partial<FeatureVisualMeta>
    ) => {
        if (!selectedMap?.id) {
            throw new Error('Create or select a property map first.');
        }

        const normalizedTrailPoints = trailPoints
            .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
            .map(point => ({
                x: clamp(Number(point.x.toFixed(2)), 0, 100),
                y: clamp(Number(point.y.toFixed(2)), 0, 100),
                lat: Number.isFinite(point.lat) ? Number(point.lat) : undefined,
                lng: Number.isFinite(point.lng) ? Number(point.lng) : undefined,
                altitudeMeters: Number.isFinite(point.altitudeMeters) ? Number(point.altitudeMeters) : null,
                capturedAtIso: point.capturedAtIso
            }));

        if (normalizedTrailPoints.length < 2) {
            throw new Error('Imported trail needs at least 2 points.');
        }

        const visualMeta: FeatureVisualMeta = {
            version: 1,
            iconKey: 'trail',
            trailColor: visualOverrides?.trailColor || trailColor,
            trailWidth: Number.isFinite(visualOverrides?.trailWidth) ? visualOverrides?.trailWidth : trailWidth,
            trailPattern: visualOverrides?.trailPattern || trailPattern
        };

        const description = composeFeatureDescription(
            sourceDescription,
            normalizedTrailPoints,
            [],
            true,
            computeTrailStats(normalizedTrailPoints, activeCalibration),
            visualMeta
        );

        const payload = {
            map_id: selectedMap.id,
            label: label.trim() || 'Imported ONX trail',
            feature_type: 'trail',
            status: 'planned',
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
            return;
        }

        const { error: insertError } = await supabase.from('property_map_features').insert(payload);
        if (insertError) {
            throw insertError;
        }

        await loadFeatures(selectedMap.id);
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

        const storedFraming = readLocalMapImageFraming()[selectedMap.id];
        if (storedFraming) {
            setMapImageFitMode(storedFraming.fitMode === 'cover' ? 'cover' : 'contain');
            setMapImageScalePercent(clamp(Number(storedFraming.scalePercent), 70, 220));
            setMapImageOffsetXPercent(clamp(Number(storedFraming.offsetXPercent), -40, 40));
            setMapImageOffsetYPercent(clamp(Number(storedFraming.offsetYPercent), -40, 40));
            setMapImageRotationDeg(clamp(Number(storedFraming.rotationDeg), -180, 180));
            setMapImageFlipX(Boolean(storedFraming.flipX));
            setMapImageFlipY(Boolean(storedFraming.flipY));
        } else {
            setMapImageFitMode('contain');
            setMapImageScalePercent(100);
            setMapImageOffsetXPercent(0);
            setMapImageOffsetYPercent(0);
            setMapImageRotationDeg(0);
            setMapImageFlipX(false);
            setMapImageFlipY(false);
        }

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
        if (!selectedMap?.id) return;

        const nextFraming = {
            ...readLocalMapImageFraming(),
            [selectedMap.id]: {
                fitMode: mapImageFitMode,
                scalePercent: mapImageScalePercent,
                offsetXPercent: mapImageOffsetXPercent,
                offsetYPercent: mapImageOffsetYPercent,
                rotationDeg: mapImageRotationDeg,
                flipX: mapImageFlipX,
                flipY: mapImageFlipY
            } as MapImageFraming
        };

        saveLocalMapImageFraming(nextFraming);
    }, [
        selectedMap?.id,
        mapImageFitMode,
        mapImageScalePercent,
        mapImageOffsetXPercent,
        mapImageOffsetYPercent,
        mapImageRotationDeg,
        mapImageFlipX,
        mapImageFlipY
    ]);

    useEffect(() => {
        resolveMapImageUrl(selectedMap);
    }, [selectedMap?.id, selectedMap?.base_image_path, selectedMap?.base_image_url, storageMode]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const media = window.matchMedia('(max-width: 820px)');
        const applyViewport = () => {
            const mobile = media.matches;
            setIsMobileViewport(mobile);
            if (!mobile) {
                setIsTrailFieldMode(false);
            }
        };

        applyViewport();
        media.addEventListener('change', applyViewport);

        return () => {
            media.removeEventListener('change', applyViewport);
        };
    }, []);

    useEffect(() => {
        return () => {
            if (mockGpsTimerRef.current !== null) {
                window.clearInterval(mockGpsTimerRef.current);
                mockGpsTimerRef.current = null;
            }
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
            setFeatureIconKey('pin');
            setTrailColor(DEFAULT_TRAIL_COLOR);
            setTrailWidth(DEFAULT_TRAIL_WIDTH);
            setTrailPattern(DEFAULT_TRAIL_PATTERN);
            setFeatureDescription('');
            setTrailDraftPoints([]);
            setSelectedDraftPointIndex(null);
            setIsTrailEditMode(false);
            setFeatureImageFiles([]);
            setExistingAttachments([]);
            return;
        }

        setFeatureLabel(selectedFeature.label);
        setFeatureType(selectedFeature.feature_type);
        setFeatureStatus(selectedFeature.status);
        const visualMeta = readVisualMetaFromDescription(selectedFeature.description);
        setFeatureIconKey(visualMeta?.iconKey || selectedFeature.feature_type || 'pin');
        setTrailColor(visualMeta?.trailColor || DEFAULT_TRAIL_COLOR);
        setTrailWidth(Number.isFinite(visualMeta?.trailWidth) ? clamp(visualMeta?.trailWidth as number, 0.5, 2.5) : DEFAULT_TRAIL_WIDTH);
        setTrailPattern(
            visualMeta?.trailPattern === 'dashed' || visualMeta?.trailPattern === 'dotted' || visualMeta?.trailPattern === 'solid'
                ? visualMeta.trailPattern
                : DEFAULT_TRAIL_PATTERN
        );
        setFeatureDescription(stripTrailMetadata(selectedFeature.description));
        setFeatureX(String(selectedFeature.x_percent));
        setFeatureY(String(selectedFeature.y_percent));
        setFeatureLat(selectedFeature.lat === null ? '' : String(selectedFeature.lat));
        setFeatureLng(selectedFeature.lng === null ? '' : String(selectedFeature.lng));
        setExistingAttachments(parseFeatureAttachmentsFromDescription(selectedFeature.description));
        setFeatureImageFiles([]);

        if (selectedFeature.feature_type === 'trail') {
            setTrailDraftPoints(parseTrailPointsFromDescription(selectedFeature.description));
            setIsTrailEditMode(false);
            setSelectedDraftPointIndex(null);
        } else {
            setTrailDraftPoints([]);
            setIsTrailEditMode(false);
            setSelectedDraftPointIndex(null);
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

    const mapPercentFromClientPoint = (clientX: number, clientY: number, rect: DOMRect) => {
        const clickX = ((clientX - rect.left) / rect.width) * 100;
        const clickY = ((clientY - rect.top) / rect.height) * 100;
        const mappedX = (clickX - mapTransform.translateXPercent) / mapTransform.scale;
        const mappedY = (clickY - mapTransform.translateYPercent) / mapTransform.scale;
        return {
            x: Number(clamp(mappedX, 0, 100).toFixed(2)),
            y: Number(clamp(mappedY, 0, 100).toFixed(2))
        };
    };

    const onMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (suppressNextMapClickRef.current) {
            suppressNextMapClickRef.current = false;
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const { x: clampedX, y: clampedY } = mapPercentFromClientPoint(event.clientX, event.clientY, rect);
        setLastMapClickPoint({ x: clampedX, y: clampedY });

        if (gpsAnchorPickMode) {
            setGpsAnchorPoint({ x: clampedX, y: clampedY });
            setGpsAnchorPickMode(false);
            setError(null);
            setStatusMessage('Standing spot marked on map. Now tap Align GPS to marked spot.');
            return;
        }

        if (edgeCalibrationMode) {
            if (!edgeCalibrationStartPoint) {
                setEdgeCalibrationStartPoint({ x: clampedX, y: clampedY });
                setEdgeCalibrationPreviewPoint({ x: clampedX, y: clampedY });
                setError(null);
                setStatusMessage(
                    edgeCalibrationMode === 'auto'
                        ? 'Auto calibrate: point 1 set. Choose edge type below, then tap point 2 on that same edge.'
                        : edgeCalibrationMode === 'north'
                            ? 'North alignment: point 1 set. Tap a second point farther north on the same edge.'
                            : 'East/West alignment: point 1 set. Tap a second point farther east or west on the same edge.'
                );
                return;
            }

            if (edgeCalibrationMode === 'auto') {
                setError('Choose edge type (North or East/West) before selecting point 2.');
                return;
            }

            const rotationDelta = edgeCalibrationMode === 'north'
                ? calculateNorthAlignmentRotationDelta(edgeCalibrationStartPoint, { x: clampedX, y: clampedY })
                : calculateEastWestAlignmentRotationDelta(edgeCalibrationStartPoint, { x: clampedX, y: clampedY });
            if (rotationDelta === null) {
                setError(
                    edgeCalibrationMode === 'north'
                        ? 'North alignment line is too short. Tap two points farther apart.'
                        : 'East/West alignment line is too short. Tap two points farther apart.'
                );
                return;
            }

            setMapImageRotationDeg(prev => normalizeSignedAngle(prev + rotationDelta));
            setEdgeCalibrationMode(null);
            setEdgeCalibrationStartPoint(null);
            setEdgeCalibrationPreviewPoint(null);
            setError(null);
            setStatusMessage(
                edgeCalibrationMode === 'north'
                    ? `North alignment applied. Rotated image ${rotationDelta.toFixed(1)} degrees.`
                    : `East/West alignment applied. Rotated image ${rotationDelta.toFixed(1)} degrees.`
            );
            return;
        }

        if (isTrailEditMode && trailDraftPoints.length > 0) {
            const targetIndex = selectedDraftPointIndex ?? trailDraftPoints.length - 1;
            setTrailDraftPoints(prev =>
                prev.map((point, idx) => (idx === targetIndex ? { ...point, x: clampedX, y: clampedY } : point))
            );
            setFeatureX(String(clampedX));
            setFeatureY(String(clampedY));
            setStatusMessage(`Moved trail point #${targetIndex + 1}. Save feature to keep the edit.`);
            return;
        }

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

    const adjustMapZoom = (delta: number) => {
        setMapZoomPercent(prev => clamp(prev + delta, 100, 350));
    };

    const zoomToAcreageView = () => {
        setMapImageFitMode('contain');
        setMapZoomPercent(100);
        setAutoFollowGps(false);
        setStatusMessage('Acreage view fit applied for the 40-acre property.');
    };

    const zoomToTrailDetailView = () => {
        setMapZoomPercent(220);
        setStatusMessage('Detail zoom enabled for manual trail refinement.');
    };

    const onMapWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -8 : 8;
        adjustMapZoom(delta);
    };

    const beginFeatureDrag = (featureId: string) => {
        suppressNextMapClickRef.current = true;
        draggingFeatureIdRef.current = featureId;
        setDraggingFeatureId(featureId);
    };

    const onMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (edgeCalibrationMode && edgeCalibrationStartPoint && !draggingFeatureIdRef.current) {
            const rect = event.currentTarget.getBoundingClientRect();
            const { x, y } = mapPercentFromClientPoint(event.clientX, event.clientY, rect);
            setEdgeCalibrationPreviewPoint({ x, y });
        }

        if (!draggingFeatureIdRef.current) return;
        event.preventDefault();

        const rect = event.currentTarget.getBoundingClientRect();
        const { x, y } = mapPercentFromClientPoint(event.clientX, event.clientY, rect);

        setFeatures(prev =>
            prev.map(feature =>
                feature.id === draggingFeatureIdRef.current
                    ? { ...feature, x_percent: x, y_percent: y }
                    : feature
            )
        );

        if (selectedFeatureId === draggingFeatureIdRef.current) {
            setFeatureX(String(x));
            setFeatureY(String(y));
        }
    };

    const onMapPointerUp = async () => {
        const featureId = draggingFeatureIdRef.current;
        if (!featureId) return;

        draggingFeatureIdRef.current = null;
        setDraggingFeatureId(null);

        const movedFeature = features.find(feature => feature.id === featureId);
        if (!movedFeature) return;

        try {
            await persistFeaturePosition(featureId, movedFeature.x_percent, movedFeature.y_percent);
            setStatusMessage(`Moved ${movedFeature.label} to X ${movedFeature.x_percent.toFixed(2)}%, Y ${movedFeature.y_percent.toFixed(2)}%.`);
        } catch (err: any) {
            setError(err?.message || 'Could not persist dragged marker position.');
            if (selectedMap?.id) {
                await loadFeatures(selectedMap.id);
            }
        }
    };

    const loadSelectedTrailIntoEditor = () => {
        if (!selectedFeature || selectedFeature.feature_type !== 'trail') {
            setError('Select a trail feature first.');
            return;
        }

        const parsedTrailPoints = parseTrailPointsFromDescription(selectedFeature.description);
        if (parsedTrailPoints.length < 2) {
            setError('Selected trail does not have enough points to edit.');
            return;
        }

        setFeatureType('trail');
        setFeatureIconKey('trail');
        setTrailDraftPoints(parsedTrailPoints);
        setSelectedDraftPointIndex(0);
        setIsTrailPlanning(false);
        setIsTrailEditMode(true);
        setFeatureX(String(parsedTrailPoints[0].x));
        setFeatureY(String(parsedTrailPoints[0].y));
        setError(null);
        setStatusMessage('Trail edit mode is active. Select a point, tap map to reposition, then save feature.');
    };

    const removeSelectedDraftPoint = () => {
        if (selectedDraftPointIndex === null) {
            setError('Select a draft point first.');
            return;
        }

        if (trailDraftPoints.length <= 2) {
            setError('Trails need at least 2 points.');
            return;
        }

        const nextPoints = trailDraftPoints.filter((_, idx) => idx !== selectedDraftPointIndex);
        setTrailDraftPoints(nextPoints);
        setSelectedDraftPointIndex(Math.min(selectedDraftPointIndex, nextPoints.length - 1));
        setStatusMessage('Removed selected draft point.');
    };

    const insertDraftPointAfterSelected = () => {
        if (trailDraftPoints.length === 0) {
            setError('Add or load a trail first.');
            return;
        }

        const sourceIndex = selectedDraftPointIndex ?? trailDraftPoints.length - 1;
        const current = trailDraftPoints[sourceIndex];
        const next = trailDraftPoints[Math.min(sourceIndex + 1, trailDraftPoints.length - 1)] || current;
        const insertedPoint: TrailPoint = {
            x: Number(((current.x + next.x) / 2).toFixed(2)),
            y: Number(((current.y + next.y) / 2).toFixed(2))
        };

        const nextPoints = [...trailDraftPoints];
        nextPoints.splice(sourceIndex + 1, 0, insertedPoint);
        setTrailDraftPoints(nextPoints);
        setSelectedDraftPointIndex(sourceIndex + 1);
        setStatusMessage('Inserted new point after current selection.');
    };

    const dropLandmarkAtGpsPin = () => {
        if (!gpsMapPoint || !liveGps) {
            setError('Start phone GPS and wait for a map position first.');
            return;
        }

        const nextX = Number(gpsMapPoint.x.toFixed(2));
        const nextY = Number(gpsMapPoint.y.toFixed(2));
        setFeatureType('note');
        setFeatureIconKey('pin');
        setFeatureStatus('active');
        setFeatureLabel(`GPS landmark ${new Date().toLocaleTimeString()}`);
        setFeatureX(String(nextX));
        setFeatureY(String(nextY));
        setFeatureLat(liveGps.lat.toFixed(7));
        setFeatureLng(liveGps.lng.toFixed(7));
        setStatusMessage('GPS landmark prefilled. Save feature to pin it on your map.');
        setError(null);
    };

    const handleOnxGpxFileSelection = (file: File | null) => {
        setOnxGpxFile(file);
        setOnxDropActive(false);
        if (file) {
            setStatusMessage(`Selected ONX GPX: ${file.name}. Import it to create a draft trail on this map.`);
        }
    };

    const openOnxHuntApp = () => {
        if (typeof window === 'undefined') return;
        window.location.href = ONX_HUNT_APP_DEEP_LINK;
        window.setTimeout(() => {
            window.open(ONX_HUNT_WEBMAP_URL, '_blank', 'noopener,noreferrer');
        }, 700);
    };

    const exportTrailToGpx = () => {
        if (!activeCalibration) {
            setError('Save a valid GPS calibration first. GPX export needs map bounds.');
            return;
        }

        const sourceTrail = trailDraftPoints.length >= 2
            ? trailDraftPoints
            : selectedFeature?.feature_type === 'trail'
                ? parseTrailPointsFromDescription(selectedFeature.description)
                : [];

        if (sourceTrail.length < 2) {
            setError('Select a trail or create a draft trail before exporting GPX.');
            return;
        }

        const trailName = featureLabel.trim() || selectedFeature?.label || 'property-trail';
        const gpx = buildGpxFromTrail(sourceTrail, activeCalibration, trailName);

        if (!gpx) {
            setError('Could not export this trail to GPX.');
            return;
        }

        const filename = `${sanitizeFileStem(trailName) || 'property-trail'}-${new Date().toISOString().slice(0, 10)}.gpx`;
        triggerTextDownload(gpx, filename);
        setStatusMessage('GPX exported. Import this file into ONX Hunt to sync the trail.');
        setError(null);
    };

    const importOnxGpxToDraftTrail = async () => {
        if (!onxGpxFile) {
            setError('Choose a GPX file from ONX first.');
            return;
        }

        if (!activeCalibration) {
            setError('Save valid map bounds before importing ONX GPX.');
            return;
        }

        try {
            const rawGpx = await onxGpxFile.text();
            const importedPoints = parseGpxToTrailPoints(rawGpx, activeCalibration);

            if (importedPoints.length < 2) {
                setError('No usable track points were found in this GPX file.');
                return;
            }

            setFeatureType('trail');
            setFeatureStatus('planned');
            setFeatureIconKey('trail');
            setFeatureLabel(`${sanitizeFileStem(onxGpxFile.name) || 'ONX trail'} import`);
            setTrailDraftPoints(importedPoints);
            setFeatureX(String(importedPoints[0].x));
            setFeatureY(String(importedPoints[0].y));
            setFeatureLat(importedPoints[0].lat?.toFixed(7) || '');
            setFeatureLng(importedPoints[0].lng?.toFixed(7) || '');
            setIsTrailPlanning(false);
            setIsTrailEditMode(true);
            setSelectedDraftPointIndex(0);
            setStatusMessage(`Imported ${importedPoints.length} ONX points to draft trail. Save feature to store it.`);
            setError(null);
        } catch (err: any) {
            setError(err?.message || 'Could not import GPX from ONX.');
        }
    };

    const runOnxAutoImport = async (force = false) => {
        if ((!onxAutoImportEnabled && !force) || !selectedMap?.id || !activeCalibration) return;
        if (onxAutoImportRunningRef.current) return;

        onxAutoImportRunningRef.current = true;
        setOnxAutoImportInFlight(true);

        try {
            const sinceMs = readOnxImportCursor();
            const response = await fetch(
                `/api/onx-gpx-feed?sinceMs=${encodeURIComponent(String(sinceMs))}&maxFiles=10&archive=${onxAutoArchiveEnabled ? '1' : '0'}`,
                {
                    cache: 'no-store'
                }
            );

            if (!response.ok) {
                throw new Error('ONX shared-folder feed is unavailable.');
            }

            const payload = await response.json() as {
                enabled: boolean;
                folderPath: string;
                files: Array<{
                    name: string;
                    modifiedMs: number;
                    content: string;
                }>;
                archivedCount?: number;
                message?: string;
            };

            if (!payload.enabled) {
                setStatusMessage(payload.message || 'ONX shared-folder import is not configured on server.');
                return;
            }

            const signatures = readOnxImportedSignatures();
            let importedCount = 0;
            let newestModifiedMs = sinceMs;

            for (const file of payload.files) {
                newestModifiedMs = Math.max(newestModifiedMs, file.modifiedMs);
                const signature = `${file.name}:${file.modifiedMs}`;
                if (signatures.has(signature)) continue;

                let importedPoints: TrailPoint[] = [];
                try {
                    importedPoints = parseGpxToTrailPoints(file.content, activeCalibration);
                } catch {
                    signatures.add(signature);
                    continue;
                }

                if (importedPoints.length < 2) {
                    signatures.add(signature);
                    continue;
                }

                await createTrailFeatureFromPoints(
                    importedPoints,
                    `${sanitizeFileStem(file.name) || 'ONX trail'} auto`,
                    `Imported automatically from shared ONX GPX folder (${file.name}).`
                );

                signatures.add(signature);
                importedCount += 1;
            }

            writeOnxImportedSignatures(signatures);
            writeOnxImportCursor(newestModifiedMs || Date.now());
            setOnxAutoImportLastRun(new Date().toISOString());

            if (importedCount > 0) {
                const archivePart = onxAutoArchiveEnabled && (payload.archivedCount || 0) > 0
                    ? ` Archived ${payload.archivedCount} source file(s).`
                    : '';
                setStatusMessage(`Auto-imported ${importedCount} ONX GPX trail(s) from shared folder.${archivePart}`);
            }
        } catch (err: any) {
            setError(err?.message || 'ONX auto-import failed.');
        } finally {
            onxAutoImportRunningRef.current = false;
            setOnxAutoImportInFlight(false);
        }
    };

    useEffect(() => {
        if (!onxAutoImportEnabled || !selectedMap?.id || !activeCalibration) return;

        runOnxAutoImport();
        const intervalMs = Math.max(15, onxAutoImportIntervalSec) * 1000;
        const timerId = window.setInterval(() => {
            runOnxAutoImport();
        }, intervalMs);

        return () => {
            window.clearInterval(timerId);
        };
    }, [onxAutoImportEnabled, onxAutoImportIntervalSec, selectedMap?.id, activeCalibration, onxAutoArchiveEnabled]);

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

    const fitPropertyImageToCanvas = () => {
        setMapImageOffsetXPercent(0);
        setMapImageOffsetYPercent(0);
        setError(null);
        setStatusMessage('Property image auto-centered using current fit, scale, and rotation settings.');
    };

    const alignGpsToMarkedMapSpot = () => {
        if (!selectedMap?.id) {
            setError('Create or select a property map first.');
            return;
        }

        if (!activeCalibration) {
            setError('Set valid map GPS bounds before running GPS alignment.');
            return;
        }

        if (!liveGps) {
            setError('Start phone GPS first so current standing position is available.');
            return;
        }

        if (!gpsAnchorPoint) {
            setError('Mark your standing spot on the map first.');
            return;
        }

        const projected = mapGpsToPercent(liveGps, activeCalibration);
        if (!projected) {
            setError('Current GPS point could not be projected with the active calibration.');
            return;
        }

        const latSpan = activeCalibration.northLat - activeCalibration.southLat;
        const lngSpan = activeCalibration.eastLng - activeCalibration.westLng;

        const deltaXPercent = gpsAnchorPoint.x - projected.x;
        const deltaYPercent = gpsAnchorPoint.y - projected.y;

        const lngShift = (deltaXPercent / 100) * lngSpan;
        const latShift = -(deltaYPercent / 100) * latSpan;

        const shiftedCalibration: MapBoundsCalibration = {
            northLat: Number((activeCalibration.northLat + latShift).toFixed(7)),
            southLat: Number((activeCalibration.southLat + latShift).toFixed(7)),
            westLng: Number((activeCalibration.westLng + lngShift).toFixed(7)),
            eastLng: Number((activeCalibration.eastLng + lngShift).toFixed(7))
        };

        setNorthLatInput(String(shiftedCalibration.northLat));
        setSouthLatInput(String(shiftedCalibration.southLat));
        setWestLngInput(String(shiftedCalibration.westLng));
        setEastLngInput(String(shiftedCalibration.eastLng));

        const nextCalibrations = {
            ...readLocalCalibrations(),
            [selectedMap.id]: shiftedCalibration
        };
        saveLocalCalibrations(nextCalibrations);

        setGpsAnchorPickMode(false);
        setError(null);
        setStatusMessage('GPS alignment applied. Live pin should now line up with your marked standing spot.');
    };

    const stopMockGpsPath = () => {
        if (mockGpsTimerRef.current !== null) {
            window.clearInterval(mockGpsTimerRef.current);
            mockGpsTimerRef.current = null;
        }
        setMockGpsEnabled(false);
        setMockGpsPlaybackIndex(0);
        setMockGpsPathPoints([]);
    };

    const startMockGpsPath = () => {
        if (!activeCalibration) {
            setGpsError('Set valid map GPS bounds before starting mock GPS.');
            return;
        }

        const parsedPoints = parseMockGpsPath(mockGpsInput);
        if (parsedPoints.length === 0) {
            setGpsError('Enter at least one valid lat/lng coordinate in the mock GPS box.');
            return;
        }

        if (mockGpsTimerRef.current !== null) {
            window.clearInterval(mockGpsTimerRef.current);
            mockGpsTimerRef.current = null;
        }

        setMockGpsPathPoints(parsedPoints);
        setMockGpsPlaybackIndex(0);
        setMockGpsEnabled(true);
        setGpsError(null);
        setError(null);
        setAutoFollowGps(true);
        setStatusMessage('Mock GPS path started. The projected pin will animate through your entered coordinates.');

        const applyMockPoint = (point: { lat: number; lng: number }, index: number) => {
            setLiveGps({
                lat: point.lat,
                lng: point.lng,
                accuracyMeters: 5 + index,
                heading: null,
                speedMps: 1.2 + index * 0.15,
                altitudeMeters: null,
                capturedAtIso: new Date().toISOString()
            });
            setIsGpsTracking(true);
        };

        applyMockPoint(parsedPoints[0], 0);

        mockGpsTimerRef.current = window.setInterval(() => {
            setMockGpsPlaybackIndex(currentIndex => {
                const nextIndex = (currentIndex + 1) % parsedPoints.length;
                applyMockPoint(parsedPoints[nextIndex], nextIndex);
                return nextIndex;
            });
        }, 1400);
    };

    const locateMeOnMap = () => {
        if (!isGpsTracking) {
            setGpsError('Start phone GPS or mock GPS first.');
            return;
        }

        if (!gpsMapPoint) {
            setError('No projected GPS position is available yet.');
            return;
        }

        setAutoFollowGps(true);
        setMapZoomPercent(prev => Math.max(prev, 170));
        setError(null);
        setStatusMessage('Map centered on your live GPS location.');
    };

    const stopGpsTracking = () => {
        if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.clearWatch(gpsWatchIdRef.current);
            gpsWatchIdRef.current = null;
        }
        stopMockGpsPath();
        setLiveGps(null);
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

        stopMockGpsPath();
        setGpsError(null);
        setError(null);
        setStatusMessage('Starting live GPS tracking...');

        if (gpsWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        }

        const applyGpsFix = (position: GeolocationPosition) => {
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
        };

        navigator.geolocation.getCurrentPosition(
            position => {
                applyGpsFix(position);
                setStatusMessage('Live GPS fix acquired.');
            },
            () => {
                // Ignore initial one-shot fix errors; continuous watch may still succeed.
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 12000
            }
        );

        gpsWatchIdRef.current = navigator.geolocation.watchPosition(
            position => {
                applyGpsFix(position);
            },
            err => {
                setGpsError(err.message || 'Unable to read current GPS location.');
                setIsGpsTracking(false);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 12000
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
        setFeatureIconKey('trail');
        setFeatureLabel(walkTrailLabel.trim() || 'Live hike trail');
        setTrailDraftPoints([]);
        setSelectedDraftPointIndex(null);
        setIsTrailEditMode(false);
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
        setFeatureIconKey('trail');
        if (!featureLabel.trim()) {
            setFeatureLabel('Hike breadcrumb trail');
        }
        setTrailDraftPoints(breadcrumbPoints);
        setSelectedDraftPointIndex(0);
        setIsTrailEditMode(true);
        setFeatureX(String(breadcrumbPoints[0].x));
        setFeatureY(String(breadcrumbPoints[0].y));
        setStatusMessage('Breadcrumb path loaded into trail draft. Save feature when ready.');
    };

    const addLastClickPointToTrailDraft = () => {
        if (!lastMapClickPoint) {
            setError('Click a location on the map first, then add it to a trail.');
            return;
        }

        setFeatureType('trail');
        setFeatureIconKey('trail');
        if (!featureLabel.trim()) {
            setFeatureLabel('Planned trail route');
        }

        setTrailDraftPoints(prev => {
            const nextPoint = { x: Number(lastMapClickPoint.x.toFixed(2)), y: Number(lastMapClickPoint.y.toFixed(2)) };
            if (prev.length === 0) {
                setFeatureX(String(nextPoint.x));
                setFeatureY(String(nextPoint.y));
                return [nextPoint];
            }
            const last = prev[prev.length - 1];
            const delta = Math.hypot(nextPoint.x - last.x, nextPoint.y - last.y);
            if (delta < 0.08) {
                return prev;
            }
            return [...prev, nextPoint];
        });

        setIsTrailPlanning(true);
        setIsTrailEditMode(false);
        setSelectedDraftPointIndex(null);
        setStatusMessage(`Point added from map click at X ${lastMapClickPoint.x.toFixed(2)}%, Y ${lastMapClickPoint.y.toFixed(2)}%.`);
        setError(null);
    };

    const continueTrailFromLibrary = (feature: PropertyMapFeature) => {
        const trailPoints = parseTrailPointsFromDescription(feature.description);
        if (trailPoints.length < 2) {
            setError('This trail does not have enough stored points to continue.');
            return;
        }

        setSelectedFeatureId(feature.id);
        setFeatureType('trail');
        setFeatureIconKey('trail');
        setTrailDraftPoints(trailPoints);
        setSelectedDraftPointIndex(trailPoints.length - 1);
        setIsTrailPlanning(true);
        setIsTrailEditMode(true);
        setFeatureX(String(trailPoints[trailPoints.length - 1].x));
        setFeatureY(String(trailPoints[trailPoints.length - 1].y));
        setStatusMessage(`Trail "${feature.label}" loaded. Click map to append new trail points, then save.`);
        setError(null);
    };

    const addCurrentGpsPointToTrailDraft = () => {
        if (!liveGps || !gpsMapPoint) {
            setError('Start GPS or mock GPS first so a point can be added.');
            return;
        }

        const gpsTrailPoint: TrailPoint = {
            x: Number(gpsMapPoint.x.toFixed(2)),
            y: Number(gpsMapPoint.y.toFixed(2)),
            lat: liveGps.lat,
            lng: liveGps.lng,
            altitudeMeters: liveGps.altitudeMeters,
            capturedAtIso: liveGps.capturedAtIso
        };

        setFeatureType('trail');
        setFeatureIconKey('trail');
        if (!featureLabel.trim()) {
            setFeatureLabel('GPS trail route');
        }

        setTrailDraftPoints(prev => {
            if (prev.length === 0) {
                setFeatureX(String(gpsTrailPoint.x));
                setFeatureY(String(gpsTrailPoint.y));
                return [gpsTrailPoint];
            }
            const last = prev[prev.length - 1];
            const delta = Math.hypot(gpsTrailPoint.x - last.x, gpsTrailPoint.y - last.y);
            if (delta < 0.08) {
                return prev;
            }
            return [...prev, gpsTrailPoint];
        });

        setIsTrailPlanning(false);
        setIsTrailEditMode(true);
        setStatusMessage(`GPS trail point added at ${liveGps.lat.toFixed(6)}, ${liveGps.lng.toFixed(6)}${gpsMapPoint.clamped ? ' (clamped to map edge).' : '.'}`);
        setError(null);
    };

    const queueTrailQuickImages = (featureId: string, files: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        if (selectedFiles.length === 0) {
            setTrailQuickImageFiles(prev => ({ ...prev, [featureId]: [] }));
            return;
        }

        const invalidFile = selectedFiles.find(file => !file.type.startsWith('image/'));
        if (invalidFile) {
            setError('Only image files are allowed for trail image uploads.');
            return;
        }

        const oversizedFile = selectedFiles.find(file => file.size > MAX_FEATURE_IMAGE_BYTES);
        if (oversizedFile) {
            setError(`Attachment ${oversizedFile.name} is too large. Use images under 10 MB each.`);
            return;
        }

        setTrailQuickImageFiles(prev => ({ ...prev, [featureId]: selectedFiles }));
        setError(null);
        setStatusMessage(`${selectedFiles.length} trail image(s) queued.`);
    };

    const saveTrailQuickImages = async (feature: PropertyMapFeature) => {
        if (!selectedMap?.id) {
            setError('Create or select a property map first.');
            return;
        }

        const queuedFiles = trailQuickImageFiles[feature.id] || [];
        if (queuedFiles.length === 0) {
            setError('Choose one or more trail images first.');
            return;
        }

        try {
            const existing = parseFeatureAttachmentsFromDescription(feature.description);
            const uploadedAttachments: FeatureAttachment[] = [];

            if (storageMode === 'supabase') {
                if (!profileId) {
                    throw new Error('Sign in before uploading trail images to Supabase.');
                }

                for (let index = 0; index < queuedFiles.length; index += 1) {
                    const file = queuedFiles[index];
                    const extension = extensionFromImageType(file.type || file.name);
                    const filePath = `${profileId}/feature-images/${selectedMap.id}/trail-${feature.id}-${Date.now()}-${index}.${extension}`;

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
            } else {
                for (const file of queuedFiles) {
                    uploadedAttachments.push({
                        name: file.name,
                        url: URL.createObjectURL(file),
                        path: null,
                        createdAtIso: new Date().toISOString()
                    });
                }
            }

            const trailPoints = parseTrailPointsFromDescription(feature.description);
            const visualMeta = readVisualMetaFromDescription(feature.description) || {
                version: 1,
                iconKey: 'trail',
                trailColor: DEFAULT_TRAIL_COLOR,
                trailWidth: DEFAULT_TRAIL_WIDTH,
                trailPattern: DEFAULT_TRAIL_PATTERN
            };

            const nextDescription = composeFeatureDescription(
                stripTrailMetadata(feature.description),
                trailPoints,
                [...existing, ...uploadedAttachments],
                true,
                computeTrailStats(trailPoints, activeCalibration),
                visualMeta
            );

            const nowIso = new Date().toISOString();

            if (storageMode === 'local') {
                const nextFeatures = readLocalFeatures().map(entry =>
                    entry.id === feature.id
                        ? {
                            ...entry,
                            description: nextDescription,
                            updated_at: nowIso,
                            updated_by: profileId
                        }
                        : entry
                );
                saveLocalFeatures(nextFeatures);
                setFeatures(nextFeatures.filter(entry => entry.map_id === selectedMap.id));
            } else {
                const { error: updateError } = await supabase
                    .from('property_map_features')
                    .update({
                        description: nextDescription,
                        updated_at: nowIso,
                        updated_by: profileId
                    })
                    .eq('id', feature.id);

                if (updateError) {
                    throw updateError;
                }

                await loadFeatures(selectedMap.id);
            }

            setTrailQuickImageFiles(prev => ({ ...prev, [feature.id]: [] }));
            setStatusMessage(`Saved ${queuedFiles.length} new image(s) to trail "${feature.label}".`);
            setError(null);
        } catch (err: any) {
            setError(err?.message || 'Could not save trail images.');
        }
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
                trailStats,
                {
                    version: 1,
                    iconKey: 'trail',
                    trailColor,
                    trailWidth,
                    trailPattern
                }
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
            setFeatureIconKey('trail');
            setFeatureLabel(walkTrailLabel.trim() || 'Live hike trail');
            setTrailDraftPoints([]);
            setSelectedDraftPointIndex(null);
            setIsTrailEditMode(false);
            setIsWalkTrailRecording(false);
            setStatusMessage('Walked trail saved as completed.');
        } catch (err: any) {
            setError(err?.message || 'Could not save walked trail.');
        } finally {
            setSavingFeature(false);
        }
    };

    useEffect(() => {
        if (!gpsMapPoint) return;
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
                    y: clamp(Number(point.y.toFixed(2)), 0, 100),
                    lat: Number.isFinite(point.lat) ? Number(point.lat) : undefined,
                    lng: Number.isFinite(point.lng) ? Number(point.lng) : undefined,
                    altitudeMeters: Number.isFinite(point.altitudeMeters) ? Number(point.altitudeMeters) : null,
                    capturedAtIso: point.capturedAtIso
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
                featureType === 'trail' ? computeTrailStats(normalizedTrailPoints, activeCalibration) : null,
                {
                    version: 1,
                    iconKey: featureIconKey,
                    trailColor: featureType === 'trail' ? trailColor : undefined,
                    trailWidth: featureType === 'trail' ? trailWidth : undefined,
                    trailPattern: featureType === 'trail' ? trailPattern : undefined
                }
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
                setSelectedDraftPointIndex(null);
                setIsTrailEditMode(false);
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
            setSelectedDraftPointIndex(null);
            setIsTrailEditMode(false);
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
            setSelectedDraftPointIndex(null);
            setIsTrailEditMode(false);
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
        setSelectedDraftPointIndex(null);
        setIsTrailEditMode(false);
        setStatusMessage('Feature deleted.');
        await loadFeatures(selectedMap.id);
    };

    if (loading) {
        return <div>Loading property maps...</div>;
    }

    return (
        <div style={{ display: 'grid', gap: '1rem', width: '100%', maxWidth: 1280, margin: '0 auto', paddingBottom: isTrailFieldMode ? 168 : 0 }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link href="/dashboard" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Main Dashboard
                </Link>
                <Link href="/dashboard/tickets" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Tickets
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
                    <div style={{ fontSize: '0.84rem', opacity: 0.82 }}>Property Planner</div>
                    <h2 style={{ margin: 0 }}>Property Map: 825 Brockport, New York</h2>
                    <div style={{ opacity: 0.8 }}>
                        Use Simple View for daily map work. Switch to Advanced View for full setup and sync tools.
                    </div>
                    <div style={{ opacity: 0.72, fontSize: '0.88rem' }}>
                        40 acres is about {ESTIMATED_SIDE_LENGTH_FEET} ft x {ESTIMATED_SIDE_LENGTH_FEET} ft when square. Use contain mode to avoid cropping.
                    </div>
                    <div style={{ opacity: 0.72, fontSize: '0.86rem' }}>
                        For live phone tracking, open this page from your phone browser over HTTPS, then enable GPS tracking below.
                    </div>
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={() => setSimpleLayout(true)}
                            style={{ borderColor: simpleLayout ? '#22c55e' : '#475569', color: simpleLayout ? '#bbf7d0' : '#cbd5e1' }}
                        >
                            Simple View
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={() => setSimpleLayout(false)}
                            style={{ borderColor: !simpleLayout ? '#38bdf8' : '#475569', color: !simpleLayout ? '#bae6fd' : '#cbd5e1' }}
                        >
                            Advanced View
                        </button>
                        {isMobileViewport && (
                            <button
                                type="button"
                                className="soft-button"
                                onClick={() => {
                                    setIsTrailFieldMode(prev => !prev);
                                    setSimpleLayout(true);
                                }}
                                style={{ borderColor: isTrailFieldMode ? '#f59e0b' : '#475569', color: isTrailFieldMode ? '#fde68a' : '#cbd5e1' }}
                            >
                                {isTrailFieldMode ? 'Exit Trail Field Mode' : 'Trail Field Mode'}
                            </button>
                        )}
                    </div>
                </div>

                {!simpleLayout && (
                    <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        <article style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem', display: 'grid', gap: '0.38rem' }}>
                            <img src="/property-map-guides/calibration-guide.svg" alt="GPS calibration guide" style={{ width: '100%', borderRadius: 8, border: '1px solid #1f2937' }} />
                            <div style={{ fontWeight: 600 }}>1) Calibrate map bounds</div>
                            <div style={{ fontSize: '0.85rem', opacity: 0.78 }}>Set north/south/west/east edges once, then your phone pin lands in the correct place.</div>
                        </article>
                        <article style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem', display: 'grid', gap: '0.38rem' }}>
                            <img src="/property-map-guides/trail-edit-guide.svg" alt="Trail editing guide" style={{ width: '100%', borderRadius: 8, border: '1px solid #1f2937' }} />
                            <div style={{ fontWeight: 600 }}>2) Edit trails point-by-point</div>
                            <div style={{ fontSize: '0.85rem', opacity: 0.78 }}>Load any saved trail, select a point, and tap map to move it for cleaner trail alignment.</div>
                        </article>
                        <article style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem', display: 'grid', gap: '0.38rem' }}>
                            <img src="/property-map-guides/onx-sync-guide.svg" alt="ONX sync guide" style={{ width: '100%', borderRadius: 8, border: '1px solid #1f2937' }} />
                            <div style={{ fontWeight: 600 }}>3) ONX Hunt bridge</div>
                            <div style={{ fontSize: '0.85rem', opacity: 0.78 }}>Open ONX quickly, export GPX from here, or import GPX from ONX to keep both tools in sync.</div>
                        </article>
                    </div>
                )}

                {statusMessage && <div style={{ color: '#86efac' }}>{statusMessage}</div>}
                {error && <div style={{ color: '#fca5a5' }}>{error}</div>}
                {!simpleLayout && (
                    <ConnectionDiagnostics
                        mode={storageMode}
                        contextLabel="Property map"
                        lastOperation={diagnosticLastOperation}
                        lastUpdatedAt={diagnosticLastUpdatedAt}
                        errorCode={diagnosticErrorCode}
                        errorMessage={diagnosticErrorMessage}
                    />
                )}
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

                {!simpleLayout && (
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
                )}

                <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.55rem' }}>
                    <div style={{ fontWeight: 700 }}>GPS Calibration + Live Tracking</div>
                    <div style={{ opacity: 0.76, fontSize: '0.88rem' }}>
                        Enter map edge coordinates so your phone GPS can be projected on this property image.
                    </div>
                    {!simpleLayout && (
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
                    )}
                    {!simpleLayout && (
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
                            <button type="button" className="soft-button" onClick={locateMeOnMap} disabled={!isGpsTracking}>
                                Locate me on map
                            </button>
                            <button
                                type="button"
                                className="soft-button"
                                onClick={() => {
                                    setGpsAnchorPickMode(prev => !prev);
                                    if (!gpsAnchorPickMode) {
                                        setStatusMessage('Tap your current standing location on the map image to set alignment anchor.');
                                        setError(null);
                                    }
                                }}
                                style={{ borderColor: gpsAnchorPickMode ? '#f97316' : '#475569', color: gpsAnchorPickMode ? '#fed7aa' : '#cbd5e1' }}
                                disabled={!liveGps}
                            >
                                {gpsAnchorPickMode ? 'Cancel standing spot pick' : 'Mark standing spot on map'}
                            </button>
                            <button type="button" className="soft-button" onClick={alignGpsToMarkedMapSpot} disabled={!liveGps || !gpsAnchorPoint || !activeCalibration}>
                                Align GPS to marked spot
                            </button>
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
                            {!isWalkTrailRecording ? (
                                <button type="button" className="soft-button" onClick={startWalkTrailRecording} disabled={!isGpsTracking}>
                                    Start walked trail now
                                </button>
                            ) : (
                                <button type="button" className="soft-button" onClick={stopWalkTrailRecording} style={{ borderColor: '#ef4444', color: '#fecaca' }}>
                                    Stop walked trail
                                </button>
                            )}
                            <button
                                type="button"
                                className="soft-button"
                                onClick={dropLandmarkAtGpsPin}
                                disabled={!liveGps || !gpsMapPoint}
                            >
                                Drop landmark at GPS pin
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
                    )}
                    {simpleLayout && (
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                className="soft-button"
                                onClick={isGpsTracking ? stopGpsTracking : startGpsTracking}
                                style={isGpsTracking ? { borderColor: '#ef4444', color: '#fecaca' } : undefined}
                            >
                                GPS On/Off
                            </button>
                            <button type="button" className="soft-button" onClick={locateMeOnMap} disabled={!isGpsTracking}>
                                Center Me
                            </button>
                            <button
                                type="button"
                                className="soft-button"
                                onClick={isWalkTrailRecording ? stopWalkTrailRecording : startWalkTrailRecording}
                                disabled={!isGpsTracking && !isWalkTrailRecording}
                                style={isWalkTrailRecording ? { borderColor: '#ef4444', color: '#fecaca' } : undefined}
                            >
                                Record Trail
                            </button>
                            <button
                                type="button"
                                className="soft-button"
                                onClick={saveWalkedTrailNow}
                                disabled={trailDraftPoints.length < 2 || savingFeature}
                                style={{ borderColor: '#22c55e', color: '#bbf7d0' }}
                            >
                                Save Trail
                            </button>
                        </div>
                    )}
                    {gpsError && <div style={{ color: '#fca5a5' }}>{gpsError}</div>}
                    {!simpleLayout && (
                        <div style={{ display: 'grid', gap: '0.45rem', border: '1px solid #334155', borderRadius: 10, padding: '0.6rem', background: 'rgba(15, 23, 42, 0.72)' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Mock GPS input</div>
                            <textarea
                                rows={3}
                                value={mockGpsInput}
                                onChange={e => setMockGpsInput(e.target.value)}
                                style={{ width: '100%', borderRadius: 8, border: '1px solid #475569', background: '#020617', color: '#e2e8f0', padding: '0.5rem' }}
                            />
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <button type="button" className="soft-button" onClick={startMockGpsPath}>
                                    Play path
                                </button>
                                <button type="button" className="soft-button" onClick={stopMockGpsPath} disabled={!mockGpsEnabled}>
                                    Stop path
                                </button>
                                <button type="button" className="soft-button" onClick={() => setAutoFollowGps(true)}>
                                    Focus mock pin
                                </button>
                            </div>
                            <div style={{ fontSize: '0.8rem', opacity: 0.74 }}>
                                Enter one lat/lng pair or a list of points separated by new lines or semicolons to test off-property projection from home.
                            </div>
                            {mockGpsEnabled && mockGpsPathPoints.length > 0 && (
                                <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                                    Playback point {mockGpsPlaybackIndex + 1} of {mockGpsPathPoints.length}
                                </div>
                            )}
                        </div>
                    )}
                    {simpleLayout && (
                        <div style={{ fontSize: '0.8rem', opacity: 0.72 }}>
                            Need ONX import/export or mock GPS testing? Switch to Advanced View.
                        </div>
                    )}
                    {liveGps && (
                        <div style={{ opacity: 0.82, fontSize: '0.86rem' }}>
                            GPS: {liveGps.lat.toFixed(6)}, {liveGps.lng.toFixed(6)} | Accuracy: {Math.round(liveGps.accuracyMeters)} m | Speed: {formatGpsSpeedMph(liveGps.speedMps)}
                        </div>
                    )}
                    {liveGps && gpsConfidence && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.84rem' }}>
                            <span
                                style={{
                                    border: `1px solid ${gpsConfidence.color}`,
                                    color: gpsConfidence.color,
                                    borderRadius: 999,
                                    padding: '0.12rem 0.5rem',
                                    fontWeight: 700,
                                    letterSpacing: '0.01em'
                                }}
                            >
                                GPS confidence: {gpsConfidence.label}
                            </span>
                            <span style={{ opacity: 0.78 }}>{gpsConfidence.hint}</span>
                        </div>
                    )}
                    {liveGps && (
                        <div style={{ opacity: 0.76, fontSize: '0.84rem' }}>
                            Heading: {liveGps.heading === null ? 'N/A' : `${Math.round(liveGps.heading)}°`} | Breadcrumb points: {breadcrumbPoints.length} | Smoothing: {enableGpsSmoothing ? `${Math.round(gpsSmoothingStrength * 100)}%` : 'Off'}
                        </div>
                    )}
                    {gpsAnchorPoint && (
                        <div style={{ opacity: 0.78, fontSize: '0.84rem' }}>
                            Standing spot marker: X {gpsAnchorPoint.x.toFixed(2)}%, Y {gpsAnchorPoint.y.toFixed(2)}%
                        </div>
                    )}
                    {liveGps && gpsMapPoint && gpsMapPoint.clamped && (
                        <div style={{ color: '#facc15', fontSize: '0.86rem' }}>
                            Projected point clamped to the nearest valid map edge so the marker still appears on the canvas.
                        </div>
                    )}
                </div>

                {!simpleLayout && (
                    <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.55rem' }}>
                        <div style={{ fontWeight: 700 }}>ONX Hunt (Advanced)</div>
                        <div style={{ opacity: 0.78, fontSize: '0.88rem' }}>
                            Open ONX from this app, export your selected trail to GPX, or import GPX back into this property map.
                        </div>
                        <div style={{ display: 'grid', gap: '0.45rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                            <button type="button" className="soft-button" onClick={openOnxHuntApp} style={{ minHeight: 44 }}>
                                1) Open ONX Hunt app/web
                            </button>
                            <button type="button" className="soft-button" onClick={exportTrailToGpx} style={{ minHeight: 44 }}>
                                2) Export selected trail GPX
                            </button>
                            <button type="button" className="soft-button" onClick={importOnxGpxToDraftTrail} style={{ minHeight: 44 }}>
                                3) Import selected GPX to draft trail
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <a href={ONX_HUNT_WEBMAP_URL} target="_blank" rel="noreferrer" className="soft-button" style={{ textDecoration: 'none' }}>
                                Open ONX Web Map
                            </a>
                        </div>
                        <div
                            onDragOver={e => {
                                e.preventDefault();
                                setOnxDropActive(true);
                            }}
                            onDragLeave={() => setOnxDropActive(false)}
                            onDrop={e => {
                                e.preventDefault();
                                const file = e.dataTransfer.files?.[0] || null;
                                if (file) {
                                    handleOnxGpxFileSelection(file);
                                }
                                setOnxDropActive(false);
                            }}
                            style={{
                                border: `1px dashed ${onxDropActive ? '#38bdf8' : '#475569'}`,
                                borderRadius: 10,
                                padding: '0.65rem',
                                background: onxDropActive ? 'rgba(56, 189, 248, 0.12)' : 'rgba(15, 23, 42, 0.65)',
                                display: 'grid',
                                gap: '0.5rem'
                            }}
                        >
                            <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>Import ONX GPX</div>
                            <div style={{ fontSize: '0.8rem', opacity: 0.72 }}>
                                Drop a GPX file here or choose one below, then use the import button.
                            </div>
                            <div style={{ display: 'grid', gap: '0.45rem', gridTemplateColumns: 'minmax(180px, 1fr) auto' }}>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.82rem', opacity: 0.8 }}>Choose .gpx file</span>
                                    <input
                                        type="file"
                                        accept=".gpx,application/gpx+xml,application/xml,text/xml"
                                        onChange={e => {
                                            const file = e.target.files?.[0] || null;
                                            handleOnxGpxFileSelection(file);
                                        }}
                                    />
                                </label>
                                <button type="button" className="soft-button" onClick={importOnxGpxToDraftTrail}>
                                    Import ONX GPX
                                </button>
                            </div>
                            {onxGpxFile && (
                                <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                                    Ready to import: {onxGpxFile.name}
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'grid', gap: '0.5rem', borderTop: '1px solid #334155', paddingTop: '0.55rem' }}>
                            <div style={{ fontSize: '0.86rem', fontWeight: 600 }}>Near-live shared-folder sync</div>
                            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={onxAutoImportEnabled}
                                        onChange={e => setOnxAutoImportEnabled(e.target.checked)}
                                    />
                                    <span style={{ fontSize: '0.86rem', opacity: 0.86 }}>Enable auto-import</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={onxAutoArchiveEnabled}
                                        onChange={e => setOnxAutoArchiveEnabled(e.target.checked)}
                                    />
                                    <span style={{ fontSize: '0.86rem', opacity: 0.86 }}>Auto-archive imported files</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ fontSize: '0.84rem', opacity: 0.78 }}>Poll every</span>
                                    <select
                                        value={String(onxAutoImportIntervalSec)}
                                        onChange={e => setOnxAutoImportIntervalSec(Number(e.target.value))}
                                        disabled={!onxAutoImportEnabled}
                                    >
                                        <option value="30">30 sec</option>
                                        <option value="45">45 sec</option>
                                        <option value="60">60 sec</option>
                                        <option value="120">120 sec</option>
                                    </select>
                                </label>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => {
                                        void runOnxAutoImport(true);
                                    }}
                                    disabled={!selectedMap || !activeCalibration || onxAutoImportInFlight}
                                >
                                    {onxAutoImportInFlight ? 'Importing...' : 'Run sync now'}
                                </button>
                            </div>
                            <div style={{ fontSize: '0.8rem', opacity: 0.72 }}>
                                Server reads files from ONX_SHARED_GPX_DIR (or shared-gpx folder in app root). When auto-archive is on, imported files move to shared-gpx/imported. Last run: {onxAutoImportLastRun ? formatDate(onxAutoImportLastRun) : 'Not yet'}
                            </div>
                        </div>
                        <div style={{ fontSize: '0.82rem', opacity: 0.72 }}>
                            Live automatic sync requires official ONX API access. This bridge provides reliable file-based sync today.
                        </div>
                    </div>
                )}
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
                <div style={{ display: 'grid', gap: '0.2rem' }}>
                    <div style={{ fontWeight: 700 }}>Map Canvas</div>
                    <div style={{ opacity: 0.78, fontSize: '0.9rem' }}>
                        Click map to place one marker, or turn on trail planning to click a sequence of path points.
                    </div>
                </div>

                {isTrailFieldMode ? (
                    <div style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem', display: 'grid', gap: '0.25rem', background: 'rgba(15, 23, 42, 0.72)' }}>
                        <div style={{ fontWeight: 700 }}>Trail Field Mode Active</div>
                        <div style={{ fontSize: '0.84rem', opacity: 0.8 }}>
                            One-thumb controls are pinned to the bottom of the screen. Tap the map to set points, then use Add Tap Point or Add GPS Point.
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={zoomToAcreageView}
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
                                setIsTrailEditMode(false);
                                setFeatureType('trail');
                            }}
                            style={{ borderColor: isTrailPlanning ? '#22c55e' : '#475569', color: isTrailPlanning ? '#bbf7d0' : '#cbd5e1' }}
                        >
                            {isTrailPlanning ? 'Trail planning on' : 'Start trail planning'}
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={addLastClickPointToTrailDraft}
                        >
                            Add clicked spot to trail
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={addCurrentGpsPointToTrailDraft}
                            disabled={!liveGps || !gpsMapPoint}
                        >
                            Add GPS point to trail
                        </button>
                        {!simpleLayout && (
                            <button
                                type="button"
                                className="soft-button"
                                onClick={loadSelectedTrailIntoEditor}
                                disabled={!selectedFeature || selectedFeature.feature_type !== 'trail'}
                                style={{ borderColor: isTrailEditMode ? '#f59e0b' : '#475569', color: isTrailEditMode ? '#fde68a' : '#cbd5e1' }}
                            >
                                {isTrailEditMode ? 'Trail edit mode active' : 'Edit selected trail'}
                            </button>
                        )}
                        {!isWalkTrailRecording ? (
                            <button type="button" className="soft-button" onClick={startWalkTrailRecording} disabled={!isGpsTracking}>
                                Start walk-to-map trail
                            </button>
                        ) : (
                            <button type="button" className="soft-button" onClick={stopWalkTrailRecording} style={{ borderColor: '#ef4444', color: '#fecaca' }}>
                                Stop walk trail
                            </button>
                        )}
                        {!simpleLayout && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.88rem', opacity: 0.82 }}>Walk trail label</span>
                                <input
                                    value={walkTrailLabel}
                                    onChange={e => setWalkTrailLabel(e.target.value)}
                                    placeholder="Live hike trail"
                                    style={{ minWidth: 180 }}
                                />
                            </label>
                        )}
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid #334155', borderRadius: 8, padding: '0.2rem 0.35rem' }}>
                            <button type="button" className="soft-button" onClick={() => adjustMapZoom(-15)}>-</button>
                            <span style={{ fontSize: '0.88rem', opacity: 0.84, minWidth: 68, textAlign: 'center' }}>Zoom {mapZoomPercent}%</span>
                            <button type="button" className="soft-button" onClick={() => adjustMapZoom(15)}>+</button>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.88rem', opacity: 0.82 }}>Fine zoom</span>
                            <input
                                type="range"
                                min={100}
                                max={350}
                                step={5}
                                value={mapZoomPercent}
                                onChange={e => setMapZoomPercent(Number(e.target.value))}
                            />
                        </label>
                        <button type="button" className="soft-button" onClick={() => setMapZoomPercent(145)}>
                            145%
                        </button>
                        <button type="button" className="soft-button" onClick={zoomToTrailDetailView}>
                            Trail detail zoom
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={() => {
                                setMapZoomPercent(100);
                                setAutoFollowGps(false);
                            }}
                        >
                            Recenter map view
                        </button>
                        {!simpleLayout && (
                            <>
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
                                    onClick={insertDraftPointAfterSelected}
                                    disabled={trailDraftPoints.length < 2}
                                >
                                    Insert point after selected
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={removeSelectedDraftPoint}
                                    disabled={selectedDraftPointIndex === null || trailDraftPoints.length <= 2}
                                >
                                    Remove selected point
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => {
                                        setTrailDraftPoints([]);
                                        setSelectedDraftPointIndex(null);
                                        setIsTrailEditMode(false);
                                    }}
                                    disabled={trailDraftPoints.length === 0}
                                >
                                    Clear draft trail
                                </button>
                                {trailDraftPoints.length > 0 && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                        <span style={{ fontSize: '0.86rem', opacity: 0.82 }}>Selected point</span>
                                        <select
                                            value={selectedDraftPointIndex ?? ''}
                                            onChange={e => {
                                                const raw = e.target.value;
                                                setSelectedDraftPointIndex(raw === '' ? null : Number(raw));
                                            }}
                                        >
                                            <option value="">None</option>
                                            {trailDraftPoints.map((_, idx) => (
                                                <option key={`draft-select-${idx}`} value={idx}>Point {idx + 1}</option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                            </>
                        )}
                        {trailDraftPoints.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', opacity: 0.8, fontSize: '0.9rem' }}>
                                Draft points: {trailDraftPoints.length}
                            </div>
                        )}
                        {lastMapClickPoint && (
                            <div style={{ display: 'flex', alignItems: 'center', opacity: 0.82, fontSize: '0.86rem' }}>
                                Last click: X {lastMapClickPoint.x.toFixed(2)}% Y {lastMapClickPoint.y.toFixed(2)}%
                            </div>
                        )}
                        {!simpleLayout && draftTrailStats && (
                            <div style={{ display: 'flex', alignItems: 'center', opacity: 0.84, fontSize: '0.88rem' }}>
                                Draft stats: {formatTrailDistance(draftTrailStats.distanceFeet)} | Gain {formatTrailElevation(draftTrailStats.elevationGainFeet)} | Loss {formatTrailElevation(draftTrailStats.elevationLossFeet)} | Time {formatTrailDuration(draftTrailStats.durationSeconds)}
                            </div>
                        )}
                        {autoFollowGps && isGpsTracking && gpsMapPoint && gpsMapPoint.clamped && (
                            <div style={{ display: 'flex', alignItems: 'center', opacity: 0.86, fontSize: '0.86rem', color: '#fcd34d' }}>
                                GPS is outside the calibrated bounds, so the pin is clamped to the nearest valid edge while auto-follow remains active.
                            </div>
                        )}
                    </div>
                )}

                <div
                    ref={mapCanvasRef}
                    onClick={onMapClick}
                    onWheel={onMapWheel}
                    onPointerMove={onMapPointerMove}
                    onPointerUp={() => {
                        void onMapPointerUp();
                    }}
                    onPointerCancel={() => {
                        void onMapPointerUp();
                    }}
                    onPointerLeave={() => {
                        void onMapPointerUp();
                    }}
                    style={{
                        position: 'relative',
                        width: '100%',
                        minHeight: isMobileViewport ? 360 : 420,
                        borderRadius: 14,
                        border: '1px solid #334155',
                        background: 'linear-gradient(145deg, #0b1220, #13213e)',
                        overflow: 'hidden',
                        cursor: gpsAnchorPickMode ? 'crosshair' : edgeCalibrationMode ? 'crosshair' : isTrailPlanning ? 'copy' : isTrailEditMode ? 'cell' : 'crosshair',
                        touchAction: 'none'
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
                                background: 'linear-gradient(145deg, #0b1220, #13213e)'
                            }}
                        >
                            {displayImageUrl && (
                                <img
                                    src={displayImageUrl}
                                    alt="Property map base"
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: mapImageFitMode,
                                        transform: `translate(${mapImageOffsetXPercent}%, ${mapImageOffsetYPercent}%) rotate(${mapImageRotationDeg}deg) scale(${mapImageScalePercent / 100}) scaleX(${mapImageFlipX ? -1 : 1}) scaleY(${mapImageFlipY ? -1 : 1})`,
                                        transformOrigin: 'center',
                                        pointerEvents: 'none',
                                        userSelect: 'none'
                                    }}
                                />
                            )}
                        </div>

                        <svg
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                        >
                            {savedTrails.map(({ feature, points }) => {
                                const start = points[0];
                                const end = points[points.length - 1];
                                const checkpointIndexes = buildCheckpointIndexes(points.length);
                                const visualMeta = featureVisualById.get(feature.id);
                                const strokeColor = visualMeta?.trailColor || (feature.id === selectedFeatureId ? '#f8fafc' : '#22d3ee');
                                const widthMultiplier = Number.isFinite(visualMeta?.trailWidth)
                                    ? clamp((visualMeta?.trailWidth as number) / DEFAULT_TRAIL_WIDTH, 0.65, 2.6)
                                    : 1;
                                const strokeDasharray = visualMeta?.trailPattern === 'dashed'
                                    ? '1.8 1.2'
                                    : visualMeta?.trailPattern === 'dotted'
                                        ? '0.45 0.95'
                                        : undefined;

                                return (
                                    <g key={`trail-${feature.id}`}>
                                        <polyline
                                            points={points.map(point => `${point.x},${point.y}`).join(' ')}
                                            fill="none"
                                            stroke={strokeColor}
                                            strokeWidth={(feature.id === selectedFeatureId ? 1.25 : 0.9) * widthMultiplier}
                                            strokeDasharray={strokeDasharray}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            opacity={0.95}
                                            style={{ cursor: 'pointer' }}
                                            onClick={event => {
                                                event.stopPropagation();
                                                setSelectedFeatureId(feature.id);
                                            }}
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
                                        stroke={trailColor}
                                        strokeWidth={trailWidth}
                                        strokeDasharray={trailPattern === 'dashed' ? '1.8 1.2' : trailPattern === 'dotted' ? '0.45 0.95' : undefined}
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
                                <circle
                                    key={`draft-point-${index}`}
                                    cx={point.x}
                                    cy={point.y}
                                    r={selectedDraftPointIndex === index ? 1.05 : 0.82}
                                    fill={selectedDraftPointIndex === index ? '#fef08a' : '#fbbf24'}
                                    stroke={selectedDraftPointIndex === index ? '#f97316' : 'transparent'}
                                    strokeWidth={selectedDraftPointIndex === index ? 0.22 : 0}
                                    style={{ cursor: 'pointer' }}
                                    onClick={event => {
                                        event.stopPropagation();
                                        setSelectedDraftPointIndex(index);
                                        setIsTrailEditMode(true);
                                    }}
                                />
                            ))}

                            {liveGps && gpsMapPoint && (
                                <>
                                    <circle
                                        cx={gpsMapPoint.x}
                                        cy={gpsMapPoint.y}
                                        r={gpsAccuracyRadiusPercent}
                                        fill={gpsMapPoint.clamped ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)'}
                                        stroke={gpsMapPoint.clamped ? 'rgba(245, 158, 11, 0.45)' : 'rgba(56, 189, 248, 0.45)'}
                                        strokeWidth={0.35}
                                    />
                                    {liveGps.heading !== null && (
                                        <g transform={`rotate(${liveGps.heading} ${gpsMapPoint.x} ${gpsMapPoint.y})`}>
                                            <polygon
                                                points={`${gpsMapPoint.x},${gpsMapPoint.y - 2.2} ${gpsMapPoint.x - 0.85},${gpsMapPoint.y - 0.25} ${gpsMapPoint.x + 0.85},${gpsMapPoint.y - 0.25}`}
                                                fill={gpsMapPoint.clamped ? '#fbbf24' : '#7dd3fc'}
                                                stroke="#f8fafc"
                                                strokeWidth={0.2}
                                            />
                                        </g>
                                    )}
                                    <circle cx={gpsMapPoint.x} cy={gpsMapPoint.y} r={1.15} fill={gpsMapPoint.clamped ? '#f59e0b' : '#38bdf8'} stroke="#f8fafc" strokeWidth={0.4} />
                                </>
                            )}

                            {edgeCalibrationMode && edgeCalibrationStartPoint && (
                                <g>
                                    <line
                                        x1={edgeCalibrationStartPoint.x}
                                        y1={edgeCalibrationStartPoint.y}
                                        x2={(edgeCalibrationPreviewPoint || edgeCalibrationStartPoint).x}
                                        y2={(edgeCalibrationPreviewPoint || edgeCalibrationStartPoint).y}
                                        stroke="#facc15"
                                        strokeWidth={0.75}
                                        strokeDasharray="1.2 0.85"
                                        opacity={0.95}
                                    />
                                    <circle cx={edgeCalibrationStartPoint.x} cy={edgeCalibrationStartPoint.y} r={1} fill="#facc15" stroke="#0f172a" strokeWidth={0.25} />
                                    {edgeCalibrationPreviewPoint && (
                                        <circle cx={edgeCalibrationPreviewPoint.x} cy={edgeCalibrationPreviewPoint.y} r={0.88} fill="#fde68a" stroke="#0f172a" strokeWidth={0.2} />
                                    )}
                                </g>
                            )}

                            {gpsAnchorPoint && (
                                <g>
                                    <circle cx={gpsAnchorPoint.x} cy={gpsAnchorPoint.y} r={1.05} fill="#f97316" stroke="#f8fafc" strokeWidth={0.25} />
                                    <circle cx={gpsAnchorPoint.x} cy={gpsAnchorPoint.y} r={2.1} fill="none" stroke="#fb923c" strokeWidth={0.24} strokeDasharray="0.85 0.85" />
                                    <text
                                        x={gpsAnchorPoint.x}
                                        y={gpsAnchorPoint.y - 2.6}
                                        textAnchor="middle"
                                        fontSize="1.18"
                                        fill="#fdba74"
                                    >
                                        Standing spot
                                    </text>
                                </g>
                            )}
                        </svg>

                        {liveGps && gpsMapPoint && (
                            <div style={{ position: 'absolute', top: 12, right: 12, width: 'min(280px, 48vw)', border: '1px solid #334155', borderRadius: 10, padding: '0.55rem', background: 'rgba(2, 6, 23, 0.86)', boxShadow: '0 10px 40px rgba(2, 6, 23, 0.35)', display: 'grid', gap: '0.34rem', fontSize: '0.78rem', zIndex: 6 }}>
                                <div style={{ fontWeight: 700, color: '#e2e8f0' }}>GPS Debug</div>
                                <div style={{ color: '#cbd5e1' }}>Raw GPS: {liveGps.lat.toFixed(6)}, {liveGps.lng.toFixed(6)}</div>
                                <div style={{ color: '#cbd5e1' }}>Projected pixel: X {gpsMapPoint.x.toFixed(2)}%, Y {gpsMapPoint.y.toFixed(2)}%</div>
                                <div style={{ color: '#cbd5e1' }}>Clamp: {gpsMapPoint.clamped ? 'Yes' : 'No'}</div>
                                <div style={{ color: '#cbd5e1' }}>Calibration: N {activeCalibration?.northLat.toFixed(6) || '—'} / S {activeCalibration?.southLat.toFixed(6) || '—'} / W {activeCalibration?.westLng.toFixed(6) || '—'} / E {activeCalibration?.eastLng.toFixed(6) || '—'}</div>
                                <div style={{ color: '#cbd5e1' }}>Zoom: {mapZoomPercent}%</div>
                            </div>
                        )}

                        {features.map(feature => {
                            const selected = feature.id === selectedFeatureId;
                            const visualMeta = featureVisualById.get(feature.id);
                            const iconKey = visualMeta?.iconKey || feature.feature_type || 'pin';
                            const glyph = markerGlyphForIcon(iconKey);
                            return (
                                <div
                                    key={feature.id}
                                    style={{
                                        position: 'absolute',
                                        left: `${feature.x_percent}%`,
                                        top: `${feature.y_percent}%`,
                                        zIndex: 2
                                    }}
                                >
                                    <button
                                        onClick={e => {
                                            e.stopPropagation();
                                            setSelectedFeatureId(feature.id);
                                        }}
                                        onPointerDown={e => {
                                            e.stopPropagation();
                                            beginFeatureDrag(feature.id);
                                        }}
                                        title={`${feature.label} (${feature.feature_type})`}
                                        style={{
                                            transform: 'translate(-50%, -50%)',
                                            width: 24,
                                            height: 24,
                                            borderRadius: 999,
                                            border: selected ? '2px solid #f8fafc' : '1px solid #93c5fd',
                                            background: getFeatureStatusColor(feature.status),
                                            cursor: draggingFeatureId === feature.id ? 'grabbing' : 'grab',
                                            color: '#f8fafc',
                                            fontSize: '0.72rem',
                                            fontWeight: 700,
                                            display: 'grid',
                                            placeItems: 'center',
                                            boxShadow: selected ? '0 0 0 2px rgba(125, 211, 252, 0.35)' : undefined
                                        }}
                                    >
                                        {glyph}
                                    </button>
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: '-20px',
                                            left: '8px',
                                            transform: 'translate(-50%, -50%)',
                                            background: 'rgba(2, 6, 23, 0.76)',
                                            border: selected ? '1px solid #7dd3fc' : '1px solid #334155',
                                            borderRadius: 6,
                                            padding: '0.1rem 0.35rem',
                                            fontSize: '0.7rem',
                                            color: '#e2e8f0',
                                            whiteSpace: 'nowrap',
                                            maxWidth: 150,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            pointerEvents: 'none'
                                        }}
                                    >
                                        {feature.label}
                                    </div>
                                </div>
                            );
                        })}

                        {selectedFeature && (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${selectedFeature.x_percent}%`,
                                    top: `${selectedFeature.y_percent}%`,
                                    transform: 'translate(-50%, -122%)',
                                    background: 'rgba(2, 6, 23, 0.9)',
                                    border: '1px solid #7dd3fc',
                                    borderRadius: 8,
                                    padding: '0.35rem',
                                    display: 'grid',
                                    gap: '0.3rem',
                                    width: 'min(220px, 45vw)',
                                    minWidth: 148,
                                    zIndex: 4
                                }}
                                onClick={event => event.stopPropagation()}
                            >
                                <input
                                    value={featureLabel}
                                    onChange={event => setFeatureLabel(event.target.value)}
                                    placeholder="Landmark label"
                                    style={{ fontSize: '0.78rem' }}
                                />
                                <select
                                    value={featureIconKey}
                                    onChange={event => setFeatureIconKey(event.target.value)}
                                    style={{ fontSize: '0.78rem' }}
                                >
                                    {LANDMARK_ICON_OPTIONS.map(option => (
                                        <option key={`quick-icon-${option.key}`} value={option.key}>{option.label} ({option.glyph})</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '0.72rem', opacity: 0.75 }}>
                                    Drag marker to move. Click Update feature to save icon/label edits.
                                </div>
                            </div>
                        )}
                    </div>

                    {displayImageUrl && (
                        <div
                            style={{
                                position: 'absolute',
                                top: 12,
                                right: 12,
                                zIndex: 12,
                                width: 86,
                                borderRadius: 10,
                                border: '1px solid rgba(148, 163, 184, 0.45)',
                                background: 'rgba(2, 6, 23, 0.75)',
                                padding: '0.35rem',
                                pointerEvents: 'none',
                                backdropFilter: 'blur(4px)'
                            }}
                        >
                            <div style={{ fontSize: '0.64rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.86, textAlign: 'center' }}>Compass</div>
                            <svg viewBox="0 0 100 100" style={{ width: '100%', height: 'auto', display: 'block' }}>
                                <circle cx="50" cy="50" r="40" fill="rgba(15, 23, 42, 0.55)" stroke="rgba(148, 163, 184, 0.5)" strokeWidth="2" />
                                <circle cx="50" cy="50" r="2.6" fill="#e2e8f0" />
                                <text x="50" y="16" textAnchor="middle" fill="#e2e8f0" fontSize="8">N</text>
                                <text x="50" y="89" textAnchor="middle" fill="#94a3b8" fontSize="6">S</text>
                                <text x="87" y="53" textAnchor="middle" fill="#94a3b8" fontSize="6">E</text>
                                <text x="13" y="53" textAnchor="middle" fill="#94a3b8" fontSize="6">W</text>
                                <g transform={`rotate(${mapNorthCompassAngleDeg} 50 50)`}>
                                    <line x1="50" y1="50" x2="50" y2="24" stroke="#f87171" strokeWidth="3" strokeLinecap="round" />
                                    <polygon points="50,14 44,27 56,27" fill="#ef4444" />
                                    <line x1="50" y1="50" x2="50" y2="72" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" />
                                </g>
                            </svg>
                            <div style={{ fontSize: '0.65rem', textAlign: 'center', opacity: 0.84 }}>
                                {mapNorthCompassAngleDeg >= 0 ? '+' : ''}{mapNorthCompassAngleDeg.toFixed(1)} degrees
                            </div>
                        </div>
                    )}
                </div>

                {!simpleLayout && (
                    <>
                        <details open={!simpleLayout} style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.65rem', display: 'grid', gap: '0.5rem' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Base Image Framing (Advanced)</summary>
                            <div style={{ height: 6 }} />
                            <div style={{ fontWeight: 700 }}>Base Image Framing</div>
                            <div style={{ opacity: 0.75, fontSize: '0.86rem' }}>
                                Use these controls when your uploaded map image looks too small or off-center.
                            </div>
                            <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span>Image scale {mapImageScalePercent}%</span>
                                    <input
                                        type="range"
                                        min={70}
                                        max={220}
                                        step={5}
                                        value={mapImageScalePercent}
                                        onChange={e => setMapImageScalePercent(Number(e.target.value))}
                                    />
                                </label>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span>Image horizontal offset {mapImageOffsetXPercent}%</span>
                                    <input
                                        type="range"
                                        min={-40}
                                        max={40}
                                        step={1}
                                        value={mapImageOffsetXPercent}
                                        onChange={e => setMapImageOffsetXPercent(Number(e.target.value))}
                                    />
                                </label>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span>Image vertical offset {mapImageOffsetYPercent}%</span>
                                    <input
                                        type="range"
                                        min={-40}
                                        max={40}
                                        step={1}
                                        value={mapImageOffsetYPercent}
                                        onChange={e => setMapImageOffsetYPercent(Number(e.target.value))}
                                    />
                                </label>
                                <label style={{ display: 'grid', gap: '0.25rem' }}>
                                    <span>Image rotation {mapImageRotationDeg}°</span>
                                    <input
                                        type="range"
                                        min={-180}
                                        max={180}
                                        step={1}
                                        value={mapImageRotationDeg}
                                        onChange={e => setMapImageRotationDeg(clamp(Number(e.target.value), -180, 180))}
                                    />
                                </label>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => {
                                        setEdgeCalibrationMode(prev => {
                                            const next = prev ? null : 'auto';
                                            if (!next) {
                                                setEdgeCalibrationStartPoint(null);
                                                setEdgeCalibrationPreviewPoint(null);
                                            } else {
                                                setStatusMessage('Auto calibrate active. Tap point 1 on any straight property boundary line.');
                                                setError(null);
                                            }
                                            return next;
                                        });
                                    }}
                                    disabled={!displayImageUrl}
                                    style={{ borderColor: edgeCalibrationMode ? '#facc15' : '#475569' }}
                                >
                                    {edgeCalibrationMode ? 'Cancel auto calibrate' : 'Auto Calibrate'}
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => setMapImageRotationDeg(prev => clamp(prev - 90, -180, 180))}
                                >
                                    Rotate -90°
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => setMapImageRotationDeg(prev => clamp(prev + 90, -180, 180))}
                                >
                                    Rotate +90°
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => setMapImageFlipX(prev => !prev)}
                                    style={{ borderColor: mapImageFlipX ? '#38bdf8' : '#475569' }}
                                >
                                    {mapImageFlipX ? 'Unflip left/right' : 'Flip left/right'}
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => setMapImageFlipY(prev => !prev)}
                                    style={{ borderColor: mapImageFlipY ? '#38bdf8' : '#475569' }}
                                >
                                    {mapImageFlipY ? 'Unflip up/down' : 'Flip up/down'}
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={() => {
                                        setMapImageScalePercent(100);
                                        setMapImageOffsetXPercent(0);
                                        setMapImageOffsetYPercent(0);
                                        setMapImageRotationDeg(0);
                                        setMapImageFlipX(false);
                                        setMapImageFlipY(false);
                                        setEdgeCalibrationMode(null);
                                        setEdgeCalibrationStartPoint(null);
                                        setEdgeCalibrationPreviewPoint(null);
                                    }}
                                >
                                    Reset image framing
                                </button>
                                <button
                                    type="button"
                                    className="soft-button"
                                    onClick={fitPropertyImageToCanvas}
                                >
                                    Fit property image
                                </button>
                            </div>
                            {edgeCalibrationMode === 'auto' && edgeCalibrationStartPoint && (
                                <div style={{ display: 'grid', gap: '0.45rem', border: '1px solid #334155', borderRadius: 10, padding: '0.55rem' }}>
                                    <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
                                        Point 1 captured. Which edge type are you drawing?
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                        <button
                                            type="button"
                                            className="soft-button"
                                            onClick={() => {
                                                setEdgeCalibrationMode('north');
                                                setStatusMessage('North alignment selected. Tap point 2 farther north or south on this same edge.');
                                                setError(null);
                                            }}
                                        >
                                            This is a North/South edge
                                        </button>
                                        <button
                                            type="button"
                                            className="soft-button"
                                            onClick={() => {
                                                setEdgeCalibrationMode('east-west');
                                                setStatusMessage('East/West alignment selected. Tap point 2 farther east or west on this same edge.');
                                                setError(null);
                                            }}
                                        >
                                            This is an East/West edge
                                        </button>
                                    </div>
                                </div>
                            )}
                            {edgeCalibrationMode === 'auto' && (
                                <div style={{ fontSize: '0.82rem', opacity: 0.8 }}>
                                    Auto calibrate is active. Tap point 1 on a boundary edge, choose edge type, then tap point 2 to apply rotation.
                                </div>
                            )}
                            {edgeCalibrationMode === 'north' && (
                                <div style={{ fontSize: '0.82rem', opacity: 0.8 }}>
                                    North alignment is active. Tap point 1, then tap point 2 farther north on that same edge to auto-rotate the map image.
                                </div>
                            )}
                            {edgeCalibrationMode === 'east-west' && (
                                <div style={{ fontSize: '0.82rem', opacity: 0.8 }}>
                                    East/West alignment is active. Tap point 1, then tap point 2 farther east or west on that same edge to auto-rotate the map image.
                                </div>
                            )}
                            <div style={{ fontSize: '0.82rem', opacity: 0.74 }}>
                                Tip: rotate or flip until property boundary lines align with known roads or north/south direction, then keep Full acreage view selected.
                            </div>
                        </details>

                        <details open={!simpleLayout} style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.65rem' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Feature Editor (Advanced)</summary>
                            <div style={{ height: 10 }} />
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
                                            if (nextType === 'trail') {
                                                setFeatureIconKey('trail');
                                                setFeatureStatus('planned');
                                            } else if (nextType === 'treestand') {
                                                setFeatureIconKey('stand');
                                                setFeatureStatus('inactive');
                                            } else if (nextType === 'range') {
                                                setFeatureIconKey('pin');
                                                setFeatureStatus('inactive');
                                            } else if (nextType === 'gate') {
                                                setFeatureIconKey('gate');
                                                setFeatureStatus('planned');
                                            } else if (nextType === 'water') {
                                                setFeatureIconKey('water');
                                                setFeatureStatus('planned');
                                            } else if (nextType === 'note') {
                                                setFeatureIconKey('note');
                                                setFeatureStatus('planned');
                                            }
                                            if (nextType !== 'trail') {
                                                setIsTrailPlanning(false);
                                                setIsTrailEditMode(false);
                                                setSelectedDraftPointIndex(null);
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
                                    <span>Landmark icon</span>
                                    <select value={featureIconKey} onChange={e => setFeatureIconKey(e.target.value)}>
                                        {LANDMARK_ICON_OPTIONS.map(option => (
                                            <option key={option.key} value={option.key}>{option.label} ({option.glyph})</option>
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
                                {featureType === 'trail' && (
                                    <>
                                        <label style={{ display: 'grid', gap: '0.3rem' }}>
                                            <span>Trail color</span>
                                            <input type="color" value={trailColor} onChange={e => setTrailColor(e.target.value)} />
                                        </label>
                                        <label style={{ display: 'grid', gap: '0.3rem' }}>
                                            <span>Trail width {trailWidth.toFixed(1)}</span>
                                            <input
                                                type="range"
                                                min={0.6}
                                                max={2.6}
                                                step={0.1}
                                                value={trailWidth}
                                                onChange={e => setTrailWidth(clamp(Number(e.target.value), 0.6, 2.6))}
                                            />
                                        </label>
                                        <label style={{ display: 'grid', gap: '0.3rem' }}>
                                            <span>Trail style</span>
                                            <select
                                                value={trailPattern}
                                                onChange={e => setTrailPattern(e.target.value as 'solid' | 'dashed' | 'dotted')}
                                            >
                                                <option value="solid">Solid</option>
                                                <option value="dashed">Dashed</option>
                                                <option value="dotted">Dotted</option>
                                            </select>
                                        </label>
                                    </>
                                )}
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
                                            Trail features save clicked route points. Use trail edit mode to adjust highlighted points.
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
                        </details>

                        <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.7rem', display: 'grid', gap: '0.6rem' }}>
                            <div style={{ display: 'grid', gap: '0.2rem' }}>
                                <div style={{ fontWeight: 700 }}>Trail Library</div>
                                <div style={{ opacity: 0.78, fontSize: '0.86rem' }}>
                                    For 825 West Ave, Brockport, NY (40 acres): select a saved trail, continue it later by map clicks or GPS points, and upload trail images from here.
                                </div>
                            </div>

                            {trailLibraryEntries.length === 0 && (
                                <div style={{ opacity: 0.74 }}>No saved trails yet. Use Start trail planning, breadcrumbs, or walk-to-map to create your first trail.</div>
                            )}

                            {trailLibraryEntries.map(entry => {
                                const queuedFiles = trailQuickImageFiles[entry.feature.id] || [];
                                return (
                                    <div
                                        key={`trail-library-${entry.feature.id}`}
                                        style={{
                                            border: entry.feature.id === selectedFeatureId ? '1px solid #60a5fa' : '1px solid #334155',
                                            borderRadius: 10,
                                            padding: '0.6rem',
                                            display: 'grid',
                                            gap: '0.45rem',
                                            background: 'rgba(15, 23, 42, 0.72)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                                            <div style={{ fontWeight: 700 }}>{entry.feature.label}</div>
                                            <div style={{ opacity: 0.8, fontSize: '0.84rem' }}>
                                                {entry.points.length} points
                                                {entry.stats ? ` • ${formatTrailDistance(entry.stats.distanceFeet)}` : ''}
                                                {entry.attachments.length > 0 ? ` • ${entry.attachments.length} images` : ''}
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                                            <button type="button" className="soft-button" onClick={() => setSelectedFeatureId(entry.feature.id)}>
                                                Select trail
                                            </button>
                                            <button type="button" className="soft-button" onClick={() => continueTrailFromLibrary(entry.feature)}>
                                                Continue by map clicks
                                            </button>
                                            <button
                                                type="button"
                                                className="soft-button"
                                                onClick={() => {
                                                    setSelectedFeatureId(entry.feature.id);
                                                    addCurrentGpsPointToTrailDraft();
                                                }}
                                                disabled={!liveGps || !gpsMapPoint}
                                            >
                                                Add GPS point now
                                            </button>
                                        </div>

                                        <div style={{ display: 'grid', gap: '0.35rem', gridTemplateColumns: 'minmax(220px, 1fr) auto' }}>
                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp,image/gif"
                                                multiple
                                                onChange={e => queueTrailQuickImages(entry.feature.id, e.target.files)}
                                            />
                                            <button
                                                type="button"
                                                className="soft-button"
                                                onClick={() => {
                                                    void saveTrailQuickImages(entry.feature);
                                                }}
                                                disabled={queuedFiles.length === 0}
                                            >
                                                Save trail images
                                            </button>
                                        </div>

                                        {queuedFiles.length > 0 && (
                                            <div style={{ fontSize: '0.8rem', opacity: 0.76 }}>
                                                Queued: {queuedFiles.map(file => file.name).join(', ')}
                                            </div>
                                        )}

                                        {entry.attachments.length > 0 && (
                                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                {entry.attachments.slice(0, 6).map((attachment, idx) => (
                                                    <a
                                                        key={`trail-library-image-${entry.feature.id}-${idx}`}
                                                        href={attachment.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        style={{
                                                            border: '1px solid #334155',
                                                            borderRadius: 8,
                                                            overflow: 'hidden',
                                                            display: 'block',
                                                            width: 96,
                                                            height: 72
                                                        }}
                                                    >
                                                        <img
                                                            src={attachment.url}
                                                            alt={attachment.name}
                                                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                                        />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </section>

            {isMobileViewport && isTrailFieldMode && (
                <div
                    style={{
                        position: 'fixed',
                        left: 10,
                        right: 10,
                        bottom: 10,
                        zIndex: 50,
                        borderRadius: 14,
                        border: '1px solid #334155',
                        background: 'rgba(2, 6, 23, 0.95)',
                        padding: '0.6rem',
                        display: 'grid',
                        gap: '0.5rem',
                        boxShadow: '0 12px 34px rgba(2, 6, 23, 0.45)'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Trail Field Mode</div>
                        <div style={{ fontSize: '0.78rem', opacity: 0.78 }}>Zoom {mapZoomPercent}%</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.45rem' }}>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={isGpsTracking ? stopGpsTracking : startGpsTracking}
                            style={{ minHeight: 52, fontWeight: 700, borderColor: isGpsTracking ? '#ef4444' : '#475569', color: isGpsTracking ? '#fecaca' : '#e2e8f0' }}
                        >
                            {isGpsTracking ? 'GPS Off' : 'GPS On'}
                        </button>
                        <button type="button" className="soft-button" onClick={locateMeOnMap} disabled={!isGpsTracking} style={{ minHeight: 52, fontWeight: 700 }}>
                            Center Me
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={() => setAutoFollowGps(prev => !prev)}
                            style={{ minHeight: 52, fontWeight: 700, borderColor: autoFollowGps ? '#22c55e' : '#475569', color: autoFollowGps ? '#bbf7d0' : '#e2e8f0' }}
                        >
                            {autoFollowGps ? 'Follow On' : 'Follow Off'}
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.45rem' }}>
                        <button type="button" className="soft-button" onClick={addLastClickPointToTrailDraft} style={{ minHeight: 52, fontWeight: 700 }}>
                            Add Tap Point
                        </button>
                        <button type="button" className="soft-button" onClick={addCurrentGpsPointToTrailDraft} disabled={!liveGps || !gpsMapPoint} style={{ minHeight: 52, fontWeight: 700 }}>
                            Add GPS Point
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={isWalkTrailRecording ? stopWalkTrailRecording : startWalkTrailRecording}
                            style={{ minHeight: 52, fontWeight: 700, borderColor: isWalkTrailRecording ? '#ef4444' : '#475569', color: isWalkTrailRecording ? '#fecaca' : '#e2e8f0' }}
                        >
                            {isWalkTrailRecording ? 'Stop Recording' : 'Record Trail'}
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={saveWalkedTrailNow}
                            disabled={trailDraftPoints.length < 2 || savingFeature}
                            style={{ minHeight: 52, fontWeight: 700, borderColor: '#22c55e', color: '#bbf7d0' }}
                        >
                            Save Trail
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.45rem' }}>
                        <button type="button" className="soft-button" onClick={() => adjustMapZoom(-15)} style={{ minHeight: 46, fontWeight: 700 }}>- Zoom</button>
                        <button type="button" className="soft-button" onClick={zoomToAcreageView} style={{ minHeight: 46, fontWeight: 700 }}>Acreage</button>
                        <button type="button" className="soft-button" onClick={() => adjustMapZoom(15)} style={{ minHeight: 46, fontWeight: 700 }}>+ Zoom</button>
                    </div>
                </div>
            )}
        </div>
    );
}
