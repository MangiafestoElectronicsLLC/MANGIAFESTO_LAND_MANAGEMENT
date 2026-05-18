import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Family Land Board',
        short_name: 'LandBoard',
        description: 'Role-based family land management ticket board.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        lang: 'en',
        icons: [
            {
                src: '/icon.svg',
                sizes: '192x192',
                type: 'image/svg+xml'
            },
            {
                src: '/icon.svg',
                sizes: '512x512',
                type: 'image/svg+xml'
            }
        ]
    };
}
