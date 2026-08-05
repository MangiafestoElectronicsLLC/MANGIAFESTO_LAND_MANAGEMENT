/** @type {import('next').NextConfig} */
const nextConfig = {
    env: {
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || '',
        NEXT_PUBLIC_DEPLOYED_AT_UTC:
            process.env.VERCEL_GIT_COMMIT_TIMESTAMP ||
            process.env.VERCEL_DEPLOYMENT_CREATED_AT ||
            new Date().toISOString()
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '*.supabase.co'
            }
        ]
    },
    async headers() {
        const isDev = process.env.NODE_ENV !== 'production';
        const scriptSrc = isDev
            ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
            : "script-src 'self' 'unsafe-inline'";

        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff'
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin'
                    },
                    {
                        key: 'X-Frame-Options',
                        value: 'DENY'
                    },
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(self), microphone=(self), geolocation=(self)'
                    },
                    {
                        key: 'Content-Security-Policy',
                        value:
                            `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.supabase.com https://*.supabase.net wss://*.supabase.co wss://*.supabase.in wss://*.supabase.com wss://*.supabase.net; frame-src 'self' https://me-cam.replit.app; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
                    }
                ]
            }
        ];
    }
};

export default nextConfig;
