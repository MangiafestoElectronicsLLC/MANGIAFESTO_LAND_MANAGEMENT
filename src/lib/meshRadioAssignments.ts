import { nodeNumberFromId } from './meshMessageRouting';
import type { MessageTarget } from './meshMessageRouting';

export type RadioAssignment = {
    userId: string;
    userName: string;
    nodeNum: number;
};

export function parseRadioId(input: string): number | null {
    const match = /^!?([0-9a-f]{8})$/i.exec(input.trim());
    if (!match) return null;
    const num = Number.parseInt(match[1], 16);
    return nodeNumberFromId(`live-${num}`);
}

export function formatRadioId(nodeNum: number): string {
    return `!${nodeNum.toString(16).padStart(8, '0')}`;
}

export function isApprovedRadio(nodeNum: number, familyNodeIds: string[], assignments: RadioAssignment[]): boolean {
    return familyNodeIds.includes(`live-${nodeNum}`) || assignments.some(item => item.nodeNum === nodeNum);
}

export function isApprovedQueuedTarget(target: MessageTarget | undefined, familyNodeIds: string[], assignments: RadioAssignment[]): boolean {
    if (!target || target.kind === 'group') return true;
    if (target.assignedUserId) {
        return assignments.some(item => item.userId === target.assignedUserId && item.nodeNum === target.nodeNum);
    }
    return isApprovedRadio(target.nodeNum, familyNodeIds, assignments);
}
