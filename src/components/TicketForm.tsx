'use client';

import { FormEvent, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { isUuid, type Role } from '@/lib/boardTypes';
import { isMissingTableSetupError } from '@/lib/supabaseErrors';

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

    const upsertProfileIfMissing = async (userId: string, userEmail: string | null) => {
        const { data: profileData } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', userId)
            .maybeSingle();

        if (profileData?.id) {
            return profileData.id;
        }

        await supabase.from('profiles').upsert({
            id: userId,
            full_name: userEmail,
            role_id: null
        });

        return userId;
    };

    const detectRoleId = (nextTitle: string, nextDescription: string) => {
        const text = `${nextTitle} ${nextDescription}`.toLowerCase();
        const groundsRole = roles.find(role => role.name.toLowerCase() === 'grounds')?.id || null;
        const technologyRole = roles.find(role => role.name.toLowerCase() === 'technology')?.id || null;
        const legalRole = roles.find(role => role.name.toLowerCase() === 'legal')?.id || null;

        if (/(trail|pond|brush|bushwhack|tree|land|ground|maint|maintenance|driveway|gate|mow|weed|snow)/.test(text)) {
            return groundsRole;
        }

        if (/(computer|wifi|internet|email|camera|login|password|website|server|tech|software|app|phone)/.test(text)) {
            return technologyRole;
        }

        if (/(contract|permit|law|legal|deed|easement|insurance|liability)/.test(text)) {
            return legalRole;
        }

        return null;
    };

    const humanizeDbError = (message: string) => {
        if (isMissingTableSetupError({ message }, ['tickets'])) {
            return 'Database setup is incomplete in this Supabase project. Run the SQL in SUPABASE_SETUP.md, then refresh.';
        }
        const lower = message.toLowerCase();
        if (lower.includes("could not find the table 'public.ticket_history'")) {
            return 'ticket_history table is missing. Run the SQL in SUPABASE_SETUP.md, then refresh.';
        }
        if (lower.includes("could not find the table 'public.roles'")) {
            return 'roles table is missing. Run the SQL in SUPABASE_SETUP.md, then refresh.';
        }
        return message;
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            const {
                data: { user }
            } = await supabase.auth.getUser();
            if (!user) {
                setError('Please sign in again.');
                return;
            }

            const profileId = await upsertProfileIfMissing(user.id, user.email || null);
            let uploadedImageUrl: string | null = null;

            if (file) {
                const extension = file.name.split('.').pop() || 'jpg';
                const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

                const { error: uploadError } = await supabase.storage
                    .from('ticket-images')
                    .upload(filePath, file, { upsert: false });

                if (uploadError) {
                    // Keep ticket creation working even if optional image storage is not configured yet.
                    setMessage('Image upload skipped. Create Supabase bucket "ticket-images" to enable attachments.');
                    uploadedImageUrl = null;
                } else {
                    const { data: publicData } = supabase.storage
                        .from('ticket-images')
                        .getPublicUrl(filePath);

                    uploadedImageUrl = publicData.publicUrl;
                }
            }

            const finalDescription = uploadedImageUrl
                ? `${description}\n\n[attachment] ${uploadedImageUrl}`
                : description;

            const detectedRoleId = detectRoleId(title, description);
            const safeRoleId = isUuid(roleId) ? roleId : isUuid(detectedRoleId) ? detectedRoleId : null;

            const { data, error } = await supabase
                .from('tickets')
                .insert({
                    title: title.trim() || 'Untitled ticket',
                    description: finalDescription,
                    role_id: safeRoleId,
                    priority,
                    created_by: profileId
                })
                .select()
                .single();

            if (error) {
                setError(humanizeDbError(error.message || 'Failed to create ticket.'));
                return;
            }

            if (data) {
                await supabase.from('ticket_history').insert({
                    ticket_id: data.id,
                    action: 'created',
                    performed_by: profileId
                });
            }

            setTitle('');
            setDescription('');
            setRoleId('');
            setPriority('normal');
            setFile(null);
            setMessage('Ticket created successfully.');
            onCreated();
        } catch (err: any) {
            setError(humanizeDbError(err?.message || 'Failed to create ticket.'));
        } finally {
            setLoading(false);
        }
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
                        style={{ padding: '0.5rem', borderRadius: 4, minWidth: 180, flex: '1 1 220px' }}
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
                        style={{ padding: '0.5rem', borderRadius: 4, minWidth: 120, flex: '0 0 140px' }}
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
