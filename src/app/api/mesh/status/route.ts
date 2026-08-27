import { NextResponse } from 'next/server';
import type { MeshMetrics, MeshNode, MeshStatusResponse } from '@/lib/meshTypes';

// SIMULATED DATA SOURCE: this repo has no live Meshtastic gateway wired in yet.
// Replace this handler's body with a real bridge (Meshtastic HTTP API, MQTT, or a
// local BLE/serial relay service) once a gateway node is deployed on the land.
export const dynamic = 'force-dynamic';

const BASE_NODES: Omit<MeshNode, 'battery_pct' | 'last_heard' | 'online' | 'signal_dbm'>[] = [
    {
        id: 'node-gateway-1',
        name: 'Cabin Gateway',
        role: 'gateway',
        hop_count: 0,
        firmware_version: '2.5.2',
        region: 'US_915',
        gps_lat: 43.2196,
        gps_lng: -77.9754
    },
    {
        id: 'node-relay-ridge',
        name: 'Ridge Relay',
        role: 'relay',
        hop_count: 1,
        firmware_version: '2.5.2',
        region: 'US_915',
        gps_lat: 43.2231,
        gps_lng: -77.9711
    },
    {
        id: 'node-relay-treeline',
        name: 'Treeline Relay',
        role: 'relay',
        hop_count: 1,
        firmware_version: '2.5.1',
        region: 'US_915',
        gps_lat: 43.2168,
        gps_lng: -77.9789
    },
    {
        id: 'node-portable-1',
        name: "Dad's Handheld",
        role: 'portable',
        hop_count: 2,
        firmware_version: '2.5.2',
        region: 'US_915',
        gps_lat: null,
        gps_lng: null
    },
    {
        id: 'node-portable-2',
        name: 'Trailhead Handheld',
        role: 'portable',
        hop_count: 2,
        firmware_version: '2.4.5',
        region: 'US_915',
        gps_lat: null,
        gps_lng: null
    }
];

const seededRandom = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
};

export async function GET() {
    const now = Date.now();
    const tickSeed = Math.floor(now / 15000); // slow drift so polling looks alive but stable

    const nodes: MeshNode[] = BASE_NODES.map((node, index) => {
        const roll = seededRandom(tickSeed + index);
        const online = roll > 0.08 || node.role === 'gateway';
        const minutesAgo = online ? Math.round(roll * 3) : Math.round(5 + roll * 40);

        return {
            ...node,
            battery_pct: Math.round(35 + seededRandom(tickSeed + index * 7) * 65),
            last_heard: new Date(now - minutesAgo * 60_000).toISOString(),
            online,
            signal_dbm: online ? Math.round(-60 - seededRandom(tickSeed + index * 3) * 55) : -999
        };
    });

    const onlineNodes = nodes.filter(n => n.online);
    const gatewayOnline = nodes.find(n => n.role === 'gateway')?.online ?? false;

    const metrics: MeshMetrics = {
        total_nodes: nodes.length,
        online_nodes: onlineNodes.length,
        reachable_nodes: gatewayOnline ? onlineNodes.length : onlineNodes.filter(n => n.hop_count <= 1).length,
        gateway_online: gatewayOnline,
        channel_utilization_pct: Math.round(5 + seededRandom(tickSeed) * 20),
        last_updated: new Date(now).toISOString()
    };

    const payload: MeshStatusResponse = { nodes, metrics, simulated: true };
    return NextResponse.json(payload);
}
