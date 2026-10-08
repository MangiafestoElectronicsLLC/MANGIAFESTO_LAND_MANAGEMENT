import { NextRequest, NextResponse } from 'next/server';
import { SerialPort } from 'serialport';

// Local USB bridge: lets ANY browser (Safari, Firefox, VS Code preview, macOS, Windows)
// talk to a Meshtastic node plugged into the machine running this server. It exposes the
// same HTTP API a WiFi node does (/api/v1/fromradio, /api/v1/toradio), so the existing
// @meshtastic/js HttpConnection works against it unchanged.
//
// Paths (relative to /api/bridge):
//   GET  ports                    list serial ports
//   POST open?path=COM3           open a port
//   POST close                    close the port
//   GET  status                   bridge state
//   GET  hotspot-detect.html      reachability probe used by the client
//   GET  api/v1/fromradio         next FromRadio packet (empty body if none)
//   PUT  api/v1/toradio           send one ToRadio packet

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const START1 = 0x94;
const START2 = 0xc3;
const MAX_PACKET = 512;
const MAX_QUEUE = 500;
const KNOWN_USB_VIDS = new Set(['303a', '10c4', '1a86', '0403']); // Espressif, Silicon Labs CP210x, CH340, FTDI

type BridgeState = {
    port: SerialPort | null;
    path: string | null;
    rx: Buffer;
    queue: Buffer[];
    lastError: string | null;
};

const globalState = globalThis as unknown as { __meshBridge?: BridgeState };
const state: BridgeState = (globalState.__meshBridge ??= { port: null, path: null, rx: Buffer.alloc(0), queue: [], lastError: null });

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// The bridge controls local hardware, so only same-origin requests to a loopback host
// (or hosts explicitly allowed via MESH_BRIDGE_ALLOWED_HOSTS) are accepted.
function authorize(request: NextRequest): NextResponse | null {
    const enabled = process.env.NODE_ENV !== 'production' || process.env.MESH_BRIDGE_ENABLED === '1';
    if (!enabled) return json({ error: 'USB bridge is disabled. Set MESH_BRIDGE_ENABLED=1 to enable it.' }, 403);

    const host = (request.headers.get('host') || '').toLowerCase();
    const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const extra = (process.env.MESH_BRIDGE_ALLOWED_HOSTS || '')
        .split(',')
        .map(h => h.trim().toLowerCase())
        .filter(Boolean);
    const allowedHost = ['localhost', '127.0.0.1', '::1'].includes(hostname) || extra.includes(hostname);
    if (!allowedHost) return json({ error: 'USB bridge only accepts localhost requests.' }, 403);

    const origin = request.headers.get('origin');
    if (origin) {
        try {
            if (new URL(origin).host.toLowerCase() !== host) return json({ error: 'Cross-origin request blocked.' }, 403);
        } catch {
            return json({ error: 'Bad origin.' }, 403);
        }
    }
    return null;
}

function handleSerialData(chunk: Buffer) {
    state.rx = Buffer.concat([state.rx, chunk]);

    // Resync on the 0x94 0xC3 frame header; anything before it is firmware debug text.
    for (;;) {
        const start = state.rx.indexOf(Buffer.from([START1, START2]));
        if (start === -1) {
            state.rx = state.rx.subarray(Math.max(0, state.rx.length - 1));
            return;
        }
        if (start > 0) state.rx = state.rx.subarray(start);
        if (state.rx.length < 4) return;

        const length = (state.rx[2] << 8) | state.rx[3];
        if (length > MAX_PACKET) {
            state.rx = state.rx.subarray(2);
            continue;
        }
        if (state.rx.length < 4 + length) return;

        state.queue.push(Buffer.from(state.rx.subarray(4, 4 + length)));
        if (state.queue.length > MAX_QUEUE) state.queue.shift();
        state.rx = state.rx.subarray(4 + length);
    }
}

async function closePort() {
    const port = state.port;
    state.port = null;
    state.path = null;
    state.rx = Buffer.alloc(0);
    state.queue = [];
    if (port?.isOpen) {
        await new Promise<void>(resolve => port.close(() => resolve()));
    }
}

