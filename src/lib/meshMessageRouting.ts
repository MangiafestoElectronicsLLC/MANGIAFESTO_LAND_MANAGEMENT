import type { MeshMessage } from './meshTypes';

export type MessageTarget =
    | { kind: 'group' }
    | { kind: 'direct'; nodeNum: number; nodeName: string; fromNodeNum: number; assignedUserId?: string };

export function nodeNumberFromId(id: string): number | null {
    if (!/^live-\d+$/.test(id)) return null;
    const num = Number(id.slice(5));
    return Number.isInteger(num) && num > 0 && num < 0xffffffff ? num : null;
}

export function targetForQueuedMessage(message: MeshMessage, connectedNodeNum: number | null): 'broadcast' | number | null {
    const target = message.target;
    if (!target || target.kind === 'group') return 'broadcast';
    if (target.kind !== 'direct' || !Number.isInteger(target.nodeNum) || target.nodeNum <= 0 ||
        target.nodeNum >= 0xffffffff || target.fromNodeNum !== connectedNodeNum ||
        target.nodeNum === connectedNodeNum) return null;
    return target.nodeNum;
}
