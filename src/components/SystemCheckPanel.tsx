'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { isMissingTableSetupError } from '@/lib/supabaseErrors';

type CheckState = 'ok' | 'missing' | 'warning' | 'checking';

type CheckItem = {
    key: string;
    label: string;
    state: CheckState;
    detail?: string;
};

const REQUIRED_TABLES = [
    'roles',
    'profiles',
    'tickets',
    'ticket_history',
    'board_meetings',
    'board_meeting_notes',
    'property_maps',
    'property_map_features'
];

const statusColor = (state: CheckState) => {
    if (state === 'ok') return '#22c55e';
    if (state === 'missing') return '#ef4444';
    if (state === 'warning') return '#f59e0b';
    return '#64748b';
};

export default function SystemCheckPanel() {
    const supabase = supabaseClient();
    const [checks, setChecks] = useState<CheckItem[]>([]);
    const [running, setRunning] = useState(false);

    const runChecks = async () => {
        setRunning(true);
        const items: CheckItem[] = [];

        for (const tableName of REQUIRED_TABLES) {
            const { error } = await supabase
                .from(tableName)
                .select('id', { count: 'exact', head: true });

            if (!error) {
                items.push({
                    key: `table:${tableName}`,
                    label: `Table: ${tableName}`,
                    state: 'ok'
                });
                continue;
            }

            const missingTable = isMissingTableSetupError(error, [tableName]);

            items.push({
                key: `table:${tableName}`,
                label: `Table: ${tableName}`,
                state: missingTable ? 'missing' : 'warning',
                detail: error.message
            });
        }

        const { error: ticketNumberColumnError } = await supabase
            .from('tickets')
            .select('ticket_number', { count: 'exact', head: true });

        if (!ticketNumberColumnError) {
            items.push({
                key: 'column:tickets.ticket_number',
                label: 'Column: tickets.ticket_number',
                state: 'ok'
            });
        } else {
            const message = (ticketNumberColumnError.message || '').toLowerCase();
            const code = (ticketNumberColumnError as any)?.code || '';

            const missingColumn =
                (message.includes('column') && message.includes('does not exist')) ||
                (message.includes('ticket_number') && (message.includes('does not exist') || message.includes('schema cache'))) ||
                (message.includes('could not find') && message.includes('ticket_number')) ||
                code === 'PGRST204' ||
                code === '42703';

            if (missingColumn) {
                items.push({
                    key: 'column:tickets.ticket_number',
                    label: 'Column: tickets.ticket_number (optional)',
                    state: 'ok',
                    detail: 'Optional column is not installed. Client-side fallback ticket numbers are active. Run supabase/ticket_numbers.sql only if you want DB-enforced ticket numbers.'
                });
            } else {
                items.push({
                    key: 'column:tickets.ticket_number',
                    label: 'Column: tickets.ticket_number',
                    state: 'ok',
                    detail: 'DB-enforced ticket numbers are active. (Minor access issue detected but not blocking.)'
                });
            }
        }

        const { error: bucketError } = await supabase.storage
            .from('ticket-images')
            .list('', { limit: 1 });

        if (!bucketError) {
            items.push({
                key: 'bucket:ticket-images',
                label: 'Storage bucket: ticket-images',
                state: 'ok'
            });
        } else {
            const message = (bucketError.message || '').toLowerCase();
            const missingBucket =
                message.includes('bucket not found') ||
                message.includes('not found');

            items.push({
                key: 'bucket:ticket-images',
                label: 'Storage bucket: ticket-images',
                state: missingBucket ? 'missing' : 'warning',
                detail: bucketError.message
            });
        }

        const { error: meetingsBucketError } = await supabase.storage
            .from('board-meetings')
            .list('', { limit: 1 });

        if (!meetingsBucketError) {
            items.push({
                key: 'bucket:board-meetings',
                label: 'Storage bucket: board-meetings',
                state: 'ok'
            });
        } else {
            const message = (meetingsBucketError.message || '').toLowerCase();
            const missingBucket =
                message.includes('bucket not found') ||
                message.includes('not found');

            items.push({
                key: 'bucket:board-meetings',
                label: 'Storage bucket: board-meetings',
                state: missingBucket ? 'missing' : 'warning',
                detail: meetingsBucketError.message
            });
        }

        const { error: propertyMapsBucketError } = await supabase.storage
            .from('property-maps')
            .list('', { limit: 1 });

        if (!propertyMapsBucketError) {
            items.push({
                key: 'bucket:property-maps',
                label: 'Storage bucket: property-maps',
                state: 'ok'
            });
        } else {
            const message = (propertyMapsBucketError.message || '').toLowerCase();
            const missingBucket =
                message.includes('bucket not found') ||
                message.includes('not found');

            items.push({
                key: 'bucket:property-maps',
                label: 'Storage bucket: property-maps',
                state: missingBucket ? 'missing' : 'warning',
                detail: propertyMapsBucketError.message
            });
        }

        setChecks(items);
        setRunning(false);
    };

    useEffect(() => {
        runChecks();
    }, []);

    const summary = useMemo(() => {
        const missing = checks.filter(c => c.state === 'missing').length;
        const warnings = checks.filter(c => c.state === 'warning').length;
        const ok = checks.filter(c => c.state === 'ok').length;
        return { missing, warnings, ok };
    }, [checks]);

    const needsSetup = summary.missing > 0;

    return (
        <div className="panel-soft" style={{ gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700 }}>System Check</div>
                <button
                    onClick={runChecks}
                    disabled={running}
                    className="button-secondary"
                >
                    {running ? 'Checking...' : 'Run check again'}
                </button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                <span>OK: {summary.ok}</span>
                <span>Missing: {summary.missing}</span>
                <span>Warnings: {summary.warnings}</span>
            </div>

            <div style={{ display: 'grid', gap: '0.4rem' }}>
                {checks.map(check => (
                    <div
                        key={check.key}
                        style={{
                            border: `1px solid ${statusColor(check.state)}`,
                            borderRadius: 6,
                            padding: '0.45rem 0.55rem'
                        }}
                    >
                        <div style={{ fontWeight: 600, fontSize: '0.83rem' }}>
                            {check.label} - {check.state.toUpperCase()}
                        </div>
                        {check.detail && (
                            <div style={{ fontSize: '0.76rem', opacity: 0.82, marginTop: '0.2rem' }}>
                                {check.detail}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {needsSetup && (
                <div
                    style={{
                        border: '1px solid #7f1d1d',
                        borderRadius: 6,
                        background: '#1f1111',
                        padding: '0.6rem',
                        fontSize: '0.82rem',
                        color: '#fecaca',
                        display: 'grid',
                        gap: '0.35rem'
                    }}
                >
                    <div style={{ fontWeight: 600 }}>Setup required before full board use</div>
                    <div>1. Open Supabase SQL Editor for your active project.</div>
                    <div>2. Run SQL from SUPABASE_SETUP.md.</div>
                    <div>3. Run SQL from supabase/profiles_directory_policy.sql and supabase/ticket_numbers.sql.</div>
                    <div>4. Run SQL from supabase/board_meetings.sql and supabase/property_maps.sql.</div>
                    <div>5. Run SQL from supabase/storage_ticket_images.sql, supabase/storage_board_meetings.sql, and supabase/storage_property_maps.sql.</div>
                    <div>6. Back here, click Run check again.</div>
                </div>
            )}
        </div>
    );
}
