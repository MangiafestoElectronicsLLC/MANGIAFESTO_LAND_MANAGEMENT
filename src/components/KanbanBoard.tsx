'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { isUuid, type Role, type Ticket, type TicketStatus } from '@/lib/boardTypes';
import { getTicketNumber } from '@/lib/ticketNumber';

type Props = {
    tickets: Ticket[];
    roles: Role[];
    onChanged: () => void;
};

const COLUMNS: Array<{ key: TicketStatus; label: string; border: string; bg: string }> = [
    { key: 'open', label: 'Open', border: '#60a5fa', bg: 'rgba(30, 64, 175, 0.3)' },
    { key: 'in_progress', label: 'In Progress', border: '#facc15', bg: 'rgba(146, 64, 14, 0.35)' },
    { key: 'closed', label: 'Closed', border: '#34d399', bg: 'rgba(6, 95, 70, 0.34)' }
];

const ATTACHMENT_REGEX = /\[attachment\]\s+(https?:\/\/\S+)/gi;

const extractAttachments = (description: string | null) => {
    const raw = description || '';
    const urls = Array.from(raw.matchAll(ATTACHMENT_REGEX))
        .map(match => match[1]?.trim())
        .filter((url): url is string => Boolean(url));
    const cleanText = raw.replace(ATTACHMENT_REGEX, '').trim();
    return { urls, cleanText };
};

const attachDescription = (descriptionText: string, attachmentUrls: string[]) => {
    const clean = descriptionText.trim();
    const markers = attachmentUrls.map(url => `[attachment] ${url}`).join('\n');
    if (!markers) return clean;
    return clean ? `${clean}\n\n${markers}` : markers;
};

