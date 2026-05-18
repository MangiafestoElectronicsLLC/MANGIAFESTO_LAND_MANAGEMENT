'use client';

export default function DashboardError({
    error,
    reset
}: {
    error: Error;
    reset: () => void;
}) {
    return (
        <div
            style={{
                border: '1px solid #7f1d1d',
                borderRadius: 8,
                padding: '1rem',
                background: '#1f1111',
                color: '#fecaca',
                display: 'grid',
                gap: '0.65rem'
            }}
        >
            <div style={{ fontWeight: 700 }}>Dashboard crashed</div>
            <div style={{ fontSize: '0.9rem' }}>{error?.message || 'Unknown client error'}</div>
            <button
                onClick={reset}
                style={{
                    width: 'fit-content',
                    padding: '0.4rem 0.75rem',
                    borderRadius: 6,
                    border: '1px solid #334155',
                    background: 'transparent',
                    color: '#e2e8f0',
                    cursor: 'pointer'
                }}
            >
                Try again
            </button>
        </div>
    );
}
