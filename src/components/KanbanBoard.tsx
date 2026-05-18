'use client';

import { useMemo, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import type { Role, Ticket, TicketStatus } from '@/lib/boardTypes';

type Props = {
    tickets: Ticket[];
    roles: Role[];
    onChanged: () => void;
};

const COLUMNS: Array<{ key: TicketStatus; label: string; border: string; bg: string }> = [
    { key: 'open', label: 'Open', border: '#60a5fa', bg: '#0b2545' },
    { key: 'in_progress', label: 'In Progress', border: '#facc15', bg: '#3f2e00' },
    { key: 'closed', label: 'Closed', border: '#34d399', bg: '#0f2f1f' }
];

const extractAttachment = (description: string | null) => {
    const raw = description || '';
    const match = raw.match(/\[attachment\]\s+(https?:\/\/\S+)/i);
    const url = match?.[1] || null;
    const cleanText = raw.replace(/\[attachment\]\s+https?:\/\/\S+/i, '').trim();
    return { url, cleanText };
};

export default function KanbanBoard({ tickets, roles, onChanged }: Props) {
    const supabase = supabaseClient();
    const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
    const roleNameMap = useMemo(() => new Map(roles.map(r => [r.id, r.name])), [roles]);

    const grouped = useMemo(() => {
        return {
            open: tickets.filter(t => t.status === 'open'),
            in_progress: tickets.filter(t => t.status === 'in_progress'),
            closed: tickets.filter(t => t.status === 'closed')
        };
    }, [tickets]);

    const updateStatus = async (ticket: Ticket, status: TicketStatus) => {
        if (ticket.status === status) return;

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

    const getTicketById = (ticketId: string) => tickets.find(t => t.id === ticketId);

    return (
        <div
            style={{
                border: '1px solid #1f2937',
                borderRadius: 8,
                padding: '1rem',
                background: '#020617'
            }}
        >
            <div style={{ marginBottom: '0.8rem', fontWeight: 600 }}>Kanban Board (drag and drop)</div>
            <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {COLUMNS.map(column => (
                    <div
                        key={column.key}
                        onDragOver={e => e.preventDefault()}
                        onDrop={async e => {
                            e.preventDefault();
                            const ticketId = e.dataTransfer.getData('text/plain');
                            const ticket = getTicketById(ticketId);
                            setActiveTicketId(null);
                            if (!ticket) return;
                            await updateStatus(ticket, column.key);
                        }}
                        style={{
                            minHeight: 220,
                            borderRadius: 8,
                            border: `1px solid ${column.border}`,
                            background: column.bg,
                            padding: '0.6rem'
                        }}
                    >
                        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                            {column.label} ({grouped[column.key].length})
                        </div>

                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                            {grouped[column.key].map(ticket => {
                                const attachment = extractAttachment(ticket.description);
                                const isActive = ticket.id === activeTicketId;

                                return (
                                    <div
                                        key={ticket.id}
                                        draggable
                                        onDragStart={e => {
                                            e.dataTransfer.setData('text/plain', ticket.id);
                                            setActiveTicketId(ticket.id);
                                        }}
                                        onDragEnd={() => setActiveTicketId(null)}
                                        style={{
                                            borderRadius: 8,
                                            border: isActive ? '1px solid #38bdf8' : '1px solid #334155',
                                            background: '#0b1220',
                                            padding: '0.55rem',
                                            cursor: 'grab'
                                        }}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ticket.title}</div>
                                        <div style={{ marginTop: '0.25rem', fontSize: '0.78rem', opacity: 0.82 }}>
                                            {attachment.cleanText || 'No description'}
                                        </div>
                                        {attachment.url && (
                                            <img
                                                src={attachment.url}
                                                alt="Attachment"
                                                style={{
                                                    marginTop: '0.45rem',
                                                    width: '100%',
                                                    maxHeight: 120,
                                                    objectFit: 'cover',
                                                    borderRadius: 6,
                                                    border: '1px solid #334155'
                                                }}
                                            />
                                        )}
                                        <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', opacity: 0.76 }}>
                                            Priority: {ticket.priority}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', opacity: 0.76 }}>
                                            Role: {ticket.role_id ? roleNameMap.get(ticket.role_id) || 'Unknown role' : 'No role'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
