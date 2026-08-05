'use client';

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { boundaryCenter } from './boundary-manager';
import {
    BasemapMode,
    buildTrailSplits,
    DEFAULT_CENTER,
    DEFAULT_ZOOM,
    SATELLITE_LABEL_TILE_ATTRIBUTION,
    SATELLITE_LABEL_TILE_URL,
    SATELLITE_TILE_ATTRIBUTION,
    SATELLITE_TILE_URL,
    STREET_TILE_ATTRIBUTION,
    STREET_TILE_URL,
    clampZoom,
    formatDistance
} from './map-engine';
import { GpsFix, LatLngTuple, Pinpoint, PropertyBoundary, Trail } from './types';

export type MapActions = {
    recenter: () => void;
    centerOnGps: () => void;
    fitBoundary: () => void;
    refresh: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
};

export type MapDiagnostics = {
    center: LatLngTuple;
    zoom: number;
    boundaryPointCount: number;
    tileErrorCount: number;
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
    basemapMode: BasemapMode;
    boundaryEditEnabled: boolean;
    onBoundaryDraftPointDrag: (index: number, position: LatLngTuple) => void;
    onBoundaryDraftInsertFromMidpoint: (edgeIndex: number, position: LatLngTuple) => number;
    onMapClick: (position: LatLngTuple) => void;
    onMapReady: (actions: MapActions) => void;
    onAutoFollowInterrupted: () => void;
    onDiagnosticsChange: (diagnostics: MapDiagnostics) => void;
};

const boundaryHandleIcon = L.divIcon({
    className: 'boundary-handle-icon',
    html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:#f59e0b;border:2px solid #111827;box-shadow:0 0 0 2px rgba(255,255,255,0.5);"></span>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
});

const boundaryMidpointIcon = L.divIcon({
    className: 'boundary-midpoint-icon',
    html: '<span style="display:block;width:12px;height:12px;border-radius:50%;background:#38bdf8;border:2px solid #0f172a;box-shadow:0 0 0 2px rgba(255,255,255,0.5);"></span>',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
});

function BoundaryMidpointHandle({
    edgeIndex,
    position,
    onBoundaryDraftInsertFromMidpoint,
    onBoundaryDraftPointDrag,
    onDragStateChange
}: {
    edgeIndex: number;
    position: LatLngTuple;
    onBoundaryDraftInsertFromMidpoint: (edgeIndex: number, position: LatLngTuple) => number;
    onBoundaryDraftPointDrag: (index: number, position: LatLngTuple) => void;
    onDragStateChange: (isDragging: boolean) => void;
}) {
    return (
        <Marker
            position={position}
            icon={boundaryMidpointIcon}
            draggable
            eventHandlers={{
                dragstart: () => {
                    onDragStateChange(true);
                },
                dragend: event => {
                    const current = event.target.getLatLng();
                    const insertedIndex = onBoundaryDraftInsertFromMidpoint(edgeIndex, [current.lat, current.lng]);
                    if (insertedIndex >= 0) {
                        onBoundaryDraftPointDrag(insertedIndex, [current.lat, current.lng]);
                    }
                    window.setTimeout(() => onDragStateChange(false), 90);
                }
            }}
        >
            <Tooltip direction="top" offset={[0, -8]}>
                Drag to add corner
            </Tooltip>
        </Marker>
    );
}

function MapInteractions({
    onMapClick,
    isBoundaryDragInProgressRef
}: {
    onMapClick: (position: LatLngTuple) => void;
    isBoundaryDragInProgressRef: MutableRefObject<boolean>;
}) {
    useMapEvents({
        click: event => {
            if (isBoundaryDragInProgressRef.current) {
                return;
            }
            onMapClick([event.latlng.lat, event.latlng.lng]);
        }
    });

    return null;
}

