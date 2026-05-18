export type Role = {
    id: string;
    name: string;
};

export type Profile = {
    id: string;
    full_name: string | null;
    role_id: string | null;
    role?: Role | null;
};

export type TicketStatus = 'open' | 'in_progress' | 'closed';

export type Ticket = {
    id: string;
    title: string;
    description: string | null;
    status: TicketStatus;
    priority: string;
    role_id: string | null;
    created_by: string | null;
    assigned_to: string | null;
    created_at: string;
    updated_at: string;
};

export const STATUS_OPTIONS = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'closed', label: 'Closed' }
] as const;

export const ROLE_SLUG_TO_NAME: Record<string, string> = {
    chairman: 'Chairman',
    legal: 'Legal',
    grounds: 'Grounds',
    technology: 'Technology'
};

export const roleNameToSlug = (name: string) => {
    const normalized = name.trim().toLowerCase();
    if (normalized === 'chairman') return 'chairman';
    if (normalized === 'legal') return 'legal';
    if (normalized === 'grounds') return 'grounds';
    if (normalized === 'technology') return 'technology';
    return normalized.replace(/\s+/g, '-');
};

export const roleSlugToName = (slug: string) => {
    return ROLE_SLUG_TO_NAME[slug.toLowerCase()] || null;
};
