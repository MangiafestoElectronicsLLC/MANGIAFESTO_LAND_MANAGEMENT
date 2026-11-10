'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';

type AdminUser = { id: string; email: string; confirmed: boolean; createdAt: string; lastSignInAt: string | null };

export default function AdminPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const call = useCallback(async (path: string, init?: RequestInit) => {
        const { data } = await supabaseClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
            return new Response(JSON.stringify({ error: 'You are not signed in. Go to the home page, create an account or sign in, then return here.' }), {
                status: 401
            });
        }
        return fetch(path, {
            ...init,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
        });
    }, []);

    const load = useCallback(async () => {
        const res = await call('/api/admin/users');
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            setError(payload.error || 'Could not load accounts.');
            return;
        }
        setError(null);
        setUsers(payload.users);
    }, [call]);

    useEffect(() => {
        load();
    }, [load]);

    const act = async (body: Record<string, string>, success: string) => {
        setMessage(null);
        setError(null);
        const res = await call('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            setError(payload.error || 'Action failed.');
            return;
        }
        setMessage(success);
        load();
    };

    const downloadBackup = async () => {
        setError(null);
        const res = await call('/api/admin/backup');
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            setError(payload.error || 'Backup failed.');
            return;
        }
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `land-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        setMessage('Backup downloaded. Keep it somewhere safe.');
    };

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem' }}>
                <h2 style={{ margin: 0 }}>Admin: accounts and backup</h2>
                {error && <div style={{ color: '#fca5a5' }}>{error}</div>}
                {message && <div style={{ color: '#86efac' }}>{message}</div>}
                <div>
                    <button type="button" className="soft-button" onClick={downloadBackup}>
                        Download full backup (accounts + data)
                    </button>
                </div>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem', maxWidth: 520 }}>
                <h3 style={{ margin: 0 }}>Create account (no email needed)</h3>
                <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                <input type="text" placeholder="Password (6+ characters)" value={password} onChange={e => setPassword(e.target.value)} />
                <button
                    type="button"
                    className="soft-button"
                    onClick={async () => {
                        await act({ action: 'create', email, password }, 'Account created.');
                        setEmail('');
                        setPassword('');
                    }}
                >
                    Create account
                </button>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>Accounts ({users.length})</h3>
                {users.map(u => (
                    <div key={u.id} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ minWidth: 240 }}>{u.email}</span>
                        <span style={{ opacity: 0.7 }}>{u.confirmed ? 'confirmed' : 'unconfirmed'}</span>
                        {!u.confirmed && (
                            <button type="button" className="soft-button" onClick={() => act({ action: 'confirm', id: u.id }, 'Account confirmed.')}>
                                Confirm
                            </button>
                        )}
                        <button
                            type="button"
                            className="soft-button"
                            onClick={() => {
                                const next = window.prompt(`New password for ${u.email} (6+ characters):`);
                                if (next) act({ action: 'set-password', id: u.id, password: next }, 'Password updated.');
                            }}
                        >
                            Set password
                        </button>
                        <button
                            type="button"
                            className="soft-button"
                            onClick={() => {
                                if (window.confirm(`Delete ${u.email}? This cannot be undone.`)) {
                                    act({ action: 'delete', id: u.id }, 'Account deleted.');
                                }
                            }}
                        >
                            Delete
                        </button>
                    </div>
                ))}
            </section>
        </div>
    );
}
