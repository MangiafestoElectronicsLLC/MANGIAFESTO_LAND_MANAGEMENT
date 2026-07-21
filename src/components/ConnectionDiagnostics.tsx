'use client';

import { useMemo, useState } from 'react';

type Props = {
    mode: 'supabase' | 'local';
    contextLabel: string;
    lastOperation: string;
    lastUpdatedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
};

const formatTime = (value: string | null) => {
    if (!value) return 'Not yet recorded';
    return new Date(value).toLocaleString();
};

export default function ConnectionDiagnostics({
    mode,
    contextLabel,
    lastOperation,
    lastUpdatedAt,
    errorCode,
    errorMessage
}: Props) {
    const hasError = Boolean(errorCode || errorMessage);
    const [copyMessage, setCopyMessage] = useState<string | null>(null);

    const diagnosticPayload = useMemo(() => {
        const lines = [
            `Context: ${contextLabel}`,
            `Mode: ${mode === 'supabase' ? 'Supabase mode' : 'Local fallback mode'}`,
            `Last operation: ${lastOperation}`,
            `Last update: ${formatTime(lastUpdatedAt)}`,
            `Error code: ${errorCode || 'none'}`,
            `Error message: ${errorMessage || 'No Supabase error captured in this session.'}`
        ];

        return lines.join('\n');
    }, [contextLabel, mode, lastOperation, lastUpdatedAt, errorCode, errorMessage]);

    const copyDiagnostics = async () => {
        try {
            await navigator.clipboard.writeText(diagnosticPayload);
            setCopyMessage('Diagnostics copied.');
        } catch {
            setCopyMessage('Copy failed. Select and copy manually from the panel text.');
        }
    };

    return (
        <section
            style={{
                border: '1px solid #334155',
                borderRadius: 10,
                background: '#0b1220',
                padding: '0.7rem 0.8rem',
                display: 'grid',
                gap: '0.35rem'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.65rem', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Connection diagnostics</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.8rem', opacity: 0.78 }}>{contextLabel}</div>
                    <button
                        type="button"
                        onClick={copyDiagnostics}
                        className="soft-button"
                        style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            borderColor: '#38bdf8',
                            color: '#bfdbfe'
                        }}
                    >
                        Copy diagnostics
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gap: '0.18rem', fontSize: '0.82rem' }}>
                <div>Mode: {mode === 'supabase' ? 'Supabase mode' : 'Local fallback mode'}</div>
                <div>Last operation: {lastOperation}</div>
                <div>Last update: {formatTime(lastUpdatedAt)}</div>
                <div>Error code: {errorCode || 'none'}</div>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                    Error message: {errorMessage || 'No Supabase error captured in this session.'}
                </div>
            </div>

            {hasError && (
                <div style={{ color: '#fecaca', fontSize: '0.8rem' }}>
                    This is the raw Supabase error context for troubleshooting.
                </div>
            )}

            {copyMessage && <div style={{ color: '#86efac', fontSize: '0.78rem' }}>{copyMessage}</div>}
        </section>
    );
}
