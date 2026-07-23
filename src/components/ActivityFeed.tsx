'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import type { TicketHistoryEvent } from '@/lib/boardTypes';

const LAST_SEEN_KEY = 'land_last_seen_history_at';

type Props = {
    title?: string;
    maxItems?: number;
    maxHeight?: number;
};

type ActivityItem = TicketHistoryEvent & {
    actorName: string;
    actorEmail: string;
    ticketCreatedByName: string;
    ticketCreatedByEmail: string;
    ticketTitle: string;
};

export default function ActivityFeed({
    title = 'Notifications & Activity',
    maxItems = 30,
    maxHeight = 520
}: Props) {
    const supabase = supabaseClient();
    const [events, setEvents] = useState<ActivityItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const lastNotifiedEventId = useRef<string | null>(null);

    const loadEvents = async () => {
        try {
            const { data, error: fetchError } = await supabase
                .from('ticket_history')
                .select('id, ticket_id, action, performed_by, from_status, to_status, created_at')
                .order('created_at', { ascending: false })
                .limit(25);

            if (fetchError) throw fetchError;

            const safe = ((data || []) as TicketHistoryEvent[]).filter(e => e && e.id);

            const actorIds = Array.from(new Set(safe.map(event => event.performed_by).filter(Boolean))) as string[];
            const ticketIds = Array.from(new Set(safe.map(event => event.ticket_id).filter(Boolean)));

            const [{ data: actorProfiles }, { data: tickets }] = await Promise.all([
                actorIds.length
                    ? supabase
                        .from('profiles')
                        .select('id, full_name')
                        .in('id', actorIds)
                    : Promise.resolve({ data: [] as any[] }),
                ticketIds.length
                    ? supabase
                        .from('tickets')
                        .select('id, created_by, title')
                        .in('id', ticketIds)
                    : Promise.resolve({ data: [] as any[] })
            ]);

            const ticketCreatorIds = Array.from(
                new Set(((tickets || []) as any[]).map(ticket => ticket.created_by).filter(Boolean))
            ) as string[];

            const { data: ticketCreators } = ticketCreatorIds.length
                ? await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', ticketCreatorIds)
                : { data: [] as any[] };

            const actorNameById = new Map<string, string>();
            for (const profile of (actorProfiles || []) as Array<{ id: string; full_name: string | null }>) {
                actorNameById.set(profile.id, profile.full_name || `User ${profile.id.slice(0, 8)}`);
            }

            const ticketCreatorById = new Map<string, { name: string; email: string }>();
            for (const profile of (ticketCreators || []) as Array<{ id: string; full_name: string | null }>) {
                ticketCreatorById.set(profile.id, {
                    name: profile.full_name || `User ${profile.id.slice(0, 8)}`,
                    email: ''
                });
            }

            const ticketById = new Map<string, { createdBy: string | null; title: string | null }>();
            for (const ticket of (tickets || []) as Array<{ id: string; created_by: string | null; title: string | null }>) {
                ticketById.set(ticket.id, {
                    createdBy: ticket.created_by,
                    title: ticket.title || null
                });
            }

            const enriched: ActivityItem[] = safe.map(event => {
                const ticketMeta = ticketById.get(event.ticket_id);
                const creatorProfile = ticketMeta?.createdBy ? ticketCreatorById.get(ticketMeta.createdBy) : null;
                return {
                    ...event,
                    actorName: event.performed_by ? actorNameById.get(event.performed_by) || `User ${event.performed_by.slice(0, 8)}` : 'System',
                    actorEmail: '',
                    ticketCreatedByName: creatorProfile?.name || 'Unknown creator',
                    ticketCreatedByEmail: creatorProfile?.email || '',
                    ticketTitle: ticketMeta?.title || 'Untitled ticket'
                };
            });

            setEvents(enriched);

            if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted' &&
                enriched.length > 0 &&
                lastNotifiedEventId.current &&
                enriched[0].id !== lastNotifiedEventId.current
            ) {
                new Notification('Family Land Board update', {
                    body: `New action: ${enriched[0].action}`
                });
            }

            if (enriched.length > 0) {
                lastNotifiedEventId.current = enriched[0].id;
            }

            setError(null);
        } catch (err: any) {
            setError(err?.message || 'Failed to load activity feed.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadEvents();
        const id = window.setInterval(loadEvents, 15000);
        return () => window.clearInterval(id);
    }, []);

    const unseenCount = useMemo(() => {
        const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
        if (!lastSeen) return events.length;
        const lastSeenTime = new Date(lastSeen).getTime();
        return events.filter(e => new Date(e.created_at).getTime() > lastSeenTime).length;
    }, [events]);

    const markRead = () => {
        localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
        setEvents(prev => [...prev]);
    };

    const requestBrowserNotifications = async () => {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        await Notification.requestPermission();
    };

    return (
        <div className="panel-soft" style={{ gap: '0.65rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Unseen: {unseenCount}</span>
                    <button
                        onClick={markRead}
                        className="button-secondary"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                    >
                        Mark read
                    </button>
                    <button
                        onClick={requestBrowserNotifications}
                        className="button-secondary"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                    >
                        Enable alerts
                    </button>
                </div>
            </div>

            {loading && <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>Loading activity...</div>}
            {error && <div style={{ color: '#fca5a5', fontSize: '0.85rem' }}>{error}</div>}

            {!loading && !events.length && (
                <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>No recent activity yet.</div>
            )}

            <div style={{ display: 'grid', gap: '0.4rem', maxHeight, overflowY: 'auto', paddingRight: '0.25rem' }}>
                {events.slice(0, maxItems).map(event => (
                    <div
                        key={event.id}
                        style={{
                            border: '1px solid #1f2937',
                            borderRadius: 6,
                            padding: '0.45rem 0.55rem',
                            fontSize: '0.8rem'
                        }}
                    >
                        <div style={{ fontWeight: 600 }}>{event.action}</div>
                        <div style={{ opacity: 0.78 }}>
                            Ticket: {event.ticket_id.slice(0, 8)} • {new Date(event.created_at).toLocaleString()}
                        </div>
                        <div style={{ opacity: 0.82 }}>Title: {event.ticketTitle}</div>
                        <div style={{ opacity: 0.82 }}>
                            By: {event.actorName} • Creator: {event.ticketCreatedByName}
                        </div>
                        {(event.from_status || event.to_status) && (
                            <div style={{ opacity: 0.78 }}>
                                {event.from_status || 'n/a'} → {event.to_status || 'n/a'}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
