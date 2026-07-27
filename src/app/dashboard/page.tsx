'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import TicketForm from '@/components/TicketForm';
import TicketList from '@/components/TicketList';
import KanbanBoard from '@/components/KanbanBoard';
import ActivityFeed from '@/components/ActivityFeed';
import { loadRolesWithFallback } from '@/lib/roleData';
import { getTicketNumber } from '@/lib/ticketNumber';
import { isMissingTableSetupError } from '@/lib/supabaseErrors';
import {
    STATUS_OPTIONS,
    roleNameToSlug,
    type Profile,
    type Role,
    type Ticket
} from '@/lib/boardTypes';

export default function DashboardPage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [email, setEmail] = useState<string>('');
    const [roles, setRoles] = useState<Role[]>([]);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [selectedRoleId, setSelectedRoleId] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<string>('all');
    const [ticketSearch, setTicketSearch] = useState<string>('');
    const [boardMode, setBoardMode] = useState<'kanban' | 'list'>('kanban');
    const [pageError, setPageError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    const supabase = supabaseClient();

    const humanizeDbError = (message: string) => {
        if (isMissingTableSetupError({ message }, ['tickets'])) {
            return 'Database setup missing: run SUPABASE_SETUP.md SQL in this Supabase project, then refresh.';
        }
        const lower = message.toLowerCase();
        if (lower.includes("could not find the table 'public.roles'")) {
            return 'roles table missing: run SUPABASE_SETUP.md SQL, then refresh.';
        }
        if (lower.includes("could not find the table 'public.profiles'")) {
            return 'profiles table missing: run SUPABASE_SETUP.md SQL, then refresh.';
        }
        return message;
    };

    useEffect(() => {
        const load = async () => {
            try {
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

                const { data: ticketDataWithErrorCheck, error: ticketsError } = await supabase
                    .from('tickets')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (ticketsError) {
                    throw ticketsError;
                }

                const safeRoles = (await loadRolesWithFallback(supabase)).filter(
                    r => r && typeof r.id === 'string' && typeof r.name === 'string'
                ) as Role[];

                const safeTickets = (ticketDataWithErrorCheck || [])
                    .filter(t => t && typeof t.id === 'string')
                    .map(t => ({
                        ...t,
                        ticket_number:
                            typeof (t as any).ticket_number === 'string' || (t as any).ticket_number === null
                                ? (t as any).ticket_number
                                : null,
                        title: typeof t.title === 'string' ? t.title : 'Untitled ticket',
                        description:
                            typeof t.description === 'string' || t.description === null
                                ? t.description
                                : String(t.description),
                        status:
                            t.status === 'open' ||
                                t.status === 'in_progress' ||
                                t.status === 'closed'
                                ? t.status
                                : 'open',
                        priority: typeof t.priority === 'string' ? t.priority : 'normal',
                        role_id:
                            typeof t.role_id === 'string' || t.role_id === null
                                ? t.role_id
                                : null,
                        created_by:
                            typeof t.created_by === 'string' || t.created_by === null
                                ? t.created_by
                                : null,
                        assigned_to:
                            typeof t.assigned_to === 'string' || t.assigned_to === null
                                ? t.assigned_to
                                : null,
                        created_at:
                            typeof t.created_at === 'string'
                                ? t.created_at
                                : new Date().toISOString(),
                        updated_at:
                            typeof t.updated_at === 'string'
                                ? t.updated_at
                                : new Date().toISOString()
                    })) as Ticket[];

                setProfile(effectiveProfile);
                setRoles(safeRoles);
                setTickets(safeTickets);
                setPageError(null);
                setLoading(false);
            } catch (err: any) {
                setPageError(humanizeDbError(err?.message || 'Dashboard failed to load. Please refresh.'));
                setLoading(false);
            }
        };

        load();
    }, []);

    const refreshTickets = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('tickets')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }
            setTickets((data || []) as Ticket[]);
            setPageError(null);
        } catch (err: any) {
            setPageError(humanizeDbError(err?.message || 'Could not refresh tickets.'));
        }
    }, [supabase]);

    useEffect(() => {
        const channel = supabase
            .channel('dashboard-tickets-live')
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
    }, [refreshTickets, supabase]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        router.push('/');
    };

    const roleName =
        roles.find(r => r.id === profile?.role_id)?.name ?? 'No role set';

    const roleFilteredTickets = useMemo(() => {
        return tickets.filter(t => {
            const roleMatch =
                selectedRoleId === 'all'
                    ? true
                    : selectedRoleId === 'unassigned'
                        ? t.role_id === null
                        : t.role_id === selectedRoleId;
            return roleMatch;
        });
    }, [tickets, selectedRoleId]);

    const searchedTickets = useMemo(() => {
        const query = ticketSearch.trim().toLowerCase();
        if (!query) return roleFilteredTickets;

        return roleFilteredTickets.filter(ticket => {
            const ticketNumber = getTicketNumber(ticket).toLowerCase();
            const haystack = `${ticket.title} ${ticket.description || ''}`.toLowerCase();
            return haystack.includes(query) || ticketNumber.includes(query);
        });
    }, [roleFilteredTickets, ticketSearch]);

    const statusFilteredTickets = useMemo(() => {
        if (selectedStatus === 'all') return searchedTickets;
        return searchedTickets.filter(t => t.status === selectedStatus);
    }, [searchedTickets, selectedStatus]);

    const showingCount = boardMode === 'kanban' ? searchedTickets.length : statusFilteredTickets.length;

    const ticketCounts = useMemo(() => {
        return {
            all: tickets.length,
            open: tickets.filter(t => t.status === 'open').length,
            in_progress: tickets.filter(t => t.status === 'in_progress').length,
            closed: tickets.filter(t => t.status === 'closed').length
        };
    }, [tickets]);

    const roleCounts = useMemo(() => {
        const counts: Record<string, number> = {
            all: tickets.length,
            unassigned: tickets.filter(t => t.role_id === null).length
        };
        for (const role of roles) {
            counts[role.id] = tickets.filter(t => t.role_id === role.id).length;
        }
        return counts;
    }, [roles, tickets]);

    if (loading) return <div className="panel-soft">Loading...</div>;

    if (pageError) {
        return (
            <div
                className="panel-soft"
                style={{ borderColor: '#7f1d1d', background: '#1f1111', gap: '0.65rem' }}
            >
                <div style={{ fontWeight: 600 }}>Dashboard Error</div>
                <div style={{ fontSize: '0.9rem', color: '#fecaca' }}>{pageError}</div>
                <button
                    onClick={() => window.location.reload()}
                    className="button-secondary"
                    style={{ width: 'fit-content' }}
                >
                    Reload page
                </button>
            </div>
        );
    }

    return (
        <div className="page-stack" style={{ gap: '1.5rem' }}>
            <div className="toolbar toolbar-spread">
                <div>
                    <div className="section-eyebrow">Logged in as</div>
                    <div>{profile?.full_name || email || 'Unknown user'}</div>
                    <div className="section-subtle">{email}</div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                        Role: {roleName}
                    </div>
                </div>
                <button onClick={handleSignOut} className="button-danger">
                    Sign out
                </button>
            </div>

            <div className="panel-soft" style={{ gap: '0.8rem' }}>
                <div style={{ fontWeight: 600 }}>Board Views</div>
                <div>
                    <Link
                        href="/dashboard/roles"
                        className="chip-link-muted"
                    >
                        Open Role Directory
                    </Link>
                    <span className="inline-dot">•</span>
                    <Link
                        href="/dashboard/meetings"
                        className="chip-link-muted"
                    >
                        Open Board Meetings
                    </Link>
                    <span className="inline-dot">•</span>
                    <Link
                        href="/dashboard/system"
                        className="chip-link-muted"
                    >
                        Open System Check
                    </Link>
                    <span className="inline-dot">•</span>
                    <Link
                        href="/dashboard/property-map"
                        className="chip-link-muted"
                    >
                        Open Property Map
                    </Link>
                    <span className="inline-dot">•</span>
                    <Link
                        href="/dashboard/treestands"
                        className="chip-link-muted"
                    >
                        Open Treestands / Range
                    </Link>
                    <span className="inline-dot">•</span>
                    <Link
                        href="/dashboard/trail-cams"
                        className="chip-link-muted"
                    >
                        Open Trail Cams
                    </Link>
                    <span className="inline-dot">•</span>
                    <Link
                        href="/dashboard/calendar"
                        className="chip-link-muted"
                    >
                        Open Hunting / Fishing Calendar
                    </Link>
                </div>
                <div className="pill-row">
                    <button
                        onClick={() => setSelectedRoleId('all')}
                        className={`pill-button ${selectedRoleId === 'all' ? 'active-blue' : ''}`}
                    >
                        All Roles ({roleCounts.all || 0})
                    </button>
                    <div className="pill-item">
                        <button
                            onClick={() => setSelectedRoleId('unassigned')}
                            className={`pill-button ${selectedRoleId === 'unassigned' ? 'active-blue' : ''}`}
                        >
                            Unassigned ({roleCounts.unassigned || 0})
                        </button>
                        <Link href="/dashboard/role/unassigned" className="chip-link-muted" style={{ fontSize: '0.72rem' }}>
                            Open page
                        </Link>
                    </div>
                    {roles.map(role => (
                        <div key={role.id} className="pill-item">
                            <button
                                onClick={() => setSelectedRoleId(role.id)}
                                className={`pill-button ${selectedRoleId === role.id ? 'active-blue' : ''}`}
                            >
                                {role.name} ({roleCounts[role.id] || 0})
                            </button>
                            <Link
                                href={`/dashboard/role/${roleNameToSlug(role.name)}`}
                                className="chip-link-muted"
                                style={{ fontSize: '0.72rem' }}
                            >
                                Open page
                            </Link>
                        </div>
                    ))}
                </div>

                <div className="pill-row">
                    {STATUS_OPTIONS.map(status => (
                        <button
                            key={status.key}
                            onClick={() => setSelectedStatus(status.key)}
                            className={`pill-button ${selectedStatus === status.key ? 'active-green' : ''}`}
                        >
                            {status.label}
                        </button>
                    ))}
                </div>

                <div className="field-stack">
                    <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>Find tickets by title, notes, or ticket number</div>
                    <input
                        value={ticketSearch}
                        onChange={e => setTicketSearch(e.target.value)}
                        placeholder="Search tickets or enter a ticket number like TKT-2026-12345"
                        className="input-compact"
                    />
                </div>

                <div className="stats-row">
                    <span>All: {ticketCounts.all}</span>
                    <span>Open: {ticketCounts.open}</span>
                    <span>In Progress: {ticketCounts.in_progress}</span>
                    <span>Closed: {ticketCounts.closed}</span>
                    <span>Showing: {showingCount}</span>
                </div>

                <div className="pill-row">
                    <button
                        onClick={() => setBoardMode('kanban')}
                        className={`pill-button ${boardMode === 'kanban' ? 'active-cyan' : ''}`}
                    >
                        Kanban View
                    </button>
                    <button
                        onClick={() => setBoardMode('list')}
                        className={`pill-button ${boardMode === 'list' ? 'active-cyan' : ''}`}
                    >
                        List View
                    </button>
                </div>
            </div>

            <TicketForm roles={roles} onCreated={refreshTickets} />
            {boardMode === 'kanban' ? (
                <KanbanBoard
                    tickets={searchedTickets}
                    roles={roles}
                    onChanged={refreshTickets}
                />
            ) : (
                <TicketList
                    tickets={statusFilteredTickets}
                    roles={roles}
                    onChanged={refreshTickets}
                />
            )}
            <ActivityFeed maxItems={60} maxHeight={620} />
        </div>
    );
}
