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
        .select('id, created_by, recording_provider, provider_recording_id')
        .eq('id', meetingId)
        .maybeSingle();
    if (meetingError) return NextResponse.json({ error: meetingError.message }, { status: 500 });
    if (!meeting || (meeting.created_by && meeting.created_by !== auth.user.id)) {
        return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 });
    }
    if (meeting.recording_provider !== 'daily' || !meeting.provider_recording_id) {
        return NextResponse.json({ error: 'Daily has not finished processing this recording yet.' }, { status: 409 });
    }

    const apiKey = process.env.DAILY_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Daily cloud recording is not configured on the server.' }, { status: 503 });

    const response = await fetch(`https://api.daily.co/v1/recordings/${encodeURIComponent(meeting.provider_recording_id)}/access-link?valid_for_secs=3600`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.download_link) {
        return NextResponse.json({ error: String(result?.info || result?.error || 'Daily could not create a playback link.') }, { status: 502 });
    }

    return NextResponse.json({ playbackUrl: result.download_link, expires: result.expires });
}