import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type InviteRequest = {
    type?: 'email' | 'sms';
    recipient?: string;
    title?: string;
    roomUrl?: string;
};

const jsonError = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function POST(request: Request) {
    const authorization = request.headers.get('authorization') || '';
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!accessToken || !supabaseUrl || !supabaseKey) {
        return jsonError('Sign in again before sending an invite.', 401);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) {
        return jsonError('Your session could not be verified. Sign in again and retry.', 401);
    }

    let body: InviteRequest;
    try {
        body = await request.json();
    } catch {
        return jsonError('Invite details were not valid JSON.', 400);
    }

    const type = body.type;
    const recipient = String(body.recipient || '').trim();
    const title = String(body.title || 'Family Board Meeting').trim().slice(0, 120) || 'Family Board Meeting';
    let roomUrl: URL;

    try {
        roomUrl = new URL(String(body.roomUrl || ''));
    } catch {
        return jsonError('The meeting link is invalid. Reopen the live meeting and try again.', 400);
    }

    let dailyHost = '';
    try {
        const configuredDomain = String(process.env.DAILY_DOMAIN || '').trim();
        if (configuredDomain) {
            dailyHost = new URL(configuredDomain.includes('://') ? configuredDomain : `https://${configuredDomain}`).hostname;
        }
    } catch {
        dailyHost = '';
    }
    const configuredJitsiDomain = String(process.env.NEXT_PUBLIC_JITSI_DOMAIN || 'meet.jit.si').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const isJitsiRoom = roomUrl.hostname === configuredJitsiDomain && /^\/family-land-board-[a-zA-Z0-9-]{1,48}$/.test(roomUrl.pathname);
    const isDailyRoom = Boolean(dailyHost) && roomUrl.hostname === dailyHost && /^\/flb-[a-f0-9]{32}$/i.test(roomUrl.pathname);

    if (roomUrl.protocol !== 'https:' || (!isJitsiRoom && !isDailyRoom)) {
        return jsonError('The meeting link is not a valid Family Land Board room.', 400);
    }

    const message = `${title}\nJoin the meeting: ${roomUrl.toString()}`;

    if (type === 'email') {
        if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
            return jsonError('Enter a valid email address.', 400);
        }

        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.RESEND_FROM_EMAIL;
        if (!apiKey || !from) {
            return jsonError('Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the server.', 503);
        }

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from,
                to: [recipient],
                subject: `Invitation: ${title}`,
                text: `You are invited to a Family Land Board meeting.\n\n${message}`
            })
        });

        if (!response.ok) {
            return jsonError('The email provider rejected the invite. Check the Resend sender/domain setup and try again.', 502);
        }

        return NextResponse.json({ sent: true, type, recipient });
    }

    if (type === 'sms') {
        const normalizedRecipient = recipient.replace(/[\s().-]/g, '');
        const phone = /^\d{10}$/.test(normalizedRecipient)
            ? `+1${normalizedRecipient}`
            : /^1\d{10}$/.test(normalizedRecipient)
                ? `+${normalizedRecipient}`
                : normalizedRecipient;
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
            return jsonError('Enter a phone number in international format, such as +15551234567.', 400);
        }

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_PHONE_NUMBER;
        if (!accountSid || !authToken || !from) {
            return jsonError('Text delivery is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER on the server.', 503);
        }

        const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
        const form = new URLSearchParams({ To: phone, From: from, Body: message });
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: form
        });

        if (!response.ok) {
            return jsonError('The text provider rejected the invite. Check the Twilio number, account, and recipient permissions.', 502);
        }

        return NextResponse.json({ sent: true, type, recipient: phone });
    }

    return jsonError('Choose email or text for this invite.', 400);
}