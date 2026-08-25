'use client';

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, Polygon, Polyline, CircleMarker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
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
    STREET_FALLBACK_TILE_ATTRIBUTION,
    STREET_FALLBACK_TILE_URL,
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
    activeBasemapMode: BasemapMode | 'forced-street-fallback';
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
    selectedPinId?: string | null;
    onPinSelect?: (pinId: string) => void;
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
    activeBasemapMode,
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
    activeBasemapMode: BasemapMode | 'forced-street-fallback';
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
            tileErrorCount,
            activeBasemapMode
        });
    }, [activeBasemapMode, boundary.polygon, boundaryDraft, boundaryEditEnabled, map, onDiagnosticsChange, tileErrorCount]);

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

    const firstGpsFixDoneRef = useRef(false);

    useEffect(() => {
        if (!liveGps) {
            firstGpsFixDoneRef.current = false;
            return;
        }

        if (!firstGpsFixDoneRef.current) {
            firstGpsFixDoneRef.current = true;
            // Always pan to first GPS fix so the pin is immediately visible.
            runProgrammaticMove(() => {
                map.setView([liveGps.lat, liveGps.lng], Math.max(map.getZoom(), 17), { animate: true });
            });
            return;
        }

        if (!autoFollow) return;
        runProgrammaticMove(() => {
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
    selectedPinId,
    onPinSelect,
    onBoundaryDraftPointDrag,
    onBoundaryDraftInsertFromMidpoint,
    onMapClick,
    onMapReady,
    onAutoFollowInterrupted,
    onDiagnosticsChange
}: Props) {
    // Inject GPS pulse animation once per page — avoids relying on global CSS applying to Leaflet DOM.
    useEffect(() => {
        const styleId = 'leaflet-gps-pulse-style';
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent =
            '@keyframes gps-pulse-kf{0%{transform:scale(1);opacity:.6}70%{transform:scale(3.2);opacity:0}100%{transform:scale(3.2);opacity:0}}' +
            '.gps-pulse-dot{animation:gps-pulse-kf 2s ease-out infinite;}';
        document.head.appendChild(style);
    }, []);

    const initialCenter = boundary.polygon.length >= 3 ? boundaryCenter(boundary) : DEFAULT_CENTER;
    const boundaryDragInProgressRef = useRef(false);
    const [tileErrorCount, setTileErrorCount] = useState(0);
    const [useStreetFallback, setUseStreetFallback] = useState(false);
    const [forceStreetOnly, setForceStreetOnly] = useState(false);

    const onTileError = useCallback(() => {
        setTileErrorCount(previous => {
            const nextCount = previous + 1;
            if (nextCount >= 14) {
                setUseStreetFallback(true);
            }
            if (nextCount >= 32) {
                setForceStreetOnly(true);
            }
            return nextCount;
        });
    }, []);

    useEffect(() => {
        setTileErrorCount(0);
        setUseStreetFallback(false);
        setForceStreetOnly(false);
    }, [basemapMode]);

    const activeStreetTileUrl = useStreetFallback ? STREET_FALLBACK_TILE_URL : STREET_TILE_URL;
    const activeStreetAttribution = useStreetFallback ? STREET_FALLBACK_TILE_ATTRIBUTION : STREET_TILE_ATTRIBUTION;
    const activeBasemapMode: BasemapMode = forceStreetOnly ? 'street' : basemapMode;
    const activeBoundaryPolygon = boundaryEditEnabled && boundaryDraft.length >= 3 ? boundaryDraft : boundary.polygon;

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
            {activeBasemapMode === 'satellite' ? (
                <>
                    <TileLayer attribution={activeStreetAttribution} url={activeStreetTileUrl} eventHandlers={{ tileerror: onTileError }} />
                    <TileLayer attribution={SATELLITE_TILE_ATTRIBUTION} url={SATELLITE_TILE_URL} eventHandlers={{ tileerror: onTileError }} />
                    <TileLayer
                        attribution={SATELLITE_LABEL_TILE_ATTRIBUTION}
                        url={SATELLITE_LABEL_TILE_URL}
                        opacity={0.28}
                        eventHandlers={{ tileerror: onTileError }}
                    />
                </>
            ) : (
                <TileLayer attribution={activeStreetAttribution} url={activeStreetTileUrl} eventHandlers={{ tileerror: onTileError }} />
            )}

            <MapInteractions onMapClick={onMapClick} isBoundaryDragInProgressRef={boundaryDragInProgressRef} />
            <MapController
                boundary={boundary}
                boundaryDraft={boundaryDraft}
                boundaryEditEnabled={boundaryEditEnabled}
                liveGps={liveGps}
                autoFollow={autoFollow}
                activeBasemapMode={activeBasemapMode}
                tileErrorCount={tileErrorCount}
                onMapReady={onMapReady}
                onAutoFollowInterrupted={onAutoFollowInterrupted}
                onDiagnosticsChange={onDiagnosticsChange}
            />

            {activeBoundaryPolygon.length >= 3 && (
                <Polygon
                    positions={activeBoundaryPolygon}
                    pathOptions={{ color: '#2dd4bf', weight: 2.5, opacity: 0.95, fillOpacity: 0.05 }}
                />
            )}

            {boundaryEditEnabled && boundaryDraft.length >= 2 && (
                <Polyline
                    positions={boundaryDraft}
                    pathOptions={{ color: '#f59e0b', weight: 2.5, dashArray: '6 10' }}
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
                    radius={pin.id === selectedPinId ? 11 : 8}
                    pathOptions={{
                        color: pin.id === selectedPinId ? '#facc15' : '#f8fafc',
                        weight: pin.id === selectedPinId ? 3 : 2,
                        fillColor: pin.pinType === 'treestand' ? '#16a34a' : pin.pinType === 'range' ? '#ea580c' : pin.pinType === 'sign' ? '#dc2626' : '#ef4444',
                        fillOpacity: 0.95
                    }}
                    eventHandlers={onPinSelect ? { click: () => onPinSelect(pin.id) } : undefined}
                >
                    <Tooltip direction="top" offset={[0, -8]}>
                        {pin.title} ({pin.pinType})
                    </Tooltip>
                </CircleMarker>
            ))}

            {liveGps && (
                <>
                    {/* Accuracy radius ring */}
                    <Circle
                        center={[liveGps.lat, liveGps.lng]}
                        radius={Math.max(liveGps.accuracyMeters, 2)}
                        pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.08, weight: 1.5, dashArray: '5 5' }}
                    />
                    {/* Outer pulsing ring */}
                    <CircleMarker
                        center={[liveGps.lat, liveGps.lng]}
                        radius={18}
                        pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.18, weight: 0 }}
                    />
                    {/* Inner solid location dot */}
                    <CircleMarker
                        center={[liveGps.lat, liveGps.lng]}
                        radius={9}
                        pathOptions={{ color: '#ffffff', fillColor: '#2563eb', fillOpacity: 1, weight: 3 }}
                    >
                        <Tooltip direction="top" offset={[0, -12]}>
                            You are here{liveGps.accuracyMeters >= 30 ? ` (±${Math.round(liveGps.accuracyMeters)}m)` : ''}
                        </Tooltip>
                    </CircleMarker>
                </>
            )}
        </MapContainer>
    );
}
