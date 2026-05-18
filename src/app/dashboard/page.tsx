'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import TicketForm from '@/components/TicketForm';
import TicketList from '@/components/TicketList';

export type Role = {
    id: string;
    name: string;
};

type Profile = {
    id: string;
    full_name: string | null;
    role_id: string | null;
    role?: Role | null;
};

export type Ticket = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    role_id: string | null;
    created_by: string | null;
    assigned_to: string | null;
    created_at: string;
    updated_at: string;
};

const STATUS_OPTIONS = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'closed', label: 'Closed' }
] as const;

export default function DashboardPage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [email, setEmail] = useState<string>('');
    const [roles, setRoles] = useState<Role[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [selectedRoleId, setSelectedRoleId] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<string>('all');
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

            setEmail(user.email || '');

            const { data: profileData } = await supabase
                .from('profiles')
                .select('id, full_name, role_id')
                .eq('id', user.id)
                .maybeSingle();

            let effectiveProfile = profileData as Profile | null;

            if (!effectiveProfile) {
                // Self-heal missing profile rows so users do not land as unknown.
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

            const { data: rolesData } = await supabase
                .from('roles')
                .select('id, name')
                .order('name', { ascending: true });

            const { data: ticketsData } = await supabase
                .from('tickets')
                .select('*')
                .order('created_at', { ascending: false });

            setProfile(effectiveProfile);
            setRoles((rolesData || []) as Role[]);
            setTickets((ticketsData || []) as Ticket[]);
            setLoading(false);
        };

        load();
    }, []);

    const refreshTickets = async () => {
        const { data } = await supabase
            .from('tickets')
            .select('*')
            .order('created_at', { ascending: false });
        setTickets((data || []) as Ticket[]);
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    if (loading) return <div>Loading...</div>;

    const roleName =
        roles.find(r => r.id === profile?.role_id)?.name ?? 'No role set';

    const filteredTickets = useMemo(() => {
        return tickets.filter(t => {
            const roleMatch =
                selectedRoleId === 'all' ? true : t.role_id === selectedRoleId;
            const statusMatch =
                selectedStatus === 'all' ? true : t.status === selectedStatus;
            return roleMatch && statusMatch;
        });
    }, [tickets, selectedRoleId, selectedStatus]);

    const ticketCounts = useMemo(() => {
        return {
            all: tickets.length,
            open: tickets.filter(t => t.status === 'open').length,
            in_progress: tickets.filter(t => t.status === 'in_progress').length,
            closed: tickets.filter(t => t.status === 'closed').length
        };
    }, [tickets]);

    const roleCounts = useMemo(() => {
        const counts: Record<string, number> = { all: tickets.length };
        for (const role of roles) {
            counts[role.id] = tickets.filter(t => t.role_id === role.id).length;
        }
        return counts;
    }, [roles, tickets]);

    return (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}
            >
                <div>
                    <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>Logged in as</div>
                    <div>{profile?.full_name || email || 'Unknown user'}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{email}</div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                        Role: {roleName}
                    </div>
                </div>
                <button
                    onClick={handleSignOut}
                    style={{
                        padding: '0.4rem 0.75rem',
                        borderRadius: 4,
                        border: '1px solid #f97373',
                        background: 'transparent',
                        color: '#fecaca',
                        cursor: 'pointer'
                    }}
                >
                    Sign out
                </button>
            </div>

            <div
                style={{
                    border: '1px solid #1f2937',
                    borderRadius: 8,
                    padding: '1rem',
                    background: '#020617',
                    display: 'grid',
                    gap: '0.8rem'
                }}
            >
                <div style={{ fontWeight: 600 }}>Board Views</div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        onClick={() => setSelectedRoleId('all')}
                        style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: 999,
                            border: selectedRoleId === 'all' ? '1px solid #93c5fd' : '1px solid #334155',
                            background: selectedRoleId === 'all' ? '#1e3a8a' : 'transparent',
                            color: '#e2e8f0',
                            cursor: 'pointer'
                        }}
                    >
                        All Roles ({roleCounts.all || 0})
                    </button>
                    {roles.map(role => (
                        <button
                            key={role.id}
                            onClick={() => setSelectedRoleId(role.id)}
                            style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: 999,
                                border: selectedRoleId === role.id ? '1px solid #93c5fd' : '1px solid #334155',
                                background: selectedRoleId === role.id ? '#1e3a8a' : 'transparent',
                                color: '#e2e8f0',
                                cursor: 'pointer'
                            }}
                        >
                            {role.name} ({roleCounts[role.id] || 0})
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {STATUS_OPTIONS.map(status => (
                        <button
                            key={status.key}
                            onClick={() => setSelectedStatus(status.key)}
                            style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: 999,
                                border: selectedStatus === status.key ? '1px solid #86efac' : '1px solid #334155',
                                background: selectedStatus === status.key ? '#14532d' : 'transparent',
                                color: '#e2e8f0',
                                cursor: 'pointer'
                            }}
                        >
                            {status.label}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem', opacity: 0.9 }}>
                    <span>All: {ticketCounts.all}</span>
                    <span>Open: {ticketCounts.open}</span>
                    <span>In Progress: {ticketCounts.in_progress}</span>
                    <span>Closed: {ticketCounts.closed}</span>
                    <span>Showing: {filteredTickets.length}</span>
                </div>
            </div>

            <TicketForm roles={roles} onCreated={refreshTickets} />
            <TicketList
                tickets={filteredTickets}
                roles={roles}
                onChanged={refreshTickets}
            />
        </div>
    );
}
