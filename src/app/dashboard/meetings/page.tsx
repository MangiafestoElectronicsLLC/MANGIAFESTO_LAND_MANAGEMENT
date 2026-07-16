'use client';

import Link from 'next/link';
import BoardMeetingsStudio from '@/components/BoardMeetingsStudio';

export default function MeetingsPage() {
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
                    href="/dashboard/tickets"
                    style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: 6,
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        textDecoration: 'none'
                    }}
                >
                    Tickets
                </Link>
                <Link
                    href="/dashboard/system"
                    style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: 6,
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        textDecoration: 'none'
                    }}
                >
                    System Check
                </Link>
            </div>

            <BoardMeetingsStudio />
        </div>
    );
}