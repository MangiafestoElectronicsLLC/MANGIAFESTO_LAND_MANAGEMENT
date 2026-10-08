const SPECS: [string, string][] = [
    ['Board', 'Heltec WiFi LoRa 32 V3 (ESP32-S3FN8), Meshtastic-supported'],
    ['LoRa radio', 'Semtech SX1262, 915 MHz (US_915 region), up to ~21 dBm'],
    ['Connectivity', 'Bluetooth 5 LE, WiFi 2.4 GHz, USB-C (power, flashing, serial)'],
    ['Display', '0.96" OLED (shows node name, battery, messages)'],
    ['Battery', '1100 mAh LiPo with onboard charging via USB-C'],
    ['Antenna', '915 MHz SMA/IPEX antenna: always attach before powering on'],
    ['Extras', 'Protective case, Arduino / LoRaWAN capable']
];

const FLEET = [
    { name: 'Node 1', role: 'Portable handheld', note: 'Carry in pack/pocket while on the land.' },
    { name: 'Node 2', role: 'Cabin gateway or fixed relay', note: 'High ground / window, powered by USB.' },
    { name: 'Node 3', role: 'Fixed relay or spare', note: 'Extends range; keep as backup.' },
    { name: 'Brother (out of state)', role: 'Portable handheld', note: 'Ship pre-configured so it works out of the box.' }
];

const BROTHER_STEPS = [
    'Flash the latest Meshtastic firmware for "Heltec V3" (flasher.meshtastic.org) and set region to US_915.',
    'Join the same private family channel: scan the channel QR from the Meshtastic app on your phone, or share the channel URL.',
    'Give the node a short unique name (e.g. "Bro-Texas") so messages show who sent them.',
    'He pairs it once in the Meshtastic phone app over Bluetooth, then opens this page in Chrome/Edge (Android or desktop) and taps Connect My Node.',
    'Out of state he will only reach you if a node is in LoRa range of a mesh or an MQTT/internet bridge is enabled; see the note below.'
];

const TIPS = [
    'Use the Chrome or Edge browser. Web Bluetooth is not available in Safari/iOS; on iPhone use the Meshtastic app for chat.',
    'Close the Meshtastic phone app (or disconnect it) before connecting here. A node accepts only one Bluetooth connection at a time.',
    'Keep messages short (about 200 characters max). Short canned messages travel and relay best.',
    'Set Hop Limit to 3 (max 7) on every node; more hops add airtime and clutter on a small mesh.',
    'Charge nodes before heading out; 1100 mAh lasts about a day of typical use, longer with the screen off.',
    'Elevation is range: a node on a ridge or tall post beats a node in a pocket in a valley.'
];

export default function HeltecGuide() {
    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.85rem' }}>
            <div>
                <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Hardware &amp; Family Setup</div>
                <h2 style={{ margin: 0 }}>Heltec V3 Meshtastic Nodes</h2>
            </div>

            <div style={{ display: 'grid', gap: '0.3rem', fontSize: '0.88rem' }}>
                {SPECS.map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <strong style={{ minWidth: 110 }}>{label}</strong>
                        <span style={{ opacity: 0.85 }}>{value}</span>
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gap: '0.4rem' }}>
                <strong style={{ fontSize: '0.9rem' }}>Family fleet (3 on hand + 1 for your brother)</strong>
                {FLEET.map(item => (
                    <div
                        key={item.name}
                        style={{ border: '1px solid #334155', borderRadius: 8, padding: '0.45rem 0.6rem', fontSize: '0.85rem' }}
                    >
                        <strong>{item.name}</strong> · {item.role}
                        <div style={{ opacity: 0.75 }}>{item.note}</div>
                    </div>
                ))}
            </div>

            <details open>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>Can&apos;t connect? Use USB (easiest)</summary>
                <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem', fontSize: '0.86rem' }}>
                    <li>Plug the Heltec into the computer that runs this app with a <strong>data</strong> USB-C cable (charge-only cables won&apos;t show a port).</li>
                    <li>Tap <strong>Connect via USB (any browser)</strong>. The app&apos;s own server opens the port, so it works in Edge, Chrome, Safari, macOS and the VS Code preview. It auto-picks the Heltec port.</li>
                    <li>Only works while the app runs on that computer (e.g. <code>npm run dev</code>). On a hosted site, set MESH_BRIDGE_ENABLED=1 on the machine with the node.</li>
                    <li>No port found? Check Device Manager &gt; Ports (Windows) or <code>ls /dev/cu.*</code> (macOS); install the CP210x driver if needed, and try another cable/port.</li>
                    <li>Close the Meshtastic web flasher, Arduino serial monitor, or other apps using the same port first.</li>
                    <li>The node must already run Meshtastic firmware (flash it at flasher.meshtastic.org) with region US_915.</li>
                </ol>
                <p style={{ fontSize: '0.82rem', opacity: 0.75, marginBottom: 0 }}>
                    About &quot;Radio ID&quot;: Meshtastic has no separate radio ID to enter. Each node gets its own node number
                    and short ID (like !a1b2c3d4) automatically, shown on the OLED and in the node list once connected.
                    Plugging in by USB doesn&apos;t require one; it just makes the connection reliable.
                </p>
            </details>

            <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>Any browser / VPN / VPS setup (no Bluetooth or USB)</summary>
                <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem', fontSize: '0.86rem' }}>
                    <li>Put the node on WiFi: Meshtastic app &gt; Radio config &gt; Network &gt; enable WiFi, enter your SSID and password.</li>
                    <li>Read its IP from the node&apos;s OLED (or router). Enter it in <strong>WiFi / VPN address</strong> on this page and tap Connect via WiFi / VPN.</li>
                    <li>Away from home: install Tailscale (easiest) or WireGuard on the phone/PC and on a device on the node&apos;s network, then use the node&apos;s VPN/LAN address. A VPS can act as the WireGuard hub.</li>
                    <li>Open this app over plain http (LAN/VPN) or enable HTTPS on the node. Browsers block http node addresses from https pages.</li>
                    <li>For nodes anywhere in the world, enable MQTT on the node (Radio config &gt; MQTT) pointing at a broker on your VPS (Mosquitto). That links meshes over the internet; the web page itself still connects to a node.</li>
                </ol>
            </details>

            <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>Setting up your brother&apos;s node</summary>
                <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem', fontSize: '0.86rem' }}>
                    {BROTHER_STEPS.map(step => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
                <p style={{ fontSize: '0.82rem', opacity: 0.75, marginBottom: 0 }}>
                    LoRa range is line-of-sight (typically 1–5 km handheld, more from high ground). Out-of-state
                    messaging needs a node connected to WiFi with MQTT uplink enabled, or use this page&apos;s
                    internet sync when you both have service.
                </p>
            </details>

            <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>Tips for reliable messaging</summary>
                <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem', fontSize: '0.86rem' }}>
                    {TIPS.map(tip => (
                        <li key={tip}>{tip}</li>
                    ))}
                </ul>
            </details>
        </section>
    );
}
