'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

const getSupabaseConfig = () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const urlLooksUnset = !url || /your[_\s-]*supabase/i.test(url);
    const keyLooksUnset = !anonKey || /your[_\s-]*supabase/i.test(anonKey);

    if (urlLooksUnset || keyLooksUnset) {
        throw new Error(
            'Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) in environment variables.'
        );
    }

    return { url, anonKey };
};

export const supabaseClient = () => {
    if (browserClient) return browserClient;

    const { url, anonKey } = getSupabaseConfig();

    // Implicit flow embeds the session tokens in the email link itself, so recovery/confirm
    // links work even when opened on a different device/browser than where they were requested
    // (PKCE would fail there since its code verifier only exists in the requesting browser).
    browserClient = createClient(url, anonKey, {
        auth: {
            flowType: 'implicit'
        }
    });

    return browserClient;
};
