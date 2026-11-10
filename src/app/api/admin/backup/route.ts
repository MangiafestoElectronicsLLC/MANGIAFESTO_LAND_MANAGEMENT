import { NextResponse } from 'next/server';
import { BACKUP_TABLES, requireAdmin } from '@/lib/serverAdmin';

export const dynamic = 'force-dynamic';

// Full JSON snapshot of accounts (without passwords) and app tables.
export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const { service } = auth;

    const tables: Record<string, unknown[] | { error: string }> = {};
    for (const table of BACKUP_TABLES) {
        const rows: unknown[] = [];
        let failed: string | null = null;
        for (let from = 0; ; from += 1000) {
            const { data, error } = await service.from(table).select('*').range(from, from + 999);
            if (error) {
                failed = error.message;
                break;
            }
            rows.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        tables[table] = failed ? { error: failed } : rows;
    }

    const { data: userData } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const accounts = (userData?.users || []).map(u => ({
        id: u.id,
        email: u.email,
        confirmed: Boolean(u.email_confirmed_at),
        created_at: u.created_at,
        user_metadata: u.user_metadata
    }));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), accounts, tables }, null, 2), {
        headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="land-board-backup-${stamp}.json"`
        }
    });
}
