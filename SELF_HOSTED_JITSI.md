# Free Self-Hosted Calls

The meetings page can join a self-hosted Jitsi room. Jitsi and Jibri are open-source, but the server must stay online and have enough CPU, memory, bandwidth, and disk space. A home server avoids a hosting bill but needs a public hostname, router/firewall access, and an always-on machine.

## Start With Jitsi

Follow the official [Jitsi Docker self-hosting guide](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker/) on an always-on Linux server:

1. Use the latest stable release of `jitsi/docker-jitsi-meet`; copy `env.example` to `.env` and run `./gen-passwords.sh`.
2. Set `PUBLIC_URL` to the public HTTPS hostname and `JVB_ADVERTISE_IPS` to the server's public IP. Configure DNS and a trusted TLS certificate.
3. Allow inbound `80/tcp`, `443/tcp`, and `10000/udp`. The Jitsi handbook explains firewall and NAT setup.
4. Start the standard Docker Compose Jitsi services and verify family members can join from outside the home network.
5. Add `NEXT_PUBLIC_JITSI_DOMAIN` to the app's build environment using only the hostname, for example `meet.example.com`, then rebuild/redeploy the app.

The meetings page's **Start free group call** creates a shared Jitsi room and displays the room link and saved family invite controls. **Start free call and record** captures the shared call tab in the browser; keep the app page open for that local recording to save.

## Record After the Host Leaves

Jitsi calls alone do not provide a server-side recording. To record after the starter closes the app, enable Jibri by following the Jitsi handbook's [Jibri recording setup](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker/#jibri):

1. Enable `ENABLE_RECORDING=1`, configure the Jibri recorder/XMPP passwords, and start the official `jibri.yml` Compose profile.
2. In this app choose **Free call only**, start the call, join it, then use **Start Jibri recording**. Jibri stores recordings under `${CONFIG}/storage/jibri` on the server and finishes when the conference ends after the last participant leaves. **Stop Jibri recording** ends it early.
3. If the meetings page remains open, the app saves Jitsi's `recordingLinkAvailable` URL when it arrives. If the app is closed, Jibri still leaves the recording on the server, but there is no active browser to link it automatically; upload the recovered MP4/WebM from **Saved recordings** when you return.

The built-in **Call room tab/window** capture remains a browser fallback only; it stops when that page/device closes. Daily cloud recording remains an optional paid managed service.