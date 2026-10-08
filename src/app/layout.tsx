import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import PrimaryNav from '@/components/PrimaryNav';

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
                style={{ margin: 0 }}
            >
                <div className="app-shell">
                    <header className="app-header">
                        <div className="app-brand app-brand-row">
                            <Image src="/company-logo.svg" alt="Mangiafesto Electronics logo" width={180} height={56} priority />
                            <div>
                                <h1>Family Land Board</h1>
                                <p>Tickets, roles, meetings, and notes in one place.</p>
                            </div>
                        </div>
                        <PrimaryNav />
                    </header>
                    <main>{children}</main>
                </div>
            </body>
        </html>
    );
}
