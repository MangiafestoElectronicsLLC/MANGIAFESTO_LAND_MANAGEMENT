import { GpsFix } from './types';

type GpsTrackingCallbacks = {
    onFix: (fix: GpsFix) => void;
    onError: (message: string) => void;
};

export type GpsTrackingHandle = {
    stop: () => void;
};

export type GeolocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export const getGeolocationPermissionState = async (): Promise<GeolocationPermissionState> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return 'unsupported';
    }

    if (!('permissions' in navigator) || typeof navigator.permissions?.query !== 'function') {
        return 'prompt';
    }

    try {
        const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        return status.state as GeolocationPermissionState;
    } catch {
        return 'prompt';
    }
};

export const getLocationPermissionHelpText = () => {
    if (typeof navigator === 'undefined') return 'Allow location access for this site in your browser settings, then reload the page.';

    const userAgent = navigator.userAgent || '';

    if (/iphone|ipad|ipod/i.test(userAgent)) {
        return 'iPhone: open Settings > Privacy & Security > Location Services, confirm it is on, then find Safari (or this app if added to your home screen) and set it to "While Using the App".';
    }

    if (/android/i.test(userAgent)) {
        return 'Android: tap the lock/info icon next to the address bar, choose Permissions > Location > Allow. If that option is missing, go to phone Settings > Apps > your browser > Permissions > Location > Allow.';
    }

    return 'Open your browser or device location settings and allow location access for this site, then reload the page.';
};

const toGpsFix = (position: GeolocationPosition): GpsFix => ({
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyMeters: position.coords.accuracy || 30,
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

export const startGpsTracking = ({ onFix, onError }: GpsTrackingCallbacks): GpsTrackingHandle | null => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
        onError('Geolocation is not available in this browser.');
        return null;
    }

    const geolocationOptions: PositionOptions = {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 20000
    };

    // Weak-signal/VPN fallback: one low-accuracy attempt before giving up entirely.
    const attemptLowAccuracyFallback = (onFallbackFailed: () => void) => {
        navigator.geolocation.getCurrentPosition(
            position => onFix(toGpsFix(position)),
            onFallbackFailed,
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
    };

    const watchId = navigator.geolocation.watchPosition(
        position => onFix(toGpsFix(position)),
        error => {
            if (error.code === error.PERMISSION_DENIED) {
                onError(
                    `Location is blocked for this site. ${getLocationPermissionHelpText()} After fixing it, reload this page and tap GPS On/Off again.`
                );
                return;
            }
            if (error.code === error.POSITION_UNAVAILABLE) {
                attemptLowAccuracyFallback(() => {
                    onError(
                        'GPS position unavailable. Move to open sky and try again. If you use a VPN, it can interfere with network-based location — try turning it off and retrying.'
                    );
                });
                return;
            }
            if (error.code === error.TIMEOUT) {
                attemptLowAccuracyFallback(() => {
                    onError(
                        'GPS timed out while waiting for a fix. If you use a VPN, try turning it off, then retry with better sky visibility.'
                    );
                });
                return;
            }
            onError(error.message || 'GPS tracking failed.');
        },
        geolocationOptions
    );

    return {
        stop: () => navigator.geolocation.clearWatch(watchId)
    };
};
