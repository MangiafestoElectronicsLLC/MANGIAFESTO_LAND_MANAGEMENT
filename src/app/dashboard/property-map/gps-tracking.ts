import { GpsFix } from './types';

type GpsTrackingCallbacks = {
    onFix: (fix: GpsFix) => void;
    onError: (message: string) => void;
};

export type GpsTrackingHandle = {
    stop: () => void;
};

export const startGpsTracking = ({ onFix, onError }: GpsTrackingCallbacks): GpsTrackingHandle | null => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
        onError('Geolocation is not available in this browser.');
        return null;
    }

    const watchId = navigator.geolocation.watchPosition(
        position => {
            onFix({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracyMeters: position.coords.accuracy,
                altitudeMeters:
                    typeof position.coords.altitude === 'number' && Number.isFinite(position.coords.altitude)
                        ? position.coords.altitude
                        : null,
                heading:
                    typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading)
                        ? position.coords.heading
                        : null,
                speedMps:
                    typeof position.coords.speed === 'number' && Number.isFinite(position.coords.speed)
                        ? position.coords.speed
                        : null,
                timestamp: position.timestamp
            });
        },
        error => {
            if (error.code === error.PERMISSION_DENIED) {
                onError('Location permission denied. Enable GPS permission in your browser settings.');
                return;
            }
            if (error.code === error.POSITION_UNAVAILABLE) {
                onError('GPS position unavailable. Move to open sky and try again.');
                return;
            }
            if (error.code === error.TIMEOUT) {
                onError('GPS timed out while waiting for a fix.');
                return;
            }
            onError(error.message || 'GPS tracking failed.');
        },
        {
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: 15000
        }
    );

    return {
        stop: () => navigator.geolocation.clearWatch(watchId)
    };
};
