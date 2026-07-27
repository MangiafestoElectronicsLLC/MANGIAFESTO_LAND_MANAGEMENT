'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseClient } from '@/lib/supabaseClient';
import { getSupabaseErrorCode, getSupabaseErrorMessage, isMissingTableSetupError } from '@/lib/supabaseErrors';
import ConnectionDiagnostics from '@/components/ConnectionDiagnostics';

type StorageMode = 'supabase' | 'local';
type RecordingSource = 'local' | 'call-room';

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

const SUPPORTED_MIME_TYPES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
];

const PLAYBACK_REFRESH_TIMEOUT_MS = 7000;
const AUTO_REFRESH_COOLDOWN_MS = 20000;

const extensionForMimeType = (mimeType: string | null | undefined) => {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('mp4')) return 'mp4';
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('ogg')) return 'ogv';
    return 'webm';
};

const extensionForPathOrUrl = (value: string | null | undefined) => {
    const source = String(value || '').toLowerCase();
    if (!source) return null;
    if (source.includes('.mp4')) return 'mp4';
    if (source.includes('.webm')) return 'webm';
    if (source.includes('.ogv')) return 'ogv';
    return null;
};

const detectMimeTypeFromBytes = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);

    // MP4 files typically contain the `ftyp` box near byte 4.
    if (bytes.length >= 12) {
        const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
        if (brand === 'ftyp') {
            return 'video/mp4';
        }
    }

    // WebM starts with an EBML header.
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        return 'video/webm';
    }

    // Ogg container signature.
    if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
        return 'video/ogg';
    }

    return null;
};

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

const BOARD_MEETING_TABLES = ['board_meetings', 'board_meeting_notes'];

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

const humanizeCallRoomError = (err: any) => {
    const name = String(err?.name || '').toLowerCase();
    if (name === 'notallowederror' || name === 'securityerror') {
        return 'Screen share permission was denied. Allow sharing the call room tab/window with audio, then try again.';
    }
    if (name === 'notfounderror') {
        return 'No screen/window source was available for call room recording.';
    }
    return err?.message || 'Could not capture the call room. Try sharing the call tab with audio enabled.';
};

