type SupabaseLikeError = {
    message?: string;
    code?: string;
};

const normalizeTable = (table: string) => table.trim().toLowerCase();

const messageIncludesTable = (message: string, table: string) => {
    const normalizedTable = normalizeTable(table);
    const publicName = `public.${normalizedTable}`;
    return (
        message.includes(`'${publicName}'`) ||
        message.includes(`\"${publicName}\"`) ||
        message.includes(publicName) ||
        message.includes(`'${normalizedTable}'`) ||
        message.includes(`\"${normalizedTable}\"`) ||
        message.includes(`relation ${normalizedTable}`) ||
        message.includes(`table ${normalizedTable}`)
    );
};

export const getSupabaseErrorMessage = (error: unknown, fallback = 'Unknown Supabase error.') => {
    if (!error) return fallback;
    if (typeof error === 'string') return error;

    const maybeError = error as SupabaseLikeError;
    if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
        return maybeError.message;
    }

    return fallback;
};

export const getSupabaseErrorCode = (error: unknown) => {
    if (!error || typeof error !== 'object') return null;

    const code = (error as SupabaseLikeError).code;
    if (typeof code === 'string' && code.trim()) {
        return code;
    }

    return null;
};

export const isMissingTableSetupError = (error: unknown, tables: string[]) => {
    const message = getSupabaseErrorMessage(error, '').toLowerCase();
    const code = String((error as SupabaseLikeError | undefined)?.code || '').toUpperCase();

    if (!message && !code) return false;

    const tablesList = tables.map(normalizeTable).filter(Boolean);

    const hasMissingLanguage =
        message.includes('could not find the table') ||
        (message.includes('relation') && message.includes('does not exist')) ||
        (message.includes('table') && message.includes('does not exist')) ||
        (message.includes('schema cache') && message.includes('could not find'));

    const hasMissingCode = code === 'PGRST205' || code === '42P01';

    if (!hasMissingLanguage && !hasMissingCode) {
        return false;
    }

    if (tablesList.length === 0) {
        return true;
    }

    return tablesList.some(table => messageIncludesTable(message, table));
};
