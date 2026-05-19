'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import type { TicketHistoryEvent } from '@/lib/boardTypes';

const LAST_SEEN_KEY = 'land_last_seen_history_at';

type Props = {
    title?: string;
};

export default function ActivityFeed({ title = 'Notifications & Activity' }: Props) {
    const supabase = supabaseClient();
    const [events, setEvents] = useState<TicketHistoryEvent[]>([]);
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
            setEvents(safe);

            if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted' &&
                safe.length > 0 &&
                lastNotifiedEventId.current &&
                safe[0].id !== lastNotifiedEventId.current
            ) {
                new Notification('Family Land Board update', {
                    body: `New action: ${safe[0].action}`
                });
            }

            if (safe.length > 0) {
                lastNotifiedEventId.current = safe[0].id;
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
        <div
            style={{
                border: '1px solid #1f2937',
                borderRadius: 8,
                padding: '1rem',
                background: '#020617',
                display: 'grid',
                gap: '0.65rem'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Unseen: {unseenCount}</span>
                    <button
                        onClick={markRead}
                        style={{
                            padding: '0.25rem 0.55rem',
                            borderRadius: 6,
                            border: '1px solid #334155',
                            background: 'transparent',
                            color: '#cbd5e1',
                            cursor: 'pointer',
                            fontSize: '0.75rem'
                        }}
                    >
                        Mark read
                    </button>
                    <button
                        onClick={requestBrowserNotifications}
                        style={{
                            padding: '0.25rem 0.55rem',
                            borderRadius: 6,
                            border: '1px solid #334155',
                            background: 'transparent',
                            color: '#cbd5e1',
                            cursor: 'pointer',
                            fontSize: '0.75rem'
                        }}
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

            <div style={{ display: 'grid', gap: '0.4rem' }}>
                {events.slice(0, 10).map(event => (
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
