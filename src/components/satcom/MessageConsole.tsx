'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeshMessage } from '@/lib/meshTypes';
import { deleteQueuedMessage, loadMessages, loadQueuedMessages, makeMessageId, markQueuedMessageSent, saveMessage, saveQueuedMessage } from '@/lib/meshMessageStore';
import type { LiveIncomingMessage, MeshtasticConnection } from '@/lib/useMeshtasticConnection';
import { createQuickMessage, loadQuickMessages, rememberRemovedDefault, saveQuickMessages, type QuickMessage } from '@/lib/quickMessages';
import { nodeNumberFromId, targetForQueuedMessage, type MessageTarget } from '@/lib/meshMessageRouting';
import { formatRadioId, isApprovedQueuedTarget, isApprovedRadio, type RadioAssignment } from '@/lib/meshRadioAssignments';

type Props = {
    senderName: string;
    live: MeshtasticConnection;
    registerIncomingHandler: (handler: (message: LiveIncomingMessage) => void) => void;
    familyNodeIds: string[];
    familyNodesReady: boolean;
    assignments: RadioAssignment[];
};

const MAX_BYTES = 200;
const wireText = (message: Pick<MeshMessage, 'text' | 'emergency'>) => `${message.emergency ? 'EMERGENCY: ' : ''}${message.text}`;
const byteLength = (text: string) => new TextEncoder().encode(text).length;
const fieldStyle: React.CSSProperties = {
    borderRadius: 8, border: '1px solid #475569', background: 'rgba(2,6,23,0.6)', color: 'inherit', padding: '0.55rem', maxWidth: '100%'
};

