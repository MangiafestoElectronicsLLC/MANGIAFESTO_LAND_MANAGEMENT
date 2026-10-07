import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type DailyWebhook = {
    id?: string;
    type?: string;
    payload?: {
        room?: string;
        room_name?: string;
        recording_id?: string;
        duration?: number;
        end_ts?: number;
        status?: string;
    };
};

export async function POST(request: Request) {
    const raw = await request.text();
    const signature = request.headers.get('x-webhook-signature') || '';
    const timestamp = request.headers.get('x-webhook-timestamp') || '';
    const secret = process.env.DAILY_WEBHOOK_SECRET;
    if (!signature || !timestamp || !secret) {
        return NextResponse.json({ error: 'Webhook signature configuration is missing.' }, { status: 401 });
    }

    let event: DailyWebhook;
    try {
        event = JSON.parse(raw) as DailyWebhook;
    } catch {
        return NextResponse.json({ error: 'Invalid webhook payload.' }, { status: 400 });
    }

    const signedPayload = `${timestamp}.${JSON.stringify(event)}`;
    const expected = createHmac('sha256', Buffer.from(secret, 'base64')).update(signedPayload).digest();
    let supplied: Buffer;
    try {
        supplied = Buffer.from(signature, 'base64');
    } catch {
        return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
    }
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceRoleKey || !supabaseUrl) {
        return NextResponse.json({ error: 'Webhook database configuration is missing.' }, { status: 503 });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const roomName = String(event.payload?.room_name || event.payload?.room || '');
    if (!roomName) return NextResponse.json({ received: true });

    if (event.type === 'meeting.ended') {
        const dailyApiKey = process.env.DAILY_API_KEY;
        if (dailyApiKey) {
            try {
                await fetch(`https://api.daily.co/v1/rooms/${encodeURIComponent(roomName)}/recordings/stop`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${dailyApiKey}` },
                    signal: AbortSignal.timeout(5000)
                });
            } catch {
                // The room's idle timeout is the fallback if the stop request cannot be reached.
            }
        }

        const endedAt = event.payload?.end_ts ? new Date(event.payload.end_ts * 1000).toISOString() : new Date().toISOString();
        const { error } = await supabase
            .from('board_meetings')
            .update({ status: 'finalizing', ended_at: endedAt, updated_at: new Date().toISOString() })
            .eq('call_room_name', roomName)
            .neq('status', 'recorded');
        if (error) return NextResponse.json({ error: 'Could not update ended meeting.' }, { status: 500 });
    }

    if (event.type === 'recording.ready-to-download' && event.payload?.recording_id) {
        const { error } = await supabase
            .from('board_meetings')
            .update({
                status: 'recorded',
                recording_provider: 'daily',
                provider_recording_id: event.payload.recording_id,
                duration_seconds: Math.max(0, Math.floor(event.payload.duration || 0)),
                ended_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('call_room_name', roomName);
        if (error) return NextResponse.json({ error: 'Could not save cloud recording metadata.' }, { status: 500 });
    }

    if (event.type === 'recording.error') {
        const { error } = await supabase
            .from('board_meetings')
            .update({ status: 'no_recording', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('call_room_name', roomName)
            .is('provider_recording_id', null);
        if (error) return NextResponse.json({ error: 'Could not save cloud recording failure.' }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}