import {
    buildBoundaryFromPoints,
    buildDefaultBoundary,
    createId,
    isNearCanonicalPropertyBoundary,
    normalizeBoundary,
    polygonCenter,
    trailDistanceMeters,
    trailDurationSeconds,
    trailElevationMetrics,
    trailPaceSecondsPerKm
} from './map-engine';
import { PhotoAttachment, Pinpoint, PropertyMapSnapshot, Trail, TrailPoint } from './types';

export const MAP_V2_META_PREFIX = '[map-v2]';

type DbFeatureRow = {
    id: string;
    label: string;
    feature_type: string;
    status: string;
    description: string | null;
    lat: number | null;
    lng: number | null;
};

type V2Meta =
    | {
        kind: 'boundary';
        polygon: Array<[number, number]>;
        name: string;
    }
    | {
        kind: 'pinpoint';
        title: string;
        description: string;
        pinType: Pinpoint['pinType'];
        position: [number, number];
        photos: PhotoAttachment[];
        createdAt: string;
        updatedAt: string;
    }
    | {
        kind: 'trail';
        name: string;
        trailType: Trail['type'];
        points: TrailPoint[];
        photos: PhotoAttachment[];
        createdAt: string;
        updatedAt: string;
    };

type PropertyMapRow = {
    id: string;
    name: string;
    center_lat: number;
    center_lng: number;
};

const parseMeta = (description: string | null): V2Meta | null => {
    if (!description || !description.startsWith(MAP_V2_META_PREFIX)) return null;

    try {
        const parsed = JSON.parse(description.slice(MAP_V2_META_PREFIX.length)) as V2Meta;
        return parsed;
    } catch {
        return null;
    }
};

const normalizePhotos = (photos: PhotoAttachment[] | undefined) =>
    Array.isArray(photos)
        ? photos.map(photo => ({
            id: photo.id || createId('photo'),
            name: photo.name || 'Photo',
            path: photo.path,
            url: photo.url,
            dataUrl: photo.dataUrl,
            createdAt: photo.createdAt || new Date().toISOString()
        }))
        : [];

const normalizeTrail = (trail: Trail): Trail => {
    const distanceMeters = trailDistanceMeters(trail.points);
    const durationSeconds = trailDurationSeconds(trail.points);
    const paceSecondsPerKm = trailPaceSecondsPerKm(distanceMeters, durationSeconds);
    const elevation = trailElevationMetrics(trail.points);

    return {
        ...trail,
        distanceMeters,
        durationSeconds,
        paceSecondsPerKm,
        elevationGainMeters: elevation.gainMeters,
        elevationLossMeters: elevation.lossMeters,
        photos: normalizePhotos(trail.photos)
    };
};

const boundaryExtents = (polygon: Array<[number, number]>) => {
    const lats = polygon.map(point => point[0]);
    const lngs = polygon.map(point => point[1]);
    return {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLng: Math.min(...lngs),
        maxLng: Math.max(...lngs)
    };
};

const latLngToPercent = (lat: number, lng: number, polygon: Array<[number, number]>) => {
    const extents = boundaryExtents(polygon);
    const latSpan = Math.max(0.000001, extents.maxLat - extents.minLat);
    const lngSpan = Math.max(0.000001, extents.maxLng - extents.minLng);

    const x = ((lng - extents.minLng) / lngSpan) * 100;
    const y = ((extents.maxLat - lat) / latSpan) * 100;
    return {
        xPercent: Math.max(0, Math.min(100, x)),
        yPercent: Math.max(0, Math.min(100, y))
    };
};

const uploadAttachmentIfNeeded = async (
    supabase: any,
    userId: string,
    mapId: string,
    entityType: 'trail' | 'pinpoint',
    entityId: string,
    attachment: PhotoAttachment
): Promise<PhotoAttachment> => {
    if (attachment.path && attachment.url) {
        return attachment;
    }

    if (!attachment.dataUrl) {
        return attachment;
    }

    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    const extension = attachment.name.toLowerCase().endsWith('.png')
        ? 'png'
        : attachment.name.toLowerCase().endsWith('.webp')
            ? 'webp'
            : 'jpg';
    const filePath = `${userId}/map-media/${mapId}/${entityType}/${entityId}/${Date.now()}-${attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_')}.${extension}`;

    const { error: uploadError } = await supabase.storage
        .from('property-maps')
        .upload(filePath, blob, {
            upsert: true,
            contentType: blob.type || 'image/jpeg'
        });

    if (uploadError) {
        throw uploadError;
    }

    const { data } = supabase.storage.from('property-maps').getPublicUrl(filePath);

    return {
        ...attachment,
        path: filePath,
        url: data.publicUrl,
        dataUrl: attachment.dataUrl
    };
};

