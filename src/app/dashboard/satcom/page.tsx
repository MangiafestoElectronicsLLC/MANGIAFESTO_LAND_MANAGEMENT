'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import MessageConsole from '@/components/satcom/MessageConsole';
import DeviceOnboarding from '@/components/satcom/DeviceOnboarding';
import RadioAssignments from '@/components/satcom/RadioAssignments';
import { useMeshtasticConnection, type LiveIncomingMessage, type MeshtasticConnection } from '@/lib/useMeshtasticConnection';
import { loadFamilyNodeIds, saveFamilyNodeIds } from '@/lib/meshFamilyNodes';
import { nodeNumberFromId } from '@/lib/meshMessageRouting';
import type { RadioAssignment } from '@/lib/meshRadioAssignments';

const inputStyle: React.CSSProperties = {
    borderRadius: 8, border: '1px solid #475569', background: 'rgba(2,6,23,0.6)',
    color: 'inherit', padding: '0.55rem', maxWidth: '100%'
};

function ConnectionCard({ live }: { live: MeshtasticConnection }) {
    const [wifiAddress, setWifiAddress] = useState('');
    const [serial, setSerial] = useState(false);
    const [localServer, setLocalServer] = useState(false);
    const connected = live.status === 'connected';
    const connecting = live.status === 'connecting';

    useEffect(() => {
        setSerial('serial' in navigator);
        setLocalServer(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname));
        setWifiAddress(window.localStorage.getItem('family-land-satcom-wifi-address') || '');
    }, []);

    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.8rem', border: `1px solid ${connected ? '#166534' : '#475569'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>1. Connect a radio</h2>
                    <p role="status" style={{ margin: '0.4rem 0 0' }}>
                        {connected ? `Connected to ${live.deviceName || 'your radio'}` : connecting ? 'Connecting to your radio...' : 'No radio connected'}
                        {connected && live.ownBattery?.pct != null ? ` · Battery ${live.ownBattery.pct}%` : ''}
                    </p>
                </div>
                {(connected || connecting) && <button className="soft-button" onClick={live.disconnect}>{connecting ? 'Cancel' : 'Disconnect'}</button>}
            </div>
            {!connected && !connecting && (
                <>
                    <p style={{ margin: 0, opacity: 0.85 }}>Turn on your Meshtastic radio and choose how to connect. No Meshtastic login is needed.</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button className="soft-button" onClick={() => void live.connectBluetooth(undefined, { forcePicker: true })}>Connect with Bluetooth</button>
                        {serial && <button className="soft-button" onClick={() => void live.connectUsb()}>Connect with USB</button>}
                        {localServer && <button className="soft-button" onClick={() => void live.connectBridge()}>Connect USB on this computer</button>}
                    </div>
                    <div style={{ opacity: 0.8, fontSize: '0.88rem' }}>For USB, close or disconnect the official Meshtastic client first: only one app can use the port. If the browser picker does not appear, try the local USB option.</div>
                </>
            )}
            {live.error && <div role="alert" style={{ color: '#fecaca' }}>{live.error}</div>}
            {!connected && !connecting && (
                <details>
                    <summary style={{ cursor: 'pointer' }}>More connection options</summary>
                    <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.6rem' }}>
                        {!localServer && <div><button className="soft-button" onClick={() => void live.connectBridge()}>USB on the app server</button> <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>For a radio plugged into the computer running the app; the local bridge must be enabled.</span></div>}
                        <label htmlFor="radio-address">Radio Wi-Fi address (optional)</label>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <input id="radio-address" value={wifiAddress} placeholder="IP address or leave blank" onChange={e => {
                                setWifiAddress(e.target.value);
                                window.localStorage.setItem('family-land-satcom-wifi-address', e.target.value);
                            }} style={inputStyle} />
                            <button className="soft-button" onClick={() => void live.connectWifi(wifiAddress)}>Connect with Wi-Fi</button>
                        </div>
                        <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>The radio must already have Wi-Fi configured. The server must allow Wi-Fi node connections, and HTTPS pages require an HTTPS radio address trusted by your browser.</span>
                    </div>
                </details>
            )}
        </section>
    );
}

