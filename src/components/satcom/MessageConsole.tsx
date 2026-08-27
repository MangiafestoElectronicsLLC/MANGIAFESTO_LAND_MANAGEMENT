'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeshMessage, MeshSendResponse } from '@/lib/meshTypes';
import {
    loadMessages,
    loadQueuedMessages,
    makeMessageId,
    queueOutgoingMessage,
    removeQueuedMessage,
    saveMessage
} from '@/lib/meshMessageStore';

type MessageConsoleProps = {
    senderName: string;
};

const POLL_MS = 20000;

export default function MessageConsole({ senderName }: MessageConsoleProps) {
    const [messages, setMessages] = useState<MeshMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [emergency, setEmergency] = useState(false);
    const [online, setOnline] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const seenIds = useRef<Set<string>>(new Set());

    const refreshFromStore = useCallback(async () => {
        const stored = await loadMessages();
        setMessages(stored);
        stored.forEach(m => seenIds.current.add(m.id));
    }, []);

    // Best-effort flush of anything queued while offline, in send order.
    const flushQueue = useCallback(async () => {
        const queued = await loadQueuedMessages();
        for (const message of queued.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
            try {
                const response = await fetch('/api/mesh/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: message.text, sender: message.sender, emergency: message.emergency })
                });
                if (!response.ok) continue;
                const data = (await response.json()) as MeshSendResponse;
                const synced: MeshMessage = { ...message, relayed_by: data.message.relayed_by, synced: true };
                await saveMessage(synced);
                await removeQueuedMessage(message.id);
                setMessages(prev => prev.map(m => (m.id === message.id ? synced : m)));
            } catch {
                break; // still offline, try again next time
            }
        }
    }, []);

    const pollIncoming = useCallback(async () => {
        try {
            const response = await fetch('/api/mesh/send');
            if (!response.ok) return;
            const data = (await response.json()) as { messages: MeshMessage[] };
            for (const incoming of data.messages) {
                if (seenIds.current.has(incoming.id)) continue;
                seenIds.current.add(incoming.id);
                await saveMessage(incoming);
            }
            await refreshFromStore();
        } catch {
            // ignore poll failures, likely offline
        }
    }, [refreshFromStore]);

    useEffect(() => {
        void refreshFromStore();
        setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);

        const handleOnline = () => {
            setOnline(true);
            void flushQueue().then(refreshFromStore);
        };
        const handleOffline = () => setOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const interval = window.setInterval(() => {
            if (navigator.onLine) void pollIncoming();
        }, POLL_MS);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.clearInterval(interval);
        };
    }, [flushQueue, pollIncoming, refreshFromStore]);

    const sendMessage = async () => {
        setError(null);
        setStatus(null);
        const text = draft.trim();

        if (!text) {
            setError('Type a message first.');
            return;
        }
        if (text.length > 200) {
            setError('Message must be 200 characters or fewer (LoRa packet limit).');
            return;
        }

        setSending(true);
        const localMessage: MeshMessage = {
            id: makeMessageId(),
            text,
            sender: senderName,
            direction: 'outgoing',
            relayed_by: null,
            emergency,
            created_at: new Date().toISOString(),
            synced: false
        };

        try {
            await saveMessage(localMessage);
            setMessages(prev => [...prev, localMessage]);
            seenIds.current.add(localMessage.id);
            setDraft('');
            setEmergency(false);

            if (!navigator.onLine) {
                await queueOutgoingMessage(localMessage);
                setStatus('Offline: message queued locally and will broadcast when connection returns.');
                return;
            }

            const response = await fetch('/api/mesh/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, sender: senderName, emergency: localMessage.emergency })
            });

            if (!response.ok) {
                await queueOutgoingMessage(localMessage);
                setStatus('Could not reach the mesh API right now; message queued and will retry.');
                return;
            }

            const data = (await response.json()) as MeshSendResponse;
            const synced: MeshMessage = { ...localMessage, relayed_by: data.message.relayed_by, synced: true };
            await saveMessage(synced);
            setMessages(prev => prev.map(m => (m.id === localMessage.id ? synced : m)));
            setStatus(`Broadcast sent via ${data.message.relayed_by}.`);
        } catch {
            await queueOutgoingMessage(localMessage);
            setStatus('Offline or unreachable: message queued locally and will broadcast when connection returns.');
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <div>
                    <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Off-Grid Messaging Console</div>
                    <h2 style={{ margin: 0 }}>Mesh Chat</h2>
                </div>
                <span
                    style={{
                        border: `1px solid ${online ? '#166534' : '#92400e'}`,
                        borderRadius: 999,
                        padding: '0.22rem 0.6rem',
                        color: online ? '#bbf7d0' : '#fde68a',
                        fontSize: '0.78rem'
                    }}
                >
                    {online ? 'Connected' : 'Offline (queuing locally)'}
                </span>
            </div>

            <div
                style={{
                    display: 'grid',
                    gap: '0.4rem',
                    maxHeight: 340,
                    overflowY: 'auto',
                    border: '1px solid #334155',
                    borderRadius: 10,
                    padding: '0.6rem'
                }}
            >
                {messages.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No messages yet. Send the first broadcast below.</div>
                ) : (
                    messages.map(message => (
                        <div
                            key={message.id}
                            style={{
                                border: message.emergency ? '1px solid #7f1d1d' : '1px solid #334155',
                                background: message.emergency ? 'rgba(127,29,29,0.18)' : 'rgba(15,23,42,0.6)',
                                borderRadius: 8,
                                padding: '0.45rem 0.6rem',
                                fontSize: '0.86rem'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem', opacity: 0.75, fontSize: '0.78rem' }}>
                                <span>
                                    {message.emergency ? 'EMERGENCY · ' : ''}
                                    {message.sender}
                                </span>
                                <span>{new Date(message.created_at).toLocaleTimeString()}</span>
                            </div>
                            <div>{message.text}</div>
                            <div style={{ opacity: 0.65, fontSize: '0.76rem' }}>
                                {message.synced ? `Relayed by ${message.relayed_by || 'mesh'}` : 'Pending — not synced yet'}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {error && <div style={{ color: '#fecaca', fontSize: '0.85rem' }}>{error}</div>}
            {status && <div style={{ color: '#bbf7d0', fontSize: '0.85rem' }}>{status}</div>}

            <div style={{ display: 'grid', gap: '0.5rem' }}>
                <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Type a message to broadcast to the mesh..."
                    maxLength={200}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical', borderRadius: 8, border: '1px solid #334155', background: 'rgba(2,6,23,0.6)', color: 'inherit', padding: '0.5rem' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={emergency} onChange={e => setEmergency(e.target.checked)} />
                        Mark as emergency broadcast
                    </label>
                    <button className="soft-button" onClick={() => void sendMessage()} disabled={sending}>
                        {sending ? 'Sending...' : 'Send to mesh'}
                    </button>
                </div>
            </div>
        </section>
    );
}
