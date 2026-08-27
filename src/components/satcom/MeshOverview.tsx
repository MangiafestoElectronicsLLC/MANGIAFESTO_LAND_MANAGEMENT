'use client';

import type { MeshMetrics, MeshNode } from '@/lib/meshTypes';

type MeshOverviewProps = {
    nodes: MeshNode[];
    metrics: MeshMetrics | null;
    loading: boolean;
    error: string | null;
    simulated: boolean;
};

const roleOrder: Record<MeshNode['role'], number> = { gateway: 0, relay: 1, portable: 2 };

export default function MeshOverview({ nodes, metrics, loading, error, simulated }: MeshOverviewProps) {
    const sorted = [...nodes].sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.hop_count - b.hop_count);
    const gateway = sorted.find(n => n.role === 'gateway');

    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                    <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Mesh Network Overview</div>
                    <h2 style={{ margin: 0 }}>Nodes → Relays → Gateway</h2>
                </div>
                {simulated && (
                    <span style={{ border: '1px solid #92400e', borderRadius: 999, padding: '0.22rem 0.6rem', color: '#fde68a', fontSize: '0.78rem', alignSelf: 'flex-start' }}>
                        Simulated demo data
                    </span>
                )}
            </div>

            {error && (
                <div style={{ border: '1px solid #7f1d1d', borderRadius: 10, padding: '0.7rem', color: '#fecaca' }}>{error}</div>
            )}

            {loading && !metrics ? (
                <div style={{ opacity: 0.75 }}>Loading mesh status...</div>
            ) : metrics ? (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.86rem' }}>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>
                        Nodes online: {metrics.online_nodes}/{metrics.total_nodes}
                    </span>
                    <span
                        style={{
                            border: `1px solid ${metrics.gateway_online ? '#166534' : '#7f1d1d'}`,
                            borderRadius: 999,
                            padding: '0.22rem 0.6rem',
                            color: metrics.gateway_online ? '#bbf7d0' : '#fecaca'
                        }}
                    >
                        Gateway: {metrics.gateway_online ? 'Online' : 'Offline'}
                    </span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>
                        Reachable: {metrics.reachable_nodes}
                    </span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>
                        Channel use: {metrics.channel_utilization_pct}%
                    </span>
                    <span style={{ opacity: 0.65, fontSize: '0.78rem', alignSelf: 'center' }}>
                        Updated {new Date(metrics.last_updated).toLocaleTimeString()}
                    </span>
                </div>
            ) : null}

            {/* Simple text-based topology: gateway at top, relays fan out, portables hang off nearest relay/hop */}
            <div style={{ display: 'grid', gap: '0.5rem' }}>
                {gateway && (
                    <div style={{ border: '1px solid #166534', borderRadius: 10, padding: '0.55rem 0.75rem', background: 'rgba(22,101,52,0.12)' }}>
                        <strong>{gateway.name}</strong>{' '}
                        <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>
                            (gateway · {gateway.online ? `${gateway.signal_dbm} dBm` : 'offline'})
                        </span>
                    </div>
                )}
                {sorted
                    .filter(n => n.role !== 'gateway')
                    .map(node => (
                        <div
                            key={node.id}
                            style={{
                                marginLeft: `${Math.min(node.hop_count, 4) * 1.25}rem`,
                                border: '1px solid #334155',
                                borderRadius: 10,
                                padding: '0.5rem 0.7rem',
                                opacity: node.online ? 1 : 0.55,
                                display: 'flex',
                                gap: '0.5rem',
                                flexWrap: 'wrap',
                                alignItems: 'center'
                            }}
                        >
                            <span style={{ opacity: 0.6 }}>{'↳'.repeat(1)}</span>
                            <strong>{node.name}</strong>
                            <span style={{ opacity: 0.75, fontSize: '0.82rem' }}>
                                ({node.role} · hop {node.hop_count} · {node.online ? `${node.signal_dbm} dBm` : 'offline'})
                            </span>
                        </div>
                    ))}
                {sorted.length === 0 && !loading && <div style={{ opacity: 0.7 }}>No nodes reported yet.</div>}
            </div>
        </section>
    );
}
