'use client';

import { FormEvent, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function AuthPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        const supabase = supabaseClient();

        try {
            if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password
                });
                if (error) throw error;

                // Create profile row
                if (data.user) {
                    await supabase.from('profiles').insert({
                        id: data.user.id,
                        full_name: email,
                        role_id: null
                    });
                }
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });
                if (error) throw error;
            }

            router.push('/dashboard');
        } catch (err: any) {
            setError(err.message ?? 'Auth error');
        }
    };

    return (
        <div style={{ maxWidth: 400 }}>
            <h2>{mode === 'signin' ? 'Sign in' : 'Sign up'}</h2>
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    style={{ padding: '0.5rem', borderRadius: 4 }}
                />
                <input
                    type="password"
                    placeholder="Password (min 6 chars)"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    style={{ padding: '0.5rem', borderRadius: 4 }}
                />
                {error && (
                    <div style={{ color: '#f97373', fontSize: '0.85rem' }}>{error}</div>
                )}
                <button
                    type="submit"
                    style={{
                        padding: '0.5rem',
                        borderRadius: 4,
                        background: '#22c55e',
                        border: 'none',
                        cursor: 'pointer'
                    }}
                >
                    {mode === 'signin' ? 'Sign in' : 'Sign up'}
                </button>
            </form>
            <button
                onClick={() =>
                    setMode(prev => (prev === 'signin' ? 'signup' : 'signin'))
                }
                style={{
                    marginTop: '0.75rem',
                    fontSize: '0.85rem',
                    background: 'transparent',
                    color: '#93c5fd',
                    border: 'none',
                    cursor: 'pointer'
                }}
            >
                {mode === 'signin'
                    ? "Don't have an account? Sign up"
                    : 'Already have an account? Sign in'}
            </button>
            <p style={{ marginTop: '1rem', fontSize: '0.8rem', opacity: 0.8 }}>
                After signup, an admin (Chairman) should set your role in Supabase
                &gt; Table Editor &gt; profiles.
            </p>
        </div>
    );
}
