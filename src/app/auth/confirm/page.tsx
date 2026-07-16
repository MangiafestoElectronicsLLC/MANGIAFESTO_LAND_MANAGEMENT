'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';

export default function AuthConfirmPage() {
    return (
        <Suspense
            fallback={
                <div className="panel panel-pad" style={{ display: 'grid', gap: '0.5rem', maxWidth: 620 }}>
                    <div style={{ fontWeight: 700 }}>Loading confirmation...</div>
                    <div style={{ opacity: 0.78 }}>Preparing the secure email confirmation flow.</div>
                </div>
            }
        >
            <AuthConfirmPageContent />
        </Suspense>
    );
}

function AuthConfirmPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);

    const isRecovery = searchParams.get('type') === 'recovery' || searchParams.get('mode') === 'recovery';

    useEffect(() => {
        const load = async () => {
            try {
                const supabase = supabaseClient();
                const {
                    data: { user }
                } = await supabase.auth.getUser();

                if (user && !isRecovery) {
                    router.replace('/dashboard');
                    return;
                }

                if (isRecovery) {
                    setInfo('Pick a new password to finish the reset.');
                } else if (!user) {
                    setError('No active session was found. The link may have expired.');
                }
            } catch (err: any) {
                setError(err?.message || 'Could not complete sign-in.');
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [isRecovery, router]);

    const handlePasswordUpdate = async () => {
        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const supabase = supabaseClient();
            const { error: updateError } = await supabase.auth.updateUser({
                password
            });

            if (updateError) {
                throw updateError;
            }

            await supabase.auth.signOut();
            router.replace('/?info=password-updated');
        } catch (err: any) {
            setError(err?.message || 'Could not update password.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="panel panel-pad" style={{ display: 'grid', gap: '0.5rem', maxWidth: 620 }}>
                <div style={{ fontWeight: 700 }}>Completing sign-in...</div>
                <div style={{ opacity: 0.78 }}>Finishing the secure handoff from your email link.</div>
            </div>
        );
    }

    return (
        <div className="panel panel-pad" style={{ display: 'grid', gap: '1rem', maxWidth: 620 }}>
            <div style={{ display: 'grid', gap: '0.25rem' }}>
                <div style={{ fontSize: '0.85rem', opacity: 0.78 }}>Family Land Board</div>
                <h2 style={{ margin: 0 }}>{isRecovery ? 'Reset your password' : 'Sign-in complete'}</h2>
            </div>

            {isRecovery ? (
                <>
                    <div style={{ opacity: 0.8, lineHeight: 1.5 }}>
                        Enter a new password for your account. After saving, return to the sign-in page and use the new password.
                    </div>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>New password</span>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="New password"
                            style={{ padding: '0.85rem 0.95rem' }}
                        />
                    </label>
                    {error && <div style={{ color: '#fca5a5' }}>{error}</div>}
                    {info && <div style={{ color: '#86efac' }}>{info}</div>}
                    <button
                        type="button"
                        onClick={handlePasswordUpdate}
                        disabled={saving}
                        className="soft-button"
                        style={{ borderColor: '#38bdf8', color: '#dbeafe' }}
                    >
                        {saving ? 'Saving...' : 'Save new password'}
                    </button>
                </>
            ) : (
                <>
                    <div style={{ opacity: 0.8, lineHeight: 1.5 }}>
                        Your email link has been accepted. Continue to the dashboard now.
                    </div>
                    {error && <div style={{ color: '#fca5a5' }}>{error}</div>}
                    <Link href="/dashboard" className="soft-button" style={{ textDecoration: 'none', borderColor: '#38bdf8', color: '#dbeafe' }}>
                        Open dashboard
                    </Link>
                </>
            )}
        </div>
    );
}