export default function MessageConsole({ senderName, live, registerIncomingHandler, familyNodeIds, familyNodesReady, assignments }: Props) {
    const [messages, setMessages] = useState<MeshMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [emergency, setEmergency] = useState(false);
    const [sending, setSending] = useState(false);
    const [flushing, setFlushing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [quickMessages, setQuickMessages] = useState<QuickMessage[]>([]);
    const [quickLabel, setQuickLabel] = useState('');
    const [quickText, setQuickText] = useState('');
    const [quickEmergency, setQuickEmergency] = useState(false);
    const [recipient, setRecipient] = useState('group');
    const flushRunning = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const connected = live.status === 'connected';
    const { sendText } = live;
    const recipientNum = nodeNumberFromId(recipient);
    const recipientAvailable = recipientNum !== null && recipientNum !== live.ownNodeNum &&
        (assignments.some(item => item.nodeNum === recipientNum) ||
            (familyNodeIds.includes(recipient) && live.nodes.some(node => node.id === recipient)));

    useEffect(() => {
        setQuickMessages(loadQuickMessages());
        loadMessages().then(stored => setMessages(current => {
            const ids = new Set(current.map(message => message.id));
            return [...stored.filter(message => !ids.has(message.id)), ...current];
        })).catch(() => setError('Could not load messages saved on this browser. Check browser storage permissions.'));
    }, []);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    const handleIncoming = useCallback((incoming: LiveIncomingMessage) => {
        const message: MeshMessage = {
            id: makeMessageId(), text: incoming.text, sender: assignments.find(item => item.nodeNum === incoming.fromNodeNum)?.userName || incoming.fromNodeName,
            direction: 'incoming', relayed_by: incoming.fromNodeName, emergency: incoming.emergency,
            created_at: new Date().toISOString(), synced: true,
            target: incoming.direct && incoming.ownNodeNum != null
                ? { kind: 'direct', nodeNum: incoming.fromNodeNum, nodeName: incoming.fromNodeName, fromNodeNum: incoming.ownNodeNum }
                : { kind: 'group' }
        };
        setMessages(prev => [...prev, message]);
        void saveMessage(message).catch(() => setError('A received message could not be saved in this browser.'));
    }, [assignments]);

    useEffect(() => {
        registerIncomingHandler(handleIncoming);
    }, [handleIncoming, registerIncomingHandler]);

    const flushQueue = useCallback(async (onlyId?: string) => {
        if (!connected || !familyNodesReady) return;
        if (flushRunning.current) {
            setError('Another message is being sent. Try again when it finishes.');
            return;
        }
        flushRunning.current = true;
        setFlushing(true);
        try {
                const queued = await loadQueuedMessages();
                let skippedDirect = false;
                for (const message of queued.filter(item => !onlyId || item.id === onlyId).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
                    if (byteLength(wireText(message)) > MAX_BYTES) {
                        setError('A saved message is too long to send. It remains saved on this browser.');
                        return;
                    }
                    const destination = targetForQueuedMessage(message, live.ownNodeNum);
                    if (destination === null || !isApprovedQueuedTarget(message.target, familyNodeIds, assignments)) {
                        skippedDirect = true;
                        continue;
                    }
                    const fromNodeNum = message.target?.kind === 'direct' ? message.target.fromNodeNum : undefined;
                    if (!(await sendText(wireText(message), destination, fromNodeNum))) {
                        setError('Could not send to the radio. The message is saved here; reconnect or try again.');
                        return;
                    }
                    const sent = { ...message, relayed_by: 'Your node', synced: true };
                    await markQueuedMessageSent(sent);
                    setMessages(prev => prev.map(item => item.id === sent.id ? sent : item));
                    setError(null);
                    setNotice('Handed to your radio. Ask someone to reply to confirm receipt.');
                }
                if (skippedDirect) setError('A direct message is waiting for its original sending radio and recipient assignment. If the assignment changed, remove the waiting message and write a new one.');
        } catch {
            setError('Could not update saved messages. Check browser storage; a message may already have reached the radio.');
        } finally {
            flushRunning.current = false;
            setFlushing(false);
        }
    }, [connected, familyNodeIds, familyNodesReady, assignments, live.ownNodeNum, sendText]);

    const sendMessage = async (value = draft, urgent = emergency) => {
        if (sending || flushing) return;
        setError(null);
        setNotice(null);
        const text = value.trim();
        if (!text) {
            setError('Write a message first.');
            return;
        }
        if (byteLength(wireText({ text, emergency: urgent })) > MAX_BYTES) {
            setError('Message is too long. Use fewer than 200 bytes, including the emergency label. Emoji and accented letters use extra bytes.');
            return;
        }
        let target: MessageTarget = { kind: 'group' };
        if (recipient !== 'group') {
            const node = live.nodes.find(item => item.id === recipient);
            const nodeNum = nodeNumberFromId(recipient);
            const assignment = assignments.find(item => item.nodeNum === nodeNum);
            if (!connected || !familyNodesReady || nodeNum == null || !isApprovedRadio(nodeNum, familyNodeIds, assignments) || live.ownNodeNum == null || (!node && !assignment) || nodeNum === live.ownNodeNum) {
                setError('Connect your radio and choose an approved family recipient before sending a direct message.');
                return;
            }
            target = { kind: 'direct', nodeNum, nodeName: assignment?.userName || node?.name || formatRadioId(nodeNum), fromNodeNum: live.ownNodeNum, assignedUserId: assignment?.userId };
        }
        setSending(true);
        const message: MeshMessage = {
            id: makeMessageId(), text, sender: senderName, direction: 'outgoing',
            relayed_by: null, emergency: urgent, created_at: new Date().toISOString(), synced: false, target
        };
        try {
            await saveQueuedMessage(message);
            setMessages(prev => [...prev, message]);
            if (value === draft) {
                setDraft('');
                setEmergency(false);
            }
            if (connected) {
                await flushQueue(message.id);
            } else {
                setNotice('Saved on this browser. Connect a radio and choose Send waiting messages.');
            }
        } catch {
            setError('Could not save your message. Check browser storage and try again.');
        } finally {
            setSending(false);
        }
    };

    const addQuick = () => {
        const text = quickText.trim();
        if (!text || byteLength(wireText({ text, emergency: quickEmergency })) > MAX_BYTES) {
            setError('Enter a quick message of at most 200 bytes, including the emergency label.');
            return;
        }
        const next = [...quickMessages, createQuickMessage(quickLabel.trim() || text.slice(0, 24), text, quickEmergency)];
        try {
            saveQuickMessages(next);
            setQuickMessages(next);
            setQuickLabel('');
            setQuickText('');
            setQuickEmergency(false);
        } catch {
            setError('Could not save the quick message in this browser.');
        }
    };

    const removeWaiting = async (id: string) => {
        if (flushRunning.current) return;
        flushRunning.current = true;
        setFlushing(true);
        try {
            await deleteQueuedMessage(id);
            setMessages(prev => prev.filter(message => message.id !== id));
            setNotice('Waiting message removed.');
        } catch {
            setError('Could not remove the waiting message from this browser.');
        } finally {
            flushRunning.current = false;
            setFlushing(false);
        }
    };

    const removeQuick = (id: string) => {
        try {
            const next = quickMessages.filter(item => item.id !== id);
            rememberRemovedDefault(id);
            saveQuickMessages(next);
            setQuickMessages(next);
        } catch {
            setError('Could not update quick messages in this browser.');
        }
    };

    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.8rem' }}>
            <div>
                <h2 style={{ margin: 0 }}>2. Message your family</h2>
                <p style={{ margin: '0.35rem 0 0', opacity: 0.85 }}>
                    {connected ? 'Choose the primary channel or one known radio.' : 'Saved messages wait until you choose to send them.'}
                </p>
            </div>
            <label htmlFor="mesh-recipient">Send to</label>
            <select id="mesh-recipient" value={recipient} onChange={event => setRecipient(event.target.value)} style={fieldStyle}>
                <option value="group">Group - primary channel</option>
                {recipient !== 'group' && !recipientAvailable && <option value={recipient}>Recipient unavailable - reconnect or select another</option>}
                {assignments.filter(item => item.nodeNum !== live.ownNodeNum).map(item =>
                    <option key={item.userId} value={`live-${item.nodeNum}`}>{item.userName} - {formatRadioId(item.nodeNum)}</option>
                )}
                {live.nodes.filter(node => {
                    const num = nodeNumberFromId(node.id);
                    return num !== null && num !== live.ownNodeNum && familyNodeIds.includes(node.id) && !assignments.some(item => item.nodeNum === num);
                }).map(node => <option key={node.id} value={node.id}>{node.name} (!{nodeNumberFromId(node.id)!.toString(16).padStart(8, '0')})</option>)}
            </select>
            {familyNodeIds.length === 0 && assignments.length === 0 && <p style={{ margin: 0, fontSize: '0.85rem' }}>Assign radios to accounts or add family radios above to enable direct messages.</p>}
            <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>
                {recipient === 'group'
                    ? 'Everyone with the primary channel key may read group messages. The default key is public.'
                    : 'Verify the node ID with the person first. Direct-message privacy depends on radio firmware, keys and settings.'}
            </p>
            <div>
                <h3 style={{ margin: '0 0 0.35rem' }}>Quick messages</h3>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
                    {connected ? 'Tap a button to send to the selected recipient.' : 'Tap a button to save it for later; it will not send automatically.'}
                </p>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {quickMessages.map(quick => <button key={quick.id} className="soft-button" disabled={sending || flushing} title={quick.text} onClick={() => void sendMessage(quick.text, quick.emergency)}>{quick.label}</button>)}
                </div>
            </div>
            <div ref={scrollRef} aria-label="Message history" role="log" aria-live="polite" style={{ display: 'grid', alignContent: 'start', gap: '0.5rem', height: 320, overflowY: 'auto', border: '1px solid #334155', borderRadius: 12, padding: '0.75rem', background: 'rgba(2,6,23,0.45)' }}>
                {messages.length === 0 ? <p style={{ opacity: 0.75, textAlign: 'center' }}>No messages yet. Send a radio check to get started.</p> : messages.map(message => (
                    <div key={message.id} style={{ justifySelf: message.direction === 'outgoing' ? 'end' : 'start', maxWidth: '90%', borderRadius: 12, padding: '0.55rem 0.75rem', overflowWrap: 'anywhere', background: message.emergency ? 'rgba(127,29,29,0.5)' : message.direction === 'outgoing' ? 'rgba(22,101,52,0.55)' : 'rgba(30,41,59,0.9)' }}>
                        {message.direction === 'incoming' && <strong>{message.sender}</strong>}
                        <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                            {message.target?.kind === 'direct' ? `Direct ${message.direction === 'incoming' ? 'from' : 'to'} ${message.target.nodeName} (!${message.target.nodeNum.toString(16).padStart(8, '0')})` : 'Primary channel'}
                        </div>
                        <div>{message.emergency && !message.text.startsWith('EMERGENCY: ') ? 'EMERGENCY: ' : ''}{message.text}</div>
                        <div style={{ opacity: 0.8, fontSize: '0.75rem' }}>
                            {new Date(message.created_at).toLocaleString()}
                            {message.direction === 'outgoing' && (message.synced ? message.relayed_by === 'Your node' ? ' · Handed to radio' : ' · Older message (delivery unknown)' : ' · Waiting to send')}
                        </div>
                        {message.direction === 'outgoing' && !message.synced && <button className="soft-button" disabled={flushing} onClick={() => void removeWaiting(message.id)} aria-label={`Remove waiting message: ${message.text}`}>Remove</button>}
                    </div>
                ))}
            </div>
            {error && <div role="alert" style={{ color: '#fecaca' }}>{error}</div>}
            {notice && <div role="status" style={{ color: '#bbf7d0' }}>{notice}</div>}
            <label htmlFor="mesh-message">Your message</label>
            <textarea id="mesh-message" value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder="Type your message" style={{ ...fieldStyle, width: '100%', resize: 'vertical' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <label><input type="checkbox" checked={emergency} onChange={e => setEmergency(e.target.checked)} /> Mark urgent</label>
                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>{byteLength(wireText({ text: draft, emergency }))}/{MAX_BYTES} bytes</span>
                <button className="soft-button" onClick={() => void sendMessage()} disabled={sending || flushing || !draft.trim()}>{sending ? 'Saving...' : connected ? 'Send message' : 'Save for later'}</button>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>Messages stay in this browser. Waiting messages send only when you choose to send them; direct messages require their original radio. Ask for a reply to confirm delivery. Urgent messages are not a substitute for emergency services.</p>
            {connected && messages.some(message => message.direction === 'outgoing' && !message.synced) && <div><button className="soft-button" disabled={flushing} onClick={() => void flushQueue()}>Send waiting messages</button></div>}
            <details>
                <summary style={{ cursor: 'pointer' }}>Manage quick messages</summary>
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {quickMessages.map(quick => <div key={quick.id}>{quick.label}: {quick.text} <button className="soft-button" onClick={() => removeQuick(quick.id)}>Remove</button></div>)}
                    <label htmlFor="quick-label">Button label</label>
                    <input id="quick-label" value={quickLabel} onChange={e => setQuickLabel(e.target.value)} maxLength={24} style={fieldStyle} />
                    <label htmlFor="quick-text">Message text</label>
                    <input id="quick-text" value={quickText} onChange={e => setQuickText(e.target.value)} style={fieldStyle} />
                    <label><input type="checkbox" checked={quickEmergency} onChange={e => setQuickEmergency(e.target.checked)} /> Mark urgent</label>
                    <div><button className="soft-button" onClick={addQuick}>Add quick message</button></div>
                </div>
            </details>
        </section>
    );
}
