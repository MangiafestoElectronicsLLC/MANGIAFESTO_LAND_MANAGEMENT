'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type ActivityType = 'hunting' | 'fishing';

type SeasonEntry = {
    id: string;
    species: string;
    type: ActivityType;
    openMonths: number[];
    location: string;
    notes: string;
};

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];

const ALL_MONTHS = Array.from({ length: 12 }, (_, idx) => idx + 1);

const SEASONS: SeasonEntry[] = [
    {
        id: 'deer-bow',
        species: 'White-tailed deer (bow)',
        type: 'hunting',
        openMonths: [10, 11, 12],
        location: 'Brockport, NY region',
        notes: 'Typical Southern Zone timing. Check annual NYS DEC rules for exact zone dates.'
    },
    {
        id: 'deer-regular',
        species: 'White-tailed deer (regular season)',
        type: 'hunting',
        openMonths: [11, 12],
        location: 'Brockport, NY region',
        notes: 'Primary firearms season window in late fall.'
    },
    {
        id: 'turkey-spring',
        species: 'Wild turkey (spring)',
        type: 'hunting',
        openMonths: [5],
        location: 'Brockport, NY region',
        notes: 'Spring gobbler season with permit requirement.'
    },
    {
        id: 'turkey-fall',
        species: 'Wild turkey (fall)',
        type: 'hunting',
        openMonths: [10, 11],
        location: 'Brockport, NY region',
        notes: 'Fall turkey dates vary by management unit.'
    },
    {
        id: 'waterfowl',
        species: 'Duck and goose (waterfowl)',
        type: 'hunting',
        openMonths: [10, 11, 12, 1],
        location: 'Monroe County flyways',
        notes: 'Split seasons are common; verify state/federal frameworks each year.'
    },
    {
        id: 'small-game',
        species: 'Rabbit and squirrel',
        type: 'hunting',
        openMonths: [10, 11, 12, 1, 2],
        location: 'Western NY fields and woods',
        notes: 'Great winter option when big game seasons are closed.'
    },
    {
        id: 'trout-inland',
        species: 'Inland trout streams',
        type: 'fishing',
        openMonths: ALL_MONTHS,
        location: 'Monroe/Orleans waterways',
        notes: 'Year-round opportunities exist under current NY inland trout regulations.'
    },
    {
        id: 'bass',
        species: 'Largemouth and smallmouth bass',
        type: 'fishing',
        openMonths: ALL_MONTHS,
        location: 'Erie Canal and nearby waters',
        notes: 'Catch-and-release and harvest windows differ by date.'
    },
    {
        id: 'walleye',
        species: 'Walleye',
        type: 'fishing',
        openMonths: [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3],
        location: 'Lake Ontario tributaries',
        notes: 'Spring through winter pattern; closed period can apply in April.'
    },
    {
        id: 'northern-pike',
        species: 'Northern pike',
        type: 'fishing',
        openMonths: ALL_MONTHS,
        location: 'Canals and backwaters near Brockport',
        notes: 'Most zones offer year-round access with size/creel rules.'
    },
    {
        id: 'panfish',
        species: 'Panfish (perch, crappie, bluegill)',
        type: 'fishing',
        openMonths: ALL_MONTHS,
        location: 'Ponds, canals, and nearshore lakes',
        notes: 'Reliable year-round family fishing option.'
    }
];