export default function SatcomPage() {
    const router = useRouter();
    const [senderName, setSenderName] = useState('Land Board User');
    const [userId, setUserId] = useState('');
    const [client, setClient] = useState<'official' | 'built-in'>('built-in');

    useEffect(() => {
        const bootstrap = async () => {
            const supabase = supabaseClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/');
                return;
            }
            const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
            setSenderName(profile?.full_name || user.email || 'Land Board User');
            setUserId(user.id);
        };
        void bootstrap();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {
                // Offline caching is optional.
            });
        }
    }, [router]);

    return (
        <div className="page-stack">
            <header className="panel panel-pad">
                <h1 style={{ margin: 0 }}>Off-Grid Comms</h1>
                <p style={{ margin: '0.4rem 0 0', opacity: 0.85 }}>Use Meshtastic to message your family without cell service.</p>
                <p style={{ margin: '0.4rem 0 0', opacity: 0.85 }}>Connect one radio to this app. Your other radios communicate with it over the mesh.</p>
            </header>
            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <h2 style={{ margin: 0 }}>Meshtastic</h2>
                    <button className="soft-button" onClick={() => setClient(client === 'official' ? 'built-in' : 'official')}>
                        {client === 'official' ? 'Try built-in chat' : 'Use official client'}
                    </button>
                </div>
                {client === 'official' && (
                    <>
                        <p style={{ margin: 0 }}>Connect a radio in the official client below. It cannot use your phone&apos;s existing connection; disconnect the phone app first if using Bluetooth.</p>
                        <p style={{ margin: 0 }}>For a group, choose <strong>Primary</strong> under Channels. For one person, select their verified radio in the node list and open a direct message. The two clients do not share connections or message history.</p>
                        <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>Unfamiliar nodes are radios yours has heard, possibly through relays or MQTT; their names do not prove who owns them. Verify node IDs with family. The default primary channel key is public: use a private shared channel key for family group messages.</p>
                        <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>The official client needs internet to load. After loading, radio messages can work without internet. Test coverage and ask for a reply; do not rely on it as your only emergency option.</p>
                        <iframe
                            title="Official Meshtastic web client"
                            src="https://client.meshtastic.org/"
                            allow="bluetooth; serial"
                            style={{ width: '100%', height: 'min(80vh, 900px)', minHeight: 500, border: '1px solid #475569', borderRadius: 10, background: '#0f172a' }}
                        />
                        <a href="https://client.meshtastic.org/" target="_blank" rel="noopener noreferrer">Open Meshtastic in a new tab</a>
                        <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>If the embedded client or device picker does not work, open it in a new Chrome or Edge tab. Your phone&apos;s Meshtastic app can continue to be used independently.</p>
                    </>
                )}
            </section>
            {client === 'built-in' && userId && <BuiltInComms senderName={senderName} userId={userId} />}
        </div>
    );
}

