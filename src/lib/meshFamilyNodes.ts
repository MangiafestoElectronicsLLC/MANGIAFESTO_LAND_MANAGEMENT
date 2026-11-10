import { nodeNumberFromId } from './meshMessageRouting';

const STORAGE_KEY = 'family-land-satcom-family-node-ids-v1';

export function loadFamilyNodeIds(): string[] {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(id => typeof id === 'string' && nodeNumberFromId(id) !== null)) {
        throw new Error('Invalid saved family radio list.');
    }
    return [...new Set(parsed)];
}

export function saveFamilyNodeIds(ids: string[]): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
