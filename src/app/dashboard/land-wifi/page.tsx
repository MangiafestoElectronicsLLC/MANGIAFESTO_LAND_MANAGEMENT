'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';

type NetworkType = 'wifi' | 'hotspot';
type SaveMode = 'supabase' | 'local';

type WifiNetwork = {
    id: string;
    label: string;
    network_type: NetworkType;
    ssid: string;
    password: string;
    notes: string;
    in_use: boolean;
    created_at: string;
    updated_at: string;
};

const WIFI_TABLES = ['land_wifi_networks'];
const LOCAL_STORAGE_KEY = 'family-land-wifi-networks-v1';

const TYPE_LABELS: Record<NetworkType, string> = {
    wifi: 'Wi-Fi',
    hotspot: 'Mobile Hotspot'
};

const EMPTY_FORM = {
    label: '',
    network_type: 'wifi' as NetworkType,
    ssid: '',
    password: '',
    notes: ''
};

const nowIso = () => new Date().toISOString();

const makeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const parseLocalNetworks = (raw: string | null): WifiNetwork[] => {
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(item => item && typeof item.id === 'string' && typeof item.ssid === 'string')
            .map(item => ({
                id: item.id,
                label: typeof item.label === 'string' ? item.label : 'Unnamed network',
                network_type: item.network_type === 'hotspot' ? 'hotspot' : 'wifi',
                ssid: typeof item.ssid === 'string' ? item.ssid : '',
                password: typeof item.password === 'string' ? item.password : '',
                notes: typeof item.notes === 'string' ? item.notes : '',
                in_use: item.in_use !== false,
                created_at: typeof item.created_at === 'string' ? item.created_at : nowIso(),
                updated_at: typeof item.updated_at === 'string' ? item.updated_at : nowIso()
            }));
    } catch {
        return [];
    }
};

const readLocalNetworks = () =>
    parseLocalNetworks(typeof window !== 'undefined' ? window.localStorage.getItem(LOCAL_STORAGE_KEY) : null);

const writeLocalNetworks = (networks: WifiNetwork[]) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(networks));
};

