'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { loadRolesWithFallback } from '@/lib/roleData';
import { roleNameToSlug, type Role } from '@/lib/boardTypes';

export default function RolesDirectoryPage() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const supabase = supabaseClient();

    useEffect(() => {
        const load = async () => {
            const {
                data: { user }
            } = await supabase.auth.getUser();

            if (!user) {
                router.push('/');
                return;
            }

            const loadedRoles = await loadRolesWithFallback(supabase);
            setRoles(loadedRoles);
            setLoading(false);
        };

        load();
    }, []);

    if (loading) return <div className="panel-soft">Loading roles...</div>;

    return (
        <div className="page-stack">
            <div>
                <div className="section-eyebrow">Role Directory</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>Open Any Role Board</div>
            </div>

            <div className="page-stack" style={{ gap: '0.5rem' }}>
                <Link href="/dashboard" className="chip-link-muted">
                    Main Dashboard
                </Link>
                <Link href="/dashboard/role/unassigned" className="chip-link-muted">
                    Unassigned Tickets Board
                </Link>
                {roles.map(role => (
                    <Link
                        key={role.id}
                        href={`/dashboard/role/${roleNameToSlug(role.name)}`}
                        className="chip-link-muted"
                    >
                        {role.name} Board
                    </Link>
                ))}
            </div>
        </div>
    );
}
