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

    if (loading) return <div>Loading roles...</div>;

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
                <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>Role Directory</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>Open Any Role Board</div>
            </div>

            <div style={{ display: 'grid', gap: '0.5rem' }}>
                <Link href="/dashboard" style={{ color: '#93c5fd', textDecoration: 'none' }}>
                    Main Dashboard
                </Link>
                <Link href="/dashboard/role/unassigned" style={{ color: '#93c5fd', textDecoration: 'none' }}>
                    Unassigned Tickets Board
                </Link>
                {roles.map(role => (
                    <Link
                        key={role.id}
                        href={`/dashboard/role/${roleNameToSlug(role.name)}`}
                        style={{ color: '#93c5fd', textDecoration: 'none' }}
                    >
                        {role.name} Board
                    </Link>
                ))}
            </div>
        </div>
    );
}
