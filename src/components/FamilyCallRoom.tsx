'use client';

import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';

type Participant = { id: string; name: string; stream: MediaStream | null; local: boolean };

type SignalPayload = {
    kind: 'hello' | 'hi' | 'offer' | 'answer' | 'ice';
    from: string;
    to?: string;
    name?: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
};

type PeerEntry = {
    pc: RTCPeerConnection;
    name: string;
    pendingIce: RTCIceCandidateInit[];
};

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const buildIceServers = (): RTCIceServer[] => {
    const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
    if (turnUrl) {
        servers.push({
            urls: turnUrl.split(',').map(url => url.trim()),
            username: process.env.NEXT_PUBLIC_TURN_USERNAME,
            credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL
        });
    }
    return servers;
};

function Tile({ participant, register }: { participant: Participant; register: (id: string, el: HTMLVideoElement | null) => void }) {
    const ref = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.srcObject = participant.stream;
        if (participant.stream) void el.play().catch(() => undefined);
    }, [participant.stream]);

    return (
        <div className="family-call-tile">
            <video
                ref={el => {
                    ref.current = el;
                    register(participant.id, el);
                }}
                autoPlay
                playsInline
                muted={participant.local}
            />
            <span className="family-call-name">{participant.local ? `${participant.name} (you)` : participant.name}</span>
        </div>
    );
}

