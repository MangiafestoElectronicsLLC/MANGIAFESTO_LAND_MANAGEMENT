'use client';

import { useCallback, useRef, useState } from 'react';
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

type UseMeshtasticConnectionArgs = {
    onIncomingMessage: (message: LiveIncomingMessage) => void;
};

const hwModelLabelFallback = (num: number) => `Node ${num}`;

export function useMeshtasticConnection({ onIncomingMessage }: UseMeshtasticConnectionArgs) {
    const [status, setStatus] = useState<LiveConnectionStatus>('disconnected');
    const [deviceName, setDeviceName] = useState<string | null>(null);
    const [nodes, setNodes] = useState<MeshNode[]>([]);
    const [error, setError] = useState<string | null>(null);

    const connectionRef = useRef<any>(null);
    const nodeNamesRef = useRef<Map<number, string>>(new Map());

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

    const connectBluetooth = useCallback(async () => {
        setError(null);

        if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
            setStatus('unsupported');
            setError('This browser does not support Web Bluetooth. Use Chrome or Edge on desktop/Android.');
            return;
        }

        setStatus('connecting');

        try {
            const meshtastic = await import('@meshtastic/js');
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

            connection.events.onNodeInfoPacket.subscribe((info: any) => upsertNodeFromInfo(info));

            connection.events.onMessagePacket.subscribe((packet: any) => {
                const fromName = nodeNamesRef.current.get(packet.from) || `Node ${packet.from}`;
                onIncomingMessage({ text: packet.data, fromNodeName: fromName, emergency: false });
            });

            const device = await connection.getDevice({ filters: [{ services: [meshtastic.ServiceUuid] }] });
            setDeviceName(device.name || 'Meshtastic node');
            await connection.connect({ device });

            connectionRef.current = connection;
            setStatus('connected');
        } catch (err: any) {
            connectionRef.current = null;
            if (err?.name === 'NotFoundError') {
                setStatus('disconnected');
                setError(null); // user cancelled the device picker
                return;
            }
            setStatus('error');
            setError(err?.message || 'Could not connect to your Meshtastic node over Bluetooth.');
        }
    }, [onIncomingMessage, upsertNodeFromInfo]);

    const disconnect = useCallback(() => {
        try {
            connectionRef.current?.disconnect();
        } catch {
            // best-effort disconnect
        }
        connectionRef.current = null;
        setStatus('disconnected');
        setDeviceName(null);
        setNodes([]);
    }, []);

    const sendText = useCallback(async (text: string): Promise<boolean> => {
        if (!connectionRef.current) return false;
        await connectionRef.current.sendText(text);
        return true;
    }, []);

    return { status, deviceName, nodes, error, connectBluetooth, disconnect, sendText };
}
