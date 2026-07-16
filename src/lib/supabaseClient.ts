'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

const getSupabaseConfig = () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const urlLooksUnset = !url || /your[_\s-]*supabase/i.test(url);
    const keyLooksUnset = !anonKey || /your[_\s-]*supabase/i.test(anonKey);

    if (urlLooksUnset || keyLooksUnset) {
        throw new Error(
            'Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.'
        );
    }

    return { url, anonKey };
};

export const supabaseClient = () => {
    if (browserClient) return browserClient;

    const { url, anonKey } = getSupabaseConfig();

    browserClient = createClient(url, anonKey);

    return browserClient;
};