export default function KanbanBoard({ tickets, roles, onChanged }: Props) {
    const supabase = supabaseClient();
    const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [workNote, setWorkNote] = useState('');
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [selectedPriority, setSelectedPriority] = useState('normal');
    const [selectedStatus, setSelectedStatus] = useState<TicketStatus>('open');
    const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
    const [metaSaving, setMetaSaving] = useState(false);
    const [savingNote, setSavingNote] = useState(false);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const roleNameMap = useMemo(() => new Map(roles.map(r => [r.id, r.name])), [roles]);
    const assignableRoles = useMemo(() => roles.filter(role => isUuid(role.id)), [roles]);

    const grouped = useMemo(() => {
        return {
            open: tickets.filter(t => t.status === 'open'),
            in_progress: tickets.filter(t => t.status === 'in_progress'),
            closed: tickets.filter(t => t.status === 'closed')
        };
    }, [tickets]);

    const insertHistoryEvent = async (payload: {
        ticket_id: string;
        action: string;
        performed_by: string | null;
        from_status: string;
        to_status: string;
    }) => {
        const { error } = await supabase.from('ticket_history').insert(payload);
        return !error;
    };

    const updateStatus = async (ticket: Ticket, status: TicketStatus) => {
        if (ticket.status === status) return;

        setActionError(null);
        setActionMessage(null);

        const {
            data: { user }
        } = await supabase.auth.getUser();
        if (!user) {
            setActionError('Your session expired. Sign in again and retry.');
            return;
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();

        const { error: updateError } = await supabase
            .from('tickets')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', ticket.id);

        if (updateError) {
            setActionError(updateError.message || 'Could not update ticket status.');
            return;
        }

        const wroteHistory = await insertHistoryEvent({
            ticket_id: ticket.id,
            action: 'status_changed',
            performed_by: profile?.id || null,
            from_status: ticket.status,
            to_status: status
        });

        setActionMessage(
            wroteHistory
                ? `Status updated to ${status.replace('_', ' ')}.`
                : `Status updated to ${status.replace('_', ' ')}, but history logging is unavailable right now.`
        );
        onChanged();
    };

    const uploadImage = async (ticketId: string, userId: string, file: File) => {
        const extension = file.name.split('.').pop() || 'jpg';
        const filePath = `${userId}/${ticketId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

        const { error: uploadError } = await supabase.storage
            .from('ticket-images')
            .upload(filePath, file, { upsert: false });

        if (uploadError) {
            throw new Error('Could not upload image. If this persists, create Supabase bucket "ticket-images" and retry.');
        }

        const { data: publicData } = supabase.storage.from('ticket-images').getPublicUrl(filePath);
        return publicData.publicUrl;
    };

    const getProfileId = async () => {
        const {
            data: { user }
        } = await supabase.auth.getUser();

        if (!user) return null;

        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();

        return profile?.id || null;
    };

    const appendWorkEntry = (description: string | null, label: string, note: string) => {
        const trimmed = note.trim();
        const stamp = new Date().toLocaleString();
        const line = `[${label} ${stamp}] ${trimmed}`;
        const base = description?.trim() || '';
        return base ? `${base}\n\n${line}` : line;
    };

    const saveWorkUpdate = async () => {
        const ticket = selectedTicketId ? tickets.find(t => t.id === selectedTicketId) : null;
        const note = workNote.trim();
        if (!ticket || !note) return;

        setActionError(null);
        setActionMessage(null);
        setSavingNote(true);

        try {
            const profileId = await getProfileId();
            const nextDescription = appendWorkEntry(ticket.description, 'work update', note);

            const { error: updateError } = await supabase
                .from('tickets')
                .update({
                    description: nextDescription,
                    updated_at: new Date().toISOString()
                })
                .eq('id', ticket.id);

            if (updateError) {
                setActionError(updateError.message || 'Could not save work update.');
                return;
            }

            const wroteHistory = await insertHistoryEvent({
                ticket_id: ticket.id,
                action: `work_update: ${note}`,
                performed_by: profileId,
                from_status: ticket.status,
                to_status: ticket.status
            });

            setWorkNote('');
            setActionMessage(
                wroteHistory
                    ? 'Work update saved.'
                    : 'Work update saved, but history logging is unavailable right now.'
            );
            onChanged();
        } finally {
            setSavingNote(false);
        }
    };

    const completeWithNotes = async () => {
        const ticket = selectedTicketId ? tickets.find(t => t.id === selectedTicketId) : null;
        const note = workNote.trim();
        if (!ticket || !note) return;

        setActionError(null);
        setActionMessage(null);
        setSavingNote(true);

        try {
            const profileId = await getProfileId();
            const nextDescription = appendWorkEntry(ticket.description, 'finished', note);

            const { error: updateError } = await supabase
                .from('tickets')
                .update({
                    description: nextDescription,
                    status: 'closed',
                    updated_at: new Date().toISOString()
                })
                .eq('id', ticket.id);

            if (updateError) {
                setActionError(updateError.message || 'Could not complete ticket with notes.');
                return;
            }

            const wroteHistory = await insertHistoryEvent({
                ticket_id: ticket.id,
                action: `completed_note: ${note}`,
                performed_by: profileId,
                from_status: ticket.status,
                to_status: 'closed'
            });

            setWorkNote('');
            setActionMessage(
                wroteHistory
                    ? 'Ticket completed with notes.'
                    : 'Ticket completed, but history logging is unavailable right now.'
            );
            onChanged();
        } finally {
            setSavingNote(false);
        }
    };

    const getTicketById = (ticketId: string) => tickets.find(t => t.id === ticketId);

    const selectedTicket = selectedTicketId ? tickets.find(t => t.id === selectedTicketId) || null : null;

    useEffect(() => {
        if (!selectedTicket) {
            setSelectedRoleId('');
            setSelectedPriority('normal');
            setSelectedStatus('open');
            setSelectedImageFile(null);
            return;
        }

        setSelectedRoleId(selectedTicket.role_id || '');
        setSelectedPriority(selectedTicket.priority || 'normal');
        setSelectedStatus(selectedTicket.status);
        setSelectedImageFile(null);
    }, [selectedTicket?.id, selectedTicket?.priority, selectedTicket?.role_id, selectedTicket?.status]);

    const saveSelectedTicketDetails = async () => {
        if (!selectedTicket) return;

        setActionError(null);
        setActionMessage(null);
        setMetaSaving(true);

        try {
            const profileId = await getProfileId();

            let roleWarning = '';
            let safeRoleId: string | null = null;
            if (!selectedRoleId) {
                safeRoleId = null;
            } else if (isUuid(selectedRoleId)) {
                safeRoleId = selectedRoleId;
            } else {
                safeRoleId = isUuid(selectedTicket.role_id || '') ? selectedTicket.role_id : null;
                roleWarning = ' Role assignment was skipped because roles are not fully set up in Supabase.';
            }

            const { error } = await supabase
                .from('tickets')
                .update({
                    role_id: safeRoleId,
                    priority: selectedPriority,
                    status: selectedStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', selectedTicket.id);

            if (error) {
                setActionError(error.message || 'Could not save ticket details.');
                return;
            }

            const wroteHistory = await insertHistoryEvent({
                ticket_id: selectedTicket.id,
                action: 'updated',
                performed_by: profileId,
                from_status: selectedTicket.status,
                to_status: selectedStatus
            });

            if (wroteHistory) {
                setActionMessage(`Ticket details saved.${roleWarning}`.trim());
            } else {
                setActionMessage(`Ticket details saved, but history logging is unavailable right now.${roleWarning}`.trim());
            }

            onChanged();
        } catch (err: any) {
            setActionError(err?.message || 'Could not save ticket details.');
        } finally {
            setMetaSaving(false);
        }
    };

    const addImageToSelectedTicket = async () => {
        if (!selectedTicket || !selectedImageFile) return;

        setActionError(null);
        setActionMessage(null);
        setMetaSaving(true);

        try {
            const {
                data: { user }
            } = await supabase.auth.getUser();
            if (!user) {
                setActionError('Your session expired. Sign in again and retry.');
                return;
            }

            const profileId = await getProfileId();
            const parsed = extractAttachments(selectedTicket.description);
            const uploadedUrl = await uploadImage(selectedTicket.id, user.id, selectedImageFile);
            const nextDescription = attachDescription(parsed.cleanText, [...parsed.urls, uploadedUrl]);

            const { error } = await supabase
                .from('tickets')
                .update({
                    description: nextDescription,
                    updated_at: new Date().toISOString()
                })
                .eq('id', selectedTicket.id);

            if (error) {
                setActionError(error.message || 'Could not add image to ticket.');
                return;
            }

            const wroteHistory = await insertHistoryEvent({
                ticket_id: selectedTicket.id,
                action: `attachment_added: ${selectedImageFile.name}`,
                performed_by: profileId,
                from_status: selectedTicket.status,
                to_status: selectedTicket.status
            });

            setSelectedImageFile(null);
            setActionMessage(wroteHistory ? 'Image attached to ticket.' : 'Image attached, but history logging is unavailable right now.');
            onChanged();
        } catch (err: any) {
            setActionError(err?.message || 'Could not add image to ticket.');
        } finally {
            setMetaSaving(false);
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
            <div style={{ marginBottom: '0.8rem', fontWeight: 600 }}>Kanban Board (drag and drop)</div>
            {actionError && <div style={{ color: '#fca5a5', fontSize: '0.84rem', marginBottom: '0.65rem' }}>{actionError}</div>}
            {actionMessage && <div style={{ color: '#86efac', fontSize: '0.84rem', marginBottom: '0.65rem' }}>{actionMessage}</div>}

            <div
                style={{
                    marginBottom: '0.9rem',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    padding: '0.7rem',
                    background: '#0b1220',
                    display: 'grid',
                    gap: '0.45rem'
                }}
            >
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {selectedTicket ? `Selected: ${selectedTicket.title}` : 'Select a ticket card to add progress or finish notes'}
                </div>
                {selectedTicket && (
                    <div style={{ display: 'grid', gap: '0.45rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                onClick={() => updateStatus(selectedTicket, 'open')}
                                disabled={metaSaving || savingNote || selectedTicket.status === 'open'}
                                style={{
                                    padding: '0.3rem 0.65rem',
                                    borderRadius: 6,
                                    border: '1px solid #6b7280',
                                    background: 'transparent',
                                    color: '#e5e7eb',
                                    cursor: metaSaving || savingNote || selectedTicket.status === 'open' ? 'not-allowed' : 'pointer',
                                    opacity: metaSaving || savingNote || selectedTicket.status === 'open' ? 0.65 : 1,
                                    fontSize: '0.8rem'
                                }}
                            >
                                Move to Open
                            </button>
                            <button
                                type="button"
                                onClick={() => updateStatus(selectedTicket, 'in_progress')}
                                disabled={metaSaving || savingNote || selectedTicket.status === 'in_progress'}
                                style={{
                                    padding: '0.3rem 0.65rem',
                                    borderRadius: 6,
                                    border: '1px solid #facc15',
                                    background: 'transparent',
                                    color: '#facc15',
                                    cursor: metaSaving || savingNote || selectedTicket.status === 'in_progress' ? 'not-allowed' : 'pointer',
                                    opacity: metaSaving || savingNote || selectedTicket.status === 'in_progress' ? 0.65 : 1,
                                    fontSize: '0.8rem'
                                }}
                            >
                                Move to In progress
                            </button>
                            <button
                                type="button"
                                onClick={() => updateStatus(selectedTicket, 'closed')}
                                disabled={metaSaving || savingNote || selectedTicket.status === 'closed'}
                                style={{
                                    padding: '0.3rem 0.65rem',
                                    borderRadius: 6,
                                    border: '1px solid #22c55e',
                                    background: 'transparent',
                                    color: '#4ade80',
                                    cursor: metaSaving || savingNote || selectedTicket.status === 'closed' ? 'not-allowed' : 'pointer',
                                    opacity: metaSaving || savingNote || selectedTicket.status === 'closed' ? 0.65 : 1,
                                    fontSize: '0.8rem'
                                }}
                            >
                                Move to Closed
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <select
                                value={selectedRoleId}
                                onChange={e => setSelectedRoleId(e.target.value)}
                                style={{ padding: '0.42rem', borderRadius: 6, minWidth: 170, flex: '1 1 180px' }}
                                disabled={metaSaving || savingNote}
                            >
                                <option value="">No role</option>
                                {assignableRoles.map(role => (
                                    <option key={role.id} value={role.id}>
                                        {role.name}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={selectedPriority}
                                onChange={e => setSelectedPriority(e.target.value)}
                                style={{ padding: '0.42rem', borderRadius: 6, minWidth: 130, flex: '1 1 140px' }}
                                disabled={metaSaving || savingNote}
                            >
                                <option value="low">Low</option>
                                <option value="normal">Normal</option>
                                <option value="high">High</option>
                            </select>
                            <select
                                value={selectedStatus}
                                onChange={e => setSelectedStatus(e.target.value as TicketStatus)}
                                style={{ padding: '0.42rem', borderRadius: 6, minWidth: 150, flex: '1 1 155px' }}
                                disabled={metaSaving || savingNote}
                            >
                                <option value="open">Open</option>
                                <option value="in_progress">In progress</option>
                                <option value="closed">Closed</option>
                            </select>
                            <button
                                type="button"
                                onClick={saveSelectedTicketDetails}
                                disabled={metaSaving || savingNote}
                                style={{
                                    padding: '0.35rem 0.65rem',
                                    borderRadius: 6,
                                    border: '1px solid #22d3ee',
                                    background: 'transparent',
                                    color: '#67e8f9',
                                    cursor: metaSaving || savingNote ? 'not-allowed' : 'pointer',
                                    opacity: metaSaving || savingNote ? 0.65 : 1,
                                    fontSize: '0.8rem'
                                }}
                            >
                                {metaSaving ? 'Saving...' : 'Save ticket details'}
                            </button>
                        </div>
                        {roles.length > 0 && assignableRoles.length === 0 && (
                            <div style={{ color: '#fca5a5', fontSize: '0.76rem' }}>
                                Role assignment is unavailable until roles are created in Supabase.
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={e => setSelectedImageFile(e.target.files?.[0] || null)}
                                disabled={metaSaving || savingNote}
                                style={{ padding: '0.35rem', borderRadius: 6, minWidth: 240, flex: '1 1 250px' }}
                            />
                            <button
                                type="button"
                                onClick={addImageToSelectedTicket}
                                disabled={!selectedImageFile || metaSaving || savingNote}
                                style={{
                                    padding: '0.35rem 0.65rem',
                                    borderRadius: 6,
                                    border: '1px solid #60a5fa',
                                    background: 'transparent',
                                    color: '#93c5fd',
                                    cursor: selectedImageFile && !metaSaving && !savingNote ? 'pointer' : 'not-allowed',
                                    opacity: selectedImageFile && !metaSaving && !savingNote ? 1 : 0.65,
                                    fontSize: '0.8rem'
                                }}
                            >
                                Add image
                            </button>
                        </div>
                    </div>
                )}
                <textarea
                    value={workNote}
                    onChange={e => setWorkNote(e.target.value)}
                    rows={3}
                    placeholder="Write what is being done, or final completion notes"
                    style={{ padding: '0.45rem', borderRadius: 6 }}
                    disabled={!selectedTicket || savingNote}
                />
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        onClick={saveWorkUpdate}
                        disabled={!selectedTicket || !workNote.trim() || savingNote}
                        style={{
                            padding: '0.35rem 0.7rem',
                            borderRadius: 6,
                            border: '1px solid #38bdf8',
                            background: 'transparent',
                            color: '#7dd3fc',
                            cursor: selectedTicket && workNote.trim() && !savingNote ? 'pointer' : 'not-allowed',
                            opacity: selectedTicket && workNote.trim() && !savingNote ? 1 : 0.6,
                            fontSize: '0.8rem'
                        }}
                    >
                        Save work update
                    </button>
                    <button
                        onClick={completeWithNotes}
                        disabled={!selectedTicket || !workNote.trim() || savingNote}
                        style={{
                            padding: '0.35rem 0.7rem',
                            borderRadius: 6,
                            border: '1px solid #22c55e',
                            background: 'transparent',
                            color: '#4ade80',
                            cursor: selectedTicket && workNote.trim() && !savingNote ? 'pointer' : 'not-allowed',
                            opacity: selectedTicket && workNote.trim() && !savingNote ? 1 : 0.6,
                            fontSize: '0.8rem'
                        }}
                    >
                        Complete ticket with notes
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
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
                            minHeight: 320,
                            borderRadius: 8,
                            border: `1px solid ${column.border}`,
                            background: column.bg,
                            padding: '0.6rem',
                            display: 'grid',
                            gap: '0.5rem'
                        }}
                    >
                        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                            {column.label} ({grouped[column.key].length})
                        </div>

                        <div style={{ display: 'grid', gap: '0.5rem', maxHeight: 580, overflowY: 'auto', paddingRight: '0.2rem' }}>
                            {grouped[column.key].map(ticket => {
                                const attachment = extractAttachments(ticket.description);
                                const isActive = ticket.id === activeTicketId;
                                const isSelected = ticket.id === selectedTicketId;
                                const ticketNumber = getTicketNumber(ticket);

                                return (
                                    <div
                                        key={ticket.id}
                                        draggable
                                        onClick={() => setSelectedTicketId(ticket.id)}
                                        onDragStart={e => {
                                            e.dataTransfer.setData('text/plain', ticket.id);
                                            setActiveTicketId(ticket.id);
                                        }}
                                        onDragEnd={() => setActiveTicketId(null)}
                                        style={{
                                            borderRadius: 8,
                                            border: isActive || isSelected ? '1px solid #38bdf8' : '1px solid #334155',
                                            background: '#111b30',
                                            padding: '0.65rem',
                                            cursor: 'grab'
                                        }}
                                    >
                                        <div style={{ marginBottom: '0.2rem' }}>
                                            <span
                                                style={{
                                                    fontSize: '0.69rem',
                                                    padding: '0.15rem 0.4rem',
                                                    borderRadius: 999,
                                                    border: '1px solid #60a5fa',
                                                    color: '#bfdbfe',
                                                    background: 'rgba(30, 64, 175, 0.35)'
                                                }}
                                            >
                                                {ticketNumber}
                                            </span>
                                        </div>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ticket.title}</div>
                                        <div
                                            style={{
                                                marginTop: '0.25rem',
                                                fontSize: '0.8rem',
                                                opacity: 0.92,
                                                lineHeight: 1.45,
                                                overflow: 'hidden',
                                                display: '-webkit-box',
                                                WebkitLineClamp: 3,
                                                WebkitBoxOrient: 'vertical'
                                            }}
                                        >
                                            {attachment.cleanText || 'No description'}
                                        </div>
                                        {attachment.urls.length > 0 && (
                                            <img
                                                src={attachment.urls[0]}
                                                alt="Attachment"
                                                style={{
                                                    marginTop: '0.45rem',
                                                    width: '100%',
                                                    maxHeight: 150,
                                                    objectFit: 'cover',
                                                    borderRadius: 6,
                                                    border: '1px solid #334155'
                                                }}
                                            />
                                        )}
                                        <div style={{ marginTop: '0.4rem', fontSize: '0.74rem', opacity: 0.9 }}>
                                            Priority: {ticket.priority}
                                        </div>
                                        <div style={{ fontSize: '0.74rem', opacity: 0.9 }}>
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
