'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { supabaseClient } from '@/lib/supabaseClient';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthPage() {
    return (
        <Suspense
            fallback={
                <div className="panel panel-pad" style={{ maxWidth: 560, margin: '0 auto' }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Loading sign in...</div>
                    <div style={{ opacity: 0.78, fontSize: '0.95rem' }}>
                        Preparing the secure login view.
                    </div>
                </div>
            }
        >
            <AuthPageContent />
        </Suspense>
    );
}

function AuthPageContent() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [fallbackMode, setFallbackMode] = useState<'magic' | 'reset' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [sendingConfirm, setSendingConfirm] = useState(false);
    const [sendingFallback, setSendingFallback] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const router = useRouter();
    const searchParams = useSearchParams();
    const hasSupabaseConfig = Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const redirectTo = useMemo(() => {
        if (typeof window === 'undefined') {
            return '/auth/confirm';
        }

        return `${window.location.origin}/auth/confirm`;
    }, []);

    const humanizeAuthError = (message: string) => {
        const lower = message.toLowerCase();
        if (lower.includes('email not confirmed')) {
            return 'Your email is not confirmed yet. Check your inbox, then try again.';
        }
        if (lower.includes('invalid login credentials')) {
            return 'That email or password did not match. Check for spelling, caps lock, and extra spaces.';
        }
        if (lower.includes('missing supabase config')) {
            return 'This deployment is missing Supabase environment variables. Add the URL and anon key, then redeploy.';
        }
        if (lower.includes('invalid supabase')) {
            return 'This deployment is missing Supabase environment variables. Add the URL and anon key, then redeploy.';
        }
        if (lower.includes('email rate limit exceeded')) {
            return 'Too many emails were sent recently. Wait a few minutes, then try again.';
        }
        if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('fetch')) {
            return 'Could not reach the Supabase service. Check the project URL, anon key, and network connection.';
        }
        return message;
    };

    useEffect(() => {
        const handleAuthCallback = async () => {
            const code = searchParams.get('code');
            const tokenHash = searchParams.get('token_hash');
            const type = searchParams.get('type');

            if (!code && !tokenHash) {
                return;
            }

            try {
                const supabase = supabaseClient();

                if (code) {
                    await supabase.auth.exchangeCodeForSession(code);
                } else if (tokenHash && type) {
                    await supabase.auth.verifyOtp({
                        type: type as 'signup' | 'recovery' | 'email' | 'magiclink' | 'invite',
                        token_hash: tokenHash
                    });
                }

                const {
                    data: { user }
                } = await supabase.auth.getUser();

                if (user) {
                    router.replace('/dashboard');
                    return;
                }
            } catch (err: any) {
                setError(humanizeAuthError(err?.message ?? 'The sign-in link could not be completed.'));
            }
        };

        handleAuthCallback();
    }, [router, searchParams]);

    useEffect(() => {
        const restoreSession = async () => {
            try {
                const supabase = supabaseClient();
                const {
                    data: { user }
                } = await supabase.auth.getUser();

                if (user) {
                    router.replace('/dashboard');
                    return;
                }
            } catch {
                // Keep the form visible; the next submit will surface config problems.
            }

            setCheckingSession(false);
        };

        restoreSession();
    }, [router]);

    useEffect(() => {
        if (searchParams.get('info') === 'password-updated') {
            setInfo('Password updated. Sign in with your new password.');
        }
    }, [searchParams]);

    const sendFallbackEmail = async (kind: 'magic' | 'reset') => {
        const nextEmail = email.trim().toLowerCase();
        if (!nextEmail) {
            setError('Enter your email first.');
            return;
        }

        setSendingFallback(true);
        setError(null);
        setInfo(null);

        try {
            const supabase = supabaseClient();

            if (kind === 'magic') {
                const { error: magicError } = await supabase.auth.signInWithOtp({
                    email: nextEmail,
                    options: {
                        emailRedirectTo: `${redirectTo}?type=magic`
                    }
                });

                if (magicError) {
                    throw magicError;
                }

                setFallbackMode('magic');
                setInfo('Magic link sent. Open the email on your phone or computer, then you will be signed in automatically.');
                return;
            }

            const { error: resetError } = await supabase.auth.resetPasswordForEmail(nextEmail, {
                redirectTo: `${redirectTo}?type=recovery`
            });

            if (resetError) {
                throw resetError;
            }

            setFallbackMode('reset');
            setInfo('Password reset email sent. Open the link, choose a new password, then return to sign in.');
        } catch (err: any) {
            setError(humanizeAuthError(err?.message ?? 'Could not send the email.'));
        } finally {
            setSendingFallback(false);
        }
    };

    const handleResendConfirmation = async () => {
        if (!email.trim()) {
            setError('Enter your email first, then click resend.');
            return;
        }

        setSendingConfirm(true);
        setError(null);
        setInfo(null);

        try {
            const supabase = supabaseClient();
            const { error: resendError } = await supabase.auth.resend({
                type: 'signup',
                email: email.trim()
            });

            if (resendError) {
                setError(humanizeAuthError(resendError.message));
            } else {
                setInfo('Confirmation email sent. Check inbox/spam, click the link, then sign in.');
            }
        } catch (err: any) {
            setError(humanizeAuthError(err?.message ?? 'Could not send confirmation email.'));
        }

        setSendingConfirm(false);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setInfo(null);
        const nextEmail = email.trim().toLowerCase();

        try {
            const supabase = supabaseClient();

            if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({
                    email: nextEmail,
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

                // If email confirmation is enabled, session is usually null after signup.
                if (!data.session) {
                    setInfo('Account created. Check your email to confirm your account, then sign in.');
                    setMode('signin');
                    return;
                }
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email: nextEmail,
                    password
                });
                if (error) throw error;
            }

            router.replace('/dashboard');
        } catch (err: any) {
            setError(humanizeAuthError(err.message ?? 'Auth error'));
        }
    };

    if (checkingSession) {
        return (
            <div className="panel panel-pad" style={{ maxWidth: 560, margin: '0 auto' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>Opening your account...</div>
                <div style={{ opacity: 0.78, fontSize: '0.95rem' }}>
                    Checking whether you already have a saved session on this device.
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            {!hasSupabaseConfig && (
                <section className="panel panel-pad" style={{ display: 'grid', gap: '0.35rem', borderColor: '#7f1d1d' }}>
                    <div style={{ fontWeight: 700, color: '#fecaca' }}>Supabase setup is missing</div>
                    <div style={{ color: '#fecaca', lineHeight: 1.5 }}>
                        This deployment does not have the Supabase URL and anon key. Add them in Vercel environment variables, then redeploy.
                    </div>
                </section>
            )}

            <section className="panel panel-pad" style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Image src="/icon.svg" alt="Mangiafesto Electronics logo" width={64} height={64} priority />
                    <div style={{ display: 'grid', gap: '0.35rem' }}>
                        <div style={{ fontSize: '0.85rem', opacity: 0.82 }}>Mangiafesto Electronics</div>
                        <h2 style={{ margin: 0, fontSize: 'clamp(1.5rem, 4vw, 2.25rem)' }}>
                            {mode === 'signin' ? 'Sign in to continue' : 'Create an account'}
                        </h2>
                        <p style={{ margin: 0, opacity: 0.78, maxWidth: 56 * 8 }}>
                            Use the same email and password from your Supabase auth user. If password sign-in fails, try the magic-link or reset-password buttons below.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="auth-form" style={{ display: 'grid', gap: '0.85rem', maxWidth: 520 }}>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Email</span>
                        <input
                            type="email"
                            placeholder="name@example.com"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            autoComplete="email"
                            inputMode="email"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            required
                            style={{ padding: '0.85rem 0.95rem' }}
                        />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Password</span>
                        <input
                            type="password"
                            placeholder="Your account password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                            required
                            style={{ padding: '0.85rem 0.95rem' }}
                        />
                    </label>
                    {error && (
                        <div className="auth-message auth-error" style={{ color: '#fca5a5', fontSize: '0.92rem', lineHeight: 1.4 }}>
                            {error}
                        </div>
                    )}
                    {info && (
                        <div className="auth-message auth-info" style={{ color: '#86efac', fontSize: '0.92rem', lineHeight: 1.4 }}>
                            {info}
                        </div>
                    )}
                    {fallbackMode === 'magic' && (
                        <div style={{ color: '#bfdbfe', fontSize: '0.88rem', lineHeight: 1.4 }}>
                            If the email app opens on the same device, tap the link and you should land back in the board automatically.
                        </div>
                    )}
                    {fallbackMode === 'reset' && (
                        <div style={{ color: '#bfdbfe', fontSize: '0.88rem', lineHeight: 1.4 }}>
                            After choosing a new password, come back here and use normal sign-in.
                        </div>
                    )}
                    <button
                        type="submit"
                        style={{
                            padding: '0.85rem 1rem',
                            borderRadius: 14,
                            background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
                            border: 'none',
                            color: '#eff6ff',
                            fontWeight: 700,
                            cursor: 'pointer',
                            boxShadow: '0 12px 30px rgba(37, 99, 235, 0.28)'
                        }}
                    >
                        {mode === 'signin' ? 'Sign in' : 'Create account'}
                    </button>
                    {mode === 'signin' && (
                        <>
                            <button
                                type="button"
                                onClick={handleResendConfirmation}
                                disabled={sendingConfirm}
                                className="soft-button"
                                style={{ borderColor: '#60a5fa', color: '#bfdbfe' }}
                            >
                                {sendingConfirm ? 'Sending...' : 'Resend confirmation email'}
                            </button>
                            <button
                                type="button"
                                onClick={() => sendFallbackEmail('magic')}
                                disabled={sendingFallback}
                                className="soft-button"
                                style={{ borderColor: '#38bdf8', color: '#cffafe' }}
                            >
                                {sendingFallback && fallbackMode === 'magic' ? 'Sending...' : 'Send magic link'}
                            </button>
                            <button
                                type="button"
                                onClick={() => sendFallbackEmail('reset')}
                                disabled={sendingFallback}
                                className="soft-button"
                                style={{ borderColor: '#34d399', color: '#dcfce7' }}
                            >
                                {sendingFallback && fallbackMode === 'reset' ? 'Sending...' : 'Reset password email'}
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => setMode(prev => (prev === 'signin' ? 'signup' : 'signin'))}
                        className="soft-button"
                        style={{ borderColor: '#475569', color: '#e2e8f0' }}
                    >
                        {mode === 'signin' ? 'Need to create an account?' : 'I already have an account'}
                    </button>
                </form>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{ fontWeight: 700 }}>Login help</div>
                <div style={{ fontSize: '0.92rem', opacity: 0.82, lineHeight: 1.5 }}>
                    If sign-in still fails, the most common causes are a missing Supabase env file, an unconfirmed email, a password typo, a stale session on the device, or a network issue reaching Supabase. Magic-link and reset-email fallback buttons are available.
                </div>
                <div style={{ fontSize: '0.9rem', opacity: 0.78, lineHeight: 1.5 }}>
                    On a phone, enter your email once, then use the fallback button that fits your situation. The email link will return you to the app automatically.
                </div>
                <div style={{ fontSize: '0.9rem', opacity: 0.78 }}>
                    After signup, a Chairman can set your role in Supabase under the profiles table.
                </div>
            </section>
        </div>
    );
}
