'use client';

import { useEffect, useState } from 'react';
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
    created_at: string;
    updated_at: string;
};

export default function DashboardPage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [roles, setRoles] = useState<Role[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
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

            const { data: profileData } = await supabase
                .from('profiles')
                .select('id, full_name, role_id')
                .eq('id', user.id)
                .single();

            const { data: rolesData } = await supabase
                .from('roles')
                .select('id, name')
                .order('name', { ascending: true });

            const { data: ticketsData } = await supabase
                .from('tickets')
                .select('*')
                .order('created_at', { ascending: false });

            setProfile(profileData as Profile);
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
                    <div>{profile?.full_name ?? 'Unknown user'}</div>
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

            <TicketForm roles={roles} onCreated={refreshTickets} />
            <TicketList tickets={tickets} onChanged={refreshTickets} />
        </div>
    );
}
