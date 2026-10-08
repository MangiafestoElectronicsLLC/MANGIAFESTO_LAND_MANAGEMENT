'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
    { href: '/dashboard', label: 'Dashboard', exact: true },
    { href: '/dashboard/tickets', label: 'Tickets' },
    { href: '/dashboard/trail-cams', label: 'Trail Cams' },
    { href: '/dashboard/land-wifi', label: 'Land Wifi' },
    { href: '/dashboard/satcom', label: 'SatCom / Off-Grid Comms' },
    { href: '/dashboard/property-map', label: 'Property Map' },
    { href: '/dashboard/treestands', label: 'Treestands / Range' },
    { href: '/dashboard/calendar', label: 'Hunting / Fishing Calendar' },
    { href: '/dashboard/roles', label: 'Roles' },
    { href: '/dashboard/meetings', label: 'Board Meetings' },
    { href: '/dashboard/system', label: 'System Check' }
];

export default function PrimaryNav() {
    const pathname = usePathname() || '';

    return (
        <nav className="app-nav" aria-label="Primary">
            {links.map(({ href, label, exact }) => {
                const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
                return (
                    <Link key={href} href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
