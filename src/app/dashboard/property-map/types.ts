export type LatLngTuple = [number, number];

export type TrailPoint = {
    lat: number;
    lng: number;
    timestamp?: number;
    altitudeMeters?: number | null;
};

export type PhotoAttachment = {
    id: string;
    name: string;
    dataUrl?: string;
    url?: string;
    path?: string;
    createdAt: string;
};

export type Pinpoint = {
    id: string;
    title: string;
    description: string;
    pinType: 'note' | 'treestand' | 'range' | 'water' | 'gate' | 'camera' | 'sign';
    position: LatLngTuple;
    photos: PhotoAttachment[];
    createdAt: string;
    updatedAt: string;
    lastCheckedAt?: string;
    sourceFeatureId?: string;
};

export type TrailType = 'walked' | 'planned';

export type Trail = {
    id: string;
    name: string;
    type: TrailType;
    points: TrailPoint[];
    photos: PhotoAttachment[];
    createdAt: string;
    updatedAt: string;
    distanceMeters: number;
    durationSeconds: number;
    paceSecondsPerKm: number | null;
    elevationGainMeters: number;
    elevationLossMeters: number;
    sourceFeatureId?: string;
};

export type PropertyBoundary = {
    id: string;
    name: string;
    polygon: LatLngTuple[];
    updatedAt: string;
    sourceFeatureId?: string;
};

export type GpsFix = {
    lat: number;
    lng: number;
    accuracyMeters: number;
    heading: number | null;
    speedMps: number | null;
    altitudeMeters: number | null;
    timestamp: number;
};

export type MapEntityRef =
    | { type: 'pinpoint'; id: string }
    | { type: 'trail'; id: string };

export type PropertyMapSnapshot = {
    mapId: string;
    boundary: PropertyBoundary;
    trails: Trail[];
    pinpoints: Pinpoint[];
    lastSyncedAt?: string;
};

export type SyncQueueItem = {
    id: string;
    mapId: string;
    snapshot: PropertyMapSnapshot;
    createdAt: string;
};
