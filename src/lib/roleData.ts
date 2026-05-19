import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ROLE_NAMES, normalizeRoleName, type Role } from '@/lib/boardTypes';

export const loadRolesWithFallback = async (supabase: SupabaseClient): Promise<Role[]> => {
    const { data: existingRoles, error } = await supabase
        .from('roles')
        .select('id, name')
        .order('name', { ascending: true });

    if (!error && existingRoles && existingRoles.length > 0) {
        return existingRoles as Role[];
    }

    await supabase
        .from('roles')
        .insert(DEFAULT_ROLE_NAMES.map(name => ({ name })));

    const { data: retryRoles } = await supabase
        .from('roles')
        .select('id, name')
        .order('name', { ascending: true });

    if (!retryRoles || retryRoles.length === 0) {
        return DEFAULT_ROLE_NAMES.map((name, index) => ({
            id: `fallback-${index}`,
            name
        }));
    }

    return (retryRoles as Role[]).map(role => ({
        ...role,
        name: normalizeRoleName(role.name)
    }));
};
