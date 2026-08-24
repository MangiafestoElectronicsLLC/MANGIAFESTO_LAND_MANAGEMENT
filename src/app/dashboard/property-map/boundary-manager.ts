import { buildDefaultBoundary, isPointInsidePolygon, normalizeBoundary, polygonCenter } from './map-engine';
import { LatLngTuple, PropertyBoundary } from './types';

const BOUNDARY_STORAGE_KEY = 'family-land-boundary-v2';

export const loadBoundary = (): PropertyBoundary => {
    if (typeof window === 'undefined') {
        return buildDefaultBoundary();
    }

    const raw = window.localStorage.getItem(BOUNDARY_STORAGE_KEY);
    if (!raw) return buildDefaultBoundary();

    try {
        const parsed = JSON.parse(raw) as PropertyBoundary;
        return normalizeBoundary(parsed);
    } catch {
        return buildDefaultBoundary();
    }
};

export const saveBoundary = (boundary: PropertyBoundary) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BOUNDARY_STORAGE_KEY, JSON.stringify(boundary));
};

export const buildBoundary = (polygon: LatLngTuple[], existingName?: string): PropertyBoundary => ({
    id: 'boundary-main',
    name: existingName?.trim() || 'Family Land Boundary',
    polygon,
    updatedAt: new Date().toISOString()
});

export const boundaryContains = (boundary: PropertyBoundary, point: LatLngTuple) =>
    isPointInsidePolygon(point, boundary.polygon);

export const boundaryCenter = (boundary: PropertyBoundary) => polygonCenter(boundary.polygon);
