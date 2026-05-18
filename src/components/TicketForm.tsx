'use client';

import { FormEvent, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import type { Role } from '@/app/dashboard/page';

type Props = {
    roles: Role[];
    onCreated: () => void;
};

export default function TicketForm({ roles, onCreated }: Props) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [roleId, setRoleId] = useState<string | ''>('');
    const [priority, setPriority] = useState('normal');
    const [loading, setLoading] = useState(false);

    const supabase = supabaseClient();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const {
            data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
            setLoading(false);
            return;
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        const { data, error } = await supabase
            .from('tickets')
            .insert({
                title,
                description,
                role_id: roleId || null,
                priority,
                created_by: profile?.id
            })
            .select()
            .single();

        if (!error && data) {
            await supabase.from('ticket_history').insert({
                ticket_id: data.id,
                action: 'created',
                performed_by: profile?.id
            });
        }

        setTitle('');
        setDescription('');
        setRoleId('');
        setPriority('normal');
        setLoading(false);
        onCreated();
    };

    return (
        <div
            style={{
                border: '1px solid #1f2937',
                borderRadius: 8,
                padding: '1rem',
                background: '#020617'
            }}
        >
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Create ticket</h3>
            <form
                onSubmit={handleSubmit}
                style={{ display: 'grid', gap: '0.75rem' }}
            >
                <input
                    placeholder="Title"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    required
                    style={{ padding: '0.5rem', borderRadius: 4 }}
                />
                <textarea
                    placeholder="Description"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={3}
                    style={{ padding: '0.5rem', borderRadius: 4 }}
                />
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <select
                        value={roleId}
                        onChange={e => setRoleId(e.target.value)}
                        style={{ padding: '0.5rem', borderRadius: 4 }}
                    >
                        <option value="">No specific role</option>
                        {roles.map(r => (
                            <option key={r.id} value={r.id}>
                                {r.name}
                            </option>
                        ))}
                    </select>
                    <select
                        value={priority}
                        onChange={e => setPriority(e.target.value)}
                        style={{ padding: '0.5rem', borderRadius: 4 }}
                    >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                    </select>
                </div>
                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        padding: '0.5rem',
                        borderRadius: 4,
                        background: '#3b82f6',
                        border: 'none',
                        cursor: 'pointer'
                    }}
                >
                    {loading ? 'Creating...' : 'Create ticket'}
                </button>
            </form>
        </div>
    );
}
