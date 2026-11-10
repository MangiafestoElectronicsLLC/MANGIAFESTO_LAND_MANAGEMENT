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
        const exists = /already|registered|exists/i.test(error?.message || '');
        return NextResponse.json(
            { error: exists ? 'That email already has an account. Sign in or reset your password.' : error?.message || 'Could not create account.' },
            { status: exists ? 409 : 400 }
        );
    }

    await service.from('profiles').upsert({ id: data.user.id, full_name: email }, { onConflict: 'id', ignoreDuplicates: true });
    return NextResponse.json({ ok: true });
}
