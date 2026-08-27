'use client';

import type { MeshMessage } from './meshTypes';

// Local-first message history + outgoing queue so the console keeps working with no internet.
const DB_NAME = 'family-land-satcom';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';
const QUEUE_STORE = 'outgoing_queue';

const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not available in this environment.'));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
                db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(QUEUE_STORE)) {
                db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

const runStore = async <T>(
    storeName: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = action(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
};

export const saveMessage = async (message: MeshMessage): Promise<void> => {
    await runStore(MESSAGES_STORE, 'readwrite', store => store.put(message));
};

export const loadMessages = async (): Promise<MeshMessage[]> => {
    try {
        const all = await runStore<MeshMessage[]>(MESSAGES_STORE, 'readonly', store => store.getAll());
        return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
    } catch {
        return [];
    }
};

export const queueOutgoingMessage = async (message: MeshMessage): Promise<void> => {
    await runStore(QUEUE_STORE, 'readwrite', store => store.put(message));
};

export const loadQueuedMessages = async (): Promise<MeshMessage[]> => {
    try {
        return await runStore<MeshMessage[]>(QUEUE_STORE, 'readonly', store => store.getAll());
    } catch {
        return [];
    }
};

export const removeQueuedMessage = async (id: string): Promise<void> => {
    await runStore(QUEUE_STORE, 'readwrite', store => store.delete(id));
};

export const makeMessageId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
