import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const BACKUP_TABLES = [
    'profiles',
    'roles',
    'tickets',
    'ticket_history',
    'land_wifi_networks',
    'board_meetings',
    'board_meeting_notes',
    'board_meeting_invitees',
    'property_maps',
    'property_map_features',
    'property_map_access_requests'
];

export const adminEmails = () =>
    (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);

export function getServiceClient(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const missingServiceKey = () =>
    NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not set on the server. Add it to the environment variables and redeploy.' },
        { status: 503 }
    );

// Verifies the bearer token belongs to an email listed in ADMIN_EMAILS.
export async function requireAdmin(request: Request) {
    const service = getServiceClient();
    if (!service) return { error: missingServiceKey() };

    const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) };

    const { data, error } = await service.auth.getUser(token);
    const email = data.user?.email?.toLowerCase();
    if (error || !data.user || !email) {
        return { error: NextResponse.json({ error: 'Your session could not be verified.' }, { status: 401 }) };
    }
    if (!adminEmails().includes(email)) {
        return { error: NextResponse.json({ error: 'Admin access only. Add your email to ADMIN_EMAILS.' }, { status: 403 }) };
    }
    return { service, user: data.user };
}