export const ensureSharedMap = async (supabase: any, userId: string): Promise<PropertyMapRow> => {
    const { data: existing, error: existingError } = await supabase
        .from('property_maps')
        .select('id,name,center_lat,center_lng')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (existingError) {
        throw existingError;
    }

    if (existing?.id) {
        return existing as PropertyMapRow;
    }

    const defaultBoundary = buildDefaultBoundary();
    const center = polygonCenter(defaultBoundary.polygon);
    const { data: inserted, error: insertError } = await supabase
        .from('property_maps')
        .insert({
            name: 'Family Property Map',
            address: '825 West Ave, Brockport, NY',
            center_lat: center[0],
            center_lng: center[1],
            created_by: userId
        })
        .select('id,name,center_lat,center_lng')
        .single();

    if (insertError) {
        throw insertError;
    }

    return inserted as PropertyMapRow;
};

export const loadSnapshotFromSupabase = async (supabase: any, mapId: string): Promise<PropertyMapSnapshot> => {
    const { data, error } = await supabase
        .from('property_map_features')
        .select('id,label,feature_type,status,description,lat,lng')
        .eq('map_id', mapId)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    let boundary = buildDefaultBoundary();
    let boundaryLoadedFromMeta = false;
    const pinpoints: Pinpoint[] = [];
    const trails: Trail[] = [];
    const boundaryFallbackPoints: Array<[number, number]> = [];

    for (const rawRow of (data || []) as DbFeatureRow[]) {
        const row = rawRow as DbFeatureRow;
        const meta = parseMeta(row.description);

        if (meta?.kind === 'boundary') {
            boundary = {
                id: 'boundary-main',
                name: meta.name || row.label || 'Family Land Boundary',
                polygon: meta.polygon,
                updatedAt: new Date().toISOString(),
                sourceFeatureId: row.id
            };
            boundaryLoadedFromMeta = true;
            continue;
        }

        if (meta?.kind === 'pinpoint') {
            pinpoints.push({
                id: row.id,
                title: meta.title,
                description: meta.description,
                pinType: meta.pinType,
                position: meta.position,
                photos: normalizePhotos(meta.photos),
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                sourceFeatureId: row.id
            });
            boundaryFallbackPoints.push(meta.position);
            continue;
        }

        if (meta?.kind === 'trail') {
            const trail: Trail = normalizeTrail({
                id: row.id,
                name: meta.name,
                type: meta.trailType,
                points: Array.isArray(meta.points) ? meta.points : [],
                photos: normalizePhotos(meta.photos),
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                distanceMeters: 0,
                durationSeconds: 0,
                paceSecondsPerKm: null,
                elevationGainMeters: 0,
                elevationLossMeters: 0,
                sourceFeatureId: row.id
            });
            if (trail.points.length >= 2) {
                trails.push(trail);
                for (const point of trail.points) {
                    boundaryFallbackPoints.push([point.lat, point.lng]);
                }
            }
            continue;
        }

        if ((row.feature_type === 'treestand' || row.feature_type === 'range' || row.feature_type === 'note') && row.lat !== null && row.lng !== null) {
            pinpoints.push({
                id: row.id,
                title: row.label,
                description: row.description || '',
                pinType: row.feature_type === 'treestand' || row.feature_type === 'range' ? row.feature_type : 'note',
                position: [row.lat, row.lng],
                photos: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                sourceFeatureId: row.id
            });
            boundaryFallbackPoints.push([row.lat, row.lng]);
        }
    }

    if (!boundaryLoadedFromMeta && boundaryFallbackPoints.length > 0) {
        const inferredBoundary = buildBoundaryFromPoints(boundaryFallbackPoints, {
            name: '825 West Ave Property Boundary',
            paddingMeters: 36
        });

        if (inferredBoundary && isNearCanonicalPropertyBoundary(inferredBoundary.polygon)) {
            boundary = {
                ...inferredBoundary,
                id: 'boundary-main'
            };
        } else {
            boundary = normalizeBoundary({
                ...boundary,
                id: 'boundary-main',
                name: '825 West Ave Property Boundary'
            });
        }
    }

    return {
        mapId,
        boundary,
        trails,
        pinpoints,
        lastSyncedAt: new Date().toISOString()
    };
};

