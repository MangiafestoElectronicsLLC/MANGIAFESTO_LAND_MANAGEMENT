'use client';

import { supabaseClient } from '@/lib/supabaseClient';
import type { Ticket } from '@/app/dashboard/page';

type Props = {
    tickets: Ticket[];
    onChanged: () => void;
};

export default function TicketList({ tickets, onChanged }: Props) {
    const supabase = supabaseClient();

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

    if (!tickets.length) return <div>No tickets yet.</div>;

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
                                gap: '0.5rem'
                            }}
                        >
                            <div>
                                <div style={{ fontWeight: 600 }}>{t.title}</div>
                                <div
                                    style={{
                                        fontSize: '0.85rem',
                                        opacity: 0.8,
                                        whiteSpace: 'pre-wrap'
                                    }}
                                >
                                    {t.description}
                                </div>
                                <div
                                    style={{
                                        marginTop: '0.25rem',
                                        fontSize: '0.75rem',
                                        opacity: 0.7
                                    }}
                                >
                                    Status: {t.status} • Priority: {t.priority}
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
                ))}
            </div>
        </div>
    );
}
