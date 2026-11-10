import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRadioId, isApprovedQueuedTarget, isApprovedRadio, parseRadioId } from './meshRadioAssignments';

test('requires a complete and valid Meshtastic node ID', () => {
    assert.equal(parseRadioId(' !abcd497c '), 0xabcd497c);
    assert.equal(parseRadioId('ABCD497C'), 0xabcd497c);
    assert.equal(parseRadioId('497c'), null);
    assert.equal(parseRadioId('!00000000'), null);
    assert.equal(parseRadioId('!ffffffff'), null);
    assert.equal(parseRadioId('!abcd497cz'), null);
    assert.equal(formatRadioId(0xabcd497c), '!abcd497c');
});

test('waiting account messages cannot be sent after an assignment changes', () => {
    const target = { kind: 'direct' as const, nodeNum: 123, nodeName: 'Family', fromNodeNum: 1, assignedUserId: 'original' };
    assert.equal(isApprovedQueuedTarget(target, [], [{ userId: 'original', userName: 'Family', nodeNum: 123 }]), true);
    assert.equal(isApprovedQueuedTarget(target, ['live-123'], [{ userId: 'other', userName: 'Other', nodeNum: 123 }]), false);
    assert.equal(isApprovedQueuedTarget(target, ['live-123'], [{ userId: 'original', userName: 'Family', nodeNum: 456 }]), false);
    assert.equal(isApprovedQueuedTarget({ ...target, assignedUserId: undefined }, ['live-123'], []), true);
    assert.equal(isApprovedQueuedTarget({ kind: 'group' }, [], []), true);
});

test('assigned and locally approved radios can be selected without approving other nodes', () => {
    const assignments = [{ userId: 'user', userName: 'Family', nodeNum: 0xabcd497c }];
    assert.equal(isApprovedRadio(0xabcd497c, [], assignments), true);
    assert.equal(isApprovedRadio(123, ['live-123'], []), true);
    assert.equal(isApprovedRadio(0xabcd497d, [], assignments), false);
    assert.equal(isApprovedRadio(0xabcd497c, [], []), false);
});
