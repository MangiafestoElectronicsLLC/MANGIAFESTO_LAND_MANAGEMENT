'use client';

import Link from 'next/link';
import SystemCheckPanel from '@/components/SystemCheckPanel';

export default function SystemPage() {
    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link
                    href="/dashboard"
                    style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: 6,
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        textDecoration: 'none'
                    }}
                >
                    Main Dashboard
                </Link>
                <Link
                    href="/dashboard/roles"
                    style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: 6,
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        textDecoration: 'none'
                    }}
                >
                    Role Directory
                </Link>
                <Link
                    href="/dashboard/meetings"
                    style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: 6,
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        textDecoration: 'none'
                    }}
                >
                    Board Meetings
                </Link>
                <Link
                    href="/dashboard/property-map"
                    style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: 6,
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        textDecoration: 'none'
                    }}
                >
                    Property Map
                </Link>
            </div>

            <SystemCheckPanel />
        </div>
    );
}