export default function CalendarPage() {
    const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
    const [typeFilter, setTypeFilter] = useState<'all' | ActivityType>('all');
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        return SEASONS.filter(entry => {
            const monthMatch = entry.openMonths.includes(month);
            const typeMatch = typeFilter === 'all' ? true : entry.type === typeFilter;
            const queryMatch = query.trim()
                ? `${entry.species} ${entry.location} ${entry.notes}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase())
                : true;

            return monthMatch && typeMatch && queryMatch;
        });
    }, [month, query, typeFilter]);

    const huntingCount = filtered.filter(item => item.type === 'hunting').length;
    const fishingCount = filtered.filter(item => item.type === 'fishing').length;
    const huntingStatusByMonth = SEASONS.filter(item => item.type === 'hunting').map(item => ({
        ...item,
        inSeason: item.openMonths.includes(month)
    }));

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link href="/dashboard" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Main Dashboard
                </Link>
                <Link href="/dashboard/tickets" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Tickets
                </Link>
                <Link href="/dashboard/meetings" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Board Meetings
                </Link>
            </div>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.9rem' }}>
                <div style={{ display: 'grid', gap: '0.3rem' }}>
                    <div style={{ opacity: 0.85, fontSize: '0.85rem' }}>Brockport Seasonal Planner</div>
                    <h2 style={{ margin: 0, fontSize: 'clamp(1.4rem, 3.8vw, 2rem)' }}>Hunting / Fishing Calendar</h2>
                    <div style={{ opacity: 0.78, maxWidth: 860 }}>
                        Month-by-month season guide for the Brockport, New York area. Use this as a planning board, then verify final legal dates and bag limits in the current NYS DEC regulations.
                    </div>
                </div>

                <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>Month</span>
                        <select value={month} onChange={e => setMonth(Number(e.target.value))}>
                            {MONTHS.map((name, idx) => (
                                <option key={name} value={idx + 1}>{name}</option>
                            ))}
                        </select>
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>Type</span>
                        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'all' | ActivityType)}>
                            <option value="all">All</option>
                            <option value="hunting">Hunting</option>
                            <option value="fishing">Fishing</option>
                        </select>
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>Search species or place</span>
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="deer, trout, canal, turkey..." />
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', opacity: 0.9 }}>
                    <span>Total in season: {filtered.length}</span>
                    <span>Hunting: {huntingCount}</span>
                    <span>Fishing: {fishingCount}</span>
                    <span>Month: {MONTHS[month - 1]}</span>
                </div>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.65rem' }}>
                <div style={{ fontWeight: 700 }}>In-season opportunities</div>
                {filtered.length === 0 && <div style={{ opacity: 0.75 }}>No entries match this filter.</div>}
                {filtered.map(entry => (
                    <div
                        key={entry.id}
                        style={{
                            border: `1px solid ${entry.type === 'hunting' ? '#f59e0b' : '#38bdf8'}`,
                            borderRadius: 12,
                            padding: '0.8rem',
                            background: entry.type === 'hunting' ? 'rgba(120, 53, 15, 0.22)' : 'rgba(8, 47, 73, 0.28)',
                            display: 'grid',
                            gap: '0.35rem'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap' }}>
                            <div style={{ fontWeight: 700 }}>{entry.species}</div>
                            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                <span style={{ textTransform: 'capitalize', opacity: 0.82 }}>{entry.type}</span>
                                <span
                                    style={{
                                        fontSize: '0.75rem',
                                        borderRadius: 999,
                                        padding: '0.12rem 0.45rem',
                                        border: '1px solid #22c55e',
                                        background: 'rgba(22, 163, 74, 0.25)',
                                        color: '#bbf7d0'
                                    }}
                                >
                                    In season now
                                </span>
                            </div>
                        </div>
                        <div style={{ opacity: 0.85 }}>{entry.location}</div>
                        <div style={{ fontSize: '0.9rem', opacity: 0.78 }}>{entry.notes}</div>
                        <div style={{ fontSize: '0.82rem', opacity: 0.7 }}>
                            Open months: {entry.openMonths.map(m => MONTHS[m - 1].slice(0, 3)).join(', ')}
                        </div>
                    </div>
                ))}
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.65rem' }}>
                <div style={{ fontWeight: 700 }}>Hunting quick status for {MONTHS[month - 1]}</div>
                <div style={{ display: 'grid', gap: '0.45rem' }}>
                    {huntingStatusByMonth.map(entry => (
                        <div
                            key={`${entry.id}-status`}
                            style={{
                                border: `1px solid ${entry.inSeason ? '#22c55e' : '#64748b'}`,
                                borderRadius: 10,
                                padding: '0.55rem 0.7rem',
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '0.75rem',
                                flexWrap: 'wrap',
                                background: entry.inSeason ? 'rgba(21, 128, 61, 0.2)' : 'rgba(51, 65, 85, 0.2)'
                            }}
                        >
                            <span style={{ fontWeight: 600 }}>{entry.species}</span>
                            <span
                                style={{
                                    fontSize: '0.8rem',
                                    color: entry.inSeason ? '#bbf7d0' : '#cbd5e1'
                                }}
                            >
                                {entry.inSeason ? 'IN SEASON' : 'CLOSED THIS MONTH'}
                            </span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.65rem' }}>
                <div style={{ fontWeight: 700 }}>Full-year season map</div>
                <div style={{ display: 'grid', gap: '0.55rem' }}>
                    {SEASONS.map(entry => (
                        <div key={`${entry.id}-timeline`} style={{ display: 'grid', gap: '0.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600 }}>{entry.species}</span>
                                <span style={{ opacity: 0.78, textTransform: 'capitalize' }}>{entry.type}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '0.25rem' }}>
                                {MONTHS.map((name, idx) => {
                                    const active = entry.openMonths.includes(idx + 1);
                                    return (
                                        <div
                                            key={`${entry.id}-${name}`}
                                            title={`${name}: ${active ? 'in season' : 'closed'}`}
                                            style={{
                                                borderRadius: 6,
                                                textAlign: 'center',
                                                padding: '0.25rem 0',
                                                fontSize: '0.72rem',
                                                border: '1px solid #334155',
                                                background: active
                                                    ? entry.type === 'hunting'
                                                        ? 'rgba(234, 88, 12, 0.45)'
                                                        : 'rgba(14, 116, 144, 0.5)'
                                                    : 'rgba(15, 23, 42, 0.55)',
                                                color: active ? '#f8fafc' : '#94a3b8'
                                            }}
                                        >
                                            {name.slice(0, 3)}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
