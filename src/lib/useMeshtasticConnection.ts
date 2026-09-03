'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeshNode } from './meshTypes';

// Real integration with devices already paired in the Meshtastic app, via the
// browser's Web Bluetooth API and the official @meshtastic/js protocol client.
// Only works in Chromium browsers (Chrome/Edge) served over HTTPS, same as the
// official Meshtastic web client at client.meshtastic.org.

export type LiveConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'unsupported' | 'error';

export type LiveIncomingMessage = {
    text: string;
    fromNodeName: string;
    emergency: boolean;
};

export type LiveBattery = {
    pct: number | null;
    voltage: number | null;
    updatedAt: string;
};

type UseMeshtasticConnectionArgs = {
    onIncomingMessage: (message: LiveIncomingMessage) => void;
};

export type BrowserSupport = {
    bluetoothApi: boolean;
    secureContext: boolean;
    ok: boolean;
};

export function checkBrowserSupport(): BrowserSupport {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
        return { bluetoothApi: false, secureContext: false, ok: false };
    }
    const bluetoothApi = 'bluetooth' in navigator;
    const secureContext = window.isSecureContext;
    return { bluetoothApi, secureContext, ok: bluetoothApi && secureContext };
}

const hwModelLabelFallback = (num: number) => `Node ${num}`;

// A silently-reconnected (previously-permitted) device may be powered off or
// out of range; without a timeout `connection.connect()` can hang forever and
// the UI gets stuck on "Connecting..." with no way out.
const CONNECT_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('TIMEOUT')), ms);
        promise.then(
            value => {
                window.clearTimeout(timer);
                resolve(value);
            },
            err => {
                window.clearTimeout(timer);
                reject(err);
            }
        );
    });
}

function describeConnectError(err: any): string {
    if (err?.message === 'TIMEOUT') {
        return 'Timed out connecting. Make sure the node is powered on, nearby, and not already connected to the Meshtastic phone app — a node can only talk to one Bluetooth client at a time, so disconnect it there first.';
    }
    if (err?.name === 'NetworkError') {
        return 'Bluetooth connection dropped. Move closer to the node and make sure it is not already connected in the Meshtastic phone app (only one Bluetooth client can be connected at once).';
    }
    if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') {
        return 'This browser blocked Bluetooth access. Reload the page and allow the Bluetooth permission prompt.';
    }
    if (err?.name === 'InvalidStateError') {
        return 'Bluetooth adapter is off or unavailable. Turn on Bluetooth on this device and try again.';
    }
    return err?.message || 'Could not connect to your Meshtastic node over Bluetooth.';
}

