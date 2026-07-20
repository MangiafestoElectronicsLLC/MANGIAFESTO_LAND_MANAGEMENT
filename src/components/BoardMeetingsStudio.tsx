'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';

type StorageMode = 'supabase' | 'local';

type BoardMeeting = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    started_at: string;
    ended_at: string | null;
    recording_url: string | null;
    recording_path: string | null;
    duration_seconds: number | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

type BoardMeetingNote = {
    id: string;
    meeting_id: string;
    note: string;
    note_time_seconds: number;
    created_by: string | null;
    created_at: string;
};

const LOCAL_MEETINGS_KEY = 'family-land-local-meetings';
const LOCAL_NOTES_KEY = 'family-land-local-meeting-notes';

const SUPPORTED_MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

const formatSeconds = (totalSeconds: number | null | undefined) => {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
    const minutes = Math.floor(safeSeconds / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (safeSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const formatDate = (value: string) =>
    new Date(value).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short'
    });

const parseJson = <T,>(raw: string | null, fallback: T) => {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const isMissingMeetingSetup = (message: string) => {
    const lower = message.toLowerCase();
    return (
        lower.includes("could not find the table 'public.board_meetings'") ||
        lower.includes("could not find the table 'public.board_meeting_notes'")
    );
};

const toMeetingRoomName = (meetingId: string) => `family-land-board-${meetingId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48)}`;

const humanizeMediaError = (err: any) => {
    const name = String(err?.name || '').toLowerCase();
    if (name === 'notallowederror' || name === 'securityerror') {
        return 'Camera or microphone permission was denied. Allow browser media access, then try again.';
    }
    if (name === 'notfounderror' || name === 'devicesnotfounderror') {
        return 'No usable camera or microphone was found on this device.';
    }
    if (name === 'notreadableerror' || name === 'trackstarterror') {
        return 'Camera or microphone is busy in another app. Close other apps using media devices and retry.';
    }
    return err?.message || 'Could not access camera and microphone.';
};

export default function BoardMeetingsStudio() {
    const router = useRouter();
    const supabase = supabaseClient();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<BlobPart[]>([]);
    const liveMeetingIdRef = useRef<string | null>(null);
    const liveStartedAtRef = useRef<number>(0);

    const [storageMode, setStorageMode] = useState<StorageMode>('supabase');
    const [setupNotice, setSetupNotice] = useState<string | null>(null);
    const [profileId, setProfileId] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [meetings, setMeetings] = useState<BoardMeeting[]>([]);
    const [notesByMeeting, setNotesByMeeting] = useState<Record<string, BoardMeetingNote[]>>({});
    const [selectedMeetingId, setSelectedMeetingId] = useState<string>('');
    const [liveMeetingId, setLiveMeetingId] = useState<string | null>(null);
    const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
    const [liveTitle, setLiveTitle] = useState('Family Board Meeting');
    const [liveDescription, setLiveDescription] = useState('');
    const [noteDraft, setNoteDraft] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isStarting, setIsStarting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const isSupabaseMode = storageMode === 'supabase';

    const readLocalMeetings = () => {
        const localMeetings = parseJson<BoardMeeting[]>(window.localStorage.getItem(LOCAL_MEETINGS_KEY), []);
        return localMeetings.filter(meeting => meeting && typeof meeting.id === 'string');
    };

    const readLocalNotes = () => {
        const localNotes = parseJson<Record<string, BoardMeetingNote[]>>(window.localStorage.getItem(LOCAL_NOTES_KEY), {});
        return localNotes || {};
    };

    const saveLocalMeetings = (nextMeetings: BoardMeeting[]) => {
        window.localStorage.setItem(LOCAL_MEETINGS_KEY, JSON.stringify(nextMeetings));
    };

    const saveLocalNotes = (nextNotes: Record<string, BoardMeetingNote[]>) => {
        window.localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(nextNotes));
    };

    const ensureUser = useCallback(async () => {
        const {
            data: { user }
        } = await supabase.auth.getUser();

        if (!user) {
            router.push('/');
            return null;
        }

        setEmail(user.email || '');

        const { data: profileData } = await supabase
            .from('profiles')
            .select('id, full_name, role_id')
            .eq('id', user.id)
            .maybeSingle();

        if (!profileData) {
            await supabase.from('profiles').upsert({
                id: user.id,
                full_name: user.email,
                role_id: null
            });
        }

        setProfileId(user.id);
        return user.id;
    }, [router, supabase]);

    const loadMeetings = useCallback(async () => {
        if (!isSupabaseMode) {
            const localMeetings = readLocalMeetings();
            setMeetings(localMeetings);
            if (!selectedMeetingId && localMeetings[0]) {
                setSelectedMeetingId(localMeetings[0].id);
            }
            return localMeetings;
        }

        const { data, error: fetchError } = await supabase
            .from('board_meetings')
            .select('*')
            .order('created_at', { ascending: false });

        if (fetchError) {
            throw fetchError;
        }

        const nextMeetings = (data || []) as BoardMeeting[];
        setMeetings(nextMeetings);

        if (!selectedMeetingId && nextMeetings[0]) {
            setSelectedMeetingId(nextMeetings[0].id);
        }

        return nextMeetings;
    }, [isSupabaseMode, selectedMeetingId, supabase]);

    const loadNotes = useCallback(
        async (meetingId: string) => {
            if (!meetingId) return;

            if (!isSupabaseMode) {
                const localNotes = readLocalNotes();
                setNotesByMeeting(localNotes);
                return;
            }

            const { data, error: fetchError } = await supabase
                .from('board_meeting_notes')
                .select('id, meeting_id, note, note_time_seconds, created_by, created_at')
                .eq('meeting_id', meetingId)
                .order('created_at', { ascending: true });

            if (fetchError) {
                throw fetchError;
            }

            setNotesByMeeting(prev => ({
                ...prev,
                [meetingId]: (data || []) as BoardMeetingNote[]
            }));
        },
        [isSupabaseMode, supabase]
    );

    const loadNotesForMeetings = useCallback(
        async (meetingIds: string[]) => {
            const validMeetingIds = Array.from(new Set(meetingIds.filter(Boolean)));
            if (validMeetingIds.length === 0) return;

            if (!isSupabaseMode) {
                const localNotes = readLocalNotes();
                setNotesByMeeting(localNotes);
                return;
            }

            const { data, error: fetchError } = await supabase
                .from('board_meeting_notes')
                .select('id, meeting_id, note, note_time_seconds, created_by, created_at')
                .in('meeting_id', validMeetingIds)
                .order('created_at', { ascending: true });

            if (fetchError) {
                throw fetchError;
            }

            const grouped: Record<string, BoardMeetingNote[]> = {};
            for (const meetingId of validMeetingIds) {
                grouped[meetingId] = [];
            }

            for (const row of (data || []) as BoardMeetingNote[]) {
                if (!grouped[row.meeting_id]) {
                    grouped[row.meeting_id] = [];
                }
                grouped[row.meeting_id].push(row);
            }

            setNotesByMeeting(prev => ({
                ...prev,
                ...grouped
            }));
        },
        [isSupabaseMode, supabase]
    );

    const getMeetingMediaStream = async () => {
        const constraints: MediaStreamConstraints[] = [
            { video: true, audio: true },
            { video: true, audio: false },
            { video: false, audio: true }
        ];

        let lastError: any = null;
        for (const nextConstraints of constraints) {
            try {
                return await navigator.mediaDevices.getUserMedia(nextConstraints);
            } catch (err: any) {
                lastError = err;
            }
        }

        throw lastError || new Error('Could not access camera and microphone.');
    };

    useEffect(() => {
        const bootstrap = async () => {
            try {
                await ensureUser();
                const nextMeetings = await loadMeetings();
                await loadNotesForMeetings(nextMeetings.map(meeting => meeting.id));

                if (nextMeetings[0]) {
                    setSelectedMeetingId(nextMeetings[0].id);
                    await loadNotes(nextMeetings[0].id);
                }
            } catch (err: any) {
                const message = String(err?.message || 'Board meetings failed to load.');
                if (isMissingMeetingSetup(message)) {
                    setStorageMode('local');
                    setSetupNotice('Supabase board meeting tables are missing, so this page is now running in local browser mode. Run supabase/board_meetings.sql and supabase/storage_board_meetings.sql, then refresh to return to full Supabase mode.');
                    const localMeetings = readLocalMeetings();
                    const localNotes = readLocalNotes();
                    setMeetings(localMeetings);
                    setNotesByMeeting(localNotes);
                    if (localMeetings[0]) {
                        setSelectedMeetingId(localMeetings[0].id);
                    }
                } else {
                    setError(message);
                }
            } finally {
                setIsLoading(false);
            }
        };

        bootstrap();
    }, [ensureUser, loadMeetings, loadNotes, loadNotesForMeetings]);

    useEffect(() => {
        if (!isSupabaseMode) return;

        const channel = supabase
            .channel('board-meetings-live')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'board_meetings' },
                () => {
                    void (async () => {
                        const updatedMeetings = await loadMeetings();
                        await loadNotesForMeetings(updatedMeetings.map(meeting => meeting.id));
                    })();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'board_meeting_notes' },
                payload => {
                    const meetingId = payload.new && 'meeting_id' in payload.new ? String(payload.new.meeting_id) : '';
                    if (meetingId) {
                        void loadNotes(meetingId);
                    }
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [isSupabaseMode, loadMeetings, loadNotes, loadNotesForMeetings, supabase]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (liveStream) {
            video.srcObject = liveStream;
            video.removeAttribute('src');
            video.load();
            void video.play().catch(() => undefined);
            return;
        }

        const selectedMeeting = meetings.find(meeting => meeting.id === selectedMeetingId) || null;
        if (selectedMeeting?.recording_url) {
            video.srcObject = null;
            video.src = selectedMeeting.recording_url;
            video.load();
            return;
        }

        video.srcObject = null;
        video.removeAttribute('src');
        video.load();
    }, [liveStream, meetings, selectedMeetingId]);

    const selectedMeeting = useMemo(
        () => meetings.find(meeting => meeting.id === selectedMeetingId) || null,
        [meetings, selectedMeetingId]
    );

    const activeRoomMeetingId = liveMeetingId || selectedMeeting?.id || '';
    const activeRoomName = activeRoomMeetingId ? toMeetingRoomName(activeRoomMeetingId) : '';
    const activeRoomUrl = activeRoomName ? `https://meet.jit.si/${activeRoomName}` : '';

    const liveMeetingLabel = liveMeetingId
        ? `${liveTitle.trim() || 'Family Board Meeting'} • live`
        : selectedMeeting
            ? `${selectedMeeting.title} • ${selectedMeeting.status}`
            : 'No meeting selected';

    const currentMeetingId = liveMeetingId || selectedMeeting?.id || meetings[0]?.id || '';
    const currentNotes = currentMeetingId ? notesByMeeting[currentMeetingId] || [] : [];

    const getPlaybackTime = () => {
        if (liveMeetingIdRef.current) {
            return Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000));
        }

        return Math.max(0, Math.floor(videoRef.current?.currentTime || 0));
    };

    const refreshAfterSave = async () => {
        const nextMeetings = await loadMeetings();
        if (liveMeetingIdRef.current) {
            setSelectedMeetingId(liveMeetingIdRef.current);
        } else if (nextMeetings[0] && !selectedMeetingId) {
            setSelectedMeetingId(nextMeetings[0].id);
        }
    };

    const upsertLocalMeeting = (meetingId: string, updater: (meeting: BoardMeeting) => BoardMeeting) => {
        setMeetings(prev => {
            const next = prev.map(meeting => (meeting.id === meetingId ? updater(meeting) : meeting));
            saveLocalMeetings(next);
            return next;
        });
    };

    const retrySupabaseMode = async () => {
        setError(null);
        setSetupNotice(null);
        setStatusMessage('Retrying Supabase board meetings mode...');

        try {
            const { data: nextMeetingsData, error: meetingsError } = await supabase
                .from('board_meetings')
                .select('*')
                .order('created_at', { ascending: false });

            if (meetingsError) {
                throw meetingsError;
            }

            const nextMeetings = (nextMeetingsData || []) as BoardMeeting[];
            const meetingIds = nextMeetings.map(meeting => meeting.id);

            const { data: notesData, error: notesError } = meetingIds.length
                ? await supabase
                    .from('board_meeting_notes')
                    .select('id, meeting_id, note, note_time_seconds, created_by, created_at')
                    .in('meeting_id', meetingIds)
                    .order('created_at', { ascending: true })
                : { data: [], error: null as any };

            if (notesError) {
                throw notesError;
            }

            const grouped: Record<string, BoardMeetingNote[]> = {};
            for (const meetingId of meetingIds) {
                grouped[meetingId] = [];
            }

            for (const row of (notesData || []) as BoardMeetingNote[]) {
                if (!grouped[row.meeting_id]) {
                    grouped[row.meeting_id] = [];
                }
                grouped[row.meeting_id].push(row);
            }

            setStorageMode('supabase');
            setMeetings(nextMeetings);
            setNotesByMeeting(grouped);
            if (nextMeetings[0]) {
                setSelectedMeetingId(nextMeetings[0].id);
            }
            setStatusMessage('Supabase mode restored.');
        } catch (err: any) {
            const message = String(err?.message || 'Supabase mode still unavailable.');
            setStorageMode('local');
            setSetupNotice('Supabase board meeting tables are still unavailable. Keep using local mode or run supabase/board_meetings.sql and supabase/storage_board_meetings.sql, then retry.');
            setError(message);
        }
    };

    const startMeeting = async () => {
        setError(null);
        setStatusMessage(null);
        let stream: MediaStream | null = null;

        try {
            const userId = await ensureUser();
            if (!userId) return;

            if (!navigator.mediaDevices?.getUserMedia) {
                setError('This browser cannot access the camera and microphone. You can still open meetings and add notes.');
                return;
            }

            setIsStarting(true);
            stream = await getMeetingMediaStream();

            const nowIso = new Date().toISOString();
            let meeting: BoardMeeting;

            if (isSupabaseMode) {
                const { data: createdMeeting, error: createError } = await supabase
                    .from('board_meetings')
                    .insert({
                        title: liveTitle.trim() || 'Family Board Meeting',
                        description: liveDescription.trim() || null,
                        status: 'live',
                        started_at: nowIso,
                        created_by: userId
                    })
                    .select('*')
                    .single();

                if (createError) {
                    stream.getTracks().forEach(track => track.stop());
                    throw createError;
                }

                meeting = createdMeeting as BoardMeeting;
            } else {
                meeting = {
                    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    title: liveTitle.trim() || 'Family Board Meeting',
                    description: liveDescription.trim() || null,
                    status: 'live',
                    started_at: nowIso,
                    ended_at: null,
                    recording_url: null,
                    recording_path: null,
                    duration_seconds: null,
                    created_by: userId,
                    created_at: nowIso,
                    updated_at: nowIso
                };

                setMeetings(prev => {
                    const nextMeetings = [meeting, ...prev.filter(item => item.id !== meeting.id)];
                    saveLocalMeetings(nextMeetings);
                    return nextMeetings;
                });
            }

            liveMeetingIdRef.current = meeting.id;
            liveStartedAtRef.current = Date.now();
            setLiveMeetingId(meeting.id);
            setLiveStream(stream);
            setSelectedMeetingId(meeting.id);
            setMeetings(prev => [meeting, ...prev.filter(item => item.id !== meeting.id)]);

            if (!window.MediaRecorder) {
                setStatusMessage('Live meeting started, but this browser cannot record video. Notes still work.');
                setIsStarting(false);
                return;
            }

            const supportedMimeType = SUPPORTED_MIME_TYPES.find(type => window.MediaRecorder?.isTypeSupported(type));
            const recorder = supportedMimeType ? new MediaRecorder(stream, { mimeType: supportedMimeType }) : new MediaRecorder(stream);

            chunksRef.current = [];
            recorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };
            recorderRef.current = recorder;

            recorder.onstop = () => {
                void (async () => {
                    const meetingId = liveMeetingIdRef.current;
                    const recordedSeconds = Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000));
                    const blob = new Blob(chunksRef.current, {
                        type: supportedMimeType || 'video/webm'
                    });

                    chunksRef.current = [];

                    if (meetingId && blob.size > 0) {
                        if (isSupabaseMode) {
                            const filePath = `${userId}/${meetingId}.webm`;
                            const { error: uploadError } = await supabase.storage
                                .from('board-meetings')
                                .upload(filePath, blob, {
                                    contentType: blob.type,
                                    upsert: true
                                });

                            let recordingUrl: string | null = null;
                            if (!uploadError) {
                                const { data } = supabase.storage.from('board-meetings').getPublicUrl(filePath);
                                recordingUrl = data.publicUrl;
                            }

                            await supabase
                                .from('board_meetings')
                                .update({
                                    status: recordingUrl ? 'recorded' : 'completed',
                                    ended_at: new Date().toISOString(),
                                    recording_path: filePath,
                                    recording_url: recordingUrl,
                                    duration_seconds: recordedSeconds,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('id', meetingId);

                            if (uploadError) {
                                setStatusMessage('Meeting saved, but recording upload failed. Run storage_board_meetings.sql and try again.');
                            } else {
                                setStatusMessage('Meeting recording saved. You can play it back and add notes now.');
                            }
                        } else {
                            const localPlaybackUrl = URL.createObjectURL(blob);
                            upsertLocalMeeting(meetingId, meetingRecord => ({
                                ...meetingRecord,
                                status: 'recorded',
                                ended_at: new Date().toISOString(),
                                recording_url: localPlaybackUrl,
                                duration_seconds: recordedSeconds,
                                updated_at: new Date().toISOString()
                            }));
                            setStatusMessage('Meeting saved in local mode. Replay works now on this page.');
                        }

                        setSelectedMeetingId(meetingId);
                    }

                    recorderRef.current = null;
                    liveMeetingIdRef.current = null;
                    liveStartedAtRef.current = 0;
                    setLiveMeetingId(null);
                    setLiveStream(null);
                    await refreshAfterSave();
                    setIsStopping(false);
                })();
            };

            recorder.start(1000);
            setStatusMessage('Live meeting started. Notes will be saved with timestamps.');
        } catch (err: any) {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            setError(humanizeMediaError(err));
        } finally {
            setIsStarting(false);
        }
    };

    const stopMeeting = async () => {
        setError(null);
        if (!liveMeetingIdRef.current && !recorderRef.current) {
            setStatusMessage('No live meeting is running.');
            return;
        }

        setStatusMessage('Saving meeting...');
        setIsStopping(true);

        try {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') {
                recorderRef.current.stop();
                liveStream?.getTracks().forEach(track => track.stop());
                setLiveStream(null);
                setStatusMessage('Finalizing recording...');
                return;
            }

            if (liveMeetingIdRef.current) {
                liveStream?.getTracks().forEach(track => track.stop());

                if (isSupabaseMode) {
                    await supabase
                        .from('board_meetings')
                        .update({
                            status: 'completed',
                            ended_at: new Date().toISOString(),
                            duration_seconds: Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000)),
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', liveMeetingIdRef.current);
                } else {
                    const liveId = liveMeetingIdRef.current;
                    upsertLocalMeeting(liveId, meetingRecord => ({
                        ...meetingRecord,
                        status: 'completed',
                        ended_at: new Date().toISOString(),
                        duration_seconds: Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000)),
                        updated_at: new Date().toISOString()
                    }));
                }

                liveMeetingIdRef.current = null;
                liveStartedAtRef.current = 0;
                setLiveMeetingId(null);
                setLiveStream(null);
                await refreshAfterSave();
                setStatusMessage('Live meeting ended. Add notes or start another recording.');
            }
        } catch (err: any) {
            setError(String(err?.message || 'Could not stop the meeting.'));
        } finally {
            if (!recorderRef.current || recorderRef.current.state === 'inactive') {
                setIsStopping(false);
            }
        }
    };

    const addNote = async () => {
        const meetingId = currentMeetingId;
        const trimmedNote = noteDraft.trim();
        if (!meetingId || !trimmedNote || !profileId) return;

        setIsSavingNote(true);
        setError(null);

        try {
            const noteTime = getPlaybackTime();

            if (isSupabaseMode) {
                const { error: insertError } = await supabase.from('board_meeting_notes').insert({
                    meeting_id: meetingId,
                    note: trimmedNote,
                    note_time_seconds: noteTime,
                    created_by: profileId
                });

                if (insertError) {
                    throw insertError;
                }

                await loadNotes(meetingId);
            } else {
                const localNote: BoardMeetingNote = {
                    id: `local-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    meeting_id: meetingId,
                    note: trimmedNote,
                    note_time_seconds: noteTime,
                    created_by: profileId,
                    created_at: new Date().toISOString()
                };

                setNotesByMeeting(prev => {
                    const nextNotes: Record<string, BoardMeetingNote[]> = {
                        ...prev,
                        [meetingId]: [...(prev[meetingId] || []), localNote]
                    };
                    saveLocalNotes(nextNotes);
                    return nextNotes;
                });
            }

            setNoteDraft('');
            setStatusMessage(`Note saved at ${formatSeconds(noteTime)}.`);
        } catch (err: any) {
            setError(String(err?.message || 'Could not save the note.'));
        } finally {
            setIsSavingNote(false);
        }
    };

    const seekToNote = (seconds: number) => {
        const video = videoRef.current;
        if (!video || liveStream) return;

        video.currentTime = seconds;
        void video.play().catch(() => undefined);
    };

    if (isLoading) {
        return (
            <div className="panel panel-pad meetings-studio" style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{ fontWeight: 700 }}>Loading board meetings...</div>
                <div style={{ opacity: 0.78 }}>Checking your session and loading saved meetings.</div>
            </div>
        );
    }

    return (
        <div className="meetings-studio" style={{ display: 'grid', gap: '1rem' }}>
            <section className="panel panel-pad meetings-hero" style={{ display: 'grid', gap: '0.85rem' }}>
                <div className="meetings-hero-row" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: '0.25rem' }}>
                        <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>Board Meetings</div>
                        <h2 style={{ margin: 0, fontSize: 'clamp(1.5rem, 4vw, 2.1rem)' }}>
                            Live meeting capture and replay
                        </h2>
                        <div style={{ opacity: 0.78, maxWidth: 800 }}>
                            Start a live session, record it, and add timestamped notes while live or later during playback.
                        </div>
                    </div>
                    <div className="meetings-signin" style={{ display: 'grid', gap: '0.35rem', textAlign: 'right' }}>
                        <div style={{ opacity: 0.78 }}>Signed in as</div>
                        <div style={{ fontWeight: 700 }}>{email || 'Family Member'}</div>
                    </div>
                </div>

                {setupNotice && (
                    <div
                        style={{
                            border: '1px solid #d97706',
                            borderRadius: 10,
                            background: 'rgba(120, 53, 15, 0.38)',
                            padding: '0.7rem 0.8rem',
                            color: '#fde68a',
                            display: 'grid',
                            gap: '0.5rem'
                        }}
                    >
                        <div>{setupNotice}</div>
                        <button
                            type="button"
                            onClick={retrySupabaseMode}
                            className="soft-button"
                            style={{ width: 'fit-content', borderColor: '#f59e0b', color: '#fde68a' }}
                        >
                            Retry Supabase mode
                        </button>
                    </div>
                )}

                <div className="meetings-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button onClick={startMeeting} disabled={isStarting || isStopping} className="soft-button" style={{ borderColor: '#2563eb', color: '#dbeafe' }}>
                        {isStarting ? 'Starting...' : liveMeetingId ? 'Meeting live' : 'Start live meeting'}
                    </button>
                    <button onClick={stopMeeting} disabled={isStarting || isStopping || (!liveMeetingId && !recorderRef.current)} className="soft-button" style={{ borderColor: '#ef4444', color: '#fecaca' }}>
                        {isStopping ? 'Stopping...' : 'Stop and save'}
                    </button>
                </div>

                <div className="meetings-fields mobile-stack" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>Meeting title</span>
                        <input value={liveTitle} onChange={e => setLiveTitle(e.target.value)} placeholder="Family Board Meeting" style={{ padding: '0.85rem 0.95rem' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>Agenda or summary</span>
                        <input value={liveDescription} onChange={e => setLiveDescription(e.target.value)} placeholder="Items to cover today" style={{ padding: '0.85rem 0.95rem' }} />
                    </label>
                </div>

                {statusMessage && <div style={{ color: '#86efac', lineHeight: 1.5 }}>{statusMessage}</div>}
                {error && <div style={{ color: '#fca5a5', lineHeight: 1.5 }}>{error}</div>}
            </section>

            {activeRoomUrl && (
                <section className="panel panel-pad meetings-room-panel" style={{ display: 'grid', gap: '0.75rem' }}>
                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                        <div style={{ fontWeight: 700 }}>Family live call room (multi-user)</div>
                        <div style={{ opacity: 0.8, fontSize: '0.92rem' }}>
                            Share this room link with your family so everyone can join the same live call.
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <a href={activeRoomUrl} target="_blank" rel="noreferrer" className="soft-button" style={{ textDecoration: 'none', borderColor: '#22c55e', color: '#bbf7d0' }}>
                            Open call room
                        </a>
                        <button
                            type="button"
                            onClick={async () => {
                                try {
                                    await navigator.clipboard.writeText(activeRoomUrl);
                                    setStatusMessage('Live call room link copied.');
                                } catch {
                                    setStatusMessage(`Copy this room link: ${activeRoomUrl}`);
                                }
                            }}
                            className="soft-button"
                            style={{ borderColor: '#38bdf8', color: '#bfdbfe' }}
                        >
                            Copy room link
                        </button>
                    </div>
                    <iframe
                        src={activeRoomUrl}
                        title="Family live call room"
                        style={{ width: '100%', minHeight: 420, borderRadius: 14, border: '1px solid #334155', background: '#020617' }}
                        allow="camera; microphone; fullscreen; display-capture"
                    />
                </section>
            )}

            <section className="panel panel-pad meetings-video-panel" style={{ display: 'grid', gap: '0.85rem' }}>
                <div className="meetings-video-head" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontWeight: 700 }}>Video</div>
                        <div style={{ opacity: 0.75, fontSize: '0.92rem' }}>
                            {liveMeetingId
                                ? 'Live camera preview is active.'
                                : selectedMeeting?.recording_url
                                    ? 'Playback the selected saved meeting.'
                                    : 'Start a live meeting or select a saved recording below.'}
                        </div>
                    </div>
                    <div style={{ opacity: 0.7, fontSize: '0.9rem' }}>
                        {liveMeetingLabel}
                    </div>
                </div>

                <video
                    ref={videoRef}
                    controls={!liveMeetingId}
                    muted={Boolean(liveMeetingId)}
                    playsInline
                    className="meetings-video"
                    style={{ width: '100%', maxHeight: 420, borderRadius: 18, background: '#020617', border: '1px solid #334155' }}
                />

                {selectedMeeting?.recording_url && !liveMeetingId && (
                    <a
                        href={selectedMeeting.recording_url}
                        download={`${selectedMeeting.title.replace(/\s+/g, '-').toLowerCase() || 'meeting'}.webm`}
                        className="soft-button"
                        style={{ width: 'fit-content', borderColor: '#38bdf8', color: '#bfdbfe' }}
                    >
                        Download recording
                    </a>
                )}

                <div className="meetings-notes-compose" style={{ display: 'grid', gap: '0.5rem' }}>
                    <label style={{ display: 'grid', gap: '0.35rem' }}>
                        <span style={{ fontWeight: 600 }}>Add a timestamp note</span>
                        <textarea
                            value={noteDraft}
                            onChange={e => setNoteDraft(e.target.value)}
                            rows={3}
                            placeholder="Write a note for this moment in the meeting"
                            style={{ padding: '0.85rem 0.95rem' }}
                        />
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button onClick={addNote} disabled={!noteDraft.trim() || isSavingNote || !currentMeetingId} className="soft-button" style={{ borderColor: '#22c55e', color: '#bbf7d0' }}>
                            {isSavingNote ? 'Saving...' : 'Save note'}
                        </button>
                        <div style={{ alignSelf: 'center', opacity: 0.75, fontSize: '0.92rem' }}>
                            Notes attach to {liveMeetingId ? 'the live meeting' : selectedMeeting?.title || 'the selected meeting'}.
                        </div>
                    </div>
                </div>
            </section>

            <section className="panel panel-pad meetings-list" style={{ display: 'grid', gap: '0.85rem' }}>
                <div className="meetings-list-head" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontWeight: 700 }}>Saved meetings</div>
                        <div style={{ opacity: 0.75, fontSize: '0.92rem' }}>Pick a meeting to replay it and review notes.</div>
                    </div>
                    <div style={{ opacity: 0.72, fontSize: '0.9rem' }}>{meetings.length} meetings saved</div>
                </div>

                <div className="meetings-cards" style={{ display: 'grid', gap: '0.65rem' }}>
                    {meetings.length === 0 && (
                        <div style={{ opacity: 0.7 }}>No saved meetings yet.</div>
                    )}
                    {meetings.map(meeting => {
                        const meetingNotes = notesByMeeting[meeting.id] || [];
                        const isSelected = meeting.id === selectedMeetingId;

                        return (
                            <button
                                key={meeting.id}
                                type="button"
                                onClick={async () => {
                                    setSelectedMeetingId(meeting.id);
                                    if (isSupabaseMode) {
                                        await loadNotes(meeting.id);
                                    }
                                    setStatusMessage(`Selected ${meeting.title}.`);
                                }}
                                className="meetings-card"
                                style={{
                                    textAlign: 'left',
                                    borderRadius: 18,
                                    border: isSelected ? '1px solid #60a5fa' : '1px solid #334155',
                                    background: isSelected ? 'rgba(30, 41, 59, 0.9)' : 'rgba(2, 6, 23, 0.74)',
                                    padding: '0.9rem 1rem',
                                    color: '#e2e8f0',
                                    cursor: 'pointer'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'grid', gap: '0.25rem' }}>
                                        <div style={{ fontWeight: 700 }}>{meeting.title}</div>
                                        <div style={{ opacity: 0.75, fontSize: '0.9rem' }}>
                                            {meeting.description || 'No agenda provided'}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', fontSize: '0.88rem', opacity: 0.78 }}>
                                        <div>{meeting.status}</div>
                                        <div>{formatDate(meeting.started_at)}</div>
                                        <div>{formatSeconds(meeting.duration_seconds)}</div>
                                    </div>
                                </div>
                                <div style={{ marginTop: '0.55rem', fontSize: '0.88rem', opacity: 0.8 }}>
                                    {meeting.recording_url ? 'Recording available for replay.' : 'No uploaded recording yet.'} {meetingNotes.length} notes.
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="panel panel-pad meetings-notes" style={{ display: 'grid', gap: '0.75rem' }}>
                <div className="meetings-notes-head" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontWeight: 700 }}>Notes for current meeting</div>
                        <div style={{ opacity: 0.75, fontSize: '0.92rem' }}>
                            Click a note to jump playback to that moment.
                        </div>
                    </div>
                    <div style={{ opacity: 0.72, fontSize: '0.9rem' }}>
                        {formatSeconds(getPlaybackTime())} current time
                    </div>
                </div>

                <div className="meetings-note-list" style={{ display: 'grid', gap: '0.5rem' }}>
                    {currentNotes.length === 0 && (
                        <div style={{ opacity: 0.7 }}>No notes saved for this meeting yet.</div>
                    )}
                    {currentNotes.map(note => (
                        <button
                            key={note.id}
                            type="button"
                            onClick={() => seekToNote(note.note_time_seconds)}
                            className="soft-button"
                            data-meeting-note="true"
                            style={{
                                justifyContent: 'space-between',
                                textAlign: 'left',
                                borderColor: '#475569',
                                color: '#e2e8f0',
                                borderRadius: 18,
                                padding: '0.8rem 0.95rem'
                            }}
                        >
                            <span style={{ flex: 1, paddingRight: '0.75rem' }}>{note.note}</span>
                            <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>{formatSeconds(note.note_time_seconds)}</span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}
