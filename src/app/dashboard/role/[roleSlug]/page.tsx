'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseClient } from '@/lib/supabaseClient';
import TicketForm from '@/components/TicketForm';
import TicketList from '@/components/TicketList';
import KanbanBoard from '@/components/KanbanBoard';
import ActivityFeed from '@/components/ActivityFeed';
import { isUuid, type Profile, type Role, type Ticket } from '@/lib/boardTypes';
import { roleSlugToName } from '@/lib/boardTypes';
import { loadRolesWithFallback } from '@/lib/roleData';

export default function RoleDashboardPage() {
    const params = useParams<{ roleSlug: string }>();
    const router = useRouter();
    const supabase = supabaseClient();

    const [profile, setProfile] = useState<Profile | null>(null);
    const [roles, setRoles] = useState<Role[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);

    const roleSlug = params?.roleSlug || '';
    const roleName = roleSlugToName(roleSlug);

    const loadData = async () => {
        const {
            data: { user }
        } = await supabase.auth.getUser();

        if (!user) {
            router.push('/');
            return;
        }

        const { data: profileData } = await supabase
            .from('profiles')
            .select('id, full_name, role_id')
            .eq('id', user.id)
            .maybeSingle();

        let effectiveProfile = profileData as Profile | null;

        if (!effectiveProfile) {
            await supabase.from('profiles').upsert({
                id: user.id,
                full_name: user.email,
                role_id: null
            });

            const { data: createdProfile } = await supabase
                .from('profiles')
                .select('id, full_name, role_id')
                .eq('id', user.id)
                .maybeSingle();

            effectiveProfile = (createdProfile as Profile | null) || {
                id: user.id,
                full_name: user.email || 'Family Member',
                role_id: null
            };
        }

        setProfile(effectiveProfile);
        setRoles(await loadRolesWithFallback(supabase));
        setLoading(false);
    };

    useEffect(() => {
        loadData();
    }, []);

    const selectedRole = useMemo(() => {
        if (!roleName) return null;
        if (roleName === 'Unassigned') return { id: 'unassigned', name: 'Unassigned' } as Role;
        return roles.find(r => r.name.toLowerCase() === roleName.toLowerCase()) || null;
    }, [roles, roleName]);

    const refreshTickets = useCallback(async () => {
        if (!selectedRole) return;

        const baseQuery = supabase
            .from('tickets')
            .select('*')
            .order('created_at', { ascending: false });

        if (selectedRole.id !== 'unassigned' && !isUuid(selectedRole.id)) {
            setTickets([]);
            return;
        }

        const { data } = selectedRole.id === 'unassigned'
            ? await baseQuery.is('role_id', null)
            : await baseQuery.eq('role_id', selectedRole.id);

        setTickets((data || []) as Ticket[]);
    }, [selectedRole, supabase]);

    useEffect(() => {
        refreshTickets();
    }, [refreshTickets]);

    useEffect(() => {
        const channel = supabase
            .channel(`role-tickets-live-${roleSlug || 'all'}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tickets' },
                () => {
                    refreshTickets();
                }
            )
            .subscribe();

        const pollId = window.setInterval(() => {
            refreshTickets();
        }, 10000);

        return () => {
            window.clearInterval(pollId);
            supabase.removeChannel(channel);
        };
    }, [refreshTickets, roleSlug, supabase]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    if (loading) return <div>Loading...</div>;

    if (!roleName) {
        return (
            <div style={{ display: 'grid', gap: '1rem' }}>
                <div>Role page not found.</div>
                <Link href="/dashboard" style={{ color: '#93c5fd' }}>
                    Return to main dashboard
                </Link>
                <Link href="/dashboard/roles" style={{ color: '#93c5fd' }}>
                    Open role directory
                </Link>
            </div>
        );
    }

    if (!selectedRole) {
        return (
            <div style={{ display: 'grid', gap: '1rem' }}>
                <div>Role {roleName} does not exist in your roles table yet.</div>
                <Link href="/dashboard" style={{ color: '#93c5fd' }}>
                    Return to main dashboard
                </Link>
                <Link href="/dashboard/roles" style={{ color: '#93c5fd' }}>
                    Open role directory
                </Link>
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '1.25rem' }}>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.75rem'
                }}
            >
                <div>
                    <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>Role Board</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{selectedRole.name}</div>
                    <div style={{ fontSize: '0.82rem', opacity: 0.7 }}>
                        Logged in as {profile?.full_name || 'Family Member'}
                    </div>
                </div>

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
                    <button
                        onClick={handleSignOut}
                        style={{
                            padding: '0.4rem 0.75rem',
                            borderRadius: 6,
                            border: '1px solid #f97373',
                            background: 'transparent',
                            color: '#fecaca',
                            cursor: 'pointer'
                        }}
                    >
                        Sign out
                    </button>
                </div>
            </div>

            <KanbanBoard tickets={tickets} roles={roles} onChanged={refreshTickets} />
            <TicketForm roles={roles} onCreated={refreshTickets} />
            <ActivityFeed title="Role Activity Notifications" />
            <TicketList tickets={tickets} roles={roles} onChanged={refreshTickets} />
        </div>
    );
}
