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
import { type LiveConnectionStatus, type LiveIncomingMessage, type MeshtasticConnection } from '@/lib/useMeshtasticConnection';
import { createQuickMessage, loadQuickMessages, saveQuickMessages, type QuickMessage } from '@/lib/quickMessages';

type MessageConsoleProps = {
    senderName: string;
    live: MeshtasticConnection;
    registerIncomingHandler: (handler: (message: LiveIncomingMessage) => void) => void;
};

const POLL_MS = 20000;

const LIVE_STATUS_LABEL: Record<LiveConnectionStatus, string> = {
    disconnected: 'Not connected',
    connecting: 'Connecting...',
    connected: 'Connected',
    unsupported: 'Bluetooth not supported',
    error: 'Connection error'
};

export default function MessageConsole({ senderName, live, registerIncomingHandler }: MessageConsoleProps) {
    const liveStatus = live.status;
    const sendLiveText = live.sendText;
    const [messages, setMessages] = useState<MeshMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [emergency, setEmergency] = useState(false);
    const [online, setOnline] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const seenIds = useRef<Set<string>>(new Set());

    const [quickMessages, setQuickMessages] = useState<QuickMessage[]>([]);
    const [newQuickLabel, setNewQuickLabel] = useState('');
    const [newQuickText, setNewQuickText] = useState('');
    const [newQuickEmergency, setNewQuickEmergency] = useState(false);

    useEffect(() => {
        setQuickMessages(loadQuickMessages());
    }, []);

    const refreshFromStore = useCallback(async () => {
        const stored = await loadMessages();
        setMessages(stored);
        stored.forEach(m => seenIds.current.add(m.id));
    }, []);

    const handleIncomingLiveMessage = useCallback(
        ({ text, fromNodeName, emergency: incomingEmergency }: { text: string; fromNodeName: string; emergency: boolean }) => {
            const incoming: MeshMessage = {
                id: makeMessageId(),
                text,
                sender: fromNodeName,
                direction: 'incoming',
                relayed_by: fromNodeName,
                emergency: incomingEmergency,
                created_at: new Date().toISOString(),
                synced: true
            };
            seenIds.current.add(incoming.id);
            void saveMessage(incoming).then(() => setMessages(prev => [...prev, incoming]));
        },
        []
    );

    useEffect(() => {
        registerIncomingHandler(handleIncomingLiveMessage);
    }, [handleIncomingLiveMessage, registerIncomingHandler]);

    // Best-effort flush of anything queued while offline, in send order.
    const flushQueue = useCallback(async () => {
        const queued = await loadQueuedMessages();
        for (const message of queued.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
            try {
                if (liveStatus === 'connected') {
                    const sentPrefix = message.emergency ? 'EMERGENCY: ' : '';
                    const delivered = await sendLiveText(`${sentPrefix}${message.text}`);
                    if (!delivered) break;
                    const synced: MeshMessage = { ...message, relayed_by: 'Your node', synced: true };
                    await saveMessage(synced);
                    await removeQueuedMessage(message.id);
                    setMessages(prev => prev.map(m => (m.id === message.id ? synced : m)));
                    continue;
                }
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
    }, [liveStatus, sendLiveText]);

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
        if (liveStatus === 'connected') void flushQueue().then(refreshFromStore);
        setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);

        const handleOnline = () => {
            setOnline(true);
            void flushQueue().then(refreshFromStore);
        };
        const handleOffline = () => setOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Live BLE mode receives its own real-time events, so only poll the
        // simulated demo API when there's no real node connected.
        const interval = window.setInterval(() => {
            if (navigator.onLine && live.status !== 'connected') void pollIncoming();
        }, POLL_MS);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flushQueue, pollIncoming, refreshFromStore, live.status]);

    const sendMessage = async (overrideText?: string, overrideEmergency?: boolean) => {
        setError(null);
        setStatus(null);
        const text = (overrideText ?? draft).trim();
        const isEmergency = overrideEmergency ?? emergency;

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
            emergency: isEmergency,
            created_at: new Date().toISOString(),
            synced: false
        };

        try {
            await saveMessage(localMessage);
            setMessages(prev => [...prev, localMessage]);
            seenIds.current.add(localMessage.id);
            setDraft('');
            setEmergency(false);

            // Real node connected over Bluetooth: send straight to the mesh, no demo API involved.
            if (live.status === 'connected') {
                const sentPrefix = localMessage.emergency ? 'EMERGENCY: ' : '';
                const delivered = await live.sendText(`${sentPrefix}${text}`);
                if (!delivered) {
                    await queueOutgoingMessage(localMessage);
                    setStatus('Bluetooth send failed; message queued for the next successful node connection.');
                    return;
                }
                const synced: MeshMessage = { ...localMessage, relayed_by: 'Your node', synced: true };
                await saveMessage(synced);
                setMessages(prev => prev.map(m => (m.id === localMessage.id ? synced : m)));
                setStatus(delivered ? 'Broadcast sent over your mesh.' : 'Could not send over Bluetooth; try reconnecting.');
                return;
            }

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
            setStatus(`Demo broadcast sent via ${data.message.relayed_by}.`);
        } catch {
            await queueOutgoingMessage(localMessage);
            setStatus('Offline or unreachable: message queued locally and will broadcast when connection returns.');
        } finally {
            setSending(false);
        }
    };

    const sendQuickMessage = (quick: QuickMessage) => void sendMessage(quick.text, quick.emergency);

    const addQuickMessage = () => {
        const text = newQuickText.trim();
        if (!text) {
            setError('Type the quick message text first.');
            return;
        }
        const label = newQuickLabel.trim() || text.slice(0, 24);
        const next = [...quickMessages, createQuickMessage(label, text, newQuickEmergency)];
        setQuickMessages(next);
        saveQuickMessages(next);
        setNewQuickLabel('');
        setNewQuickText('');
        setNewQuickEmergency(false);
    };

    const removeQuickMessage = (id: string) => {
        const next = quickMessages.filter(q => q.id !== id);
        setQuickMessages(next);
        saveQuickMessages(next);
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
                    border: `1px solid ${live.status === 'connected' ? '#166534' : '#334155'}`,
                    borderRadius: 10,
                    padding: '0.6rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    flexWrap: 'wrap'
                }}
            >
                <div style={{ display: 'grid', gap: '0.15rem' }}>
                    <strong style={{ fontSize: '0.9rem' }}>
                        {live.status === 'connected' ? `Connected: ${live.deviceName || 'Your node'}` : LIVE_STATUS_LABEL[live.status]}
                    </strong>
                    <span style={{ fontSize: '0.78rem', opacity: 0.75 }}>
                        {live.status === 'connected'
                            ? 'Messages send and receive for real over your paired Meshtastic node.'
                            : 'Tap connect and pick the node you already paired in the Meshtastic app.'}
                    </span>
                </div>
                {live.status === 'connected' ? (
                    <button className="soft-button" onClick={live.disconnect}>
                        Disconnect
                    </button>
                ) : (
                    <button className="soft-button" onClick={() => void live.connectBluetooth()} disabled={live.status === 'connecting'}>
                        {live.status === 'connecting' ? 'Connecting...' : 'Connect My Node (Bluetooth)'}
                    </button>
                )}
            </div>
            {live.error && <div style={{ color: '#fecaca', fontSize: '0.82rem' }}>{live.error}</div>}

            <div style={{ display: 'grid', gap: '0.4rem' }}>
                <div style={{ fontSize: '0.82rem', opacity: 0.75, fontWeight: 600 }}>Quick Messages (one tap, works with your connected node)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {quickMessages.map(quick => (
                        <button
                            key={quick.id}
                            className="soft-button"
                            onClick={() => sendQuickMessage(quick)}
                            disabled={sending}
                            style={quick.emergency ? { borderColor: '#7f1d1d', color: '#fecaca' } : undefined}
                            title={quick.text}
                        >
                            {quick.emergency ? '⚠ ' : ''}
                            {quick.label}
                        </button>
                    ))}
                    {quickMessages.length === 0 && <span style={{ opacity: 0.65, fontSize: '0.82rem' }}>No quick messages yet — add one below.</span>}
                </div>
                <details>
                    <summary style={{ cursor: 'pointer', fontSize: '0.82rem', opacity: 0.8 }}>Manage quick messages</summary>
                    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {quickMessages.map(quick => (
                            <div key={quick.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.84rem' }}>
                                <span>
                                    {quick.emergency ? 'EMERGENCY · ' : ''}
                                    {quick.label} — <span style={{ opacity: 0.75 }}>{quick.text}</span>
                                </span>
                                <button className="soft-button" onClick={() => removeQuickMessage(quick.id)} style={{ borderColor: '#7f1d1d', color: '#fecaca' }}>
                                    Remove
                                </button>
                            </div>
                        ))}
                        <div style={{ display: 'grid', gap: '0.35rem', paddingTop: '0.35rem', borderTop: '1px solid #334155' }}>
                            <input
                                value={newQuickLabel}
                                onChange={e => setNewQuickLabel(e.target.value)}
                                placeholder="Button label (e.g. Heading home)"
                                maxLength={24}
                                style={{ borderRadius: 8, border: '1px solid #334155', background: 'rgba(2,6,23,0.6)', color: 'inherit', padding: '0.4rem 0.5rem' }}
                            />
                            <input
                                value={newQuickText}
                                onChange={e => setNewQuickText(e.target.value)}
                                placeholder="Message text to send"
                                maxLength={200}
                                style={{ borderRadius: 8, border: '1px solid #334155', background: 'rgba(2,6,23,0.6)', color: 'inherit', padding: '0.4rem 0.5rem' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem' }}>
                                    <input type="checkbox" checked={newQuickEmergency} onChange={e => setNewQuickEmergency(e.target.checked)} />
                                    Emergency
                                </label>
                                <button className="soft-button" onClick={addQuickMessage}>
                                    Add quick message
                                </button>
                            </div>
                        </div>
                    </div>
                </details>
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
