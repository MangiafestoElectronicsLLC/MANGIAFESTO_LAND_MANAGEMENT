'use client';

import type { MeshNodeRole } from './meshTypes';

// Local-only registry of Meshtastic nodes that have been onboarded into this
// dashboard. Web Bluetooth cannot enumerate paired devices reliably across
// browsers, so we remember the human-facing details here and match by name.

const STORAGE_KEY = 'family-land-satcom-devices-v1';

export type OnboardedDevice = {
    id: string;
    nickname: string;
    role: MeshNodeRole;
    bluetoothName: string;
    stationNotes: string;
    ownerName: string;
    addedAt: string;
    lastConnectedAt: string | null;
    lastBatteryPct: number | null;
    lastBatteryAt: string | null;
};

export const DEVICE_ROLE_OPTIONS: { value: MeshNodeRole; label: string; hint: string }[] = [
    { value: 'portable', label: 'Portable / handheld', hint: 'Carried in a pack or pocket while on the land.' },
    { value: 'relay', label: 'Fixed relay', hint: 'Mounted on high ground to extend range between nodes.' },
    { value: 'gateway', label: 'Cabin gateway', hint: 'Always-on node at the cabin that bridges the mesh.' },
    { value: 'unknown', label: 'Other / spare', hint: 'Backup node or not assigned to a station yet.' }
];

const isBrowser = () => typeof window !== 'undefined';

export function loadDevices(): OnboardedDevice[] {
    if (!isBrowser()) return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is OnboardedDevice => Boolean(item && typeof item.id === 'string'));
    } catch {
        return [];
    }
}

export function saveDevices(devices: OnboardedDevice[]) {
    if (!isBrowser()) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
    } catch {
        // storage full or blocked; registry is a convenience only
    }
}

export function createDevice(input: Omit<OnboardedDevice, 'id' | 'addedAt' | 'lastConnectedAt' | 'lastBatteryPct' | 'lastBatteryAt'>): OnboardedDevice {
    return {
        ...input,
        id:
            isBrowser() && typeof window.crypto?.randomUUID === 'function'
                ? window.crypto.randomUUID()
                : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        addedAt: new Date().toISOString(),
        lastConnectedAt: null,
        lastBatteryPct: null,
        lastBatteryAt: null
    };
}

export function upsertDevice(devices: OnboardedDevice[], device: OnboardedDevice): OnboardedDevice[] {
    const existingIndex = devices.findIndex(d => d.id === device.id);
    if (existingIndex === -1) return [...devices, device];
    const next = [...devices];
    next[existingIndex] = device;
    return next;
}

export function markDeviceConnected(devices: OnboardedDevice[], bluetoothName: string): OnboardedDevice[] {
    const stamp = new Date().toISOString();
    return devices.map(device => (device.bluetoothName === bluetoothName ? { ...device, lastConnectedAt: stamp } : device));
}

export function updateDeviceBattery(devices: OnboardedDevice[], bluetoothName: string, pct: number | null): OnboardedDevice[] {
    if (pct == null) return devices;
    const stamp = new Date().toISOString();
    return devices.map(device =>
        device.bluetoothName === bluetoothName ? { ...device, lastBatteryPct: pct, lastBatteryAt: stamp } : device
    );
}

export type BatteryHealth = 'good' | 'low' | 'critical' | 'unknown';

export function batteryHealth(pct: number | null): BatteryHealth {
    if (pct == null) return 'unknown';
    if (pct >= 60) return 'good';
    if (pct >= 25) return 'low';
    return 'critical';
}

export const BATTERY_HEALTH_LABEL: Record<BatteryHealth, string> = {
    good: 'Good',
    low: 'Low',
    critical: 'Charge soon',
    unknown: 'Unknown'
};

export const BATTERY_HEALTH_COLOR: Record<BatteryHealth, string> = {
    good: '#bbf7d0',
    low: '#fde68a',
    critical: '#fecaca',
    unknown: '#94a3b8'
};
