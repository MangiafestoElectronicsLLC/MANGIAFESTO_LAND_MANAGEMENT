export type MeshNodeRole = 'portable' | 'relay' | 'gateway' | 'unknown';

export type MeshNode = {
    id: string;
    name: string;
    role: MeshNodeRole;
    battery_pct: number;
    last_heard: string;
    online: boolean;
    signal_dbm: number;
    hop_count: number;
    firmware_version: string;
    region: string;
    gps_lat: number | null;
    gps_lng: number | null;
};

export type MeshMetrics = {
    total_nodes: number;
    online_nodes: number;
    reachable_nodes: number;
    gateway_online: boolean;
    channel_utilization_pct: number;
    last_updated: string;
};

export type MeshStatusResponse = {
    nodes: MeshNode[];
    metrics: MeshMetrics;
    simulated: boolean;
};

export type MeshMessage = {
    id: string;
    text: string;
    sender: string;
    direction: 'outgoing' | 'incoming';
    relayed_by: string | null;
    emergency: boolean;
    created_at: string;
    synced: boolean;
};

export type MeshSendRequest = {
    text: string;
    sender: string;
    emergency?: boolean;
};

export type MeshSendResponse = {
    message: MeshMessage;
    simulated: boolean;
};
