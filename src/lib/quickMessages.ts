'use client';

// Simple per-device canned-message presets for one-tap field messaging.
export type QuickMessage = {
    id: string;
    label: string;
    text: string;
    emergency: boolean;
};

const STORAGE_KEY = 'family-land-satcom-quick-messages-v1';

const DEFAULT_QUICK_MESSAGES: QuickMessage[] = [
    { id: 'qm-on-my-way', label: 'On my way back', text: 'On my way back to the cabin now.', emergency: false },
    { id: 'qm-all-clear', label: 'All clear', text: 'All clear, no issues here.', emergency: false },
    { id: 'qm-need-help', label: 'Need help', text: 'Need help / assistance at my location.', emergency: true },
    { id: 'qm-low-battery', label: 'Low battery', text: 'My battery is low, going offline soon.', emergency: false },
    { id: 'qm-checked-in', label: 'Checked in', text: 'Checked in, everything normal.', emergency: false }
];

const makeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const parseQuickMessages = (raw: string | null): QuickMessage[] => {
    if (!raw) return DEFAULT_QUICK_MESSAGES;

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_QUICK_MESSAGES;

        return parsed
            .filter(item => item && typeof item.id === 'string' && typeof item.text === 'string')
            .map(item => ({
                id: item.id,
                label: typeof item.label === 'string' && item.label.trim() ? item.label : item.text.slice(0, 24),
                text: item.text,
                emergency: item.emergency === true
            }));
    } catch {
        return DEFAULT_QUICK_MESSAGES;
    }
};

export const loadQuickMessages = (): QuickMessage[] => {
    if (typeof window === 'undefined') return DEFAULT_QUICK_MESSAGES;
    return parseQuickMessages(window.localStorage.getItem(STORAGE_KEY));
};

export const saveQuickMessages = (messages: QuickMessage[]): void => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
};

export const createQuickMessage = (label: string, text: string, emergency: boolean): QuickMessage => ({
    id: makeId(),
    label,
    text,
    emergency
});
