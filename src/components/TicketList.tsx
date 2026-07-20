'use client';

import { useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import type { Role, Ticket, TicketHistoryEvent } from '@/lib/boardTypes';
import { getTicketNumber } from '@/lib/ticketNumber';

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
    const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
    const [draftTitle, setDraftTitle] = useState('');
    const [draftDescription, setDraftDescription] = useState('');
    const [draftPriority, setDraftPriority] = useState('normal');
    const [draftRoleId, setDraftRoleId] = useState<string>('');
    const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
    const [historyByTicket, setHistoryByTicket] = useState<Record<string, TicketHistoryEvent[]>>({});
    const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);

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

    const startEdit = (ticket: Ticket) => {
        setEditingTicketId(ticket.id);
        setDraftTitle(ticket.title);
        setDraftDescription(ticket.description || '');
        setDraftPriority(ticket.priority || 'normal');
        setDraftRoleId(ticket.role_id || '');
    };

    const cancelEdit = () => {
        setEditingTicketId(null);
        setDraftTitle('');
        setDraftDescription('');
        setDraftPriority('normal');
        setDraftRoleId('');
    };

    const saveEdit = async (ticket: Ticket) => {
        const {
            data: { user }
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        const { error } = await supabase
            .from('tickets')
            .update({
                title: draftTitle.trim() || ticket.title,
                description: draftDescription,
                priority: draftPriority,
                role_id: draftRoleId || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', ticket.id);

        if (error) return;

        await supabase.from('ticket_history').insert({
            ticket_id: ticket.id,
            action: 'updated',
            performed_by: profile?.id,
            from_status: ticket.status,
            to_status: ticket.status
        });

        cancelEdit();
        onChanged();
    };

    const loadHistory = async (ticketId: string) => {
        setHistoryLoadingId(ticketId);
        const { data } = await supabase
            .from('ticket_history')
            .select('id, ticket_id, action, performed_by, from_status, to_status, created_at')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: false })
            .limit(25);

        setHistoryByTicket(prev => ({
            ...prev,
            [ticketId]: (data || []) as TicketHistoryEvent[]
        }));
        setHistoryLoadingId(null);
    };

    const toggleHistory = async (ticketId: string) => {
        const open = !historyOpen[ticketId];
        setHistoryOpen(prev => ({ ...prev, [ticketId]: open }));
        if (open && !historyByTicket[ticketId]) {
            await loadHistory(ticketId);
        }
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
                        const ticketNumber = getTicketNumber(t);

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
                                        {editingTicketId === t.id ? (
                                            <div style={{ display: 'grid', gap: '0.45rem' }}>
                                                <input
                                                    value={draftTitle}
                                                    onChange={e => setDraftTitle(e.target.value)}
                                                    style={{ padding: '0.35rem', borderRadius: 4 }}
                                                />
                                                <textarea
                                                    value={draftDescription}
                                                    onChange={e => setDraftDescription(e.target.value)}
                                                    rows={3}
                                                    style={{ padding: '0.35rem', borderRadius: 4 }}
                                                />
                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <select
                                                        value={draftRoleId}
                                                        onChange={e => setDraftRoleId(e.target.value)}
                                                        style={{ padding: '0.35rem', borderRadius: 4 }}
                                                    >
                                                        <option value="">No role</option>
                                                        {roles.map(r => (
                                                            <option key={r.id} value={r.id}>
                                                                {r.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        value={draftPriority}
                                                        onChange={e => setDraftPriority(e.target.value)}
                                                        style={{ padding: '0.35rem', borderRadius: 4 }}
                                                    >
                                                        <option value="low">Low</option>
                                                        <option value="normal">Normal</option>
                                                        <option value="high">High</option>
                                                    </select>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={() => saveEdit(t)}
                                                        style={{
                                                            padding: '0.25rem 0.5rem',
                                                            borderRadius: 4,
                                                            border: '1px solid #34d399',
                                                            background: 'transparent',
                                                            color: '#34d399',
                                                            cursor: 'pointer',
                                                            fontSize: '0.75rem'
                                                        }}
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={cancelEdit}
                                                        style={{
                                                            padding: '0.25rem 0.5rem',
                                                            borderRadius: 4,
                                                            border: '1px solid #64748b',
                                                            background: 'transparent',
                                                            color: '#cbd5e1',
                                                            cursor: 'pointer',
                                                            fontSize: '0.75rem'
                                                        }}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div
                                                    style={{
                                                        width: 'fit-content',
                                                        marginBottom: '0.3rem',
                                                        fontSize: '0.69rem',
                                                        padding: '0.18rem 0.42rem',
                                                        borderRadius: 999,
                                                        border: '1px solid #60a5fa',
                                                        color: '#bfdbfe',
                                                        background: 'rgba(30, 64, 175, 0.35)'
                                                    }}
                                                >
                                                    {ticketNumber}
                                                </div>
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
                                            </>
                                        )}

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

                                        <div style={{ marginTop: '0.45rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                            <button
                                                onClick={() => startEdit(t)}
                                                style={{
                                                    padding: '0.25rem 0.5rem',
                                                    borderRadius: 4,
                                                    border: '1px solid #38bdf8',
                                                    background: 'transparent',
                                                    color: '#7dd3fc',
                                                    cursor: 'pointer',
                                                    fontSize: '0.75rem'
                                                }}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => toggleHistory(t.id)}
                                                style={{
                                                    padding: '0.25rem 0.5rem',
                                                    borderRadius: 4,
                                                    border: '1px solid #64748b',
                                                    background: 'transparent',
                                                    color: '#cbd5e1',
                                                    cursor: 'pointer',
                                                    fontSize: '0.75rem'
                                                }}
                                            >
                                                {historyOpen[t.id] ? 'Hide History' : 'View History'}
                                            </button>
                                        </div>

                                        {historyOpen[t.id] && (
                                            <div
                                                style={{
                                                    marginTop: '0.45rem',
                                                    border: '1px solid #1e293b',
                                                    borderRadius: 6,
                                                    padding: '0.45rem',
                                                    display: 'grid',
                                                    gap: '0.35rem'
                                                }}
                                            >
                                                <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Ticket History</div>
                                                {historyLoadingId === t.id && (
                                                    <div style={{ fontSize: '0.74rem', opacity: 0.8 }}>Loading history...</div>
                                                )}
                                                {(historyByTicket[t.id] || []).map(event => (
                                                    <div key={event.id} style={{ fontSize: '0.72rem', opacity: 0.86 }}>
                                                        <div>{event.action}</div>
                                                        <div>{new Date(event.created_at).toLocaleString()}</div>
                                                        {(event.from_status || event.to_status) && (
                                                            <div>{event.from_status || 'n/a'} → {event.to_status || 'n/a'}</div>
                                                        )}
                                                    </div>
                                                ))}
                                                {historyByTicket[t.id] && historyByTicket[t.id].length === 0 && (
                                                    <div style={{ fontSize: '0.74rem', opacity: 0.8 }}>No history yet.</div>
                                                )}
                                            </div>
                                        )}
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
