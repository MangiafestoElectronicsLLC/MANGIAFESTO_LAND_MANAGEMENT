import { NextResponse } from 'next/server';
import { getMeetingAuth } from '@/lib/serverMeetingAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const auth = await getMeetingAuth(request);
    if (auth.error) return auth.error;

    let body: { meetingId?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid meeting request.' }, { status: 400 });
    }

    const meetingId = String(body.meetingId || '').trim();
    const { data: meeting, error: meetingError } = await auth.supabase
        .from('board_meetings')
        .select('id, created_by, call_room_name, call_provider, status')
        .eq('id', meetingId)
        .maybeSingle();
    if (meetingError) return NextResponse.json({ error: meetingError.message }, { status: 500 });
    if (!meeting || (meeting.created_by && meeting.created_by !== auth.user.id)) {
        return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
    }
    if (meeting.call_provider !== 'daily' || !meeting.call_room_name) {
        return NextResponse.json({ error: 'This meeting has no Daily cloud room.' }, { status: 400 });
    }

    const apiKey = process.env.DAILY_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Daily cloud recording is not configured on the server.' }, { status: 503 });

    const response = await fetch(`https://api.daily.co/v1/rooms/${encodeURIComponent(meeting.call_room_name)}/recordings/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'cloud',
            maxDuration: 14400,
            minIdleTimeOut: 300,
            layout: { preset: 'default', max_cam_streams: 8 }
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        return NextResponse.json({ error: String(result?.info || result?.error || 'Daily could not start cloud recording.') }, { status: 502 });
    }

    return NextResponse.json({ started: true });
}