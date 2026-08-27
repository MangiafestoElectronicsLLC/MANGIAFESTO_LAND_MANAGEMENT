import { NextResponse } from 'next/server';
import type { MeshMessage, MeshSendRequest, MeshSendResponse } from '@/lib/meshTypes';

// SIMULATED BROADCAST ENDPOINT: no live Meshtastic gateway is wired in yet.
// This in-memory log is best-effort only (resets on cold start / differs per
// serverless instance) and exists so the console has something to poll while
// a real gateway bridge (Meshtastic HTTP API / MQTT) is not yet deployed.
export const dynamic = 'force-dynamic';

const RELAY_NODES = ['Cabin Gateway', 'Ridge Relay', 'Treeline Relay'];

const recentBroadcasts: MeshMessage[] = [];
const MAX_LOG = 50;

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function GET() {
    return NextResponse.json({ messages: recentBroadcasts, simulated: true });
}

export async function POST(request: Request) {
    let body: MeshSendRequest;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const text = String(body?.text || '').trim();
    const sender = String(body?.sender || 'Unknown node').trim() || 'Unknown node';

    if (!text) {
        return NextResponse.json({ error: 'Message text is required.' }, { status: 400 });
    }

    if (text.length > 200) {
        return NextResponse.json({ error: 'Message must be 200 characters or fewer (LoRa packet limit).' }, { status: 400 });
    }

    const relayedBy = RELAY_NODES[Math.floor(Math.random() * RELAY_NODES.length)];

    const message: MeshMessage = {
        id: makeId(),
        text,
        sender,
        direction: 'outgoing',
        relayed_by: relayedBy,
        emergency: Boolean(body?.emergency),
        created_at: new Date().toISOString(),
        synced: true
    };

    recentBroadcasts.unshift(message);
    recentBroadcasts.length = Math.min(recentBroadcasts.length, MAX_LOG);

    const payload: MeshSendResponse = { message, simulated: true };
    return NextResponse.json(payload);
}
