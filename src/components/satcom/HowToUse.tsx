const STEPS = [
    {
        title: 'Already paired your node in the Meshtastic app? You\'re ready.',
        detail:
            'Go to the Off-Grid Messaging Console above and tap "Connect My Node (Bluetooth)". Pick your node from the popup — that\'s it, no extra setup needed on this page.'
    },
    {
        title: 'Turn on your node',
        detail:
            'Each ESP32 LoRa V3 node (with the 1100mAh battery + protective case) charges over USB-C. Press and hold the side button ~1 second to power on.'
    },
    {
        title: 'First time pairing a brand-new node?',
        detail:
            'Install "Meshtastic" from the App Store or Google Play, connect over Bluetooth once there, and join your family\'s private channel. After that, this page can connect to it directly too.'
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