export default function FamilyCallRoom({
    roomId,
    displayName,
    onRecordableStream,
    onParticipantCount,
    onError
}: {
    roomId: string;
    displayName: string;
    onRecordableStream?: (stream: MediaStream | null) => void;
    onParticipantCount?: (count: number) => void;
    onError?: (message: string) => void;
}) {
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [micOn, setMicOn] = useState(true);
    const [camOn, setCamOn] = useState(true);
    const [connectionNote, setConnectionNote] = useState('Starting camera and microphone...');
    const localStreamRef = useRef<MediaStream | null>(null);
    const videoEls = useRef<Map<string, HTMLVideoElement>>(new Map());
    const callbacksRef = useRef({ onRecordableStream, onParticipantCount, onError });
    callbacksRef.current = { onRecordableStream, onParticipantCount, onError };

    const registerVideo = (id: string, el: HTMLVideoElement | null) => {
        if (el) videoEls.current.set(id, el);
        else videoEls.current.delete(id);
    };

    useEffect(() => {
        callbacksRef.current.onParticipantCount?.(participants.length);
    }, [participants.length]);

    useEffect(() => {
        let disposed = false;
        const supabase = supabaseClient();
        const myId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const peers = new Map<string, PeerEntry>();
        const remoteAudioSources = new Map<string, MediaStreamAudioSourceNode>();
        let audioCtx: AudioContext | null = null;
        let audioDest: MediaStreamAudioDestinationNode | null = null;
        let drawTimer: number | null = null;
        let canvasStream: MediaStream | null = null;
        let channel: ReturnType<typeof supabase.channel> | null = null;

        const publish = (participantsNext?: Participant[]) => {
            setParticipants(prev => participantsNext || prev);
        };

        const upsertParticipant = (id: string, patch: Partial<Participant>) => {
            setParticipants(prev => {
                const exists = prev.some(item => item.id === id);
                return exists
                    ? prev.map(item => (item.id === id ? { ...item, ...patch } : item))
                    : [...prev, { id, name: 'Guest', stream: null, local: false, ...patch }];
            });
        };

        const removeParticipant = (id: string) => {
            setParticipants(prev => prev.filter(item => item.id !== id));
            remoteAudioSources.get(id)?.disconnect();
            remoteAudioSources.delete(id);
        };

        const send = (payload: SignalPayload) => {
            void channel?.send({ type: 'broadcast', event: 'signal', payload });
        };

        const addRemoteAudioToMix = (id: string, stream: MediaStream) => {
            if (!audioCtx || !audioDest || remoteAudioSources.has(id) || stream.getAudioTracks().length === 0) return;
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(audioDest);
            remoteAudioSources.set(id, source);
        };

        const closePeer = (id: string) => {
            const entry = peers.get(id);
            if (!entry) return;
            entry.pc.close();
            peers.delete(id);
            removeParticipant(id);
        };

        const createPeer = (id: string, name: string) => {
            const existing = peers.get(id);
            if (existing) return existing;

            const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
            const entry: PeerEntry = { pc, name, pendingIce: [] };
            peers.set(id, entry);
            upsertParticipant(id, { name, local: false });

            localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current as MediaStream));

            pc.onicecandidate = event => {
                if (event.candidate) send({ kind: 'ice', from: myId, to: id, candidate: event.candidate.toJSON() });
            };
            pc.ontrack = event => {
                const stream = event.streams[0] || new MediaStream([event.track]);
                upsertParticipant(id, { stream });
                addRemoteAudioToMix(id, stream);
            };
            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'failed') {
                    setConnectionNote(`Could not connect directly to ${name}. A TURN server may be needed on strict networks.`);
                } else if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
                    if (pc.connectionState === 'closed') return;
                    window.setTimeout(() => {
                        if (!disposed && peers.get(id)?.pc === pc && pc.connectionState === 'disconnected') closePeer(id);
                    }, 8000);
                }
            };
            return entry;
        };

        const flushIce = async (entry: PeerEntry) => {
            const queued = entry.pendingIce.splice(0);
            for (const candidate of queued) {
                await entry.pc.addIceCandidate(candidate).catch(() => undefined);
            }
        };

        const initiate = async (id: string, name: string) => {
            const entry = createPeer(id, name);
            const offer = await entry.pc.createOffer();
            await entry.pc.setLocalDescription(offer);
            send({ kind: 'offer', from: myId, to: id, name: displayName, sdp: entry.pc.localDescription?.toJSON() });
        };

        const handleSignal = async (message: SignalPayload) => {
            if (disposed || message.from === myId) return;
            if (message.to && message.to !== myId) return;

            try {
                if (message.kind === 'hello' || message.kind === 'hi') {
                    if (message.kind === 'hello') send({ kind: 'hi', from: myId, name: displayName });
                    // Smaller id initiates so both sides never offer at once.
                    if (!peers.has(message.from) && myId < message.from) {
                        await initiate(message.from, message.name || 'Guest');
                    } else if (!peers.has(message.from)) {
                        upsertParticipant(message.from, { name: message.name || 'Guest', local: false });
                    }
                    return;
                }

                if (message.kind === 'offer' && message.sdp) {
                    const entry = createPeer(message.from, message.name || 'Guest');
                    await entry.pc.setRemoteDescription(message.sdp);
                    await flushIce(entry);
                    const answer = await entry.pc.createAnswer();
                    await entry.pc.setLocalDescription(answer);
                    send({ kind: 'answer', from: myId, to: message.from, sdp: entry.pc.localDescription?.toJSON() });
                    return;
                }

                if (message.kind === 'answer' && message.sdp) {
                    const entry = peers.get(message.from);
                    if (!entry) return;
                    await entry.pc.setRemoteDescription(message.sdp);
                    await flushIce(entry);
                    return;
                }

                if (message.kind === 'ice' && message.candidate) {
                    const entry = peers.get(message.from);
                    if (!entry) return;
                    if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(message.candidate).catch(() => undefined);
                    else entry.pendingIce.push(message.candidate);
                }
            } catch (err: any) {
                callbacksRef.current.onError?.(`Call connection problem: ${String(err?.message || err)}`);
            }
        };

        const startMixing = (local: MediaStream) => {
            const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
            audioCtx = new AudioContextCtor();
            void audioCtx.resume().catch(() => undefined);
            audioDest = audioCtx.createMediaStreamDestination();
            if (local.getAudioTracks().length > 0) {
                const micSource = audioCtx.createMediaStreamSource(new MediaStream(local.getAudioTracks()));
                const gain = audioCtx.createGain();
                gain.gain.value = 2;
                micSource.connect(gain);
                gain.connect(audioDest);
            }

            const canvas = document.createElement('canvas');
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;
            const ctx = canvas.getContext('2d');
            canvasStream = canvas.captureStream(15);

            const draw = () => {
                if (!ctx) return;
                ctx.fillStyle = '#020617';
                ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                const entries = [...videoEls.current.entries()];
                const count = Math.max(1, entries.length);
                const cols = Math.ceil(Math.sqrt(count));
                const rows = Math.ceil(count / cols);
                const cellW = CANVAS_WIDTH / cols;
                const cellH = CANVAS_HEIGHT / rows;
                entries.forEach(([, el], index) => {
                    const col = index % cols;
                    const row = Math.floor(index / cols);
                    const x = col * cellW;
                    const y = row * cellH;
                    if (el.readyState >= 2 && el.videoWidth > 0) {
                        const scale = Math.min(cellW / el.videoWidth, cellH / el.videoHeight);
                        const w = el.videoWidth * scale;
                        const h = el.videoHeight * scale;
                        ctx.drawImage(el, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h);
                    }
                });
            };
            drawTimer = window.setInterval(draw, 66);

            const mixed = new MediaStream([
                ...canvasStream.getVideoTracks(),
                ...audioDest.stream.getAudioTracks()
            ]);
            callbacksRef.current.onRecordableStream?.(mixed);
        };

        const join = async () => {
            let local: MediaStream | null = null;
            try {
                local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            } catch {
                try {
                    local = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                    setCamOn(false);
                } catch (err: any) {
                    callbacksRef.current.onError?.(
                        String(err?.name || '').toLowerCase().includes('notallowed')
                            ? 'Camera and microphone permission was denied. Allow access in the browser, then rejoin.'
                            : `Could not start camera or microphone: ${String(err?.message || err)}`
                    );
                    setConnectionNote('No camera or microphone available.');
                    return;
                }
            }
            if (disposed) {
                local?.getTracks().forEach(track => track.stop());
                return;
            }

            localStreamRef.current = local;
            setParticipants([{ id: myId, name: displayName, stream: local, local: true }]);
            callbacksRef.current.onParticipantCount?.(1);
            startMixing(local);

            channel = supabase.channel(`family-call-${roomId}`, {
                config: { broadcast: { self: false }, presence: { key: myId } }
            });
            channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
                void handleSignal(payload as SignalPayload);
            });
            channel.on('presence', { event: 'leave' }, ({ key }) => {
                if (key && key !== myId) closePeer(key);
            });
            channel.subscribe(status => {
                if (disposed) return;
                if (status === 'SUBSCRIBED') {
                    setConnectionNote('Connected. Waiting for family to join...');
                    void channel?.track({ name: displayName });
                    send({ kind: 'hello', from: myId, name: displayName });
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    setConnectionNote('Could not reach the call signaling service. Check your connection.');
                    callbacksRef.current.onError?.('Could not reach the call signaling service (Supabase Realtime).');
                }
            });
        };

        void join();

        return () => {
            disposed = true;
            callbacksRef.current.onRecordableStream?.(null);
            if (drawTimer) window.clearInterval(drawTimer);
            canvasStream?.getTracks().forEach(track => track.stop());
            peers.forEach(entry => entry.pc.close());
            peers.clear();
            remoteAudioSources.forEach(source => source.disconnect());
            remoteAudioSources.clear();
            void audioCtx?.close().catch(() => undefined);
            if (channel) {
                void channel.untrack();
                void supabase.removeChannel(channel);
            }
            localStreamRef.current?.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
            setParticipants([]);
            publish([]);
        };
    }, [roomId, displayName]);

    const toggleMic = () => {
        const next = !micOn;
        localStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = next; });
        setMicOn(next);
    };

    const toggleCam = () => {
        const next = !camOn;
        localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = next; });
        setCamOn(next);
    };

    return (
        <div className="family-call">
            <div className="family-call-grid" data-count={participants.length}>
                {participants.map(participant => (
                    <Tile key={participant.id} participant={participant} register={registerVideo} />
                ))}
            </div>
            <div className="family-call-bar">
                <span className="family-call-note">
                    {participants.length > 1 ? `${participants.length} people in the call` : connectionNote}
                </span>
                <button type="button" className="soft-button" onClick={toggleMic} aria-pressed={!micOn}>
                    {micOn ? 'Mute mic' : 'Unmute mic'}
                </button>
                <button type="button" className="soft-button" onClick={toggleCam} aria-pressed={!camOn}>
                    {camOn ? 'Turn camera off' : 'Turn camera on'}
                </button>
            </div>
        </div>
    );
}