export default function BoardMeetingsStudio() {
    const router = useRouter();
    const supabase = supabaseClient();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<BlobPart[]>([]);
    const recordedMimeTypeRef = useRef<string | null>(null);
    const liveMeetingIdRef = useRef<string | null>(null);
    const liveStartedAtRef = useRef<number>(0);
    const manualStopRequestedRef = useRef(false);
    const autoRefreshAttemptAtRef = useRef<Record<string, number>>({});

    const [storageMode, setStorageMode] = useState<StorageMode>('supabase');
    const [setupNotice, setSetupNotice] = useState<string | null>(null);
    const [profileId, setProfileId] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [meetings, setMeetings] = useState<BoardMeeting[]>([]);
    const [notesByMeeting, setNotesByMeeting] = useState<Record<string, BoardMeetingNote[]>>({});
    const [playbackUrls, setPlaybackUrls] = useState<Record<string, string>>({});
    const [selectedMeetingId, setSelectedMeetingId] = useState<string>('');
    const [liveMeetingId, setLiveMeetingId] = useState<string | null>(null);
    const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
    const [recordingSource, setRecordingSource] = useState<RecordingSource>('local');
    const [liveTitle, setLiveTitle] = useState('Family Board Meeting');
    const [liveDescription, setLiveDescription] = useState('');
    const [noteDraft, setNoteDraft] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isStarting, setIsStarting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [isMigratingRecording, setIsMigratingRecording] = useState(false);
    const [isResumingCapture, setIsResumingCapture] = useState(false);
    const [isRefreshingPlayback, setIsRefreshingPlayback] = useState(false);
    const [isDeletingMeetingId, setIsDeletingMeetingId] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [diagnosticLastOperation, setDiagnosticLastOperation] = useState('Startup checks');
    const [diagnosticLastUpdatedAt, setDiagnosticLastUpdatedAt] = useState<string | null>(null);
    const [diagnosticErrorCode, setDiagnosticErrorCode] = useState<string | null>(null);
    const [diagnosticErrorMessage, setDiagnosticErrorMessage] = useState<string | null>(null);

    const isSupabaseMode = storageMode === 'supabase';

    const setDiagnosticSuccess = (operation: string) => {
        setDiagnosticLastOperation(operation);
        setDiagnosticLastUpdatedAt(new Date().toISOString());
        setDiagnosticErrorCode(null);
        setDiagnosticErrorMessage(null);
    };

    const setDiagnosticFailure = (operation: string, err: unknown, fallbackMessage: string) => {
        const message = getSupabaseErrorMessage(err, fallbackMessage);
        const code = getSupabaseErrorCode(err);
        setDiagnosticLastOperation(operation);
        setDiagnosticLastUpdatedAt(new Date().toISOString());
        setDiagnosticErrorCode(code);
        setDiagnosticErrorMessage(message);
        return message;
    };

    const resolvePlaybackUrl = useCallback(
        async (meeting: BoardMeeting) => {
            if (!meeting?.id) {
                return null;
            }

            if (!isSupabaseMode) {
                return meeting.recording_url || null;
            }

            if (meeting.recording_path) {
                const signedUrlResult = await Promise.race([
                    supabase.storage.from('board-meetings').createSignedUrl(meeting.recording_path, 60 * 60 * 24 * 7),
                    new Promise<{ data: null; error: Error }>(resolve => {
                        window.setTimeout(() => {
                            resolve({ data: null, error: new Error('signed-url-timeout') });
                        }, PLAYBACK_REFRESH_TIMEOUT_MS);
                    })
                ]);

                const { data, error: signedUrlError } = signedUrlResult as {
                    data: { signedUrl?: string } | null;
                    error: unknown;
                };

                if (!signedUrlError && data?.signedUrl) {
                    return data.signedUrl;
                }

                // Fast fallback for public buckets when signed URL generation fails or times out.
                const { data: publicData } = supabase.storage.from('board-meetings').getPublicUrl(meeting.recording_path);
                if (publicData?.publicUrl) {
                    return publicData.publicUrl;
                }

                if (String((signedUrlError as any)?.message || '').includes('signed-url-timeout')) {
                    throw new Error('Playback source unavailable, click Migrate legacy recording');
                }
            }

            return meeting.recording_url || null;
        },
        [isSupabaseMode, supabase]
    );

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

    const getCallRoomMediaStream = async () => {
        if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new Error('This browser cannot capture a tab/window for call room recording.');
        }

        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        // Some browsers skip tab audio unless the user toggles it on during share.
        if (displayStream.getAudioTracks().length > 0) {
            return displayStream;
        }

        try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const micTrack = micStream.getAudioTracks()[0];
            if (micTrack) {
                displayStream.addTrack(micTrack);
                const stopMicTrack = () => {
                    micTrack.stop();
                };
                displayStream.getVideoTracks().forEach(track => {
                    track.addEventListener('ended', stopMicTrack, { once: true });
                });
            }
        } catch {
            // If mic access is denied we still keep video capture for meeting replay.
        }

        return displayStream;
    };

    useEffect(() => {
        const bootstrap = async () => {
            try {
                await ensureUser();
                const nextMeetings = await loadMeetings();
                await loadNotesForMeetings(nextMeetings.map(meeting => meeting.id));
                setDiagnosticSuccess('Load meetings and notes');

                if (nextMeetings[0]) {
                    setSelectedMeetingId(nextMeetings[0].id);
                    await loadNotes(nextMeetings[0].id);
                }
            } catch (err: any) {
                const message = setDiagnosticFailure('Load meetings and notes', err, 'Board meetings failed to load.');
                if (isMissingTableSetupError(err, BOARD_MEETING_TABLES)) {
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
                        try {
                            const updatedMeetings = await loadMeetings();
                            await loadNotesForMeetings(updatedMeetings.map(meeting => meeting.id));
                        } catch (err: any) {
                            setError(String(err?.message || 'Realtime board meeting sync failed.'));
                        }
                    })();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'board_meeting_notes' },
                payload => {
                    const meetingId = payload.new && 'meeting_id' in payload.new ? String(payload.new.meeting_id) : '';
                    if (meetingId) {
                        void (async () => {
                            try {
                                await loadNotes(meetingId);
                            } catch (err: any) {
                                setError(String(err?.message || 'Realtime meeting notes sync failed.'));
                            }
                        })();
                    }
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [isSupabaseMode, loadMeetings, loadNotes, loadNotesForMeetings, supabase]);

    useEffect(() => {
        void (async () => {
            const nextUrls: Record<string, string> = {};

            for (const meeting of meetings) {
                if (!meeting.recording_url && !meeting.recording_path) {
                    continue;
                }

                const url = await resolvePlaybackUrl(meeting);
                if (url) {
                    nextUrls[meeting.id] = url;
                }
            }

            if (Object.keys(nextUrls).length > 0) {
                setPlaybackUrls(prev => ({
                    ...prev,
                    ...nextUrls
                }));
            }
        })();
    }, [meetings, resolvePlaybackUrl]);

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
        const playbackUrl = selectedMeeting ? playbackUrls[selectedMeeting.id] || selectedMeeting.recording_url : null;

        if (playbackUrl) {
            video.srcObject = null;
            video.src = playbackUrl;
            video.muted = false;
            video.load();
            void video.play().catch(() => undefined);
            return;
        }

        video.srcObject = null;
        video.removeAttribute('src');
        video.load();
    }, [liveStream, meetings, playbackUrls, selectedMeetingId]);

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
    const selectedPlaybackUrl = selectedMeeting
        ? playbackUrls[selectedMeeting.id] || selectedMeeting.recording_url || null
        : null;
    const selectedExtension = selectedMeeting
        ? extensionForPathOrUrl(selectedMeeting.recording_path) ||
        extensionForPathOrUrl(selectedMeeting.recording_url) ||
        extensionForPathOrUrl(selectedPlaybackUrl) ||
        'webm'
        : 'webm';
    const selectedDownloadName = selectedMeeting
        ? `${selectedMeeting.title.replace(/\s+/g, '-').toLowerCase() || 'meeting'}.${selectedExtension}`
        : `meeting.${selectedExtension}`;

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

    const attachRecorder = useCallback(
        (args: {
            stream: MediaStream;
            userId: string;
            sourceMode: RecordingSource;
            meetingId: string;
        }) => {
            const { stream, userId, sourceMode, meetingId } = args;

            if (!window.MediaRecorder) {
                setStatusMessage('Live meeting started, but this browser cannot record video. Notes still work.');
                return;
            }

            const supportedMimeType = SUPPORTED_MIME_TYPES.find(type => window.MediaRecorder?.isTypeSupported(type));
            const recorder = supportedMimeType ? new MediaRecorder(stream, { mimeType: supportedMimeType }) : new MediaRecorder(stream);

            chunksRef.current = [];
            recordedMimeTypeRef.current = supportedMimeType || recorder.mimeType || null;
            recorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    if (!recordedMimeTypeRef.current && event.data.type) {
                        recordedMimeTypeRef.current = event.data.type;
                    }
                    chunksRef.current.push(event.data);
                }
            };

            recorder.onstop = () => {
                void (async () => {
                    const activeMeetingId = liveMeetingIdRef.current;
                    const shouldFinalizeMeeting = manualStopRequestedRef.current;
                    const recordedSeconds = Math.max(0, Math.floor((Date.now() - liveStartedAtRef.current) / 1000));
                    const finalMimeType = recordedMimeTypeRef.current || recorder.mimeType || 'video/webm';
                    const fileExtension = extensionForMimeType(finalMimeType);
                    const blob = new Blob(chunksRef.current, {
                        type: finalMimeType
                    });

                    chunksRef.current = [];
                    recordedMimeTypeRef.current = null;
                    recorderRef.current = null;
                    setLiveStream(null);

                    const targetMeetingId = activeMeetingId || meetingId;
                    if (targetMeetingId && blob.size > 0) {
                        if (isSupabaseMode) {
                            const filePath = `${userId}/${targetMeetingId}.${fileExtension}`;
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
                                    status: recordingUrl ? (shouldFinalizeMeeting ? 'recorded' : 'live') : shouldFinalizeMeeting ? 'completed' : 'live',
                                    ...(shouldFinalizeMeeting ? { ended_at: new Date().toISOString() } : {}),
                                    recording_path: filePath,
                                    recording_url: recordingUrl,
                                    duration_seconds: recordedSeconds,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('id', targetMeetingId);

                            if (uploadError) {
                                setStatusMessage('Meeting saved, but recording upload failed. Run storage_board_meetings.sql and try again.');
                            } else if (shouldFinalizeMeeting) {
                                setStatusMessage('Meeting recording saved. You can play it back and add notes now.');
                            } else {
                                setStatusMessage('Capture ended. Meeting is still live. Reopen call room capture or stop manually when done.');
                            }
                        } else {
                            const localPlaybackUrl = URL.createObjectURL(blob);
                            upsertLocalMeeting(targetMeetingId, meetingRecord => ({
                                ...meetingRecord,
                                status: shouldFinalizeMeeting ? 'recorded' : 'live',
                                ended_at: shouldFinalizeMeeting ? new Date().toISOString() : null,
                                recording_url: localPlaybackUrl,
                                duration_seconds: recordedSeconds,
                                updated_at: new Date().toISOString()
                            }));
                            setStatusMessage(
                                shouldFinalizeMeeting
                                    ? 'Meeting saved in local mode. Replay works now on this page.'
                                    : 'Capture ended. Meeting is still live. Resume capture or stop manually when done.'
                            );
                        }

                        setSelectedMeetingId(targetMeetingId);
                    }

                    if (shouldFinalizeMeeting) {
                        liveMeetingIdRef.current = null;
                        liveStartedAtRef.current = 0;
                        manualStopRequestedRef.current = false;
                        setLiveMeetingId(null);
                        await refreshAfterSave();
                        setIsStopping(false);
                        return;
                    }

                    await refreshAfterSave();
                    setIsStopping(false);
                })();
            };

            // If tab/window sharing ends, recorder stops. Keep meeting live until user manually ends it.
            stream.getVideoTracks().forEach(track => {
                track.addEventListener(
                    'ended',
                    () => {
                        if (manualStopRequestedRef.current) return;
                        setStatusMessage('Call room sharing ended. Meeting is still live; resume capture or stop and save when ready.');
                    },
                    { once: true }
                );
            });

            recorderRef.current = recorder;
            recorder.start(1000);

            const hasAudioTrack = stream.getAudioTracks().length > 0;
            if (hasAudioTrack) {
                if (sourceMode === 'call-room') {
                    setStatusMessage('Live call room recording started. Keep the shared tab/window open while your family joins. Notes will be saved with timestamps.');
                } else {
                    setStatusMessage('Live meeting started. Notes will be saved with timestamps.');
                }
            } else if (sourceMode === 'call-room') {
                setStatusMessage('Call room recording started, but no audio track was detected. When sharing, enable tab audio so family voices are included.');
            } else {
                setStatusMessage('Live meeting started, but no microphone audio track was detected. Allow microphone access and restart the meeting if you need audio in recordings.');
            }
        },
        [isSupabaseMode, supabase]
    );

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
            setDiagnosticSuccess('Retry Supabase mode');
            if (nextMeetings[0]) {
                setSelectedMeetingId(nextMeetings[0].id);
            }
            setStatusMessage('Supabase mode restored.');
        } catch (err: any) {
            const message = setDiagnosticFailure('Retry Supabase mode', err, 'Supabase mode still unavailable.');
            if (isMissingTableSetupError(err, BOARD_MEETING_TABLES)) {
                setStorageMode('local');
                setSetupNotice('Supabase board meeting tables are still unavailable. Keep using local mode or run supabase/board_meetings.sql and supabase/storage_board_meetings.sql, then retry.');
            } else {
                setStorageMode('supabase');
                setSetupNotice(null);
            }
            setError(message);
        }
    };

    const startMeeting = async () => {
        setError(null);
        setStatusMessage(null);
        let stream: MediaStream | null = null;
        let sourceMode: RecordingSource = recordingSource;

        try {
            const userId = await ensureUser();
            if (!userId) return;

            sourceMode = recordingSource;

            if (sourceMode === 'local' && !navigator.mediaDevices?.getUserMedia) {
                setError('This browser cannot access the camera and microphone. You can still open meetings and add notes.');
                return;
            }

            if (sourceMode === 'call-room' && !navigator.mediaDevices?.getDisplayMedia) {
                setError('This browser cannot capture a shared call room. Use local recording mode or a modern browser that supports tab/window capture.');
                return;
            }

            setIsStarting(true);
            stream = sourceMode === 'call-room' ? await getCallRoomMediaStream() : await getMeetingMediaStream();

            const audioTracks = stream.getAudioTracks();
            const hasAudioTrack = audioTracks.length > 0;

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
            manualStopRequestedRef.current = false;
            setLiveMeetingId(meeting.id);
            setLiveStream(stream);
            setSelectedMeetingId(meeting.id);
            setMeetings(prev => [meeting, ...prev.filter(item => item.id !== meeting.id)]);

            attachRecorder({
                stream,
                userId,
                sourceMode,
                meetingId: meeting.id
            });
        } catch (err: any) {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            setError(sourceMode === 'call-room' ? humanizeCallRoomError(err) : humanizeMediaError(err));
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
        manualStopRequestedRef.current = true;

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
                manualStopRequestedRef.current = false;
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

    const resumeCallRoomCapture = async () => {
        if (!liveMeetingIdRef.current || recorderRef.current || recordingSource !== 'call-room') {
            return;
        }

        setError(null);
        setIsResumingCapture(true);

        try {
            const userId = profileId || (await ensureUser());
            if (!userId) return;

            const stream = await getCallRoomMediaStream();
            setLiveStream(stream);
            attachRecorder({
                stream,
                userId,
                sourceMode: 'call-room',
                meetingId: liveMeetingIdRef.current
            });
            setStatusMessage('Call room capture resumed.');
        } catch (err: any) {
            setError(humanizeCallRoomError(err));
        } finally {
            setIsResumingCapture(false);
        }
    };

    const refreshSelectedPlayback = async (
        meeting: BoardMeeting | null,
        options?: {
            showBusy?: boolean;
            silent?: boolean;
        }
    ) => {
        if (!meeting) return;
        const showBusy = options?.showBusy ?? true;
        const silent = options?.silent ?? false;

        if (showBusy) {
            setIsRefreshingPlayback(true);
        }

        try {
            const refreshedUrl = await resolvePlaybackUrl(meeting);
            if (refreshedUrl) {
                setPlaybackUrls(prev => ({
                    ...prev,
                    [meeting.id]: refreshedUrl
                }));
                if (!silent) {
                    setStatusMessage(`Refreshed playback link for ${meeting.title}.`);
                }
            } else {
                setError('Playback source unavailable, click Migrate legacy recording');
            }
        } catch (err: any) {
            const message = getSupabaseErrorMessage(err, 'Could not refresh playback URL.');
            if (
                message.includes('signed-url-timeout') ||
                message.toLowerCase().includes('timeout') ||
                message.toLowerCase().includes('playback source unavailable')
            ) {
                setError('Playback source unavailable, click Migrate legacy recording');
            } else {
                setError(message);
            }
        } finally {
            if (showBusy) {
                setIsRefreshingPlayback(false);
            }
        }
    };

    const deleteMeeting = async (meeting: BoardMeeting) => {
        if (!meeting?.id) return;
        if (liveMeetingIdRef.current === meeting.id) {
            setError('Stop the live meeting before deleting it.');
            return;
        }

        const confirmed = window.confirm(`Delete meeting "${meeting.title}" and its notes? This cannot be undone.`);
        if (!confirmed) return;

        setError(null);
        setIsDeletingMeetingId(meeting.id);

        try {
            if (isSupabaseMode) {
                if (meeting.recording_path) {
                    await supabase.storage.from('board-meetings').remove([meeting.recording_path]);
                }

                const { error: deleteError } = await supabase.from('board_meetings').delete().eq('id', meeting.id);
                if (deleteError) throw deleteError;
            } else {
                const localMeetingNotes = readLocalNotes();
                const nextNotes = { ...localMeetingNotes };
                delete nextNotes[meeting.id];
                saveLocalNotes(nextNotes);
                setNotesByMeeting(nextNotes);

                if (meeting.recording_url?.startsWith('blob:')) {
                    URL.revokeObjectURL(meeting.recording_url);
                }
            }

            setMeetings(prev => {
                const nextMeetings = prev.filter(item => item.id !== meeting.id);
                if (!isSupabaseMode) {
                    saveLocalMeetings(nextMeetings);
                }
                return nextMeetings;
            });

            setPlaybackUrls(prev => {
                const next = { ...prev };
                delete next[meeting.id];
                return next;
            });

            setNotesByMeeting(prev => {
                const next = { ...prev };
                delete next[meeting.id];
                return next;
            });

            if (selectedMeetingId === meeting.id) {
                const nextMeeting = meetings.find(item => item.id !== meeting.id) || null;
                setSelectedMeetingId(nextMeeting?.id || '');
            }

            setStatusMessage(`Deleted ${meeting.title}.`);
            await refreshAfterSave();
        } catch (err: any) {
            setError(getSupabaseErrorMessage(err, 'Could not delete the meeting.'));
        } finally {
            setIsDeletingMeetingId(null);
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

    const migrateSelectedRecording = async () => {
        if (!selectedMeeting) {
            setError('Select a meeting with a recording before running migration.');
            return;
        }

        setError(null);
        setStatusMessage('Migrating selected legacy recording...');
        setIsMigratingRecording(true);

        try {
            const freshestPlaybackUrl = await resolvePlaybackUrl(selectedMeeting);
            const fetchUrl = freshestPlaybackUrl || selectedPlaybackUrl;

            if (!fetchUrl && !selectedMeeting.recording_path) {
                throw new Error('No recording URL/path found for this meeting.');
            }

            let sourceBlob: Blob;
            if (isSupabaseMode && selectedMeeting.recording_path) {
                const { data: downloadBlob, error: downloadError } = await supabase.storage
                    .from('board-meetings')
                    .download(selectedMeeting.recording_path);
                if (downloadError || !downloadBlob) {
                    throw downloadError || new Error('Could not download the selected recording for migration.');
                }
                sourceBlob = downloadBlob;
            } else {
                const response = await fetch(String(fetchUrl), {
                    cache: 'no-store'
                });

                if (!response.ok) {
                    throw new Error(`Could not fetch recording for migration (HTTP ${response.status}).`);
                }

                sourceBlob = await response.blob();
            }

            if (sourceBlob.size === 0) {
                throw new Error('Selected recording is empty and cannot be migrated.');
            }

            const probeBuffer = await sourceBlob.slice(0, 64).arrayBuffer();
            const detectedMime = detectMimeTypeFromBytes(probeBuffer);
            const fallbackMimeFromPath = extensionForPathOrUrl(selectedMeeting.recording_path || selectedMeeting.recording_url || selectedPlaybackUrl);

            const targetMimeType =
                detectedMime ||
                (sourceBlob.type ? sourceBlob.type : null) ||
                (fallbackMimeFromPath === 'mp4' ? 'video/mp4' : fallbackMimeFromPath === 'ogv' ? 'video/ogg' : 'video/webm');

            const targetBlob = sourceBlob.type === targetMimeType ? sourceBlob : new Blob([sourceBlob], { type: targetMimeType });
            const targetExtension = extensionForMimeType(targetMimeType);

            if (isSupabaseMode) {
                const userId = profileId || (await ensureUser());
                if (!userId) {
                    throw new Error('Could not verify your account for migration.');
                }

                const filePath = `${userId}/${selectedMeeting.id}-migrated.${targetExtension}`;
                const { error: uploadError } = await supabase.storage
                    .from('board-meetings')
                    .upload(filePath, targetBlob, {
                        contentType: targetBlob.type,
                        upsert: true
                    });

                if (uploadError) {
                    throw uploadError;
                }

                const { data: publicData } = supabase.storage.from('board-meetings').getPublicUrl(filePath);
                const migratedPublicUrl = publicData?.publicUrl || null;

                const { error: updateError } = await supabase
                    .from('board_meetings')
                    .update({
                        status: 'recorded',
                        recording_path: filePath,
                        recording_url: migratedPublicUrl,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', selectedMeeting.id);

                if (updateError) {
                    throw updateError;
                }

                setMeetings(prev =>
                    prev.map(meeting =>
                        meeting.id === selectedMeeting.id
                            ? {
                                ...meeting,
                                status: 'recorded',
                                recording_path: filePath,
                                recording_url: migratedPublicUrl,
                                updated_at: new Date().toISOString()
                            }
                            : meeting
                    )
                );

                const resolvedUrl = await resolvePlaybackUrl({
                    ...selectedMeeting,
                    recording_path: filePath,
                    recording_url: migratedPublicUrl
                });

                if (resolvedUrl) {
                    setPlaybackUrls(prev => ({
                        ...prev,
                        [selectedMeeting.id]: resolvedUrl
                    }));
                }
            } else {
                const localPlaybackUrl = URL.createObjectURL(targetBlob);
                upsertLocalMeeting(selectedMeeting.id, meetingRecord => ({
                    ...meetingRecord,
                    status: 'recorded',
                    recording_url: localPlaybackUrl,
                    updated_at: new Date().toISOString()
                }));

                setPlaybackUrls(prev => ({
                    ...prev,
                    [selectedMeeting.id]: localPlaybackUrl
                }));
            }

            setStatusMessage('Legacy migration complete. Try replaying this meeting now. If original recording has no audio track, migration cannot create missing audio.');
        } catch (err: any) {
            setError(getSupabaseErrorMessage(err, err?.message || 'Recording migration failed.'));
        } finally {
            setIsMigratingRecording(false);
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
                    <div
                        style={{
                            display: 'flex',
                            gap: '0.4rem',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            marginRight: '0.35rem'
                        }}
                    >
                        <span style={{ opacity: 0.82, fontSize: '0.9rem' }}>Record source:</span>
                        <button
                            type="button"
                            onClick={() => setRecordingSource('local')}
                            disabled={Boolean(liveMeetingId)}
                            className="soft-button"
                            style={{
                                borderColor: recordingSource === 'local' ? '#22c55e' : '#334155',
                                color: recordingSource === 'local' ? '#bbf7d0' : '#cbd5e1',
                                opacity: liveMeetingId && recordingSource !== 'local' ? 0.72 : 1
                            }}
                        >
                            Local camera/mic
                        </button>
                        <button
                            type="button"
                            onClick={() => setRecordingSource('call-room')}
                            disabled={Boolean(liveMeetingId)}
                            className="soft-button"
                            style={{
                                borderColor: recordingSource === 'call-room' ? '#22c55e' : '#334155',
                                color: recordingSource === 'call-room' ? '#bbf7d0' : '#cbd5e1',
                                opacity: liveMeetingId && recordingSource !== 'call-room' ? 0.72 : 1
                            }}
                        >
                            Call room tab/window
                        </button>
                    </div>
                    <button onClick={startMeeting} disabled={isStarting || isStopping} className="soft-button" style={{ borderColor: '#2563eb', color: '#dbeafe' }}>
                        {isStarting
                            ? 'Starting...'
                            : liveMeetingId
                                ? 'Meeting live'
                                : recordingSource === 'call-room'
                                    ? 'Start live call recording'
                                    : 'Start live meeting'}
                    </button>
                    <button onClick={stopMeeting} disabled={isStarting || isStopping || (!liveMeetingId && !recorderRef.current)} className="soft-button" style={{ borderColor: '#ef4444', color: '#fecaca' }}>
                        {isStopping ? 'Stopping...' : 'Stop and save'}
                    </button>
                </div>

                {recordingSource === 'call-room' && !liveMeetingId && (
                    <div style={{ opacity: 0.78, fontSize: '0.9rem' }}>
                        Tip: pick the call room tab/window and enable share audio so everyone in the room is captured.
                    </div>
                )}

                {liveMeetingId && recordingSource === 'call-room' && !liveStream && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={resumeCallRoomCapture}
                            disabled={isResumingCapture || isStopping}
                            className="soft-button"
                            style={{ borderColor: '#f59e0b', color: '#fde68a' }}
                        >
                            {isResumingCapture ? 'Resuming capture...' : 'Resume call-room capture'}
                        </button>
                        <div style={{ alignSelf: 'center', opacity: 0.8, fontSize: '0.9rem' }}>
                            The meeting stays live until you manually stop and save.
                        </div>
                    </div>
                )}

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

                <ConnectionDiagnostics
                    mode={storageMode}
                    contextLabel="Board meetings"
                    lastOperation={diagnosticLastOperation}
                    lastUpdatedAt={diagnosticLastUpdatedAt}
                    errorCode={diagnosticErrorCode}
                    errorMessage={diagnosticErrorMessage}
                />
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
                    {liveMeetingId && recordingSource === 'call-room' && (
                        <div
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                width: 'fit-content',
                                border: '1px solid #ef4444',
                                borderRadius: 999,
                                padding: '0.35rem 0.7rem',
                                background: 'rgba(127, 29, 29, 0.32)',
                                color: '#fecaca',
                                fontWeight: 700,
                                fontSize: '0.85rem'
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    background: '#ef4444',
                                    boxShadow: '0 0 0 4px rgba(239, 68, 68, 0.22)'
                                }}
                            />
                            Call room recording active
                        </div>
                    )}
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
                                : selectedMeeting && (playbackUrls[selectedMeeting.id] || selectedMeeting.recording_url)
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
                    preload="metadata"
                    onError={() => {
                        if (!liveMeetingId && selectedMeeting) {
                            const meetingId = selectedMeeting.id;
                            const now = Date.now();
                            const lastAttempt = autoRefreshAttemptAtRef.current[meetingId] || 0;
                            if (now - lastAttempt < AUTO_REFRESH_COOLDOWN_MS) {
                                return;
                            }

                            autoRefreshAttemptAtRef.current[meetingId] = now;
                            void refreshSelectedPlayback(selectedMeeting, { showBusy: false, silent: true });
                        }
                    }}
                    className="meetings-video"
                    style={{ width: '100%', maxHeight: 420, borderRadius: 18, background: '#020617', border: '1px solid #334155' }}
                />

                {selectedPlaybackUrl && !liveMeetingId && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <a
                            href={selectedPlaybackUrl}
                            download={selectedDownloadName}
                            className="soft-button"
                            style={{ width: 'fit-content', borderColor: '#38bdf8', color: '#bfdbfe' }}
                        >
                            Download recording
                        </a>
                        <button
                            type="button"
                            onClick={() => {
                                void refreshSelectedPlayback(selectedMeeting);
                            }}
                            disabled={isRefreshingPlayback}
                            className="soft-button"
                            style={{ borderColor: '#22c55e', color: '#bbf7d0' }}
                        >
                            {isRefreshingPlayback ? 'Refreshing playback...' : 'Refresh playback link'}
                        </button>
                        <button
                            type="button"
                            onClick={migrateSelectedRecording}
                            disabled={isMigratingRecording}
                            className="soft-button"
                            style={{ borderColor: '#f59e0b', color: '#fde68a' }}
                        >
                            {isMigratingRecording ? 'Migrating...' : 'Migrate legacy recording'}
                        </button>
                    </div>
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
                            <div
                                key={meeting.id}
                                className="meetings-card"
                                style={{
                                    textAlign: 'left',
                                    borderRadius: 18,
                                    border: isSelected ? '1px solid #60a5fa' : '1px solid #334155',
                                    background: isSelected ? 'rgba(30, 41, 59, 0.9)' : 'rgba(2, 6, 23, 0.74)',
                                    padding: '0.9rem 1rem',
                                    color: '#e2e8f0'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            setSelectedMeetingId(meeting.id);
                                            if (isSupabaseMode) {
                                                await loadNotes(meeting.id);
                                            }

                                            if (!playbackUrls[meeting.id] && meeting.recording_path) {
                                                void refreshSelectedPlayback(meeting, { showBusy: false, silent: true });
                                            }

                                            setStatusMessage(`Selected ${meeting.title}.`);
                                        }}
                                        className="soft-button"
                                        style={{ borderColor: '#334155', color: '#e2e8f0' }}
                                    >
                                        {isSelected ? 'Selected' : 'Select meeting'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void deleteMeeting(meeting);
                                        }}
                                        disabled={isDeletingMeetingId === meeting.id || liveMeetingId === meeting.id}
                                        className="soft-button"
                                        style={{ borderColor: '#ef4444', color: '#fecaca' }}
                                    >
                                        {isDeletingMeetingId === meeting.id ? 'Deleting...' : 'Delete (admin)'}
                                    </button>
                                </div>
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
                                    {meeting.recording_url || meeting.recording_path || playbackUrls[meeting.id]
                                        ? 'Recording available for replay.'
                                        : 'No uploaded recording yet.'}{' '}
                                    {meetingNotes.length} notes.
                                </div>
                            </div>
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
