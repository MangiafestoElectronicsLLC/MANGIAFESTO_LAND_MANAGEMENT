'use client';

import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { boundaryCenter } from './boundary-manager';
import { buildTrailSplits, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_URL, clampZoom, formatDistance } from './map-engine';
import { GpsFix, LatLngTuple, Pinpoint, PropertyBoundary, Trail } from './types';

export type MapActions = {
    recenter: () => void;
    centerOnGps: () => void;
    fitBoundary: () => void;
};

type Props = {
    boundary: PropertyBoundary;
    trails: Trail[];
    selectedTrailId: string | null;
    pinpoints: Pinpoint[];
    walkedTrailDraft: Array<{ lat: number; lng: number }>;
    plannedTrailDraft: LatLngTuple[];
    boundaryDraft: LatLngTuple[];
    liveGps: GpsFix | null;
    autoFollow: boolean;
    onMapClick: (position: LatLngTuple) => void;
    onMapReady: (actions: MapActions) => void;
};

function MapInteractions({ onMapClick }: { onMapClick: (position: LatLngTuple) => void }) {
    useMapEvents({
        click: event => {
            onMapClick([event.latlng.lat, event.latlng.lng]);
        }
    });

    return null;
}

function MapController({
    boundary,
    liveGps,
    autoFollow,
    onMapReady
}: {
    boundary: PropertyBoundary;
    liveGps: GpsFix | null;
    autoFollow: boolean;
    onMapReady: (actions: MapActions) => void;
}) {
    const map = useMap();

    useEffect(() => {
        const actions: MapActions = {
            recenter: () => map.setView(boundaryCenter(boundary), map.getZoom(), { animate: true }),
            centerOnGps: () => {
                if (!liveGps) return;
                map.setView([liveGps.lat, liveGps.lng], Math.max(map.getZoom(), 18), { animate: true });
            },
            fitBoundary: () => {
                if (boundary.polygon.length < 3) return;
                map.fitBounds(L.latLngBounds(boundary.polygon), { padding: [26, 26], animate: true });
            }
        };

        onMapReady(actions);
    }, [map, boundary, liveGps, onMapReady]);

    useEffect(() => {
        if (!autoFollow || !liveGps) return;
        map.setView([liveGps.lat, liveGps.lng], clampZoom(Math.max(map.getZoom(), 18)), { animate: true });
    }, [autoFollow, liveGps, map]);

    return null;
}

export default function LeafletMapCanvas({
    boundary,
    trails,
    selectedTrailId,
    pinpoints,
    walkedTrailDraft,
    plannedTrailDraft,
    boundaryDraft,
    liveGps,
    autoFollow,
    onMapClick,
    onMapReady
}: Props) {
    const initialCenter = boundary.polygon.length >= 3 ? boundaryCenter(boundary) : DEFAULT_CENTER;

    return (
        <MapContainer
            center={initialCenter}
            zoom={DEFAULT_ZOOM}
            scrollWheelZoom
            style={{ height: '100%', width: '100%', background: '#0b1220' }}
        >
            <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} />

            <MapInteractions onMapClick={onMapClick} />
            <MapController boundary={boundary} liveGps={liveGps} autoFollow={autoFollow} onMapReady={onMapReady} />

            {boundary.polygon.length >= 3 && (
                <Polygon
                    positions={boundary.polygon}
                    pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.95, fillOpacity: 0.08 }}
                />
            )}

            {boundaryDraft.length >= 2 && (
                <Polyline
                    positions={boundaryDraft}
                    pathOptions={{ color: '#f59e0b', weight: 3, dashArray: '6 10' }}
                />
            )}

            {trails.map(trail => (
                <Polyline
                    key={trail.id}
                    positions={trail.points.map(point => [point.lat, point.lng])}
                    pathOptions={{
                        color: trail.type === 'walked' ? '#38bdf8' : '#f97316',
                        weight: selectedTrailId === trail.id ? 5 : trail.type === 'walked' ? 4 : 3,
                        opacity: 0.9
                    }}
                >
                    <Tooltip sticky>
                        {trail.name} ({trail.type}) - {formatDistance(trail.distanceMeters)}
                    </Tooltip>
                </Polyline>
            ))}

            {trails
                .filter(trail => trail.id === selectedTrailId)
                .flatMap(trail => buildTrailSplits(trail.points))
                .map((split, index) => (
                    <CircleMarker
                        key={`split-${index}-${split.distanceMeters}`}
                        center={[split.point.lat, split.point.lng]}
                        radius={5}
                        pathOptions={{ color: '#f8fafc', fillColor: '#0ea5e9', fillOpacity: 0.95 }}
                    >
                        <Tooltip direction="top">Split {split.label}</Tooltip>
                    </CircleMarker>
                ))}

            {walkedTrailDraft.length >= 2 && (
                <Polyline
                    positions={walkedTrailDraft.map(point => [point.lat, point.lng])}
                    pathOptions={{ color: '#22d3ee', weight: 4, dashArray: '8 8' }}
                />
            )}

            {plannedTrailDraft.length >= 2 && (
                <Polyline positions={plannedTrailDraft} pathOptions={{ color: '#fb923c', weight: 3, dashArray: '5 8' }} />
            )}

            {pinpoints.map(pin => (
                <CircleMarker
                    key={pin.id}
                    center={pin.position}
                    radius={8}
                    pathOptions={{
                        color: '#f8fafc',
                        fillColor: pin.pinType === 'treestand' ? '#16a34a' : pin.pinType === 'range' ? '#ea580c' : '#ef4444',
                        fillOpacity: 0.95
                    }}
                >
                    <Tooltip direction="top" offset={[0, -8]}>
                        {pin.title} ({pin.pinType})
                    </Tooltip>
                </CircleMarker>
            ))}

            {liveGps && (
                <>
                    <Circle
                        center={[liveGps.lat, liveGps.lng]}
                        radius={Math.max(liveGps.accuracyMeters, 2)}
                        pathOptions={{ color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.15, weight: 1.5 }}
                    />
                    <CircleMarker
                        center={[liveGps.lat, liveGps.lng]}
                        radius={7}
                        pathOptions={{ color: '#f8fafc', fillColor: '#2563eb', fillOpacity: 1 }}
                    >
                        <Tooltip direction="top">You are here</Tooltip>
                    </CircleMarker>
                </>
            )}
        </MapContainer>
    );
}
