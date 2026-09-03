'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    BATTERY_HEALTH_COLOR,
    BATTERY_HEALTH_LABEL,
    DEVICE_ROLE_OPTIONS,
    batteryHealth,
    createDevice,
    loadDevices,
    markDeviceConnected,
    saveDevices,
    updateDeviceBattery,
    upsertDevice,
    type OnboardedDevice
} from '@/lib/meshDeviceRegistry';
import { checkBrowserSupport, type MeshtasticConnection } from '@/lib/useMeshtasticConnection';
import type { MeshNodeRole } from '@/lib/meshTypes';

type DeviceOnboardingProps = {
    live: MeshtasticConnection;
    ownerName: string;
};

const PREP_CHECKS = [
    { id: 'powered', label: 'Node is powered on (hold the side button ~1 second) and charged over USB-C.' },
    { id: 'antenna', label: '915MHz antenna is screwed on before powering up — never transmit without it.' },
    { id: 'app', label: 'Node was paired once in the official Meshtastic phone app.' },
    { id: 'region', label: 'Region is set to US_915 in the Meshtastic app.' },
    { id: 'channel', label: 'Node joined the family private channel (same QR / channel key as the other nodes).' }
];

const inputStyle: React.CSSProperties = {
    borderRadius: 8,
    border: '1px solid #334155',
    background: 'rgba(2,6,23,0.6)',
    color: 'inherit',
    padding: '0.45rem 0.55rem',
    width: '100%'
};

const stepTitles = ['Check this device', 'Prep the node', 'Name it', 'Connect & verify'];

// Small reusable pill showing a device's battery health, live or last-known.
function BatteryBadge({ pct }: { pct: number | null }) {
    const health = batteryHealth(pct);
    return (
        <span
            style={{
                border: `1px solid ${BATTERY_HEALTH_COLOR[health]}`,
                color: BATTERY_HEALTH_COLOR[health],
                borderRadius: 999,
                padding: '0.15rem 0.55rem',
                fontSize: '0.76rem',
                whiteSpace: 'nowrap'
            }}
        >
            🔋 {pct != null ? `${pct}%` : BATTERY_HEALTH_LABEL[health]}
        </span>
    );
}

