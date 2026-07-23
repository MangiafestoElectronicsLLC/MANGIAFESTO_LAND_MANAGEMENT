'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type CamStatus = 'active' | 'offline' | 'maintenance';

type TrailCam = {
    id: string;
    name: string;
    location: string;
    url: string;
    status: CamStatus;
    notes: string;
    updatedAt: string;
};

const STORAGE_KEY = 'family-land-trail-cams-v1';
const DEFAULT_PORTAL_URL =
    process.env.NEXT_PUBLIC_TRAIL_CAM_DASHBOARD_URL ||
    'https://me-cam.replit.app/dashboard';
const DEFAULT_ACCOUNTS_URL =
    process.env.NEXT_PUBLIC_TRAIL_CAM_ACCOUNTS_URL ||
    'https://me-cam.replit.app/';

const STATUS_LABELS: Record<CamStatus, string> = {
    active: 'Active',
    offline: 'Offline',
    maintenance: 'Maintenance'
};

const EMPTY_FORM = {
    name: '',
    location: '',
    url: '',
    status: 'active' as CamStatus,
    notes: ''
};

const buildDefaultCam = (): TrailCam => ({
    id: 'me-cam-dashboard',
    name: 'ME_CAM Dashboard',
    location: 'All linked trail/security cameras',
    url: DEFAULT_PORTAL_URL,
    status: 'active',
    notes: 'Use this to view the full hosted camera dashboard and account-linked feeds.',
    updatedAt: new Date().toISOString()
});

const parseStoredCams = (raw: string | null): TrailCam[] => {
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(cam => cam && typeof cam.id === 'string' && typeof cam.name === 'string')
            .map(cam => ({
                id: cam.id,
                name: typeof cam.name === 'string' ? cam.name : 'Unnamed camera',
                location: typeof cam.location === 'string' ? cam.location : '',
                url: typeof cam.url === 'string' ? cam.url : '',
                status:
                    cam.status === 'active' || cam.status === 'offline' || cam.status === 'maintenance'
                        ? cam.status
                        : 'active',
                notes: typeof cam.notes === 'string' ? cam.notes : '',
                updatedAt: typeof cam.updatedAt === 'string' ? cam.updatedAt : new Date().toISOString()
            }));
    } catch {
        return [];
    }
};

