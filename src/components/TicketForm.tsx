'use client';

import { FormEvent, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import type { Role } from '@/lib/boardTypes';

type Props = {
    roles: Role[];
    onCreated: () => void;
};

export default function TicketForm({ roles, onCreated }: Props) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [roleId, setRoleId] = useState<string | ''>('');
    const [priority, setPriority] = useState('normal');
    const [file, setFile] = useState<File | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const supabase = supabaseClient();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        const {
            data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
            setError('Please sign in again.');
            setLoading(false);
            return;
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        let uploadedImageUrl: string | null = null;

        if (file) {
            const extension = file.name.split('.').pop() || 'jpg';
            const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

            const { error: uploadError } = await supabase.storage
                .from('ticket-images')
                .upload(filePath, file, { upsert: false });

            if (uploadError) {
                setError('Image upload failed. Create a Supabase Storage bucket named ticket-images, then try again.');
                setLoading(false);
                return;
            }

            const { data: publicData } = supabase.storage
                .from('ticket-images')
                .getPublicUrl(filePath);

            uploadedImageUrl = publicData.publicUrl;
        }

        const finalDescription = uploadedImageUrl
            ? `${description}\n\n[attachment] ${uploadedImageUrl}`
            : description;

        const { data, error } = await supabase
            .from('tickets')
            .insert({
                title,
                description: finalDescription,
                role_id: roleId || null,
                priority,
                created_by: profile?.id
            })
            .select()
            .single();

        if (error) {
            setError(error.message || 'Failed to create ticket.');
            setLoading(false);
            return;
        }

        if (data) {
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
        setFile(null);
        setMessage('Ticket created successfully.');
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
                <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', opacity: 0.8 }}>
                        Optional photo attachment (phone or PC)
                    </label>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={e => setFile(e.target.files?.[0] || null)}
                        style={{ padding: '0.35rem', borderRadius: 4 }}
                    />
                    {file && (
                        <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', opacity: 0.8 }}>
                            Selected: {file.name}
                        </div>
                    )}
                </div>
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
                {error && <div style={{ color: '#fca5a5', fontSize: '0.8rem' }}>{error}</div>}
                {message && <div style={{ color: '#86efac', fontSize: '0.8rem' }}>{message}</div>}
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
