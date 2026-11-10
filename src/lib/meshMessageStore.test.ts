import assert from 'node:assert/strict';
import test from 'node:test';
import { markQueuedMessageSent } from './meshMessageStore';
import type { MeshMessage } from './meshTypes';

const message: MeshMessage = {
    id: 'test-message',
    text: 'Radio check',
    sender: 'Family',
    direction: 'outgoing',
    relayed_by: 'Your node',
    emergency: false,
    created_at: '2026-01-01T00:00:00.000Z',
    synced: true
};

function mockDatabase(abort: boolean) {
    const calls: unknown[][] = [];
    let closed = false;
    const tx = {
        error: abort ? new Error('transaction aborted') : null,
        oncomplete: () => {},
        onabort: () => {},
        objectStore(name: string) {
            return {
                put(value: MeshMessage) { calls.push(['put', name, value]); },
                delete(id: string) {
                    calls.push(['delete', name, id]);
                    queueMicrotask(() => abort ? tx.onabort() : tx.oncomplete());
                }
            };
        }
    };
    const db = {
        transaction(names: string[], mode: string) {
            calls.push(['transaction', names, mode]);
            return tx;
        },
        close() { closed = true; }
    };
    const request = {
        result: db,
        onsuccess: () => {},
        onerror: () => {}
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: { open() { queueMicrotask(() => request.onsuccess()); return request; } }
    });
    return {
        calls,
        isClosed: () => closed,
        restore() {
            if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
            else Reflect.deleteProperty(globalThis, 'indexedDB');
        }
    };
}

test('marking a message sent updates history and queue in one transaction', async () => {
    const db = mockDatabase(false);
    try {
        await markQueuedMessageSent(message);
        assert.deepEqual(db.calls, [
            ['transaction', ['messages', 'outgoing_queue'], 'readwrite'],
            ['put', 'messages', message],
            ['delete', 'outgoing_queue', message.id]
        ]);
        assert.equal(db.isClosed(), true);
    } finally {
        db.restore();
    }
});

test('marking a message sent reports an aborted transaction', async () => {
    const db = mockDatabase(true);
    try {
        await assert.rejects(markQueuedMessageSent(message), /transaction aborted/);
        assert.equal(db.isClosed(), true);
    } finally {
        db.restore();
    }
});
