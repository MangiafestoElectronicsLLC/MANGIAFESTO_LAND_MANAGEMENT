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
        return NextResponse.json({ error: 'This meeting is not using cloud recording.' }, { status: 400 });
    }

    const apiKey = process.env.DAILY_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Daily cloud recording is not configured on the server.' }, { status: 503 });

    const response = await fetch(`https://api.daily.co/v1/rooms/${encodeURIComponent(meeting.call_room_name)}/recordings/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        return NextResponse.json({ error: String(detail?.info || detail?.error || 'Daily could not stop the recording.') }, { status: 502 });
    }

    const { error: updateError } = await auth.supabase
        .from('board_meetings')
        .update({ status: 'finalizing', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', meeting.id);
    if (updateError) return NextResponse.json({ error: `Daily stopped the recording but meeting status did not update: ${updateError.message}` }, { status: 500 });

    return NextResponse.json({ stopped: true, status: 'finalizing' });
}