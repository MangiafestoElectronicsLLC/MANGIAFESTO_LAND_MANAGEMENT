const STEPS = [
    {
        title: 'Charge and power on your node',
        detail:
            'Each ESP32 LoRa V3 node (with the 1100mAh battery + protective case) charges over USB-C. Press and hold the side button ~1 second to power on — the OLED screen (if fitted) or LED will light up.'
    },
    {
        title: 'Install the Meshtastic app',
        detail: 'Install "Meshtastic" from the App Store or Google Play on your phone. One app pairs with any of your nodes.'
    },
    {
        title: 'Pair via Bluetooth',
        detail:
            'In the Meshtastic app, tap "+" / "Connect a device" → Bluetooth, then select your node from the scan list. First-time pairing may ask for a PIN shown on the node.'
    },
    {
        title: 'Join the private channel',
        detail:
            'Under Channels, import or enter the shared family channel (PSK + name) so every node/phone talks on the same private mesh instead of the public default channel.'
    },
    {
        title: 'Set region + role once per node',
        detail:
            'In device settings, confirm Region = US_915 and Role = Portable (handheld), Relay (fixed high point), or Gateway (the one node connected to internet/power at the cabin).'
    },
    {
        title: 'Open the SatCom page to monitor the mesh',
        detail: 'Come back to this /dashboard/satcom page any time to see node health, signal, and battery without opening the Meshtastic app.'
    },
    {
        title: 'Use the messaging console with no phone signal',
        detail:
            'When you have zero cell bars, use the Off-Grid Messaging Console below — it broadcasts over LoRa to every node in range, and queues automatically if you\'re also offline from this dashboard.'
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
