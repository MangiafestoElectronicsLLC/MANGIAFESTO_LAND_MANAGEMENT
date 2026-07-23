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
const PLANNING_AHEAD_DAY = 24;

function getPlanningDefaultMonth() {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const dayOfMonth = today.getDate();

    if (dayOfMonth >= PLANNING_AHEAD_DAY) {
        return currentMonth === 12 ? 1 : currentMonth + 1;
    }

    return currentMonth;
}

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
    const [month, setMonth] = useState<number>(() => getPlanningDefaultMonth());
    const [currentMonth] = useState<number>(() => new Date().getMonth() + 1);
    const [typeFilter, setTypeFilter] = useState<'all' | ActivityType>('all');
    const [query, setQuery] = useState('');
    const [showOpenNowOnly, setShowOpenNowOnly] = useState(false);
    const [showFullYearMap, setShowFullYearMap] = useState(false);
    const effectiveMonth = showOpenNowOnly ? currentMonth : month;

    const filtered = useMemo(() => {
        return SEASONS.filter(entry => {
            const monthMatch = entry.openMonths.includes(effectiveMonth);
            const typeMatch = typeFilter === 'all' ? true : entry.type === typeFilter;
            const queryMatch = query.trim()
                ? `${entry.species} ${entry.location} ${entry.notes}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase())
                : true;

            return monthMatch && typeMatch && queryMatch;
        });
    }, [effectiveMonth, query, typeFilter]);

    const huntingCount = filtered.filter(item => item.type === 'hunting').length;
    const fishingCount = filtered.filter(item => item.type === 'fishing').length;
    const monthName = MONTHS[effectiveMonth - 1];
    const plannedMonthName = MONTHS[month - 1];
    const filteredHunting = filtered.filter(item => item.type === 'hunting');
    const filteredFishing = filtered.filter(item => item.type === 'fishing');
    const seasonBadgeLabel = showOpenNowOnly ? 'Open now' : `Open in ${monthName}`;

    return (
        <div className="page-stack">
            <div className="toolbar">
                <Link href="/dashboard" className="chip-link">
                    Main Dashboard
                </Link>
                <Link href="/dashboard/tickets" className="chip-link">
                    Tickets
                </Link>
                <Link href="/dashboard/meetings" className="chip-link">
                    Board Meetings
                </Link>
            </div>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.9rem' }}>
                <div style={{ display: 'grid', gap: '0.3rem' }}>
                    <div style={{ opacity: 0.85, fontSize: '0.85rem' }}>Brockport Hunting / Fishing Calendar</div>
                    <h2 style={{ margin: 0, fontSize: 'clamp(1.4rem, 3.8vw, 2rem)' }}>What is open this month?</h2>
                    <div style={{ opacity: 0.78, maxWidth: 860 }}>
                        Pick a month, choose a type, and see what is in season around Brockport, New York. Always confirm legal dates and bag limits with current NYS DEC regulations.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', fontSize: '0.84rem' }}>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.2rem 0.55rem', background: 'rgba(15, 23, 42, 0.5)' }}>1. Pick month</span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.2rem 0.55rem', background: 'rgba(15, 23, 42, 0.5)' }}>2. Filter by type</span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.2rem 0.55rem', background: 'rgba(15, 23, 42, 0.5)' }}>3. Review open options</span>
                </div>

                <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>Month</span>
                        <select value={month} onChange={e => setMonth(Number(e.target.value))} disabled={showOpenNowOnly}>
                            {MONTHS.map((name, idx) => (
                                <option key={name} value={idx + 1}>{name}</option>
                            ))}
                        </select>
                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                            Late-month planning defaults to next month after day {PLANNING_AHEAD_DAY - 1}.
                        </span>
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

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'fit-content', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={showOpenNowOnly}
                            onChange={e => setShowOpenNowOnly(e.target.checked)}
                        />
                        <span style={{ fontSize: '0.9rem' }}>Show only open now for my selected type</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => setShowOpenNowOnly(false)}
                        disabled={!showOpenNowOnly}
                        style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: 8,
                            border: '1px solid #334155',
                            background: showOpenNowOnly ? 'rgba(30, 41, 59, 0.6)' : 'rgba(15, 23, 42, 0.4)',
                            color: showOpenNowOnly ? '#e2e8f0' : '#94a3b8',
                            cursor: showOpenNowOnly ? 'pointer' : 'not-allowed'
                        }}
                    >
                        Use planning month
                    </button>
                </div>

                <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                    <div style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem 0.65rem', background: 'rgba(15, 23, 42, 0.5)' }}>
                        <div style={{ fontSize: '0.78rem', opacity: 0.76 }}>Selected month</div>
                        <div style={{ fontWeight: 700 }}>{showOpenNowOnly ? `${monthName} (now)` : plannedMonthName}</div>
                    </div>
                    <div style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem 0.65rem', background: 'rgba(15, 23, 42, 0.5)' }}>
                        <div style={{ fontSize: '0.78rem', opacity: 0.76 }}>Open now</div>
                        <div style={{ fontWeight: 700 }}>{filtered.length} options</div>
                    </div>
                    <div style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem 0.65rem', background: 'rgba(15, 23, 42, 0.5)' }}>
                        <div style={{ fontSize: '0.78rem', opacity: 0.76 }}>Hunting</div>
                        <div style={{ fontWeight: 700 }}>{huntingCount}</div>
                    </div>
                    <div style={{ border: '1px solid #334155', borderRadius: 10, padding: '0.55rem 0.65rem', background: 'rgba(15, 23, 42, 0.5)' }}>
                        <div style={{ fontSize: '0.78rem', opacity: 0.76 }}>Fishing</div>
                        <div style={{ fontWeight: 700 }}>{fishingCount}</div>
                    </div>
                </div>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.65rem' }}>
                <div style={{ fontWeight: 700 }}>{showOpenNowOnly ? 'Open now' : `Open in ${monthName}`}</div>
                {filtered.length === 0 && <div style={{ opacity: 0.75 }}>No entries match this filter.</div>}

                <div style={{ display: 'grid', gap: '0.85rem' }}>
                    <div style={{ fontWeight: 600, opacity: 0.9 }}>Hunting</div>
                    {filteredHunting.length === 0 && <div style={{ opacity: 0.72 }}>No hunting options in this view.</div>}
                    {filteredHunting.map(entry => (
                        <div
                            key={`${entry.id}-hunt`}
                            style={{
                                border: '1px solid #f59e0b',
                                borderRadius: 10,
                                padding: '0.7rem',
                                display: 'grid',
                                gap: '0.3rem',
                                background: 'rgba(120, 53, 15, 0.22)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <div style={{ fontWeight: 700 }}>{entry.species}</div>
                                <span
                                    style={{
                                        fontSize: '0.75rem',
                                        borderRadius: 999,
                                        padding: '0.1rem 0.45rem',
                                        border: '1px solid #22c55e',
                                        background: 'rgba(22, 163, 74, 0.25)',
                                        color: '#bbf7d0'
                                    }}
                                >
                                    {seasonBadgeLabel}
                                </span>
                            </div>
                            <div style={{ opacity: 0.85 }}>{entry.location}</div>
                            <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>{entry.notes}</div>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'grid', gap: '0.85rem' }}>
                    <div style={{ fontWeight: 600, opacity: 0.9 }}>Fishing</div>
                    {filteredFishing.length === 0 && <div style={{ opacity: 0.72 }}>No fishing options in this view.</div>}
                    {filteredFishing.map(entry => (
                        <div
                            key={`${entry.id}-fish`}
                            style={{
                                border: '1px solid #38bdf8',
                                borderRadius: 10,
                                padding: '0.7rem',
                                display: 'grid',
                                gap: '0.3rem',
                                background: 'rgba(8, 47, 73, 0.28)'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <div style={{ fontWeight: 700 }}>{entry.species}</div>
                                <span
                                    style={{
                                        fontSize: '0.75rem',
                                        borderRadius: 999,
                                        padding: '0.1rem 0.45rem',
                                        border: '1px solid #22c55e',
                                        background: 'rgba(22, 163, 74, 0.25)',
                                        color: '#bbf7d0'
                                    }}
                                >
                                    {seasonBadgeLabel}
                                </span>
                            </div>
                            <div style={{ opacity: 0.85 }}>{entry.location}</div>
                            <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>{entry.notes}</div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.65rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700 }}>Full-year season map</div>
                    <button
                        type="button"
                        onClick={() => setShowFullYearMap(prev => !prev)}
                        style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: 8,
                            border: '1px solid #334155',
                            background: 'rgba(30, 41, 59, 0.6)',
                            color: '#e2e8f0',
                            cursor: 'pointer'
                        }}
                    >
                        {showFullYearMap ? 'Hide year map' : 'Show year map'}
                    </button>
                </div>

                <div style={{ fontSize: '0.84rem', opacity: 0.78 }}>
                    Use this only when planning far ahead. For month-to-month decisions, the &quot;Open this month&quot; section above is the fastest view.
                </div>

                {showFullYearMap && (
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
                )}
            </section>
        </div>
    );
}
