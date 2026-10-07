import { NextResponse } from 'next/server';
import { getMeetingAuth } from '@/lib/serverMeetingAuth';

export const dynamic = 'force-dynamic';

type StartRequest = { meetingId?: string };

const dailyRequest = async (path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown) => {
    const apiKey = process.env.DAILY_API_KEY;
    if (!apiKey) throw new Error('Cloud recording is not configured. Add DAILY_API_KEY to the server environment.');

    const response = await fetch(`https://api.daily.co/v1${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = String(result?.info || result?.error || `HTTP ${response.status}`);
        throw new Error(`Daily could not ${method === 'POST' ? 'start' : 'load'} the cloud call: ${detail}`);
    }
    return result;
};

export async function POST(request: Request) {
    const auth = await getMeetingAuth(request);
    if (auth.error) return auth.error;

    let body: StartRequest;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid meeting request.' }, { status: 400 });
    }

    const meetingId = String(body.meetingId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(meetingId)) {
        return NextResponse.json({ error: 'A valid meeting ID is required.' }, { status: 400 });
    }

    const { data: meeting, error: meetingError } = await auth.supabase
        .from('board_meetings')
        .select('id, created_by, call_url, call_room_name, call_provider')
        .eq('id', meetingId)
        .maybeSingle();
    if (meetingError) {
        return NextResponse.json({ error: meetingError.message }, { status: 500 });
    }
    if (!meeting || (meeting.created_by && meeting.created_by !== auth.user.id)) {
        return NextResponse.json({ error: 'Meeting not found or you do not have permission to start its recording.' }, { status: 404 });
    }
    if (meeting.call_url && meeting.call_room_name && meeting.call_provider === 'daily') {
        return NextResponse.json({ roomUrl: meeting.call_url, roomName: meeting.call_room_name, alreadyStarted: true });
    }

    if (!process.env.DAILY_API_KEY) {
        return NextResponse.json({ error: 'Cloud recording needs a Daily account with cloud recording enabled. Configure DAILY_API_KEY on the server.' }, { status: 503 });
    }

    const roomName = `flb-${meetingId.replace(/-/g, '')}`;
    let room: { name?: string; url?: string };
    try {
        try {
            room = await dailyRequest('/rooms', 'POST', {
                name: roomName,
                privacy: 'public',
                properties: {
                    enable_recording: 'cloud',
                    enable_prejoin_ui: true,
                    max_participants: 20,
                    start_audio_off: false,
                    start_video_off: false
                }
            });
        } catch (createError: any) {
            if (!String(createError?.message || '').toLowerCase().includes('already exists')) throw createError;
            room = await dailyRequest(`/rooms/${encodeURIComponent(roomName)}`, 'GET');
            await dailyRequest(`/rooms/${encodeURIComponent(roomName)}`, 'PATCH', {
                properties: { enable_recording: 'cloud', enable_prejoin_ui: true }
            });
        }

        const roomUrl = String(room.url || '');
        if (!roomUrl.startsWith('https://') || !room.name) {
            throw new Error('Daily returned an incomplete room response. Check the Daily account domain.');
        }

        const { error: saveRoomError } = await auth.supabase
            .from('board_meetings')
            .update({
                call_provider: 'daily',
                call_room_name: room.name,
                call_url: roomUrl,
                recording_provider: 'daily',
                recording_path: null,
                recording_url: null,
                provider_recording_id: null,
                status: 'live',
                updated_at: new Date().toISOString()
            })
            .eq('id', meetingId);
        if (saveRoomError) {
            return NextResponse.json({ error: `Run supabase/board_meetings_cloud_recording.sql, then retry. ${saveRoomError.message}` }, { status: 503 });
        }

        return NextResponse.json({ roomUrl, roomName: room.name, cloudRecording: 'starts-after-join' });
    } catch (err: any) {
        return NextResponse.json({ error: String(err?.message || 'Could not start Daily cloud recording.') }, { status: 502 });
    }
}