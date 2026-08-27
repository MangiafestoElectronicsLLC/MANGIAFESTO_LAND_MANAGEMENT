const STEPS = [
    {
        title: 'Adding a brand-new node? Use "My Mesh Devices" above.',
        detail:
            'Tap "Add a node" and the four-step guide checks your browser, walks the prep checklist (antenna, US_915 region, family channel), lets you name the node and its station, then connects and saves it for one-tap reconnects later.'
    },
    {
        title: 'Already added? Just tap Connect on the device card.',
        detail:
            'Saved nodes appear in My Mesh Devices with their nickname, role, and last-connected time. Connect reuses the same node without hunting through the Bluetooth picker.'
    },
    {
        title: 'Turn on your node',
        detail:
            'Each ESP32 LoRa V3 node (with the 1100mAh battery + protective case) charges over USB-C. Screw on the 915MHz antenna first, then press and hold the side button ~1 second to power on.'
    },
    {
        title: 'First-time pairing happens in the Meshtastic app',
        detail:
            'Install "Meshtastic" from the App Store or Google Play, pair over Bluetooth once there, set region US_915, and join your family\'s private channel. After that, this page can connect to it directly.'
    },
    {
        title: 'Monitor the mesh here anytime',
        detail: 'Once connected, node battery/signal/last-heard and message history update live on this page without opening the Meshtastic app.'
    },
    {
        title: 'Use the messaging console with no phone signal',
        detail:
            'When you have zero cell bars, use the Off-Grid Messaging Console — it broadcasts over LoRa to every node in range, and queues automatically if you\'re also offline from this dashboard.'
    }
];

export default function HowToUse() {
    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem' }}>
            <div>
                <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>Getting Started</div>
                <h2 style={{ margin: 0 }}>How to Use Meshnology on the Land</h2>
            </div>
            <ol style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.6rem' }}>
                {STEPS.map(step => (
                    <li key={step.title} style={{ fontSize: '0.9rem' }}>
                        <strong>{step.title}</strong>
                        <div style={{ opacity: 0.8 }}>{step.detail}</div>
                    </li>
                ))}
            </ol>
            <div style={{ fontSize: '0.82rem', opacity: 0.7 }}>
                Hardware reference: ESP32 LoRa V3 development boards with SX1262 radios, 915MHz antennas, 1100mAh
                batteries, and protective cases — one set as a portable handheld, one or two as fixed relays on high
                ground, and one as the cabin gateway.
            </div>
        </section>
    );
}
