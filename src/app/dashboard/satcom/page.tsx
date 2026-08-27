'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import MeshOverview from '@/components/satcom/MeshOverview';
import NodeList from '@/components/satcom/NodeList';
import MessageConsole from '@/components/satcom/MessageConsole';
import HowToUse from '@/components/satcom/HowToUse';
import EmergencyGuide from '@/components/satcom/EmergencyGuide';
import type { MeshMetrics, MeshNode } from '@/lib/meshTypes';
import type { LiveConnectionStatus } from '@/lib/useMeshtasticConnection';

const STATUS_POLL_MS = 15000;

export default function SatcomPage() {
    const router = useRouter();
    const supabase = supabaseClient();

    const [senderName, setSenderName] = useState('Land Board User');
    const [nodes, setNodes] = useState<MeshNode[]>([]);
    const [metrics, setMetrics] = useState<MeshMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [liveNodes, setLiveNodes] = useState<MeshNode[]>([]);
    const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>('disconnected');

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
            <div className="toolbar">
                <Link href="/dashboard" className="chip-link">
                    Main Dashboard
                </Link>
                <Link href="/dashboard/land-wifi" className="chip-link">
                    Land Wifi
                </Link>
                <Link href="/dashboard/property-map" className="chip-link">
                    Property Map
                </Link>
                <Link href="/dashboard/system" className="chip-link">
                    System Check
                </Link>
            </div>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.35rem' }}>
                <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Off-Grid Communications</div>
                <h1 style={{ margin: 0 }}>SatCom / Off-Grid Comms</h1>
                <p style={{ margin: 0, opacity: 0.8 }}>
                    Monitor your ESP32 LoRa V3 (SX1262) Meshtastic mesh, send off-grid messages when phone signal is
                    gone, and use emergency communication tools anywhere on the land.
                </p>
            </section>

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
                <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
                    <MeshOverview
                        nodes={displayNodes}
                        metrics={displayMetrics}
                        loading={loading}
                        error={error}
                        simulated={liveStatus !== 'connected'}
                    />
                    <NodeList nodes={displayNodes} loading={loading} />
                </div>
                <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
                    <MessageConsole senderName={senderName} onLiveNodesChange={setLiveNodes} onLiveStatusChange={setLiveStatus} />
                </div>
            </div>

            <EmergencyGuide />

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
    );
}
