'use client';

// Simple per-device canned-message presets for one-tap field messaging.
export type QuickMessage = {
    id: string;
    label: string;
    text: string;
    emergency: boolean;
};

const STORAGE_KEY = 'family-land-satcom-quick-messages-v1';

// Walkie-talkie style presets. Texts stay short so they fit LoRa packets and
// read well on a Heltec's small OLED. New defaults are merged into saved lists
// by id so existing users get them without losing their custom buttons.
export const DEFAULT_QUICK_MESSAGES: QuickMessage[] = [
    { id: 'qm-going-on-land', label: '🌲 Going on the land', text: 'Heading onto the land now. Will check in.', emergency: false },
    { id: 'qm-going-hunting', label: '🦌 Going hunting', text: 'Going hunting. Will check in when done.', emergency: false },
    { id: 'qm-in-stand', label: 'In my stand', text: 'In my stand/blind now. Staying quiet.', emergency: false },
    { id: 'qm-moving', label: 'Moving locations', text: 'Moving to a new spot, will update.', emergency: false },
    { id: 'qm-leaving-land', label: '🚗 Leaving the land', text: 'Leaving the land now. Gate is closed.', emergency: false },
    { id: 'qm-on-my-way', label: 'On my way back', text: 'On my way back to the cabin now.', emergency: false },
    { id: 'qm-all-clear', label: 'All clear', text: 'All clear, no issues here.', emergency: false },
    { id: 'qm-checked-in', label: 'Checked in', text: 'Checked in, everything normal.', emergency: false },
    { id: 'qm-game-down', label: 'Game down', text: 'Game down. Will need help later.', emergency: false },
    { id: 'qm-gate-open', label: 'Gate left open', text: 'Gate is open, someone please check it.', emergency: false },
    { id: 'qm-radio-check', label: 'Radio check', text: 'Radio check, anyone copy?', emergency: false },
    { id: 'qm-copy', label: 'Copy', text: 'Copy that.', emergency: false },
    { id: 'qm-low-battery', label: 'Low battery', text: 'My battery is low, going offline soon.', emergency: false },
    { id: 'qm-need-help', label: 'Need help', text: 'Need help / assistance at my location.', emergency: true }
];

const REMOVED_KEY = 'family-land-satcom-quick-messages-removed-v1';

const readRemoved = (): string[] => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(REMOVED_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const mergeDefaults = (stored: QuickMessage[]): QuickMessage[] => {
    const ids = new Set(stored.map(item => item.id));
    const removed = readRemoved();
    return [...stored, ...DEFAULT_QUICK_MESSAGES.filter(item => !ids.has(item.id) && !removed.includes(item.id))];
};

// Remember deleted defaults so merging doesn't resurrect them.
export const rememberRemovedDefault = (id: string): void => {
    if (typeof window === 'undefined' || !DEFAULT_QUICK_MESSAGES.some(item => item.id === id)) return;
    const removed = readRemoved();
    if (!removed.includes(id)) window.localStorage.setItem(REMOVED_KEY, JSON.stringify([...removed, id]));
};

const makeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const parseQuickMessages = (raw: string | null): QuickMessage[] => {
    if (!raw) return DEFAULT_QUICK_MESSAGES;

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_QUICK_MESSAGES;

        return mergeDefaults(
            parsed
                .filter(item => item && typeof item.id === 'string' && typeof item.text === 'string')
                .map(item => ({
                    id: item.id,
                    label: typeof item.label === 'string' && item.label.trim() ? item.label : item.text.slice(0, 24),
                    text: item.text,
                    emergency: item.emergency === true
                }))
        );
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