const isValidWebUrl = (value: string) => {
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

export default function TrailCamsPage() {
    const [cams, setCams] = useState<TrailCam[]>([]);
    const [selectedCamId, setSelectedCamId] = useState('');
    const [showEmbed, setShowEmbed] = useState(true);
    const [embedMode, setEmbedMode] = useState<'portal' | 'selected'>('portal');
    const [form, setForm] = useState(EMPTY_FORM);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    useEffect(() => {
        const loaded = parseStoredCams(typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null);

        if (loaded.length > 0) {
            setCams(loaded);
            setSelectedCamId(loaded[0].id);
            return;
        }

        const seeded = [buildDefaultCam()];
        setCams(seeded);
        setSelectedCamId(seeded[0].id);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    }, []);

    useEffect(() => {
        if (cams.length === 0) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cams));
    }, [cams]);

    const selectedCam = useMemo(() => cams.find(cam => cam.id === selectedCamId) || null, [cams, selectedCamId]);

    const activeCamCount = useMemo(() => cams.filter(cam => cam.status === 'active').length, [cams]);

    const embedUrl =
        embedMode === 'portal'
            ? DEFAULT_PORTAL_URL
            : selectedCam?.url || DEFAULT_PORTAL_URL;

    const addCamera = () => {
        setError(null);
        setStatusMessage(null);

        const name = form.name.trim();
        const location = form.location.trim();
        const notes = form.notes.trim();
        const url = form.url.trim();

        if (!name) {
            setError('Camera name is required.');
            return;
        }

        if (!isValidWebUrl(url)) {
            setError('Camera URL must start with http:// or https:// and be a valid web address.');
            return;
        }

        const newCam: TrailCam = {
            id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name,
            location,
            notes,
            status: form.status,
            url,
            updatedAt: new Date().toISOString()
        };

        setCams(prev => [newCam, ...prev]);
        setSelectedCamId(newCam.id);
        setForm(EMPTY_FORM);
        setStatusMessage(`${name} added to trail cams.`);
    };

    const removeCamera = (camId: string) => {
        const cam = cams.find(item => item.id === camId);
        if (!cam) return;

        const next = cams.filter(item => item.id !== camId);
        setCams(next);

        if (selectedCamId === camId) {
            setSelectedCamId(next[0]?.id || '');
        }

        setStatusMessage(`${cam.name} removed.`);
    };

    const updateCamStatus = (camId: string, status: CamStatus) => {
        setCams(prev =>
            prev.map(cam =>
                cam.id === camId
                    ? { ...cam, status, updatedAt: new Date().toISOString() }
                    : cam
            )
        );
    };

    return (
        <div className="trail-cams-page" style={{ display: 'grid', gap: '1rem' }}>
            <div className="trail-cams-top-links" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link href="/dashboard" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Main Dashboard
                </Link>
                <Link href="/dashboard/property-map" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    Property Map
                </Link>
                <Link href="/dashboard/system" style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #334155', color: '#cbd5e1', textDecoration: 'none' }}>
                    System Check
                </Link>
                <a
                    href={DEFAULT_PORTAL_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{ padding: '0.35rem 0.65rem', borderRadius: 6, border: '1px solid #14532d', color: '#bbf7d0', textDecoration: 'none' }}
                >
                    Open ME_CAM Dashboard
                </a>
            </div>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem' }}>
                <div style={{ display: 'grid', gap: '0.25rem' }}>
                    <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Trail Cams + Security Cams</div>
                    <h2 style={{ margin: 0 }}>Camera Operations Center</h2>
                    <div style={{ opacity: 0.78 }}>
                        Launch your hosted ME_CAM dashboard, embed it directly in this app, and keep a clickable list of trail cams currently in use.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.86rem' }}>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Total cams: {cams.length}</span>
                    <span style={{ border: '1px solid #166534', borderRadius: 999, padding: '0.22rem 0.6rem', color: '#bbf7d0' }}>Active: {activeCamCount}</span>
                    <span style={{ border: '1px solid #334155', borderRadius: 999, padding: '0.22rem 0.6rem' }}>Selected: {selectedCam?.name || 'None'}</span>
                </div>

                <div className="trail-cams-quick-actions" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <a className="soft-button" href={DEFAULT_PORTAL_URL} target="_blank" rel="noreferrer">
                        Open dashboard in new tab
                    </a>
                    <a className="soft-button" href={DEFAULT_ACCOUNTS_URL} target="_blank" rel="noreferrer">
                        Manage / create camera accounts
                    </a>
                    {selectedCam && (
                        <a className="soft-button" href={selectedCam.url} target="_blank" rel="noreferrer">
                            Open selected camera
                        </a>
                    )}
                </div>
            </section>

            <section className="panel panel-pad" style={{ display: 'grid', gap: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 700 }}>Live Viewer</div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <input
                            type="checkbox"
                            checked={showEmbed}
                            onChange={e => setShowEmbed(e.target.checked)}
                            style={{ width: 18, height: 18 }}
                        />
                        Show embedded viewer
                    </label>
                </div>

                <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                            type="radio"
                            name="embed-mode"
                            checked={embedMode === 'portal'}
                            onChange={() => setEmbedMode('portal')}
                            style={{ width: 16, height: 16 }}
                        />
                        ME_CAM dashboard
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                            type="radio"
                            name="embed-mode"
                            checked={embedMode === 'selected'}
                            onChange={() => setEmbedMode('selected')}
                            disabled={!selectedCam}
                            style={{ width: 16, height: 16 }}
                        />
                        Selected camera URL
                    </label>
                </div>

                {showEmbed ? (
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                        <div style={{ opacity: 0.78, fontSize: '0.82rem' }}>
                            If embedding is blocked by your camera provider, use the open-in-new-tab buttons above.
                        </div>
                        <iframe
                            title="Trail camera viewer"
                            src={embedUrl}
                            className="trail-cams-embed"
                            style={{ width: '100%', minHeight: 380, border: '1px solid #334155', borderRadius: 14, background: '#020617' }}
                            allow="camera; microphone; fullscreen"
                        />
                    </div>
                ) : (
                    <div style={{ opacity: 0.78, fontSize: '0.86rem' }}>
                        Embedded viewer is off. Use quick actions to open the dashboard or selected camera.
                    </div>
                )}
            </section>

            <div className="trail-cams-management-grid">
                <section className="panel panel-pad" style={{ display: 'grid', gap: '0.8rem' }}>
                    <div style={{ fontWeight: 700 }}>Trail Cams In Use</div>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {cams.length === 0 ? (
                            <div style={{ opacity: 0.75 }}>No cameras listed yet. Add your first camera below.</div>
                        ) : (
                            cams.map(cam => (
                                <article
                                    key={cam.id}
                                    style={{
                                        border: selectedCamId === cam.id ? '1px solid #38bdf8' : '1px solid #334155',
                                        borderRadius: 12,
                                        padding: '0.75rem',
                                        background: 'rgba(2, 6, 23, 0.55)',
                                        display: 'grid',
                                        gap: '0.55rem'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                                        <div style={{ display: 'grid', gap: '0.2rem' }}>
                                            <strong>{cam.name}</strong>
                                            <span style={{ opacity: 0.8, fontSize: '0.84rem' }}>{cam.location || 'No location set'}</span>
                                        </div>
                                        <span
                                            style={{
                                                borderRadius: 999,
                                                padding: '0.2rem 0.58rem',
                                                border:
                                                    cam.status === 'active'
                                                        ? '1px solid #166534'
                                                        : cam.status === 'offline'
                                                            ? '1px solid #991b1b'
                                                            : '1px solid #92400e',
                                                color:
                                                    cam.status === 'active'
                                                        ? '#bbf7d0'
                                                        : cam.status === 'offline'
                                                            ? '#fecaca'
                                                            : '#fde68a',
                                                fontSize: '0.78rem'
                                            }}
                                        >
                                            {STATUS_LABELS[cam.status]}
                                        </span>
                                    </div>

                                    {cam.notes && <div style={{ fontSize: '0.84rem', opacity: 0.84 }}>{cam.notes}</div>}

                                    <div className="trail-cams-card-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <button className="soft-button" onClick={() => setSelectedCamId(cam.id)}>
                                            Select
                                        </button>
                                        <a className="soft-button" href={cam.url} target="_blank" rel="noreferrer">
                                            Open feed
                                        </a>
                                        <select
                                            value={cam.status}
                                            onChange={e => updateCamStatus(cam.id, e.target.value as CamStatus)}
                                            style={{ maxWidth: 190 }}
                                        >
                                            <option value="active">Active</option>
                                            <option value="offline">Offline</option>
                                            <option value="maintenance">Maintenance</option>
                                        </select>
                                        {cam.id !== 'me-cam-dashboard' && (
                                            <button
                                                className="soft-button"
                                                onClick={() => removeCamera(cam.id)}
                                                style={{ borderColor: '#7f1d1d', color: '#fecaca' }}
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </article>
                            ))
                        )}
                    </div>
                </section>

                <section className="panel panel-pad" style={{ display: 'grid', gap: '0.8rem' }}>
                    <div style={{ fontWeight: 700 }}>Add Camera</div>
                    <div style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Camera name</span>
                            <input
                                value={form.name}
                                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="North Gate Cam"
                            />
                        </label>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Location</span>
                            <input
                                value={form.location}
                                onChange={e => setForm(prev => ({ ...prev, location: e.target.value }))}
                                placeholder="North field tree line"
                            />
                        </label>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Camera URL</span>
                            <input
                                value={form.url}
                                onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))}
                                placeholder="https://..."
                            />
                        </label>
                        <label style={{ display: 'grid', gap: '0.35rem' }}>
                            <span>Status</span>
                            <select
                                value={form.status}
                                onChange={e => setForm(prev => ({ ...prev, status: e.target.value as CamStatus }))}
                            >
                                <option value="active">Active</option>
                                <option value="offline">Offline</option>
                                <option value="maintenance">Maintenance</option>
                            </select>
                        </label>
                    </div>

                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span>Notes</span>
                        <textarea
                            value={form.notes}
                            onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Battery replaced 7/23. Faces main trail crossing."
                            rows={3}
                        />
                    </label>

                    <div className="trail-cams-form-actions" style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                        <button className="soft-button" onClick={addCamera}>
                            Add camera
                        </button>
                        <button className="soft-button" onClick={() => setForm(EMPTY_FORM)}>
                            Clear form
                        </button>
                    </div>

                    {error && (
                        <div style={{ border: '1px solid #7f1d1d', color: '#fecaca', borderRadius: 10, padding: '0.6rem 0.7rem' }}>
                            {error}
                        </div>
                    )}
                    {statusMessage && (
                        <div style={{ border: '1px solid #14532d', color: '#bbf7d0', borderRadius: 10, padding: '0.6rem 0.7rem' }}>
                            {statusMessage}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
