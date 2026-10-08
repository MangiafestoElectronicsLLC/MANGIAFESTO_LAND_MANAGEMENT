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
const PICKER_TIMEOUT_MS = 60000;
const RADIO_REPLY_TIMEOUT_MS = 20000;

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

function describeUsbError(err: any): string {
    if (err?.message === 'NO_RADIO_REPLY') {
        return 'The USB port opened but the node did not answer. Make sure it runs Meshtastic firmware (not stock Arduino/Heltec firmware; flash at flasher.meshtastic.org), wait ~5 seconds after plugging in, and replug it. Close other apps using the COM port.';
    }
    if (err?.message === 'PORT_NOT_OPEN') {
        return 'Could not open the USB port. Another app or tab probably has it open. Close the Meshtastic web client, Arduino serial monitor, and other tabs, then retry.';
    }
    if (err?.message === 'TIMEOUT') {
        return 'The USB port picker never appeared or finished. This happens in VS Code\'s embedded browser. Open http://localhost:3000/dashboard/satcom in regular Chrome or Edge, click Connect via USB, and choose the COM port from the popup.';
    }
    if (err?.name === 'InvalidStateError' || /already open|in use|busy/i.test(err?.message || '')) {
        return 'The USB port is busy. Close other tabs/apps using it (Meshtastic web client, Arduino serial monitor), then retry.';
    }
    if (err?.name === 'NetworkError') {
        return 'Could not open the USB port. Use a data-capable USB-C cable (not charge-only) and install the CP210x USB driver if no port shows up.';
    }
    return err?.message || 'Could not connect to your node over USB.';
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
    const connectAttemptRef = useRef(0);
    const usingBridgeRef = useRef(false);

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
        (meshtastic: any, kind: 'ble' | 'serial' | 'http' = 'ble') => {
            const client = new meshtastic.Client();
            const connection =
                kind === 'serial'
                    ? client.createSerialConnection()
                    : kind === 'http'
                      ? client.createHttpConnection()
                      : client.createBleConnection();

            connection.events.onDeviceStatus.subscribe((deviceStatus: number) => {
                if (deviceStatus === meshtastic.Types.DeviceStatusEnum.DeviceConnected) {
                    // Serial reports "connected" as soon as the port opens; connectUsb confirms the radio replies first.
                    if (kind === 'ble') setStatus('connected');
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
    const connectBluetooth = useCallback(async (preferDeviceName?: string, opts?: { forcePicker?: boolean; deviceId?: string }) => {
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
            // A device ID (e.g. 9148, the suffix on the node's Bluetooth name) narrows the picker to that node.
            const id = opts?.deviceId?.trim();
            const filterOptions = {
                filters: id
                    ? [
                          { namePrefix: `Meshtastic_${id}` },
                          { namePrefix: `${id}_` },
                          { namePrefix: id },
                          { namePrefix: `Heltec_${id}` }
                      ]
                    : [{ services: [meshtastic.ServiceUuid] }],
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

    // USB path: Web Serial over the board's USB-C cable. No Bluetooth pairing or
    // phone app needed, which makes it the most reliable way to get a node online.
    const connectUsb = useCallback(async () => {
        setError(null);
        if (status === 'connecting') return;
        if (connectionRef.current) {
            try {
                connectionRef.current.disconnect();
            } catch {
                // best-effort cleanup before switching connections
            }
            connectionRef.current = null;
        }

        const serial = typeof navigator !== 'undefined' ? (navigator as any).serial : undefined;
        if (!serial) {
            setStatus('unsupported');
            setError(
                'This browser has no USB (Web Serial) support. Open http://localhost:3000/dashboard/satcom in regular Chrome or Edge (not the VS Code preview browser).'
            );
            return;
        }

        const attempt = ++connectAttemptRef.current;
        const cancelled = () => attempt !== connectAttemptRef.current;
        setStatus('connecting');
        myNodeNumRef.current = null;

        try {
            const meshtastic = await import('@meshtastic/js');
            const connection = buildConnection(meshtastic, 'serial');

            // Without a timeout a blocked/hidden port picker leaves the UI "connecting" forever.
            // Reuse a port the user already granted; otherwise show the picker.
            const granted: any[] = await serial.getPorts().catch(() => []);
            const port = granted.length === 1 ? granted[0] : await withTimeout<any>(serial.requestPort({}), PICKER_TIMEOUT_MS);
            if (cancelled()) return;
            connectionRef.current = connection;

            await withTimeout(connection.connect({ port, concurrentLogOutput: false }), CONNECT_TIMEOUT_MS);
            if (cancelled()) return;

            // The library swallows open() failures, so confirm the port really opened.
            if (!port.readable || !port.writable) {
                throw Object.assign(new Error('PORT_NOT_OPEN'), { name: 'InvalidStateError' });
            }

            // Only report connected once the radio answers with its node info.
            const deadline = Date.now() + RADIO_REPLY_TIMEOUT_MS;
            while (myNodeNumRef.current == null && Date.now() < deadline && !cancelled()) {
                await new Promise(resolve => window.setTimeout(resolve, 250));
            }
            if (cancelled()) return;
            if (myNodeNumRef.current == null) throw new Error('NO_RADIO_REPLY');

            setDeviceName(nodeNamesRef.current.get(myNodeNumRef.current) || 'USB node');
            setStatus('connected');
        } catch (err: any) {
            if (cancelled()) return;
            try {
                connectionRef.current?.disconnect();
            } catch {
                // best-effort cleanup after a failed attempt
            }
            connectionRef.current = null;
            if (err?.name === 'NotFoundError') {
                setStatus('disconnected');
                return; // user cancelled the port picker
            }
            setStatus('error');
            setError(describeUsbError(err));
        }
    }, [buildConnection, status]);

    // Shared HTTP transport: used for WiFi/VPN nodes and for the local USB bridge.
    const connectHttp = useCallback(
        async (address: string, tls: boolean, opts: { fetchInterval: number; failMessage: string; timeoutMs?: number; silent?: boolean }) => {
            const attempt = ++connectAttemptRef.current;
            const cancelled = () => attempt !== connectAttemptRef.current;
            setStatus('connecting');
            myNodeNumRef.current = null;

            try {
                const meshtastic = await import('@meshtastic/js');
                const connection = buildConnection(meshtastic, 'http');
                connectionRef.current = connection;
                await withTimeout(connection.connect({ address, tls,                 fetchInterval: opts.fetchInterval }), opts.timeoutMs ?? CONNECT_TIMEOUT_MS);

                                const deadline = Date.now() + (opts.timeoutMs ?? RADIO_REPLY_TIMEOUT_MS);
                while (myNodeNumRef.current == null && Date.now() < deadline && !cancelled()) {
                    await new Promise(resolve => window.setTimeout(resolve, 250));
                }
                if (cancelled()) return false;
                if (myNodeNumRef.current == null) throw new Error('NO_RADIO_REPLY');

                setDeviceName(nodeNamesRef.current.get(myNodeNumRef.current) || address);
                setStatus('connected');
                return true;
            } catch {
                if (cancelled()) return false;
                try {
                    connectionRef.current?.disconnect();
                } catch {
                    // best-effort cleanup after a failed attempt
                }
                connectionRef.current = null;
                if (opts.silent) return false;
                setStatus('error');
                setError(opts.failMessage);
                return false;
            }
        },
        [buildConnection]
    );

    const releaseExistingConnection = useCallback(() => {
        if (!connectionRef.current) return;
        try {
            connectionRef.current.disconnect();
        } catch {
            // best-effort cleanup before switching connections
        }
        connectionRef.current = null;
    }, []);

    // Network path: works in ANY browser (Safari, Firefox, iPhone) because it is plain HTTP to the
    // node's WiFi address on your LAN, VPN (Tailscale/WireGuard) or a VPS tunnel.
    const connectWifi = useCallback(
        // Leave the address empty for auto-detect: tries meshtastic.local, then the node's own
        // hotspot address. Returns the address that worked so the UI can remember it.
        async (rawAddress: string): Promise<string | null> => {
            setError(null);
            if (status === 'connecting') return null;
            releaseExistingConnection();
            usingBridgeRef.current = false;

            const typed = rawAddress.trim();
            const tls = /^https:\/\//i.test(typed);
            const clean = (value: string) => value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
            const candidates = typed ? [clean(typed)] : ['meshtastic.local', '192.168.4.1'];

            if (window.location.protocol === 'https:' && !tls) {
                setStatus('error');
                setError(
                    'This page is on HTTPS, so browsers block plain-HTTP node addresses. Open the app over http on your LAN/VPN (or the USB option on the computer running it), or enable HTTPS on the node and enter https://<address>.'
                );
                return null;
            }

            setStatus('connecting');
            const auto = !typed;
            for (let i = 0; i < candidates.length; i++) {
                const address = candidates[i];
                const last = i === candidates.length - 1;
                const before = connectAttemptRef.current;
                const ok = await connectHttp(address, tls, {
                    fetchInterval: 3000,
                    timeoutMs: auto ? 8000 : undefined,
                    silent: !last,
                    failMessage: auto
                        ? 'No node found automatically. Make sure the node has WiFi turned on (Meshtastic app > Radio config > Network) and this device is on the same WiFi or VPN, then type the IP shown on the node\'s screen into the box and tap again.'
                        : 'Could not reach the node at ' +
                          address +
                          '. Check WiFi is enabled on the node, this device is on the same network or VPN, and the address matches the node\'s screen.'
                });
                if (ok) return address;
                if (connectAttemptRef.current !== before + 1) break; // cancelled by the user
            }
            return null;
        },
        [connectHttp, releaseExistingConnection, status]
    );

    // USB through the app's own server (/api/bridge): the node is plugged into the machine running
    // the app, and ANY browser (including the VS Code preview, Safari, macOS) talks to it over HTTP.
    const connectBridge = useCallback(
        async (portPath?: string) => {
            setError(null);
            if (status === 'connecting') return;
            releaseExistingConnection();
            usingBridgeRef.current = false;
            setStatus('connecting');

            const fail = (message: string) => {
                setStatus('error');
                setError(message);
            };

            let path = portPath;
            try {
                const listResponse = await withTimeout(fetch('/api/bridge/ports', { cache: 'no-store' }), 8000);
                if (listResponse.status === 403) {
                    const body = await listResponse.json().catch(() => null);
                    return fail(body?.error || 'The USB bridge is disabled on this server.');
                }
                if (!listResponse.ok) return fail('The USB bridge on the app server did not respond. Is the app running on the computer the node is plugged into?');
                const { ports } = (await listResponse.json()) as { ports: { path: string; likelyMeshtastic: boolean }[] };
                if (ports.length === 0) {
                    return fail(
                        'No USB serial ports found on the app server. Plug the node into the computer running this app with a data-capable USB-C cable, and install the CP210x/CH340 driver if Device Manager shows no port.'
                    );
                }
                path = path || (ports.find(p => p.likelyMeshtastic) ?? ports[0]).path;

                const openResponse = await withTimeout(fetch(`/api/bridge/open?path=${encodeURIComponent(path)}`, { method: 'POST' }), 10000);
                if (!openResponse.ok) {
                    const body = await openResponse.json().catch(() => null);
                    return fail(body?.error || `Could not open ${path}.`);
                }
            } catch {
                return fail('Could not reach the USB bridge on the app server.');
            }

            usingBridgeRef.current = true;
            const ok = await connectHttp(window.location.host + '/api/bridge', window.location.protocol === 'https:', {
                fetchInterval: 1000,
                failMessage: `Opened ${path} but the node did not answer. Make sure it runs Meshtastic firmware (flash at flasher.meshtastic.org), wait ~5 seconds after plugging in, then try again.`
            });
            if (!ok) {
                usingBridgeRef.current = false;
                void fetch('/api/bridge/close', { method: 'POST' }).catch(() => undefined);
            }
        },
        [connectHttp, releaseExistingConnection, status]
    );

    useEffect(() => {
        return () => {
            try {
                connectionRef.current?.disconnect();
            } catch {
                // best-effort cleanup when leaving the page
            }
            connectionRef.current = null;
            if (usingBridgeRef.current) void fetch('/api/bridge/close', { method: 'POST', keepalive: true }).catch(() => undefined);
        };
    }, []);

    const disconnect = useCallback(() => {
        connectAttemptRef.current++; // also cancels an in-flight connect attempt
        try {
            connectionRef.current?.disconnect();
        } catch {
            // best-effort disconnect
        }
        connectionRef.current = null;
        if (usingBridgeRef.current) {
            usingBridgeRef.current = false;
            void fetch('/api/bridge/close', { method: 'POST' }).catch(() => undefined);
        }
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

    return { status, deviceName, nodes, error, ownBattery, connectBluetooth, connectUsb, connectBridge, connectWifi, disconnect, sendText };
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
