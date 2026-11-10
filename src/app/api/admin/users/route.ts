import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/serverAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const { data, error } = await auth.service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        users: data.users.map(u => ({
            id: u.id,
            email: u.email,
            confirmed: Boolean(u.email_confirmed_at),
            createdAt: u.created_at,
            lastSignInAt: u.last_sign_in_at
        }))
    });
}

type Action = 'create' | 'confirm' | 'set-password' | 'delete';

export async function POST(request: Request) {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const action = body.action as Action;
    const { service } = auth;

    if (action === 'create') {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!email || password.length < 6) {
            return NextResponse.json({ error: 'Email and a password of at least 6 characters are required.' }, { status: 400 });
        }
        const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user) return NextResponse.json({ error: error?.message || 'Could not create user.' }, { status: 400 });
        await service.from('profiles').upsert({ id: data.user.id, full_name: email }, { onConflict: 'id', ignoreDuplicates: true });
        return NextResponse.json({ ok: true });
    }

    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'Missing user id.' }, { status: 400 });

    if (action === 'confirm') {
        const { error } = await service.auth.admin.updateUserById(id, { email_confirm: true });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
    }

    if (action === 'set-password') {
        const password = String(body.password || '');
        if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
        const { error } = await service.auth.admin.updateUserById(id, { password, email_confirm: true });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
    }

    if (action === 'delete') {
        if (id === auth.user.id) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
        const { error } = await service.auth.admin.deleteUser(id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
