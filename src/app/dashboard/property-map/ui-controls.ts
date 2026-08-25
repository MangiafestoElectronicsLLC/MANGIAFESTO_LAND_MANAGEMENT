export type ToolbarControl = {
    id: string;
    label: string;
};

export const TOP_BAR_CONTROLS: ToolbarControl[] = [
    { id: 'gps', label: 'GPS On/Off' },
    { id: 'center', label: 'Center Me' },
    { id: 'record', label: 'Record Trail' },
    { id: 'save', label: 'Save Trail' }
];

export const FLOATING_CONTROLS: ToolbarControl[] = [
    { id: 'pin', label: 'Add Pinpoint' },
    { id: 'trail-point', label: 'Add Trail Point' },
    { id: 'follow', label: 'Auto-follow' },
    { id: 'recenter', label: 'Recenter Map' }
];

export const BOTTOM_DRAWER_TABS = [
    { id: 'boundary', label: 'Boundary Editor' },
    { id: 'pins', label: 'Pinpoints' },
    { id: 'trails', label: 'Trail Manager' },
    { id: 'photos', label: 'Photo Attachments' },
    { id: 'io', label: 'Import / Export' }
] as const;

export type BottomDrawerTab = (typeof BOTTOM_DRAWER_TABS)[number]['id'];
