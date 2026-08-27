'use client';

import type { MeshNode } from '@/lib/meshTypes';

type NodeListProps = {
    nodes: MeshNode[];
    loading: boolean;
};

const ROLE_LABELS: Record<MeshNode['role'], string> = {
    portable: 'Portable',
    relay: 'Relay',
    gateway: 'Gateway',
    unknown: 'Mesh Node'
};

const formatLastHeard = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.max(0, Math.round(diffMs / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
};

const batteryColor = (pct: number) => {
    if (pct >= 60) return '#bbf7d0';
    if (pct >= 25) return '#fde68a';
    return '#fecaca';
};

export default function NodeList({ nodes, loading }: NodeListProps) {
    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
            <div>
                <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Fleet Status</div>
                <h2 style={{ margin: 0 }}>Your LoRa Nodes</h2>
            </div>

            {loading && nodes.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Loading nodes...</div>
            ) : (
                <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                    {nodes.map(node => (
                        <article
                            key={node.id}
                            style={{
                                border: node.online ? '1px solid #166534' : '1px solid #334155',
                                borderRadius: 12,
                                padding: '0.75rem',
                                background: 'rgba(2, 6, 23, 0.55)',
                                display: 'grid',
                                gap: '0.4rem',
                                opacity: node.online ? 1 : 0.65
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                                <strong>{node.name}</strong>
                                <span
                                    style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        background: node.online ? '#22c55e' : '#64748b',
                                        display: 'inline-block'
                                    }}
                                    title={node.online ? 'Online' : 'Offline'}
                                />
                            </div>
                            <span style={{ opacity: 0.8, fontSize: '0.82rem' }}>{ROLE_LABELS[node.role]} · {node.region}</span>
                            <div style={{ fontSize: '0.84rem', display: 'grid', gap: '0.2rem' }}>
                                <span>
                                    Battery:{' '}
                                    <strong style={{ color: batteryColor(node.battery_pct) }}>{node.battery_pct}%</strong>
                                </span>
                                <span>Last heard: {node.online ? formatLastHeard(node.last_heard) : 'unreachable'}</span>
                                <span>Firmware: v{node.firmware_version}</span>
                                <span>
                                    GPS:{' '}
                                    {node.gps_lat != null && node.gps_lng != null
                                        ? `${node.gps_lat.toFixed(4)}, ${node.gps_lng.toFixed(4)}`
                                        : 'not enabled'}
                                </span>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
