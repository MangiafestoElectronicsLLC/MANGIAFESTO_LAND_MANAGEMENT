'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import { formatRadioId, parseRadioId, type RadioAssignment } from '@/lib/meshRadioAssignments';
import type { MeshtasticConnection } from '@/lib/useMeshtasticConnection';
import { nodeNumberFromId } from '@/lib/meshMessageRouting';

type Profile = { id: string; full_name: string | null };
type AssignmentRow = { user_id: string; node_num: number };

export default function RadioAssignments({ live, userId, onChange }: {
    live: MeshtasticConnection;
    userId: string;
    onChange: (assignments: RadioAssignment[]) => void;
}) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [assignments, setAssignments] = useState<RadioAssignment[]>([]);
    const [selectedUser, setSelectedUser] = useState('');
    const [radioId, setRadioId] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        const supabase = supabaseClient();
        const [profileResult, assignmentResult] = await Promise.all([
            supabase.from('profiles').select('id, full_name').order('full_name'),
            supabase.from('meshtastic_radio_assignments').select('user_id, node_num')
        ]);
        if (profileResult.error || assignmentResult.error) {
            throw new Error(`Could not load shared radio assignments. Run the Meshtastic assignments SQL setup and check your connection. ${profileResult.error?.message || assignmentResult.error?.message}`);
        }
        const people: Profile[] = profileResult.data;
        const rows: AssignmentRow[] = assignmentResult.data;
        const next = rows.map(row => ({
            userId: row.user_id,
            userName: people.find(profile => profile.id === row.user_id)?.full_name || 'Unnamed account',
            nodeNum: row.node_num
        }));
        setProfiles(people);
        setAssignments(next);
        onChange(next);
        setError(null);
    }, [onChange]);

    useEffect(() => {
        void load().catch(err => setError(err instanceof Error ? err.message : 'Could not load shared radio assignments.'));
    }, [load]);

    const save = async (remove: boolean) => {
        setError(null);
        setNotice(null);
        if (!selectedUser || (!remove && parseRadioId(radioId) === null)) {
            setError('Choose an account and enter the complete eight-digit radio ID.');
            return;
        }
        setSaving(true);
        try {
            const { data, error: sessionError } = await supabaseClient().auth.getSession();
            if (sessionError || !data.session) throw new Error('Sign in again before changing assignments.');
            const response = await fetch('/api/satcom/radio-assignments', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
                body: JSON.stringify({ userId: selectedUser, radioId: remove ? null : radioId })
            });
            const result: { error?: string } = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not save the assignment.');
            await load();
            setNotice(remove ? 'Assignment removed.' : 'Radio assignment saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the assignment.');
        } finally {
            setSaving(false);
        }
    };

    const ownAssignment = assignments.find(item => item.userId === userId);
    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.7rem' }}>
            <h2 style={{ margin: 0 }}>Radios assigned to accounts</h2>
            <p style={{ margin: 0 }}>An admin can assign one verified radio to each account. This helps everyone select the right radio; it does not connect radios or create an account inbox.</p>
            {error && <div role="alert" style={{ color: '#fecaca' }}>{error} <button className="soft-button" onClick={() => void load().catch(err => setError(err instanceof Error ? err.message : 'Could not load shared radio assignments.'))}>Retry loading</button></div>}
            {notice && <p role="status" style={{ color: '#bbf7d0', margin: 0 }}>{notice}</p>}
            {assignments.length === 0 ? <p style={{ margin: 0 }}>No shared assignments loaded.</p> : (
                <ul style={{ margin: 0 }}>
                    {assignments.map(item => <li key={item.userId}>{item.userName}{item.userId === userId ? ' (you)' : ''}: {formatRadioId(item.nodeNum)}</li>)}
                </ul>
            )}
            {ownAssignment && live.status === 'connected' && live.ownNodeNum !== null && ownAssignment.nodeNum !== live.ownNodeNum &&
                <p role="status" style={{ margin: 0 }}>This connected radio is not the radio assigned to your account. Direct replies go to the connected radio, not automatically to your assigned radio.</p>}
            <details>
                <summary style={{ cursor: 'pointer' }}>Assign or remove a radio (admin)</summary>
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.6rem' }}>
                    <label htmlFor="radio-account">Account</label>
                    <select id="radio-account" value={selectedUser} onChange={event => {
                        const id = event.target.value;
                        setSelectedUser(id);
                        const current = assignments.find(item => item.userId === id);
                        setRadioId(current ? formatRadioId(current.nodeNum) : '');
                    }}>
                        <option value="">Choose an account</option>
                        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name || profile.id}</option>)}
                    </select>
                    <label htmlFor="assignment-radio">Full radio node ID</label>
                    <input id="assignment-radio" value={radioId} onChange={event => setRadioId(event.target.value)} placeholder="!abcd497c" />
                    {live.status === 'connected' && (
                        <label>Or choose a detected radio
                            <select value="" onChange={event => setRadioId(event.target.value)} style={{ marginLeft: '0.5rem' }}>
                                <option value="">Choose verified radio</option>
                                {live.nodes.map(node => {
                                    const num = nodeNumberFromId(node.id);
                                    return num === null ? null : <option key={node.id} value={formatRadioId(num)}>{node.name} ({formatRadioId(num)})</option>;
                                })}
                            </select>
                        </label>
                    )}
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>Compare the entire ID on the person&apos;s radio or Meshtastic app. The last four digits alone are not enough. Changing assignments requires admin access.</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button className="soft-button" disabled={saving} onClick={() => void save(false)}>Save assignment</button>
                        <button className="soft-button" disabled={saving || !assignments.some(item => item.userId === selectedUser)} onClick={() => void save(true)}>Remove assignment</button>
                    </div>
                </div>
            </details>
            <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8 }}>Assignments are visible to signed-in users and do not restrict access to a radio. Messages remain on this browser, not in an account inbox. To receive on the website, connect a radio and keep this page open.</p>
        </section>
    );
}
