import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeNumberFromId, targetForQueuedMessage } from './meshMessageRouting';
import type { MeshMessage } from './meshTypes';

const message: MeshMessage = {
    id: 'one',
    text: 'Hello',
    sender: 'Family',
    direction: 'outgoing',
    relayed_by: null,
    emergency: false,
    created_at: '2026-01-01T00:00:00.000Z',
    synced: false
};

test('legacy and group messages broadcast on the primary channel', () => {
    assert.equal(targetForQueuedMessage(message, 1), 'broadcast');
    assert.equal(targetForQueuedMessage({ ...message, target: { kind: 'group' } }, 1), 'broadcast');
});

test('direct messages retain their recipient and require the original radio', () => {
    const direct: MeshMessage = { ...message, target: { kind: 'direct', nodeNum: 42, nodeName: 'Family', fromNodeNum: 1 } };
    assert.equal(targetForQueuedMessage(direct, 1), 42);
    assert.equal(targetForQueuedMessage(direct, 2), null);
    assert.equal(targetForQueuedMessage(direct, null), null);
    assert.equal(targetForQueuedMessage({ ...direct, target: { kind: 'direct', nodeNum: 1, nodeName: 'Self', fromNodeNum: 1 } }, 1), null);
    assert.equal(targetForQueuedMessage({ ...direct, target: { kind: 'direct', nodeNum: 0xffffffff, nodeName: 'Invalid', fromNodeNum: 1 } }, 1), null);
});

test('only valid live node IDs can be direct-message recipients', () => {
    assert.equal(nodeNumberFromId('live-42'), 42);
    for (const id of ['live-0', 'live-4294967295', 'live--2', 'live-3abc', 'sim-42']) {
        assert.equal(nodeNumberFromId(id), null);
    }
});