async function openPort(path: string) {
    await closePort();
    state.lastError = null;

    // hupcl:false and dtr/rts low stop the ESP32 from resetting when the port opens.
    const port = new SerialPort({ path, baudRate: 115200, autoOpen: false, hupcl: false });
    await new Promise<void>((resolve, reject) => port.open(err => (err ? reject(err) : resolve())));
    await new Promise<void>(resolve => port.set({ dtr: false, rts: false }, () => resolve()));

    port.on('data', handleSerialData);
    port.on('error', err => {
        state.lastError = err.message;
    });
    port.on('close', () => {
        if (state.port === port) {
            state.port = null;
            state.path = null;
        }
    });

    state.port = port;
    state.path = path;

    // Wake the radio's serial API so it starts streaming immediately.
    port.write(Buffer.alloc(32, START2));
}

async function listPorts() {
    const ports = await SerialPort.list();
    return ports
        .map(p => ({
            path: p.path,
            manufacturer: p.manufacturer ?? null,
            vendorId: p.vendorId ?? null,
            productId: p.productId ?? null,
            likelyMeshtastic: p.vendorId ? KNOWN_USB_VIDS.has(p.vendorId.toLowerCase()) : false
        }))
        .sort((a, b) => Number(b.likelyMeshtastic) - Number(a.likelyMeshtastic));
}

function describe(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (/denied|busy|in use|locked/i.test(message)) {
        return `${message}. Another program has the port open: close the Meshtastic web client, Arduino serial monitor, PuTTY, or other tabs.`;
    }
    if (/permission/i.test(message)) {
        return `${message}. On macOS/Linux make sure your user can access the serial device (Linux: add yourself to the dialout group).`;
    }
    return message;
}

type Context = { params: { path?: string[] } };

export async function GET(request: NextRequest, { params }: Context) {
    const denied = authorize(request);
    if (denied) return denied;
    const route = (params.path ?? []).join('/');

    switch (route) {
        case 'ports':
            return json({ ports: await listPorts() });
        case 'status':
            return json({ open: Boolean(state.port?.isOpen), path: state.path, queued: state.queue.length, error: state.lastError });
        case 'hotspot-detect.html':
            return new NextResponse('<html><body>Meshtastic USB bridge</body></html>', {
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }
            });
        case 'api/v1/fromradio': {
            if (!state.port?.isOpen) return json({ error: 'No USB node open.' }, 503);
            // One packet per request, matching the client's non-batch mode.
            const packet = state.queue.shift();
            return new NextResponse(new Uint8Array(packet ?? Buffer.alloc(0)), {
                headers: { 'Content-Type': 'application/x-protobuf', 'Cache-Control': 'no-store' }
            });
        }
        default:
            return json({ error: 'Not found.' }, 404);
    }
}

export async function POST(request: NextRequest, { params }: Context) {
    const denied = authorize(request);
    if (denied) return denied;
    const route = (params.path ?? []).join('/');

    if (route === 'open') {
        const path = request.nextUrl.searchParams.get('path') || '';
        const known = (await listPorts()).some(p => p.path === path);
        if (!known) return json({ error: 'Unknown serial port.' }, 400);
        try {
            await openPort(path);
            return json({ ok: true, path });
        } catch (err) {
            state.lastError = describe(err);
            return json({ error: state.lastError }, 500);
        }
    }
    if (route === 'close') {
        await closePort();
        return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
}

export async function PUT(request: NextRequest, { params }: Context) {
    const denied = authorize(request);
    if (denied) return denied;
    if ((params.path ?? []).join('/') !== 'api/v1/toradio') return json({ error: 'Not found.' }, 404);
    if (!state.port?.isOpen) return json({ error: 'No USB node open.' }, 503);

    const payload = Buffer.from(await request.arrayBuffer());
    if (payload.length === 0 || payload.length > MAX_PACKET) return json({ error: 'Bad packet size.' }, 400);

    const frame = Buffer.concat([Buffer.from([START1, START2, (payload.length >> 8) & 0xff, payload.length & 0xff]), payload]);
    await new Promise<void>((resolve, reject) => state.port!.write(frame, err => (err ? reject(err) : resolve())));
    return new NextResponse(null, { status: 200 });
}
