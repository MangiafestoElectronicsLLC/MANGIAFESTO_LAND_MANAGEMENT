import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/serverAdmin';
import { parseRadioId } from '@/lib/meshRadioAssignments';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || !('userId' in body) || typeof body.userId !== 'string' ||
        !('radioId' in body) || (body.radioId !== null && typeof body.radioId !== 'string')) {
        return NextResponse.json({ error: 'Choose an account and a full radio ID.' }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.userId)) {
        return NextResponse.json({ error: 'Invalid account ID.' }, { status: 400 });
    }
    if (body.radioId === null) {
        const { error } = await auth.service.from('meshtastic_radio_assignments').delete().eq('user_id', body.userId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }
    const nodeNum = parseRadioId(body.radioId);
    if (nodeNum === null) return NextResponse.json({ error: 'Enter the complete eight-digit node ID, for example !abcd497c.' }, { status: 400 });
    const { error } = await auth.service.from('meshtastic_radio_assignments').upsert(
        { user_id: body.userId, node_num: nodeNum, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
    );
    if (error) {
        return NextResponse.json({ error: error.code === '23505' ? 'That radio is already assigned to another account. Remove that assignment first.' : error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
}
