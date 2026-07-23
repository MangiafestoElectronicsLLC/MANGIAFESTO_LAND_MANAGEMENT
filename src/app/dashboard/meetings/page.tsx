'use client';

import Link from 'next/link';
import BoardMeetingsStudio from '@/components/BoardMeetingsStudio';

export default function MeetingsPage() {
    return (
        <div className="page-stack">
            <div className="toolbar">
                <Link href="/dashboard" className="chip-link">
                    Main Dashboard
                </Link>
                <Link href="/dashboard/roles" className="chip-link">
                    Role Directory
                </Link>
                <Link href="/dashboard/tickets" className="chip-link">
                    Tickets
                </Link>
                <Link href="/dashboard/system" className="chip-link">
                    System Check
                </Link>
                <Link href="/dashboard/property-map" className="chip-link">
                    Property Map
                </Link>
                <Link href="/dashboard/calendar" className="chip-link">
                    Hunting/Fishing Calendar
                </Link>
            </div>

            <BoardMeetingsStudio />
        </div>
    );
}