export default function LandWifiPage() {
    const router = useRouter();
    const supabase = supabaseClient();

    const [saveMode, setSaveMode] = useState<SaveMode>('supabase');
    const [networks, setNetworks] = useState<WifiNetwork[]>([]);
    const [visiblePasswordIds, setVisiblePasswordIds] = useState<Set<string>>(new Set());
    const [form, setForm] = useState(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [setupNotice, setSetupNotice] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    useEffect(() => {
        const bootstrap = async () => {
            try {
                const {
                    data: { user }
                } = await supabase.auth.getUser();

                if (!user) {
                    router.push('/');
                    return;
                }

                const { data, error: fetchError } = await supabase
                    .from('land_wifi_networks')
                    .select('*')
                    .order('in_use', { ascending: false })
                    .order('created_at', { ascending: false });

                if (fetchError) {
                    throw fetchError;
                }

                setSaveMode('supabase');
                setNetworks((data || []) as WifiNetwork[]);
            } catch (err: any) {
                if (isMissingTableSetupError(err, WIFI_TABLES)) {
                    setSaveMode('local');
                    setSetupNotice(
                        'Shared land_wifi_networks table is missing, so networks are only stored on this device. Run supabase/land_wifi_networks.sql to share them with everyone.'
                    );
                    setNetworks(readLocalNetworks());
                } else {
                    setError(getSupabaseErrorMessage(err, 'Could not load land wifi networks.'));
                }
            } finally {
                setLoading(false);
            }
        };

        void bootstrap();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const activeNetworks = useMemo(() => networks.filter(network => network.in_use), [networks]);

    const togglePasswordVisible = (id: string) => {
        setVisiblePasswordIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const copyText = async (text: string, label: string) => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setStatusMessage(`${label} copied to clipboard.`);
        } catch {
            setError('Could not copy to clipboard on this device.');
        }
    };

    const addNetwork = async () => {
        setError(null);
        setStatusMessage(null);

        const label = form.label.trim();
        const ssid = form.ssid.trim();
        const password = form.password.trim();
        const notes = form.notes.trim();

        if (!label) {
            setError('Give this network a name (e.g. "Main Cabin" or "Dad\'s Phone Hotspot").');
            return;
        }

        if (!ssid) {
            setError('Network name (SSID) is required.');
            return;
        }

        setSaving(true);

        try {
            if (saveMode === 'supabase') {
                const { data, error: insertError } = await supabase
                    .from('land_wifi_networks')
                    .insert({
                        label,
                        network_type: form.network_type,
                        ssid,
                        password,
                        notes,
                        in_use: true
                    })
                    .select('*')
                    .single();

                if (insertError) {
                    throw insertError;
                }

                setNetworks(prev => [data as WifiNetwork, ...prev]);
            } else {
                const newNetwork: WifiNetwork = {
                    id: makeId(),
                    label,
                    network_type: form.network_type,
                    ssid,
                    password,
                    notes,
                    in_use: true,
                    created_at: nowIso(),
                    updated_at: nowIso()
                };

                const next = [newNetwork, ...networks];
                setNetworks(next);
                writeLocalNetworks(next);
            }

            setForm(EMPTY_FORM);
            setStatusMessage(`${label} added.`);
        } catch (err: any) {
            setError(getSupabaseErrorMessage(err, 'Could not save this network.'));
        } finally {
            setSaving(false);
        }
    };

    const toggleInUse = async (network: WifiNetwork) => {
        setError(null);
        const nextInUse = !network.in_use;

        if (saveMode === 'supabase') {
            const { data, error: updateError } = await supabase
                .from('land_wifi_networks')
                .update({ in_use: nextInUse })
                .eq('id', network.id)
                .select('*')
                .single();

            if (updateError) {
                setError(getSupabaseErrorMessage(updateError, 'Could not update this network.'));
                return;
            }

            setNetworks(prev => prev.map(item => (item.id === network.id ? (data as WifiNetwork) : item)));
        } else {
            const next = networks.map(item =>
                item.id === network.id ? { ...item, in_use: nextInUse, updated_at: nowIso() } : item
            );
            setNetworks(next);
            writeLocalNetworks(next);
        }
    };

    const removeNetwork = async (network: WifiNetwork) => {
        setError(null);

        if (saveMode === 'supabase') {
            const { error: deleteError } = await supabase.from('land_wifi_networks').delete().eq('id', network.id);

            if (deleteError) {
                setError(getSupabaseErrorMessage(deleteError, 'Could not remove this network.'));
                return;
            }
        }

        const next = networks.filter(item => item.id !== network.id);
        setNetworks(next);
        if (saveMode === 'local') {
            writeLocalNetworks(next);
        }
        setStatusMessage(`${network.label} removed.`);
    };

    return (
        <div className="land-wifi-page" style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link href="/dashboard" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Main Dashboard
                </Link>
                <Link href="/dashboard/property-map" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Property Map
                </Link>
                <Link href="/dashboard/system" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    System Check
                </Link>
            </div>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'grid', gap: '0.25rem' }}>
                    <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Connectivity</div>
                    <h2 style={{ margin: 0 }}>Land Wi-Fi &amp; Hotspots</h2>
                    <div style={{ opacity: 0.78 }}>
                        Shared Wi-Fi network names/passwords and mobile hotspots so everyone can get connected anywhere on the land. Toggle a network off when it&apos;s not currently broadcasting.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.86rem' }}>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Total: {networks.length}</span>
                    <span style={{ border: '1px solid #166534', borderRadius: 999, padding: '0.22rem 0.6rem', color: '#bbf7d0' }}>In use: {activeNetworks.length}</span>
                    {saveMode === 'local' && (
                        <span style={{ border: '1px solid #92400e', borderRadius: 999, padding: '0.22rem 0.6rem', color: '#fde68a' }}>
                            Saved on this device only
                        </span>
                    )}
                </div>
            </section>

            {setupNotice && (
                <div className="notice-warning" style={{ border: '1px solid #92400e', borderRadius: 10, padding: '0.7rem', color: '#fde68a' }}>
                    {setupNotice}
                </div>
            )}
            {error && (
                <div className="notice-error" style={{ border: '1px solid #7f1d1d', borderRadius: 10, padding: '0.7rem', color: '#fecaca' }}>
                    {error}
                </div>
            )}
            {statusMessage && (
                <div style={{ border: '1px solid #166534', borderRadius: 10, padding: '0.7rem', color: '#bbf7d0' }}>
                    {statusMessage}
                </div>
            )}

            <div className="land-wifi-management-grid">
                <section className="panel panel-pad" style={{ display: 'grid', gap: '0.8rem' }}>
                    <div style={{ fontWeight: 700 }}>Available Networks</div>

                    {loading ? (
                        <div style={{ opacity: 0.75 }}>Loading...</div>
                    ) : networks.length === 0 ? (
                        <div style={{ opacity: 0.75 }}>No networks added yet. Add the first Wi-Fi or hotspot below.</div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                            {networks.map(network => {
                                const passwordVisible = visiblePasswordIds.has(network.id);
                                return (
                                    <article
                                        key={network.id}
                                        style={{
                                            border: network.in_use ? '1px solid #166534' : '1px solid #334155',
                                            borderRadius: 12,
                                            padding: '0.75rem',
                                            background: 'rgba(2, 6, 23, 0.55)',
                                            display: 'grid',
                                            gap: '0.55rem',
                                            opacity: network.in_use ? 1 : 0.65
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                <strong>{network.label}</strong>
                                                <span style={{ opacity: 0.8, fontSize: '0.84rem' }}>{TYPE_LABELS[network.network_type]}</span>
                                            </div>
                                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={network.in_use}
                                                    onChange={() => void toggleInUse(network)}
                                                    style={{ width: 18, height: 18 }}
                                                />
                                                {network.in_use ? 'In use' : 'Not in use'}
                                            </label>
                                        </div>

                                        <div style={{ display: 'grid', gap: '0.3rem', fontSize: '0.9rem' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span style={{ opacity: 0.75 }}>SSID:</span>
                                                <code style={{ background: 'rgba(148,163,184,0.12)', padding: '0.1rem 0.4rem', borderRadius: 6 }}>{network.ssid}</code>
                                                <button className="soft-button" onClick={() => void copyText(network.ssid, 'Network name')}>
                                                    Copy
                                                </button>
                                            </div>
                                            {network.password && (
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <span style={{ opacity: 0.75 }}>Password:</span>
                                                    <code style={{ background: 'rgba(148,163,184,0.12)', padding: '0.1rem 0.4rem', borderRadius: 6 }}>
                                                        {passwordVisible ? network.password : '•'.repeat(Math.max(6, network.password.length))}
                                                    </code>
                                                    <button className="soft-button" onClick={() => togglePasswordVisible(network.id)}>
                                                        {passwordVisible ? 'Hide' : 'Show'}
                                                    </button>
                                                    <button className="soft-button" onClick={() => void copyText(network.password, 'Password')}>
                                                        Copy
                                                    </button>
                                                </div>
                                            )}
                                            {!network.password && <div style={{ opacity: 0.7 }}>No password (open network)</div>}
                                        </div>

                                        {network.notes && <div style={{ fontSize: '0.84rem', opacity: 0.84 }}>{network.notes}</div>}

                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <button
                                                className="soft-button"
                                                onClick={() => void removeNetwork(network)}
                                                style={{ borderColor: '#7f1d1d', color: '#fecaca' }}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className="panel panel-pad" style={{ display: 'grid', gap: '0.8rem' }}>
                    <div style={{ fontWeight: 700 }}>Add Wi-Fi / Hotspot</div>
                    <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Name / label</span>
                            <input
                                value={form.label}
                                onChange={e => setForm(prev => ({ ...prev, label: e.target.value }))}
                                placeholder="Main Cabin Wi-Fi"
                            />
                        </label>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Type</span>
                            <select
                                value={form.network_type}
                                onChange={e => setForm(prev => ({ ...prev, network_type: e.target.value as NetworkType }))}
                            >
                                <option value="wifi">Wi-Fi</option>
                                <option value="hotspot">Mobile Hotspot</option>
                            </select>
                        </label>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Network name (SSID)</span>
                            <input
                                value={form.ssid}
                                onChange={e => setForm(prev => ({ ...prev, ssid: e.target.value }))}
                                placeholder="Family-Land-5G"
                            />
                        </label>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Password (optional)</span>
                            <input
                                value={form.password}
                                onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                                placeholder="Leave blank if open"
                            />
                        </label>
                        <label style={{ display: 'grid', gap: '0.35rem', gridColumn: '1 / -1' }}>
                            <span>Notes (optional)</span>
                            <input
                                value={form.notes}
                                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                                placeholder="Best signal near the barn, etc."
                            />
                        </label>
                    </div>

                    <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                        <button className="soft-button" onClick={() => void addNetwork()} disabled={saving}>
                            {saving ? 'Saving...' : 'Add network'}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