function BuiltInComms({ senderName, userId }: { senderName: string; userId: string }) {
    const [familyNodeIds, setFamilyNodeIds] = useState<string[]>([]);
    const [assignments, setAssignments] = useState<RadioAssignment[]>([]);
    const [familyNodesReady, setFamilyNodesReady] = useState(false);
    const [familyError, setFamilyError] = useState<string | null>(null);
    const incomingHandlerRef = useRef<((message: LiveIncomingMessage) => void) | null>(null);
    const handleIncomingMessage = useCallback((message: LiveIncomingMessage) => incomingHandlerRef.current?.(message), []);
    const registerIncomingHandler = useCallback((handler: (message: LiveIncomingMessage) => void) => {
        incomingHandlerRef.current = handler;
    }, []);
    const live = useMeshtasticConnection({ onIncomingMessage: handleIncomingMessage });

    useEffect(() => {
        try {
            setFamilyNodeIds(loadFamilyNodeIds());
            setFamilyNodesReady(true);
        } catch {
            setFamilyError('Could not load the family radio list. Check browser storage; waiting messages will not send until this is resolved.');
        }
    }, []);

    const updateFamily = (id: string, selected: boolean) => {
        const next = selected ? [...familyNodeIds, id] : familyNodeIds.filter(item => item !== id);
        try {
            saveFamilyNodeIds(next);
            setFamilyNodeIds(next);
            setFamilyError(null);
        } catch {
            setFamilyError('Could not save your family radio list in this browser.');
        }
    };

    return (
        <>
            <ConnectionCard live={live} />
            <RadioAssignments live={live} userId={userId} onChange={setAssignments} />
            <section className="panel panel-pad">
                <h2 style={{ margin: 0 }}>Family radios</h2>
                <p>Radios selected here and shared account assignments appear as direct-message recipients. Compare the full node ID with each family member&apos;s radio before selecting it.</p>
                {familyError && <p role="alert" style={{ color: '#fecaca' }}>{familyError}</p>}
                {!familyNodesReady ? null : live.status !== 'connected' ? <p>Connect a radio to choose your family devices.</p> : (
                    <>
                        {familyNodeIds.length === 0 && <p>No family radios selected yet.</p>}
                        <ul>
                            {familyNodeIds.map(id => {
                                const num = nodeNumberFromId(id);
                                const node = live.nodes.find(item => item.id === id);
                                return <li key={id}>{node?.name || 'Not reported by this radio'} {num !== null && `(!${num.toString(16).padStart(8, '0')})`} <button className="soft-button" onClick={() => updateFamily(id, false)}>Remove</button></li>;
                            })}
                        </ul>
                        <details>
                            <summary style={{ cursor: 'pointer' }}>Choose radios from detected nodes</summary>
                            <p>Other nodes may appear because your radio heard them. Names can be duplicated; verify each full ID before adding it.</p>
                            {live.nodes.filter(node => !familyNodeIds.includes(node.id)).map(node => {
                                const num = nodeNumberFromId(node.id);
                                return num === null ? null : <div key={node.id} style={{ marginBottom: '0.5rem' }}>{node.name} (!{num.toString(16).padStart(8, '0')}) {num === live.ownNodeNum && '(connected radio)'} <button className="soft-button" onClick={() => updateFamily(node.id, true)}>Add to family</button></div>;
                            })}
                        </details>
                    </>
                )}
                <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>This list only filters this app; it does not block other radios from the mesh or make group broadcasts private. The official client has its own separate node list.</p>
            </section>
            <MessageConsole senderName={senderName} live={live} registerIncomingHandler={registerIncomingHandler} familyNodeIds={familyNodeIds} familyNodesReady={familyNodesReady} assignments={assignments} />
            <details className="panel panel-pad">
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Help &amp; offline tips</summary>
                <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.8rem' }}>
                    <p style={{ margin: 0 }}>Sign in to this app and open this page while online; keep it open when internet is unavailable. Reopening or signing in offline is not guaranteed.</p>
                    <p style={{ margin: 0 }}>If your radios already communicate, there is no need to reflash them. Keep antennas attached before powering them on.</p>
                    <p style={{ margin: 0 }}>In the Meshtastic phone app, check that all radios use the correct region for your location and matching modem and primary channel settings. Keep channel keys private.</p>
                    <p style={{ margin: 0 }}>For USB, use a data cable and close other apps using the port. If no port appears, try another cable or USB port and check Windows Device Manager. For Bluetooth, use Chrome or Edge on a secure page and disconnect the phone app first.</p>
                    <p style={{ margin: 0 }}>Test by sending a radio check and asking another person to reply. Range depends on terrain and placement. Do not rely on this page as your only emergency communication method.</p>
                </div>
            </details>
            <details className="panel panel-pad">
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Saved device setup</summary>
                <DeviceOnboarding live={live} ownerName={senderName} />
            </details>
        </>
    );
}
