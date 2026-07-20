'use client';

import { useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { isUuid, type Role, type Ticket, type TicketHistoryEvent } from '@/lib/boardTypes';
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
    const [savingTicketId, setSavingTicketId] = useState<string | null>(null);
    const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
    const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({});
    const [editMessage, setEditMessage] = useState<string | null>(null);
    const [editError, setEditError] = useState<string | null>(null);

    const roleNameMap = new Map(roles.map(r => [r.id, r.name]));

    const updateStatus = async (ticket: Ticket, status: string) => {
        setEditError(null);
        setEditMessage(null);
        setStatusUpdatingId(ticket.id);

        const {
            data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
            setStatusUpdatingId(null);
            setEditError('Your session expired. Sign in again and retry.');
            return;
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        const { error: updateError } = await supabase
            .from('tickets')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', ticket.id);

        if (updateError) {
            setStatusUpdatingId(null);
            setEditError(updateError.message || 'Could not update ticket status.');
            return;
        }

        await supabase.from('ticket_history').insert({
            ticket_id: ticket.id,
            action: 'status_changed',
            performed_by: profile?.id,
            from_status: ticket.status,
            to_status: status
        });

        setStatusUpdatingId(null);
        setEditMessage('Status updated.');
        onChanged();
    };

    const formatStatusLabel = (status: string) => {
        if (status === 'in_progress') return 'In Progress';
        if (status === 'closed') return 'Closed';
        return 'Open';
    };

    const formatPriorityLabel = (priority: string) => {
        if (priority === 'high') return 'High';
        if (priority === 'low') return 'Low';
        return 'Normal';
    };

    const statusBadgeStyle = (status: string) => {
        if (status === 'closed') {
            return { border: '1px solid #22c55e', background: 'rgba(6, 95, 70, 0.35)', color: '#bbf7d0' };
        }
        if (status === 'in_progress') {
            return { border: '1px solid #facc15', background: 'rgba(146, 64, 14, 0.3)', color: '#fde68a' };
        }
        return { border: '1px solid #60a5fa', background: 'rgba(30, 64, 175, 0.35)', color: '#bfdbfe' };
    };

    const priorityBadgeStyle = (priority: string) => {
        if (priority === 'high') {
            return { border: '1px solid #f97373', background: 'rgba(127, 29, 29, 0.32)', color: '#fecaca' };
        }
        if (priority === 'low') {
            return { border: '1px solid #34d399', background: 'rgba(6, 95, 70, 0.32)', color: '#bbf7d0' };
        }
        return { border: '1px solid #a78bfa', background: 'rgba(76, 29, 149, 0.3)', color: '#ddd6fe' };
    };

    const toggleDescription = (ticketId: string) => {
        setExpandedDescriptions(prev => ({
            ...prev,
            [ticketId]: !prev[ticketId]
        }));
    };

    const startEdit = (ticket: Ticket) => {
        setEditError(null);
        setEditMessage(null);
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
        setEditError(null);
        setEditMessage(null);

        if (draftRoleId && !isUuid(draftRoleId)) {
            setEditError('Role setup is incomplete, so this ticket cannot be assigned to that role yet. Run the missing Supabase role setup SQL and try again.');
            return;
        }

        setSavingTicketId(ticket.id);

        const {
            data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
            setSavingTicketId(null);
            setEditError('Your session expired. Sign in again and retry.');
            return;
        }

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

        if (error) {
            setSavingTicketId(null);
            setEditError(error.message || 'Could not save ticket changes.');
            return;
        }

        await supabase.from('ticket_history').insert({
            ticket_id: ticket.id,
            action: 'updated',
            performed_by: profile?.id,
            from_status: ticket.status,
            to_status: ticket.status
        });

        cancelEdit();
        setSavingTicketId(null);
        setEditMessage('Ticket updated.');
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
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0 }}>Tickets</h3>
                <div style={{ fontSize: '0.84rem', opacity: 0.8 }}>{tickets.length} in this view</div>
            </div>
            {editError && <div style={{ color: '#fca5a5', fontSize: '0.84rem', marginBottom: '0.6rem' }}>{editError}</div>}
            {editMessage && <div style={{ color: '#86efac', fontSize: '0.84rem', marginBottom: '0.6rem' }}>{editMessage}</div>}
            <div style={{ display: 'grid', gap: '0.75rem' }}>
                {tickets.map(t => (
                    (() => {
                        const attachment = extractAttachment(t.description);
                        const ticketNumber = getTicketNumber(t);
                        const isExpanded = Boolean(expandedDescriptions[t.id]);
                        const textLength = (attachment.cleanText || '').length;
                        const canExpand = textLength > 180;

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
                                    className="ticket-item-row"
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
                                                        disabled={savingTicketId === t.id}
                                                        style={{
                                                            padding: '0.25rem 0.5rem',
                                                            borderRadius: 4,
                                                            border: '1px solid #34d399',
                                                            background: 'transparent',
                                                            color: '#34d399',
                                                            cursor: savingTicketId === t.id ? 'not-allowed' : 'pointer',
                                                            opacity: savingTicketId === t.id ? 0.65 : 1,
                                                            fontSize: '0.75rem'
                                                        }}
                                                    >
                                                        {savingTicketId === t.id ? 'Saving...' : 'Save'}
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
                                                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    <div style={{ fontWeight: 600 }}>{t.title}</div>
                                                    <span
                                                        style={{
                                                            fontSize: '0.7rem',
                                                            borderRadius: 999,
                                                            padding: '0.16rem 0.42rem',
                                                            ...statusBadgeStyle(t.status)
                                                        }}
                                                    >
                                                        {formatStatusLabel(t.status)}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontSize: '0.7rem',
                                                            borderRadius: 999,
                                                            padding: '0.16rem 0.42rem',
                                                            ...priorityBadgeStyle(t.priority)
                                                        }}
                                                    >
                                                        {formatPriorityLabel(t.priority)} priority
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: '0.85rem',
                                                        opacity: 0.8,
                                                        whiteSpace: 'pre-wrap',
                                                        overflow: 'hidden',
                                                        display: isExpanded ? 'block' : '-webkit-box',
                                                        WebkitLineClamp: isExpanded ? 'unset' : 4,
                                                        WebkitBoxOrient: 'vertical'
                                                    }}
                                                >
                                                    {attachment.cleanText || 'No description'}
                                                </div>
                                                {canExpand && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleDescription(t.id)}
                                                        style={{
                                                            marginTop: '0.35rem',
                                                            padding: '0.2rem 0.4rem',
                                                            borderRadius: 4,
                                                            border: '1px solid #475569',
                                                            background: 'transparent',
                                                            color: '#cbd5e1',
                                                            cursor: 'pointer',
                                                            fontSize: '0.72rem',
                                                            width: 'fit-content'
                                                        }}
                                                    >
                                                        {isExpanded ? 'Show less' : 'Show more'}
                                                    </button>
                                                )}
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
                                                Status: {formatStatusLabel(t.status)} • Priority: {formatPriorityLabel(t.priority)}
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
                                                disabled={Boolean(savingTicketId)}
                                                style={{
                                                    padding: '0.25rem 0.5rem',
                                                    borderRadius: 4,
                                                    border: '1px solid #38bdf8',
                                                    background: 'transparent',
                                                    color: '#7dd3fc',
                                                    cursor: savingTicketId ? 'not-allowed' : 'pointer',
                                                    opacity: savingTicketId ? 0.65 : 1,
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
                                        className="ticket-status-actions"
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.25rem'
                                        }}
                                    >
                                        <button
                                            onClick={() => updateStatus(t, 'open')}
                                            disabled={statusUpdatingId === t.id || t.status === 'open'}
                                            style={{
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: 4,
                                                border: '1px solid #6b7280',
                                                background: 'transparent',
                                                color: '#e5e7eb',
                                                cursor: statusUpdatingId === t.id || t.status === 'open' ? 'not-allowed' : 'pointer',
                                                opacity: statusUpdatingId === t.id || t.status === 'open' ? 0.6 : 1,
                                                fontSize: '0.75rem'
                                            }}
                                        >
                                            {statusUpdatingId === t.id && t.status !== 'open' ? 'Updating...' : 'Open'}
                                        </button>
                                        <button
                                            onClick={() => updateStatus(t, 'in_progress')}
                                            disabled={statusUpdatingId === t.id || t.status === 'in_progress'}
                                            style={{
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: 4,
                                                border: '1px solid #facc15',
                                                background: 'transparent',
                                                color: '#facc15',
                                                cursor: statusUpdatingId === t.id || t.status === 'in_progress' ? 'not-allowed' : 'pointer',
                                                opacity: statusUpdatingId === t.id || t.status === 'in_progress' ? 0.6 : 1,
                                                fontSize: '0.75rem'
                                            }}
                                        >
                                            In progress
                                        </button>
                                        <button
                                            onClick={() => updateStatus(t, 'closed')}
                                            disabled={statusUpdatingId === t.id || t.status === 'closed'}
                                            style={{
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: 4,
                                                border: '1px solid #22c55e',
                                                background: 'transparent',
                                                color: '#22c55e',
                                                cursor: statusUpdatingId === t.id || t.status === 'closed' ? 'not-allowed' : 'pointer',
                                                opacity: statusUpdatingId === t.id || t.status === 'closed' ? 0.6 : 1,
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
