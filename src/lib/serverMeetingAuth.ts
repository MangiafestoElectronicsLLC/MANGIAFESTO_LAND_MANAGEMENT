import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

type MeetingAuthResult =
    | { supabase: SupabaseClient; user: User; error?: never }
    | { supabase?: never; user?: never; error: NextResponse };

export async function getMeetingAuth(request: Request): Promise<MeetingAuthResult> {
    const accessToken = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!accessToken || !supabaseUrl || !supabaseKey) {
        return { error: NextResponse.json({ error: 'Sign in again before managing this meeting.' }, { status: 401 }) };
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);
    if (error || !user) {
        return { error: NextResponse.json({ error: 'Your sign-in session could not be verified.' }, { status: 401 }) };
    }

    return { supabase, user };
}