export function useMeshtasticConnection({ onIncomingMessage }: UseMeshtasticConnectionArgs) {
    const [status, setStatus] = useState<LiveConnectionStatus>('disconnected');
    const [deviceName, setDeviceName] = useState<string | null>(null);
    const [nodes, setNodes] = useState<MeshNode[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [ownBattery, setOwnBattery] = useState<LiveBattery | null>(null);

    const connectionRef = useRef<any>(null);
    const nodeNamesRef = useRef<Map<number, string>>(new Map());
    const myNodeNumRef = useRef<number | null>(null);

    const upsertNodeFromInfo = useCallback((info: any) => {
        const num: number = info?.num;
        if (typeof num !== 'number') return;

        const longName: string = info?.user?.longName || hwModelLabelFallback(num);
        nodeNamesRef.current.set(num, longName);

        const batteryPct = typeof info?.deviceMetrics?.batteryLevel === 'number' ? info.deviceMetrics.batteryLevel : 0;
        const lastHeardSeconds: number = info?.lastHeard || 0;
        const hopsAway: number = typeof info?.hopsAway === 'number' ? info.hopsAway : 0;
        const latitudeI = info?.position?.latitudeI;
        const longitudeI = info?.position?.longitudeI;

        const node: MeshNode = {
            id: `live-${num}`,
            name: longName,
            role: hopsAway === 0 ? 'portable' : 'unknown',
            battery_pct: Math.min(100, Math.max(0, batteryPct)),
            last_heard: lastHeardSeconds ? new Date(lastHeardSeconds * 1000).toISOString() : new Date().toISOString(),
            online: true,
            signal_dbm: typeof info?.snr === 'number' ? Math.round(info.snr * 10) : -70,
            hop_count: hopsAway,
            firmware_version: 'unknown',
            region: 'US_915',
            gps_lat: typeof latitudeI === 'number' ? latitudeI / 1e7 : null,
            gps_lng: typeof longitudeI === 'number' ? longitudeI / 1e7 : null
        };

        setNodes(prev => {
            const next = prev.filter(n => n.id !== node.id);
            next.push(node);
            return next;
        });
    }, []);

    const buildConnection = useCallback(
        (meshtastic: any) => {
            const client = new meshtastic.Client();
            const connection = client.createBleConnection();

            connection.events.onDeviceStatus.subscribe((deviceStatus: number) => {
                if (deviceStatus === meshtastic.Types.DeviceStatusEnum.DeviceConnected) {
                    setStatus('connected');
                } else if (
                    deviceStatus === meshtastic.Types.DeviceStatusEnum.DeviceDisconnected ||
                    deviceStatus === meshtastic.Types.DeviceStatusEnum.DeviceRestarting
                ) {
                    setStatus('disconnected');
                }
            });

            connection.events.onNodeInfoPacket.subscribe((info: any) => {
                upsertNodeFromInfo(info);
                if (typeof info?.num === 'number' && info.num === myNodeNumRef.current) {
                    const batteryPct = info?.deviceMetrics?.batteryLevel;
                    const voltage = info?.deviceMetrics?.voltage;
                    if (typeof batteryPct === 'number' || typeof voltage === 'number') {
                        setOwnBattery({
                            pct: typeof batteryPct === 'number' ? Math.min(100, Math.max(0, batteryPct)) : null,
                            voltage: typeof voltage === 'number' ? voltage : null,
                            updatedAt: new Date().toISOString()
                        });
                    }
                }
            });

            // MyNodeInfo tells us which node number IS this browser's connected
            // node, so we can tell its battery telemetry apart from other mesh nodes.
            connection.events.onMyNodeInfo.subscribe((info: any) => {
                if (typeof info?.myNodeNum === 'number') myNodeNumRef.current = info.myNodeNum;
            });

            // Telemetry packets arrive far more often than full NodeInfo rebroadcasts,
            // so this keeps battery/voltage readings fresh for every known node.
            connection.events.onTelemetryPacket.subscribe((packet: any) => {
                const metrics = packet?.data?.deviceMetrics;
                if (!metrics) return;
                const batteryPct = typeof metrics.batteryLevel === 'number' ? Math.min(100, Math.max(0, metrics.batteryLevel)) : null;
                const voltage = typeof metrics.voltage === 'number' ? metrics.voltage : null;

                if (packet.from === myNodeNumRef.current) {
                    setOwnBattery({ pct: batteryPct, voltage, updatedAt: new Date().toISOString() });
                }

                setNodes(prev =>
                    prev.map(node =>
                        node.id === `live-${packet.from}`
                            ? { ...node, battery_pct: batteryPct ?? node.battery_pct }
                            : node
                    )
                );
            });

            connection.events.onMessagePacket.subscribe((packet: any) => {
                const fromName = nodeNamesRef.current.get(packet.from) || `Node ${packet.from}`;
                const text = typeof packet.data === 'string' ? packet.data : String(packet.data ?? '');
                if (text) onIncomingMessage({ text, fromNodeName: fromName, emergency: false });
            });

            return connection;
        },
        [onIncomingMessage, upsertNodeFromInfo]
    );

    // `forcePicker` skips the silent-reconnect-by-name attempt and always opens
    // the browser's device chooser, so users have a reliable way to pick a
    // different/nearby node when the remembered one won't reconnect.
    const connectBluetooth = useCallback(async (preferDeviceName?: string, opts?: { forcePicker?: boolean }) => {
        setError(null);

        if (status === 'connecting') return;
        if (connectionRef.current) {
            try {
                connectionRef.current.disconnect();
            } catch {
                // best-effort cleanup before switching devices
            }
            connectionRef.current = null;
        }

        const support = checkBrowserSupport();
        if (!support.bluetoothApi) {
            setStatus('unsupported');
            setError('This browser does not support Web Bluetooth. Use Chrome or Edge on desktop/Android.');
            return;
        }
        if (!support.secureContext) {
            setStatus('unsupported');
            setError('Web Bluetooth needs a secure (HTTPS) page. Open this dashboard over https and try again.');
            return;
        }

        setStatus('connecting');

        try {
            const meshtastic = await import('@meshtastic/js');
            const filterOptions = {
                filters: [{ services: [meshtastic.ServiceUuid] }],
                optionalServices: [meshtastic.ServiceUuid]
            };

            const remembered = opts?.forcePicker ? null : await findPreviouslyAllowedDevice(preferDeviceName);

            if (remembered) {
                // Try the remembered device first, but don't let a stale/out-of-range
                // device hang the UI forever — fall back to the picker below instead.
                const connection = buildConnection(meshtastic);
                try {
                    await withTimeout(connection.connect({ device: remembered }), CONNECT_TIMEOUT_MS);
                    setDeviceName(remembered.name || 'Meshtastic node');
                    connectionRef.current = connection;
                    setStatus('connected');
                    return;
                } catch {
                    try {
                        connection.disconnect();
                    } catch {
                        // best-effort cleanup before falling back to the picker
                    }
                }
            }

            const connection = buildConnection(meshtastic);
            const device = await connection.getDevice(filterOptions);
            setDeviceName(device.name || 'Meshtastic node');
            connectionRef.current = connection;
            await withTimeout(connection.connect({ device }), CONNECT_TIMEOUT_MS);

            setStatus('connected');
        } catch (err: any) {
            connectionRef.current = null;
            if (err?.name === 'NotFoundError') {
                setStatus('disconnected');
                setError(null); // user cancelled the device picker
                return;
            }
            setStatus('error');
            setError(describeConnectError(err));
        }
    }, [buildConnection, status]);

    useEffect(() => {
        return () => {
            try {
                connectionRef.current?.disconnect();
            } catch {
                // best-effort cleanup when leaving the page
            }
            connectionRef.current = null;
        };
    }, []);

    const disconnect = useCallback(() => {
        try {
            connectionRef.current?.disconnect();
        } catch {
            // best-effort disconnect
        }
        connectionRef.current = null;
        myNodeNumRef.current = null;
        setStatus('disconnected');
        setDeviceName(null);
        setNodes([]);
        setOwnBattery(null);
    }, []);

    const sendText = useCallback(async (text: string): Promise<boolean> => {
        if (status !== 'connected' || !connectionRef.current) return false;
        await connectionRef.current.sendText(text);
        return true;
    }, [status]);

    return { status, deviceName, nodes, error, ownBattery, connectBluetooth, disconnect, sendText };
}

export type MeshtasticConnection = ReturnType<typeof useMeshtasticConnection>;

// Chromium exposes already-permitted devices via getDevices(), which lets an
// onboarded node reconnect without showing the picker again.
async function findPreviouslyAllowedDevice(preferDeviceName?: string): Promise<any | null> {
    if (!preferDeviceName) return null;
    const bluetooth = (navigator as any).bluetooth;
    if (typeof bluetooth?.getDevices !== 'function') return null;
    try {
        const devices = await bluetooth.getDevices();
        return devices.find((device: any) => device?.name === preferDeviceName) ?? null;
    } catch {
        return null;
    }
}
