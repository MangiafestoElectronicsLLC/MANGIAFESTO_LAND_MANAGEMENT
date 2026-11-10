import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFamilyNodeIds, saveFamilyNodeIds } from './meshFamilyNodes';

test('family node selections are stored by full node ID', () => {
    let value: string | null = null;
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage: {
            getItem: () => value,
            setItem: (_key: string, next: string) => { value = next; }
        } }
    });
    try {
        assert.deepEqual(loadFamilyNodeIds(), []);
        saveFamilyNodeIds(['live-123456', 'live-789012']);
        assert.deepEqual(loadFamilyNodeIds(), ['live-123456', 'live-789012']);
        value = '["live-1","live-1"]';
        assert.deepEqual(loadFamilyNodeIds(), ['live-1']);
        value = '["live-4294967295"]';
        assert.throws(() => loadFamilyNodeIds(), /Invalid saved family radio list/);
        value = '{bad json';
        assert.throws(() => loadFamilyNodeIds());
    } finally {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else Reflect.deleteProperty(globalThis, 'window');
    }
});
