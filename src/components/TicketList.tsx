'use client';

import { supabaseClient } from '@/lib/supabaseClient';
import type { Role, Ticket } from '@/app/dashboard/page';

type Props = {
    tickets: Ticket[];
    roles: Role[];
    onChanged: () => void;
};

const extractAttachment = (description: string | null) => {
    const raw = description || '';
    const match = raw.match(/\[attachment\]\s+(https?:\/\/\S+)/i);
    const url = match?.[1] || null;
    const cleanText = raw.replace(/\[attachment\]\s+https?:\/\/\S+/i, '').trim();
    return { url, cleanText };
};

export default function TicketList({ tickets, roles, onChanged }: Props) {
    const supabase = supabaseClient();

    const roleNameMap = new Map(roles.map(r => [r.id, r.name]));

    const updateStatus = async (ticket: Ticket, status: string) => {
        const {
            data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        await supabase
            .from('tickets')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', ticket.id);

        await supabase.from('ticket_history').insert({
            ticket_id: ticket.id,
            action: 'status_changed',
            performed_by: profile?.id,
            from_status: ticket.status,
            to_status: status
        });

        onChanged();
    };

    if (!tickets.length) {
        return (
            <div
                style={{
                    border: '1px solid #1f2937',
                    borderRadius: 8,
                    padding: '1rem',
                    background: '#020617'
                }}
            >
                No tickets found in this view.
            </div>
        );
    }

    return (
        <div
            style={{
                border: '1px solid #1f2937',
                borderRadius: 8,
                padding: '1rem',
                background: '#020617'
            }}
        >
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Tickets</h3>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
                {tickets.map(t => (
                    (() => {
                        const attachment = extractAttachment(t.description);

                        return (
                            <div
                                key={t.id}
                                style={{
                                    borderRadius: 6,
                                    padding: '0.75rem',
                                    background: '#020617',
                                    border: '1px solid #111827'
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        gap: '0.75rem',
                                        alignItems: 'flex-start'
                                    }}
                                >
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600 }}>{t.title}</div>
                                        <div
                                            style={{
                                                fontSize: '0.85rem',
                                                opacity: 0.8,
                                                whiteSpace: 'pre-wrap'
                                            }}
                                        >
                                            {attachment.cleanText || 'No description'}
                                        </div>

                                        {attachment.url && (
                                            <div style={{ marginTop: '0.6rem' }}>
                                                <a
                                                    href={attachment.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    style={{ color: '#93c5fd', fontSize: '0.8rem' }}
                                                >
                                                    Open attached image
                                                </a>
                                                <div style={{ marginTop: '0.4rem' }}>
                                                    <img
                                                        src={attachment.url}
                                                        alt="Ticket attachment"
                                                        style={{
                                                            width: 'min(320px, 100%)',
                                                            borderRadius: 8,
                                                            border: '1px solid #334155'
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        <div
                                            style={{
                                                marginTop: '0.4rem',
                                                fontSize: '0.75rem',
                                                opacity: 0.78,
                                                display: 'grid',
                                                gap: '0.15rem'
                                            }}
                                        >
                                            <div>
                                                Status: {t.status} • Priority: {t.priority}
                                            </div>
                                            <div>
                                                Role: {t.role_id ? roleNameMap.get(t.role_id) || 'Unknown role' : 'No role'}
                                            </div>
                                            <div>
                                                Created: {new Date(t.created_at).toLocaleString()} • Updated: {new Date(t.updated_at).toLocaleString()}
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.25rem'
                                        }}
                                    >
                                        <button
                                            onClick={() => updateStatus(t, 'open')}
                                            style={{
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: 4,
                                                border: '1px solid #6b7280',
                                                background: 'transparent',
                                                color: '#e5e7eb',
                                                cursor: 'pointer',
                                                fontSize: '0.75rem'
                                            }}
                                        >
                                            Open
                                        </button>
                                        <button
                                            onClick={() => updateStatus(t, 'in_progress')}
                                            style={{
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: 4,
                                                border: '1px solid #facc15',
                                                background: 'transparent',
                                                color: '#facc15',
                                                cursor: 'pointer',
                                                fontSize: '0.75rem'
                                            }}
                                        >
                                            In progress
                                        </button>
                                        <button
                                            onClick={() => updateStatus(t, 'closed')}
                                            style={{
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: 4,
                                                border: '1px solid #22c55e',
                                                background: 'transparent',
                                                color: '#22c55e',
                                                cursor: 'pointer',
                                                fontSize: '0.75rem'
                                            }}
                                        >
                                            Closed
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()
                ))}
            </div>
        </div>
    );
}
