import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
    title: 'Family Land Board',
    description: 'Tickets and roles for family land'
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    background: '#0f172a',
                    color: '#e5e7eb'
                }}
            >
                <div style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem' }}>
                    <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
                        Family Land Board
                    </h1>
                    {children}
                </div>
            </body>
        </html>
    );
}
