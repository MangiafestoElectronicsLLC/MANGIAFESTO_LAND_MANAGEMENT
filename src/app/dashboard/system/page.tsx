'use client';

import Link from 'next/link';
import SystemCheckPanel from '@/components/SystemCheckPanel';

export default function SystemPage() {
    return (
        <div className="page-stack">
            <div className="toolbar">
                <Link href="/dashboard" className="chip-link">
                    Main Dashboard
                </Link>
                <Link href="/dashboard/roles" className="chip-link">
                    Role Directory
                </Link>
                <Link href="/dashboard/meetings" className="chip-link">
                    Board Meetings
                </Link>
                <Link href="/dashboard/property-map" className="chip-link">
                    Property Map
                </Link>
                <Link href="/dashboard/treestands" className="chip-link">
                    Treestands / Range
                </Link>
            </div>

            <SystemCheckPanel />
        </div>
    );
}
