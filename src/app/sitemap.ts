import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://mangiafesto-land-management.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();

    return [
        {
            url: `${siteUrl}/`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 1
        },
        {
            url: `${siteUrl}/dashboard`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.8
        },
        {
            url: `${siteUrl}/dashboard/trail-cams`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.75
        },
        {
            url: `${siteUrl}/dashboard/land-wifi`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.75
        },
        {
            url: `${siteUrl}/dashboard/satcom`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.75
        },
        {
            url: `${siteUrl}/dashboard/treestands`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.75
        },
        {
            url: `${siteUrl}/dashboard/role/chairman`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.7
        },
        {
            url: `${siteUrl}/dashboard/role/legal`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.7
        },
        {
            url: `${siteUrl}/dashboard/role/grounds`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.7
        },
        {
            url: `${siteUrl}/dashboard/role/technology`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.7
        }
    ];
}