export const syncSnapshotToSupabase = async (
    supabase: any,
    userId: string,
    snapshot: PropertyMapSnapshot
): Promise<PropertyMapSnapshot> => {
    const normalizedBoundary = {
        ...snapshot.boundary,
        sourceFeatureId: snapshot.boundary.sourceFeatureId || createId('boundary')
    };

    const normalizedPinpoints: Pinpoint[] = [];
    for (const pin of snapshot.pinpoints) {
        const pinId = pin.sourceFeatureId || pin.id || createId('pinpoint');
        const uploadedPhotos: PhotoAttachment[] = [];
        for (const photo of normalizePhotos(pin.photos)) {
            const uploaded = await uploadAttachmentIfNeeded(supabase, userId, snapshot.mapId, 'pinpoint', pinId, photo);
            uploadedPhotos.push(uploaded);
        }

        normalizedPinpoints.push({
            ...pin,
            id: pinId,
            sourceFeatureId: pinId,
            photos: uploadedPhotos
        });
    }

    const normalizedTrails: Trail[] = [];
    for (const trail of snapshot.trails) {
        const trailId = trail.sourceFeatureId || trail.id || createId('trail');
        const uploadedPhotos: PhotoAttachment[] = [];
        for (const photo of normalizePhotos(trail.photos)) {
            const uploaded = await uploadAttachmentIfNeeded(supabase, userId, snapshot.mapId, 'trail', trailId, photo);
            uploadedPhotos.push(uploaded);
        }

        normalizedTrails.push(
            normalizeTrail({
                ...trail,
                id: trailId,
                sourceFeatureId: trailId,
                photos: uploadedPhotos
            })
        );
    }

    const boundaryMeta: V2Meta = {
        kind: 'boundary',
        polygon: normalizedBoundary.polygon,
        name: normalizedBoundary.name
    };

    const rows = [
        {
            id: normalizedBoundary.sourceFeatureId,
            map_id: snapshot.mapId,
            label: normalizedBoundary.name,
            feature_type: 'note',
            status: 'active',
            description: `${MAP_V2_META_PREFIX}${JSON.stringify(boundaryMeta)}`,
            x_percent: 50,
            y_percent: 50,
            lat: polygonCenter(normalizedBoundary.polygon)[0],
            lng: polygonCenter(normalizedBoundary.polygon)[1],
            created_by: userId,
            updated_by: userId
        },
        ...normalizedPinpoints.map(pin => {
            const positionPercent = latLngToPercent(pin.position[0], pin.position[1], normalizedBoundary.polygon);
            const pinMeta: V2Meta = {
                kind: 'pinpoint',
                title: pin.title,
                description: pin.description,
                pinType: pin.pinType,
                position: pin.position,
                photos: pin.photos,
                createdAt: pin.createdAt,
                updatedAt: pin.updatedAt
            };

            return {
                id: pin.sourceFeatureId,
                map_id: snapshot.mapId,
                label: pin.title,
                feature_type: pin.pinType === 'treestand' || pin.pinType === 'range' ? pin.pinType : 'note',
                status: 'active',
                description: `${MAP_V2_META_PREFIX}${JSON.stringify(pinMeta)}`,
                x_percent: positionPercent.xPercent,
                y_percent: positionPercent.yPercent,
                lat: pin.position[0],
                lng: pin.position[1],
                created_by: userId,
                updated_by: userId
            };
        }),
        ...normalizedTrails.map(trail => {
            const lead = trail.points[0];
            const positionPercent = lead
                ? latLngToPercent(lead.lat, lead.lng, normalizedBoundary.polygon)
                : { xPercent: 50, yPercent: 50 };
            const trailMeta: V2Meta = {
                kind: 'trail',
                name: trail.name,
                trailType: trail.type,
                points: trail.points,
                photos: trail.photos,
                createdAt: trail.createdAt,
                updatedAt: trail.updatedAt
            };

            return {
                id: trail.sourceFeatureId,
                map_id: snapshot.mapId,
                label: trail.name,
                feature_type: 'trail',
                status: trail.type === 'walked' ? 'completed' : 'planned',
                description: `${MAP_V2_META_PREFIX}${JSON.stringify(trailMeta)}`,
                x_percent: positionPercent.xPercent,
                y_percent: positionPercent.yPercent,
                lat: trail.points[0]?.lat ?? null,
                lng: trail.points[0]?.lng ?? null,
                created_by: userId,
                updated_by: userId
            };
        })
    ];

    const { error: upsertError } = await supabase
        .from('property_map_features')
        .upsert(rows, { onConflict: 'id' });

    if (upsertError) {
        throw upsertError;
    }

    const { data: existingRows, error: existingError } = await supabase
        .from('property_map_features')
        .select('id,description')
        .eq('map_id', snapshot.mapId);

    if (existingError) {
        throw existingError;
    }

    const desiredIds = new Set(rows.map(row => row.id));
    const staleIds = (existingRows || [])
        .filter((row: { id: string; description: string | null }) => {
            const meta = parseMeta(row.description);
            return Boolean(meta) && !desiredIds.has(row.id);
        })
        .map((row: { id: string }) => row.id);

    if (staleIds.length > 0) {
        const { error: deleteError } = await supabase
            .from('property_map_features')
            .delete()
            .in('id', staleIds);

        if (deleteError) {
            throw deleteError;
        }
    }

    return {
        ...snapshot,
        boundary: normalizedBoundary,
        pinpoints: normalizedPinpoints,
        trails: normalizedTrails,
        lastSyncedAt: new Date().toISOString()
    };
};
