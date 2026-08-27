export default function EmergencyGuide() {
    return (
        <section className="panel panel-pad" style={{ display: 'grid', gap: '0.75rem', border: '1px solid #7f1d1d' }}>
            <div>
                <div style={{ opacity: 0.8, fontSize: '0.85rem', color: '#fecaca' }}>Emergency Mode</div>
                <h2 style={{ margin: 0 }}>Emergency Communication</h2>
            </div>

            <div style={{ display: 'grid', gap: '0.6rem', fontSize: '0.9rem' }}>
                <div>
                    <strong>Sending an emergency broadcast</strong>
                    <div style={{ opacity: 0.85 }}>
                        In the Off-Grid Messaging Console, check &quot;Mark as emergency broadcast&quot; before sending. Emergency
                        messages are highlighted in red for everyone on the mesh so they stand out from normal chatter.
                    </div>
                </div>
                <div>
                    <strong>Relay nodes extend coverage</strong>
                    <div style={{ opacity: 0.85 }}>
                        A message doesn&apos;t need a direct line to every node — Ridge Relay and Treeline Relay repeat packets
                        so a handheld deep in the woods can still reach the cabin gateway a few hops away.
                    </div>
                </div>
                <div>
                    <strong>Works with zero internet</strong>
                    <div style={{ opacity: 0.85 }}>
                        LoRa mesh messaging between nodes and phones works entirely offline — no cell signal, Wi-Fi, or
                        internet required between the sender and any node in range.
                    </div>
                </div>
                <div>
                    <strong>Gateway syncs when internet returns</strong>
                    <div style={{ opacity: 0.85 }}>
                        The cabin gateway node is the only one that needs internet, and only to sync mesh activity back to
                        this dashboard. Messages sent while this page is offline are queued on your device and sent
                        automatically the moment connection returns.
                    </div>
                </div>
            </div>
        </section>
    );
}
