import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://mangiafesto-land-management.vercel.app';

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: {
        default: 'Family Land Board',
        template: '%s | Family Land Board'
    },
    description: 'Role-based ticket and land operations board for family land management.',
    keywords: ['land management', 'family board', 'ticket tracking', 'property operations'],
    robots: {
        index: true,
        follow: true
    },
    alternates: {
        canonical: '/'
    },
    openGraph: {
        title: 'Family Land Board',
        description: 'Role-based ticket and land operations board for family land management.',
        url: siteUrl,
        siteName: 'Family Land Board',
        type: 'website'
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Family Land Board',
        description: 'Role-based ticket and land operations board for family land management.'
    }
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: '#0f172a'
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
