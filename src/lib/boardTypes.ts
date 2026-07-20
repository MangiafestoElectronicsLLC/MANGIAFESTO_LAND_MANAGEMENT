export type Role = {
    id: string;
    name: string;
};

export const DEFAULT_ROLE_NAMES = ['Chairman', 'Legal', 'Grounds', 'Technology'] as const;

export type Profile = {
    id: string;
    full_name: string | null;
    role_id: string | null;
    role?: Role | null;
};

export type TicketStatus = 'open' | 'in_progress' | 'closed';

export type Ticket = {
    id: string;
    ticket_number: string | null;
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

export type TicketHistoryEvent = {
    id: string;
    ticket_id: string;
    action: string;
    performed_by: string | null;
    from_status: string | null;
    to_status: string | null;
    created_at: string;
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
    technology: 'Technology',
    unassigned: 'Unassigned'
};

export const roleNameToSlug = (name: string | null | undefined) => {
    const normalized = typeof name === 'string' ? name.trim().toLowerCase() : '';
    if (!normalized) return 'unknown-role';
    if (normalized === 'chairman') return 'chairman';
    if (normalized === 'legal') return 'legal';
    if (normalized === 'grounds') return 'grounds';
    if (normalized === 'technology') return 'technology';
    return normalized.replace(/\s+/g, '-');
};

export const roleSlugToName = (slug: string | null | undefined) => {
    const key = typeof slug === 'string' ? slug.toLowerCase() : '';
    if (!key) return null;
    return ROLE_SLUG_TO_NAME[key] || null;
};

export const normalizeRoleName = (name: string | null | undefined) => {
    if (!name) return '';
    const value = name.trim().toLowerCase();
    if (value === 'chairman') return 'Chairman';
    if (value === 'legal') return 'Legal';
    if (value === 'grounds') return 'Grounds';
    if (value === 'technology') return 'Technology';
    return name.trim();
};

export const isUuid = (value: string | null | undefined) => {
    if (!value) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
};
