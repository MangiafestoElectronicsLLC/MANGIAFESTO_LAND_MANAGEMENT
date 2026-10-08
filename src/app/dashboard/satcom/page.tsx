'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import MeshOverview from '@/components/satcom/MeshOverview';
import NodeList from '@/components/satcom/NodeList';
import MessageConsole from '@/components/satcom/MessageConsole';
import DeviceOnboarding from '@/components/satcom/DeviceOnboarding';
import HowToUse from '@/components/satcom/HowToUse';
import HeltecGuide from '@/components/satcom/HeltecGuide';
import EmergencyGuide from '@/components/satcom/EmergencyGuide';
import type { MeshMetrics, MeshNode } from '@/lib/meshTypes';
import { useMeshtasticConnection, type LiveIncomingMessage, type MeshtasticConnection } from '@/lib/useMeshtasticConnection';
import { batteryHealth, BATTERY_HEALTH_COLOR, BATTERY_HEALTH_LABEL } from '@/lib/meshDeviceRegistry';

const STATUS_POLL_MS = 15000;

// Big, simple status card at the top of the page: one glance tells you whether
// you're connected, to what, and how much battery it has left.
function ConnectionHero({ live }: { live: MeshtasticConnection }) {
    const connected = live.status === 'connected';
    const health = batteryHealth(live.ownBattery?.pct ?? null);
    const [deviceId, setDeviceId] = useState('9148');
    const [wifiAddress, setWifiAddress] = useState('');
    const [caps, setCaps] = useState({ serial: false, bluetooth: false });

    useEffect(() => {
        const saved = window.localStorage.getItem('family-land-satcom-device-id');
        if (saved !== null) setDeviceId(saved);
        setWifiAddress(window.localStorage.getItem('family-land-satcom-wifi-address') ?? '');
        setCaps({ serial: 'serial' in navigator, bluetooth: 'bluetooth' in navigator });
    }, []);

    const updateWifiAddress = (value: string) => {
        setWifiAddress(value);
        window.localStorage.setItem('family-land-satcom-wifi-address', value);
    };

    const updateDeviceId = (value: string) => {
        setDeviceId(value);
        window.localStorage.setItem('family-land-satcom-device-id', value);
    };

    const statusText: Record<typeof live.status, string> = {
        disconnected: 'Not connected',
        connecting: 'Connecting...',
        connected: `Connected: ${live.deviceName || 'Your node'}`,
        unsupported: 'Not supported here: try WiFi/VPN below',
        error: 'Connection error'
    };

    return (
        <section
            className="panel panel-pad"
            style={{
                border: `1px solid ${connected ? '#166534' : '#334155'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                flexWrap: 'wrap'
            }}
        >
            <div style={{ display: 'grid', gap: '0.25rem' }}>
                <span
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontWeight: 700,
                        fontSize: '1.05rem'
                    }}
                >
                    <span
                        style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: connected ? '#22c55e' : '#64748b',
                            display: 'inline-block'
                        }}
                    />
                    {statusText[live.status]}
                    {connected && live.ownBattery?.pct != null && (
                        <span style={{ fontSize: '0.85rem', color: BATTERY_HEALTH_COLOR[health], fontWeight: 400 }}>
                            🔋 {live.ownBattery.pct}% ({BATTERY_HEALTH_LABEL[health]})
                        </span>
                    )}
                </span>
                <span style={{ opacity: 0.75, fontSize: '0.85rem' }}>
                    {connected
                        ? 'Send messages and see live mesh status below.'
                        : 'Plug the node in by USB and tap Connect via USB, or use Bluetooth if it is already paired.'}
                </span>
                {live.error && <span style={{ color: '#fecaca', fontSize: '0.82rem' }}>{live.error}</span>}
            </div>
            {connected || live.status === 'connecting' ? (
                <button className="soft-button" onClick={live.disconnect}>
                    {connected ? 'Disconnect' : 'Cancel'}
                </button>
            ) : (
                <div style={{ display: 'grid', gap: '0.4rem', justifyItems: 'end' }}>
                    <input
                        value={deviceId}
                        onChange={e => updateDeviceId(e.target.value)}
                        placeholder="Device ID (e.g. 9148)"
                        inputMode="text"
                        maxLength={16}
                        aria-label="Meshtastic device ID"
                        title="The ID in your node's Bluetooth name, like Meshtastic_9148"
                        style={{ borderRadius: 8, border: '1px solid #334155', background: 'rgba(2,6,23,0.6)', color: 'inherit', padding: '0.4rem 0.55rem', width: 170 }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button className="soft-button" onClick={() => void live.connectBridge()} title="Works in any browser, including the VS Code preview. The node must be plugged into the computer running this app.">
                            Connect via USB (any browser)
                        </button>
                        {caps.serial && (
                            <button className="soft-button" onClick={() => void live.connectUsb()} title="Direct Web Serial from this browser">
                                USB (browser direct)
                            </button>
                        )}
                        <button
                            className="soft-button"
                            onClick={() => void live.connectBluetooth(undefined, { forcePicker: true, deviceId })}
                        >
                            Connect via Bluetooth
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <input
                            value={wifiAddress}
                            onChange={e => updateWifiAddress(e.target.value)}
                            placeholder="Optional: node IP (leave blank to auto-find)"
                            aria-label="Node WiFi or VPN address (optional)"
                            style={{ borderRadius: 8, border: '1px solid #334155', background: 'rgba(2,6,23,0.6)', color: 'inherit', padding: '0.4rem 0.55rem', width: 260 }}
                        />
                        <button
                            className="soft-button"
                            title="Finds your node on WiFi or VPN automatically. Only type an address if auto-find fails."
                            onClick={async () => {
                                const used = await live.connectWifi(wifiAddress);
                                if (used && !wifiAddress.trim()) updateWifiAddress(used);
                            }}
                        >
                            Auto-connect (WiFi / VPN)
                        </button>
                    </div>
                    <div style={{ fontSize: '0.74rem', opacity: 0.65, maxWidth: 420, textAlign: 'right' }}>
                        {caps.serial ? 'USB ✔ ' : 'USB direct ✖ '}·{' '}
                        {caps.bluetooth ? 'Bluetooth ✔ ' : 'Bluetooth ✖ (Chrome/Edge/Android) '}· WiFi/VPN ✔ works in any browser
                    </div>
                </div>
            )}
        </section>
    );
}

export default function SatcomPage() {
    const router = useRouter();
    const supabase = supabaseClient();

    const [senderName, setSenderName] = useState('Land Board User');
    const [nodes, setNodes] = useState<MeshNode[]>([]);
    const [metrics, setMetrics] = useState<MeshMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // The connection lives here so both the onboarding wizard and the message
    // console drive the same paired node.
    const incomingHandlerRef = useRef<((message: LiveIncomingMessage) => void) | null>(null);
    const handleIncomingMessage = useCallback((message: LiveIncomingMessage) => {
        incomingHandlerRef.current?.(message);
    }, []);
    const registerIncomingHandler = useCallback((handler: (message: LiveIncomingMessage) => void) => {
        incomingHandlerRef.current = handler;
    }, []);
    const live = useMeshtasticConnection({ onIncomingMessage: handleIncomingMessage });
    const liveStatus = live.status;
    const liveNodes = live.nodes;

    useEffect(() => {
        const bootstrap = async () => {
            const {
                data: { user }
            } = await supabase.auth.getUser();

            if (!user) {
                router.push('/');
                return;
            }

            const { data: profileData } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('id', user.id)
                .maybeSingle();

            setSenderName(profileData?.full_name || user.email || 'Land Board User');
        };

        void bootstrap();

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {
                // best-effort only; page still works without offline caching
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let cancelled = false;

        const fetchStatus = async () => {
            try {
                const response = await fetch('/api/mesh/status');
                if (!response.ok) throw new Error('Mesh status API returned an error.');
                const data = await response.json();
                if (cancelled) return;
                setNodes(data.nodes || []);
                setMetrics(data.metrics || null);
                setError(null);
            } catch {
                if (!cancelled) setError('Could not reach the mesh status API. Showing last known data.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void fetchStatus();
        const interval = window.setInterval(() => {
            // Skip demo polling once a real node is connected; live events take over.
            if (liveStatus !== 'connected') void fetchStatus();
        }, STATUS_POLL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveStatus]);

    const displayNodes = liveStatus === 'connected' ? liveNodes : nodes;
    const displayMetrics =
        liveStatus === 'connected'
            ? {
                total_nodes: liveNodes.length,
                online_nodes: liveNodes.length,
                reachable_nodes: liveNodes.length,
                gateway_online: true,
                channel_utilization_pct: 0,
                last_updated: new Date().toISOString()
            }
            : metrics;

    return (
        <div className="page-stack">
            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.35rem' }}>
                <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Off-Grid Communications</div>
                <h1 style={{ margin: 0 }}>SatCom / Off-Grid Comms</h1>
                <p style={{ margin: 0, opacity: 0.8 }}>
                    Connect your Meshtastic node, then send a message — no phone signal needed anywhere on the land.
                </p>
            </section>

            <ConnectionHero live={live} />

            <div style={{ display: 'grid', gap: '1rem' }}>
                <MessageConsole senderName={senderName} live={live} registerIncomingHandler={registerIncomingHandler} />
                <DeviceOnboarding live={live} ownerName={senderName} />
                <HeltecGuide />
                <EmergencyGuide />

                <details className="panel panel-pad">
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Mesh Network Details (Advanced)</summary>
                    <div style={{ display: 'grid', gap: '1rem', marginTop: '0.85rem' }}>
                        <MeshOverview
                            nodes={displayNodes}
                            metrics={displayMetrics}
                            loading={loading}
                            error={error}
                            simulated={liveStatus !== 'connected'}
                        />
                        <NodeList nodes={displayNodes} loading={loading} />
                    </div>
                </details>

                <details className="panel panel-pad">
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>How Meshnology Works (Setup &amp; Guide)</summary>
                    <div style={{ display: 'grid', gap: '1rem', marginTop: '0.85rem' }}>
                        <HowToUse />
                        <div style={{ fontSize: '0.9rem', opacity: 0.85, display: 'grid', gap: '0.4rem' }}>
                            <p style={{ margin: 0 }}>
                                The cabin gateway node bridges the Meshtastic mesh to the internet. Once connected via
                                Bluetooth above, this page talks directly to your paired node using the same protocol as the
                                Meshtastic app — no separate gateway server required for basic messaging and node status.
                            </p>
                            <p style={{ margin: 0 }}>
                                Messages you send here are stored locally in your browser (IndexedDB) so history survives
                                reloads and works offline, then sync automatically once you&apos;re back online — the same
                                pattern used by Property Map and Land Wifi for offline-first editing on this dashboard.
                            </p>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );
}
