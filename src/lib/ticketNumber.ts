import type { Ticket } from '@/lib/boardTypes';

const extractDigits = (value: string) => value.replace(/[^0-9]/g, '');

export const getTicketNumber = (ticket: Pick<Ticket, 'id' | 'created_at' | 'ticket_number'>) => {
    const persistentTicketNumber = ticket.ticket_number;
    if (typeof persistentTicketNumber === 'string' && persistentTicketNumber.trim()) {
        return persistentTicketNumber.trim();
    }

    const date = new Date(ticket.created_at || Date.now());
    const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
    const rawId = ticket.id || '';
    const digits = extractDigits(rawId).slice(-5).padStart(5, '0');
    const fallback = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-5).padStart(5, 'X');
    const suffix = digits === '00000' ? fallback : digits;
    return `TKT-${year}-${suffix}`;
};
