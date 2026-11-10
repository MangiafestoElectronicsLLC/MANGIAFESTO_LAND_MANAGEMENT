import assert from 'node:assert/strict';
import test from 'node:test';
import { loadQuickMessages } from './quickMessages';

test('new stand preset is available alongside existing custom messages', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const storage = new Map([
        ['family-land-satcom-quick-messages-v1', JSON.stringify([{ id: 'custom', label: 'Custom', text: 'Hello', emergency: false }])]
    ]);
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null } }
    });
    try {
        const messages = loadQuickMessages();
        assert.ok(messages.some(message => message.id === 'custom'));
        assert.ok(messages.some(message => message.id === 'qm-going-to-stand' && message.label === 'Going to my stand'));
        storage.set('family-land-satcom-quick-messages-removed-v1', JSON.stringify(['qm-going-to-stand']));
        assert.ok(!loadQuickMessages().some(message => message.id === 'qm-going-to-stand'));
    } finally {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else Reflect.deleteProperty(globalThis, 'window');
    }
});