export default function DeviceOnboarding({ live, ownerName }: DeviceOnboardingProps) {
    const [devices, setDevices] = useState<OnboardedDevice[]>([]);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [step, setStep] = useState(0);
    const [checks, setChecks] = useState<Record<string, boolean>>({});
    const [nickname, setNickname] = useState('');
    const [role, setRole] = useState<MeshNodeRole>('portable');
    const [stationNotes, setStationNotes] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [savedMessage, setSavedMessage] = useState<string | null>(null);

    const support = useMemo(() => checkBrowserSupport(), []);

    useEffect(() => {
        setDevices(loadDevices());
    }, []);

    useEffect(() => {
        if (live.status !== 'connected' || !live.deviceName) return;
        setDevices(prev => {
            const next = markDeviceConnected(prev, live.deviceName as string);
            saveDevices(next);
            return next;
        });
    }, [live.status, live.deviceName]);

    // Persist the connected node's live battery reading so it's still visible
    // as "last known" once the browser disconnects or the page reloads.
    useEffect(() => {
        if (live.status !== 'connected' || !live.deviceName || live.ownBattery?.pct == null) return;
        setDevices(prev => {
            const next = updateDeviceBattery(prev, live.deviceName as string, live.ownBattery!.pct);
            saveDevices(next);
            return next;
        });
    }, [live.status, live.deviceName, live.ownBattery]);

    const allPrepChecked = PREP_CHECKS.every(check => checks[check.id]);
    const knownDevice = devices.find(device => device.bluetoothName === live.deviceName);

    const resetWizard = () => {
        setStep(0);
        setChecks({});
        setNickname('');
        setRole('portable');
        setStationNotes('');
        setFormError(null);
    };

    const startWizard = () => {
        resetWizard();
        setSavedMessage(null);
        setWizardOpen(true);
    };

    const goNext = () => {
        setFormError(null);
        if (step === 0 && !support.ok) {
            setFormError('Open this page in Chrome or Edge over https before adding a node.');
            return;
        }
        if (step === 1 && !allPrepChecked) {
            setFormError('Check every prep item so the node can actually join the mesh.');
            return;
        }
        if (step === 2 && !nickname.trim()) {
            setFormError('Give the node a nickname so it is recognizable in the node list.');
            return;
        }
        setStep(current => Math.min(current + 1, stepTitles.length - 1));
    };

    const finishOnboarding = () => {
        setFormError(null);
        if (live.status !== 'connected') {
            setFormError('Connect to the node first so we can confirm it is reachable.');
            return;
        }
        const device = createDevice({
            nickname: nickname.trim(),
            role,
            bluetoothName: live.deviceName || nickname.trim(),
            stationNotes: stationNotes.trim(),
            ownerName
        });
        const next = upsertDevice(devices, { ...device, lastConnectedAt: new Date().toISOString() });
        setDevices(next);
        saveDevices(next);
        setSavedMessage(`${device.nickname} added to your mesh device list.`);
        setWizardOpen(false);
        resetWizard();
    };

    const removeDevice = (id: string) => {
        const next = devices.filter(device => device.id !== id);
        setDevices(next);
        saveDevices(next);
    };

    const renameDevice = (id: string, value: string) => {
        const next = devices.map(device => (device.id === id ? { ...device, nickname: value } : device));
        setDevices(next);
        saveDevices(next);
    };

    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div>
                    <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Device Setup</div>
                    <h2 style={{ margin: 0 }}>My Mesh Devices</h2>
                </div>
                {!wizardOpen && (
                    <button className="soft-button" onClick={startWizard}>
                        Add a node
                    </button>
                )}
            </div>

            {savedMessage && <div style={{ color: '#bbf7d0', fontSize: '0.85rem' }}>{savedMessage}</div>}

            {devices.length === 0 && !wizardOpen && (
                <p style={{ margin: 0, opacity: 0.8, fontSize: '0.9rem' }}>
                    No nodes added yet. Once a node is paired in the Meshtastic app, tap <strong>Add a node</strong> and
                    the four-step guide walks you through connecting it to this dashboard.
                </p>
            )}

            {devices.length > 0 && !wizardOpen && (
                <p style={{ margin: 0, opacity: 0.7, fontSize: '0.82rem' }}>
                    Only one node talks to this browser over Bluetooth at a time — whichever one you carry and tap{' '}
                    <strong>Connect</strong> on below. It must be powered on, nearby, and not already connected in the
                    Meshtastic phone app (a node only accepts one Bluetooth client at once). The rest of the mesh
                    still shows up automatically through that connection.
                </p>
            )}

            {devices.length > 0 && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {devices.map(device => {
                        const isActive = live.status === 'connected' && live.deviceName === device.bluetoothName;
                        return (
                            <div
                                key={device.id}
                                style={{
                                    border: `1px solid ${isActive ? '#166534' : '#334155'}`,
                                    borderRadius: 10,
                                    padding: '0.6rem 0.7rem',
                                    display: 'grid',
                                    gap: '0.4rem'
                                }}
                            >
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                        value={device.nickname}
                                        onChange={e => renameDevice(device.id, e.target.value)}
                                        maxLength={40}
                                        style={{ ...inputStyle, width: 'auto', flex: '1 1 12rem', fontWeight: 600 }}
                                    />
                                    <span style={{ fontSize: '0.78rem', opacity: 0.8 }}>
                                        {DEVICE_ROLE_OPTIONS.find(option => option.value === device.role)?.label || device.role}
                                    </span>
                                    <BatteryBadge pct={isActive ? live.ownBattery?.pct ?? device.lastBatteryPct : device.lastBatteryPct} />
                                </div>
                                <div style={{ fontSize: '0.78rem', opacity: 0.7 }}>
                                    Bluetooth name: {device.bluetoothName}
                                    {device.stationNotes ? ` · ${device.stationNotes}` : ''}
                                    {device.lastConnectedAt
                                        ? ` · last connected ${new Date(device.lastConnectedAt).toLocaleString()}`
                                        : ' · not connected yet'}
                                    {!isActive && device.lastBatteryAt
                                        ? ` · battery last seen ${new Date(device.lastBatteryAt).toLocaleString()}`
                                        : ''}
                                </div>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                    {isActive ? (
                                        <button className="soft-button" onClick={live.disconnect}>
                                            Disconnect
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                className="soft-button"
                                                onClick={() => void live.connectBluetooth(device.bluetoothName)}
                                                disabled={live.status === 'connecting'}
                                            >
                                                {live.status === 'connecting' ? 'Connecting...' : 'Connect'}
                                            </button>
                                            <button
                                                className="soft-button"
                                                onClick={() => void live.connectBluetooth(device.bluetoothName, { forcePicker: true })}
                                                disabled={live.status === 'connecting'}
                                                title="Open the Bluetooth device picker instead of auto-reconnecting by name"
                                            >
                                                Choose device...
                                            </button>
                                        </>
                                    )}
                                    <button className="soft-button" onClick={() => removeDevice(device.id)} style={{ borderColor: '#7f1d1d', color: '#fecaca' }}>
                                        Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {live.status === 'connected' && !knownDevice && !wizardOpen && (
                <div style={{ fontSize: '0.85rem', opacity: 0.85 }}>
                    Connected to <strong>{live.deviceName}</strong>, which isn&apos;t saved yet. Tap <strong>Add a node</strong> to
                    name it and keep it in this list for one-tap reconnects.
                </div>
            )}

            {wizardOpen && (
                <div style={{ border: '1px solid #334155', borderRadius: 12, padding: '0.75rem', display: 'grid', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {stepTitles.map((title, index) => (
                            <span
                                key={title}
                                style={{
                                    border: `1px solid ${index === step ? '#2563eb' : '#334155'}`,
                                    color: index <= step ? 'inherit' : undefined,
                                    opacity: index <= step ? 1 : 0.55,
                                    borderRadius: 999,
                                    padding: '0.2rem 0.6rem',
                                    fontSize: '0.76rem'
                                }}
                            >
                                {index + 1}. {title}
                            </span>
                        ))}
                    </div>

                    {step === 0 && (
                        <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.88rem' }}>
                            <strong>Can this phone/computer talk to a node?</strong>
                            <div>{support.bluetoothApi ? '✔' : '✖'} Web Bluetooth available (Chrome or Edge required — iPhone Safari cannot do this).</div>
                            <div>{support.secureContext ? '✔' : '✖'} Page loaded over a secure https connection.</div>
                            {!support.ok && (
                                <div style={{ color: '#fde68a' }}>
                                    On iPhone, use the Meshtastic app itself for messaging — this dashboard still shows
                                    guides, emergency steps, and your saved device list.
                                </div>
                            )}
                        </div>
                    )}

                    {step === 1 && (
                        <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.88rem' }}>
                            <strong>Confirm the node is ready</strong>
                            {PREP_CHECKS.map(check => (
                                <label key={check.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(checks[check.id])}
                                        onChange={e => setChecks(prev => ({ ...prev, [check.id]: e.target.checked }))}
                                    />
                                    <span>{check.label}</span>
                                </label>
                            ))}
                        </div>
                    )}

                    {step === 2 && (
                        <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.88rem' }}>
                            <strong>Name this node and set its job</strong>
                            <input
                                value={nickname}
                                onChange={e => setNickname(e.target.value)}
                                placeholder="Nickname (e.g. Nick's handheld, Ridge relay)"
                                maxLength={40}
                                style={inputStyle}
                            />
                            <select value={role} onChange={e => setRole(e.target.value as MeshNodeRole)} style={inputStyle}>
                                {DEVICE_ROLE_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <div style={{ opacity: 0.75, fontSize: '0.8rem' }}>
                                {DEVICE_ROLE_OPTIONS.find(option => option.value === role)?.hint}
                            </div>
                            <input
                                value={stationNotes}
                                onChange={e => setStationNotes(e.target.value)}
                                placeholder="Where it lives (e.g. north ridge tower, cabin shelf)"
                                maxLength={80}
                                style={inputStyle}
                            />
                        </div>
                    )}

                    {step === 3 && (
                        <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.88rem' }}>
                            <strong>Connect and confirm</strong>
                            <p style={{ margin: 0, opacity: 0.8 }}>
                                Tap connect, then choose your node in the browser popup. Once it says connected, the node
                                list and mesh chat switch from demo data to your real mesh.
                            </p>
                            <p style={{ margin: 0, opacity: 0.7, fontSize: '0.82rem' }}>
                                No devices in the popup? Close the Meshtastic phone app first — a node only accepts one
                                Bluetooth connection at a time — then make sure it&apos;s powered on and within a few
                                meters before tapping connect again.
                            </p>
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                {live.status === 'connected' ? (
                                    <span style={{ color: '#bbf7d0', display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                                        Connected to {live.deviceName}
                                        <BatteryBadge pct={live.ownBattery?.pct ?? null} />
                                    </span>
                                ) : (
                                    <button
                                        className="soft-button"
                                        onClick={() => void live.connectBluetooth(undefined, { forcePicker: true })}
                                        disabled={live.status === 'connecting'}
                                    >
                                        {live.status === 'connecting' ? 'Connecting...' : 'Connect over Bluetooth'}
                                    </button>
                                )}
                                {live.status === 'connected' && (
                                    <span style={{ opacity: 0.75 }}>
                                        {live.nodes.length} node{live.nodes.length === 1 ? '' : 's'} seen on the mesh so far.
                                    </span>
                                )}
                            </div>
                            {live.error && <div style={{ color: '#fecaca' }}>{live.error}</div>}
                        </div>
                    )}

                    {formError && <div style={{ color: '#fecaca', fontSize: '0.85rem' }}>{formError}</div>}

                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                        <button
                            className="soft-button"
                            onClick={() => {
                                setWizardOpen(false);
                                resetWizard();
                            }}
                        >
                            Cancel
                        </button>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                            {step > 0 && (
                                <button className="soft-button" onClick={() => setStep(current => current - 1)}>
                                    Back
                                </button>
                            )}
                            {step < stepTitles.length - 1 ? (
                                <button className="soft-button" onClick={goNext}>
                                    Next
                                </button>
                            ) : (
                                <button className="soft-button" onClick={finishOnboarding}>
                                    Save node
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