function MapController({
    boundary,
    boundaryDraft,
    boundaryEditEnabled,
    liveGps,
    autoFollow,
    tileErrorCount,
    onMapReady,
    onAutoFollowInterrupted,
    onDiagnosticsChange
}: {
    boundary: PropertyBoundary;
    boundaryDraft: LatLngTuple[];
    boundaryEditEnabled: boolean;
    liveGps: GpsFix | null;
    autoFollow: boolean;
    tileErrorCount: number;
    onMapReady: (actions: MapActions) => void;
    onAutoFollowInterrupted: () => void;
    onDiagnosticsChange: (diagnostics: MapDiagnostics) => void;
}) {
    const map = useMap();
    const isProgrammaticMoveRef = useRef(false);
    const hasDoneInitialFitRef = useRef(false);

    const runProgrammaticMove = (action: () => void) => {
        isProgrammaticMoveRef.current = true;
        action();
        window.setTimeout(() => {
            isProgrammaticMoveRef.current = false;
        }, 260);
    };

    const emitDiagnostics = useCallback(() => {
        const center = map.getCenter();
        const activePolygon = boundaryEditEnabled && boundaryDraft.length >= 3 ? boundaryDraft : boundary.polygon;
        onDiagnosticsChange({
            center: [center.lat, center.lng],
            zoom: map.getZoom(),
            boundaryPointCount: activePolygon.length,
            tileErrorCount
        });
    }, [boundary.polygon, boundaryDraft, boundaryEditEnabled, map, onDiagnosticsChange, tileErrorCount]);

    useEffect(() => {
        const invalidate = () => map.invalidateSize({ animate: false });
        const observer =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                    map.invalidateSize({ animate: false });
                })
                : null;

        if (observer) {
            observer.observe(map.getContainer());
        }

        // Leaflet can mis-measure width right after mount in complex grid layouts.
        const timerA = window.setTimeout(invalidate, 0);
        const timerB = window.setTimeout(invalidate, 220);
        const timerC = window.setTimeout(invalidate, 800);
        window.addEventListener('resize', invalidate);
        window.addEventListener('visibilitychange', invalidate);

        return () => {
            window.clearTimeout(timerA);
            window.clearTimeout(timerB);
            window.clearTimeout(timerC);
            window.removeEventListener('resize', invalidate);
            window.removeEventListener('visibilitychange', invalidate);
            observer?.disconnect();
        };
    }, [map]);

    useEffect(() => {
        const stopAutoFollowOnManualMove = () => {
            if (!autoFollow || isProgrammaticMoveRef.current) return;
            onAutoFollowInterrupted();
        };

        map.on('dragstart', stopAutoFollowOnManualMove);
        map.on('zoomstart', stopAutoFollowOnManualMove);

        return () => {
            map.off('dragstart', stopAutoFollowOnManualMove);
            map.off('zoomstart', stopAutoFollowOnManualMove);
        };
    }, [autoFollow, map, onAutoFollowInterrupted]);

    useEffect(() => {
        const publish = () => {
            emitDiagnostics();
        };

        map.on('load', publish);
        map.on('moveend', publish);
        map.on('zoomend', publish);
        publish();

        return () => {
            map.off('load', publish);
            map.off('moveend', publish);
            map.off('zoomend', publish);
        };
    }, [emitDiagnostics, map]);

    useEffect(() => {
        emitDiagnostics();
    }, [emitDiagnostics]);

    useEffect(() => {
        if (hasDoneInitialFitRef.current) {
            return;
        }

        const polygon = boundary.polygon.length >= 3 ? boundary.polygon : boundaryDraft;
        if (polygon.length < 3) {
            return;
        }

        hasDoneInitialFitRef.current = true;
        runProgrammaticMove(() => {
            map.fitBounds(L.latLngBounds(polygon), { padding: [24, 24], maxZoom: 19, animate: false });
        });
    }, [boundary.polygon, boundaryDraft, map]);

    useEffect(() => {
        if (boundaryEditEnabled) return;
        if (boundary.polygon.length < 3) return;

        runProgrammaticMove(() => {
            map.fitBounds(L.latLngBounds(boundary.polygon), { padding: [24, 24], maxZoom: 19, animate: true });
        });
    }, [boundary.updatedAt, boundaryEditEnabled, boundary.polygon, map]);

    useEffect(() => {
        const actions: MapActions = {
            recenter: () =>
                runProgrammaticMove(() => {
                    map.setView(boundaryCenter(boundary), map.getZoom(), { animate: true });
                }),
            centerOnGps: () => {
                if (!liveGps) return;
                runProgrammaticMove(() => {
                    map.setView([liveGps.lat, liveGps.lng], Math.max(map.getZoom(), 17), { animate: true });
                });
            },
            fitBoundary: () => {
                const polygon = boundaryEditEnabled && boundaryDraft.length >= 3 ? boundaryDraft : boundary.polygon;
                if (polygon.length < 3) return;
                runProgrammaticMove(() => {
                    map.fitBounds(L.latLngBounds(polygon), { padding: [24, 24], maxZoom: 19, animate: true });
                });
            },
            refresh: () => {
                map.invalidateSize({ animate: false });
                map.eachLayer(layer => {
                    const tileLayer = layer as L.TileLayer;
                    if (typeof tileLayer.redraw === 'function') {
                        tileLayer.redraw();
                    }
                });
            },
            zoomIn: () => {
                runProgrammaticMove(() => {
                    map.setZoom(clampZoom(map.getZoom() + 1));
                });
            },
            zoomOut: () => {
                runProgrammaticMove(() => {
                    map.setZoom(clampZoom(map.getZoom() - 1));
                });
            }
        };

        onMapReady(actions);
    }, [map, boundary, boundaryDraft, boundaryEditEnabled, liveGps, onMapReady]);

    useEffect(() => {
        if (!autoFollow || !liveGps) return;
        runProgrammaticMove(() => {
            // Keep current zoom so users can choose close/far tracking while moving.
            map.setView([liveGps.lat, liveGps.lng], clampZoom(map.getZoom()), { animate: true });
        });
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
    basemapMode,
    boundaryEditEnabled,
    onBoundaryDraftPointDrag,
    onBoundaryDraftInsertFromMidpoint,
    onMapClick,
    onMapReady,
    onAutoFollowInterrupted,
    onDiagnosticsChange
}: Props) {
    const initialCenter = boundary.polygon.length >= 3 ? boundaryCenter(boundary) : DEFAULT_CENTER;
    const boundaryDragInProgressRef = useRef(false);
    const [tileErrorCount, setTileErrorCount] = useState(0);

    const onTileError = useCallback(() => {
        setTileErrorCount(previous => previous + 1);
    }, []);

    useEffect(() => {
        setTileErrorCount(0);
    }, [basemapMode]);

    const onHandleDragStateChange = (isDragging: boolean) => {
        boundaryDragInProgressRef.current = isDragging;
    };

    return (
        <MapContainer
            center={initialCenter}
            zoom={DEFAULT_ZOOM}
            scrollWheelZoom
            style={{ height: '100%', width: '100%', background: '#0b1220' }}
        >
            {basemapMode === 'satellite' ? (
                <>
                    <TileLayer attribution={STREET_TILE_ATTRIBUTION} url={STREET_TILE_URL} eventHandlers={{ tileerror: onTileError }} />
                    <TileLayer attribution={SATELLITE_TILE_ATTRIBUTION} url={SATELLITE_TILE_URL} eventHandlers={{ tileerror: onTileError }} />
                    <TileLayer
                        attribution={SATELLITE_LABEL_TILE_ATTRIBUTION}
                        url={SATELLITE_LABEL_TILE_URL}
                        opacity={0.28}
                        eventHandlers={{ tileerror: onTileError }}
                    />
                </>
            ) : (
                <TileLayer attribution={STREET_TILE_ATTRIBUTION} url={STREET_TILE_URL} eventHandlers={{ tileerror: onTileError }} />
            )}

            <MapInteractions onMapClick={onMapClick} isBoundaryDragInProgressRef={boundaryDragInProgressRef} />
            <MapController
                boundary={boundary}
                boundaryDraft={boundaryDraft}
                boundaryEditEnabled={boundaryEditEnabled}
                liveGps={liveGps}
                autoFollow={autoFollow}
                tileErrorCount={tileErrorCount}
                onMapReady={onMapReady}
                onAutoFollowInterrupted={onAutoFollowInterrupted}
                onDiagnosticsChange={onDiagnosticsChange}
            />

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

            {boundaryEditEnabled &&
                boundaryDraft.map((point, index) => (
                    <Marker
                        key={`boundary-handle-${index}`}
                        position={point}
                        icon={boundaryHandleIcon}
                        draggable
                        eventHandlers={{
                            dragstart: () => {
                                onHandleDragStateChange(true);
                            },
                            dragend: event => {
                                const next = event.target.getLatLng();
                                onBoundaryDraftPointDrag(index, [next.lat, next.lng]);
                                window.setTimeout(() => onHandleDragStateChange(false), 90);
                            }
                        }}
                    >
                        <Tooltip direction="top" offset={[0, -8]}>
                            Corner {index + 1}
                        </Tooltip>
                    </Marker>
                ))}

            {boundaryEditEnabled &&
                boundaryDraft.length >= 3 &&
                boundaryDraft.map((point, index) => {
                    const next = boundaryDraft[(index + 1) % boundaryDraft.length];
                    const midpoint: LatLngTuple = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];

                    return (
                        <BoundaryMidpointHandle
                            key={`boundary-midpoint-${index}`}
                            edgeIndex={index}
                            position={midpoint}
                            onBoundaryDraftInsertFromMidpoint={onBoundaryDraftInsertFromMidpoint}
                            onBoundaryDraftPointDrag={onBoundaryDraftPointDrag}
                            onDragStateChange={onHandleDragStateChange}
                        />
                    );
                })}

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
