import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/serverAdmin';

export const dynamic = 'force-dynamic';

// Creates a pre-confirmed account so sign-up never depends on email delivery.
export async function POST(request: Request) {
    const service = getServiceClient();
    if (!service) {
        return NextResponse.json({ error: 'not-configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
        const message = error?.message || '';
        const exists = /already|registered|exists/i.test(message);
        const badKey = /invalid api key|jwt|unauthorized|not allowed/i.test(message);
        return NextResponse.json(
            {
                error: exists
                    ? 'That email already has an account. Sign in, or ask an admin to set your password.'
                    : badKey
                      ? 'SUPABASE_SERVICE_ROLE_KEY on the server is wrong. Paste the service_role secret key from Supabase, then redeploy.'
                      : message || 'Could not create account.'
            },
            { status: exists ? 409 : 400 }
        );
    }

    await service.from('profiles').upsert({ id: data.user.id, full_name: email }, { onConflict: 'id', ignoreDuplicates: true });
    return NextResponse.json({ ok: true });
}
