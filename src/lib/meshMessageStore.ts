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
        tx.oncomplete = () => {
            db.close();
            resolve(req.result);
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || req.error || new Error('Message storage transaction failed.'));
        };
    });
};

export const saveMessage = async (message: MeshMessage): Promise<void> => {
    await runStore(MESSAGES_STORE, 'readwrite', store => store.put(message));
};

export const loadMessages = async (): Promise<MeshMessage[]> => {
    const all = await runStore<MeshMessage[]>(MESSAGES_STORE, 'readonly', store => store.getAll());
    return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
};

export const queueOutgoingMessage = async (message: MeshMessage): Promise<void> => {
    await runStore(QUEUE_STORE, 'readwrite', store => store.put(message));
};

export const saveQueuedMessage = async (message: MeshMessage): Promise<void> => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([MESSAGES_STORE, QUEUE_STORE], 'readwrite');
        tx.objectStore(MESSAGES_STORE).put(message);
        tx.objectStore(QUEUE_STORE).put(message);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('Could not save the waiting message.'));
        };
    });
};

export const deleteQueuedMessage = async (id: string): Promise<void> => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([MESSAGES_STORE, QUEUE_STORE], 'readwrite');
        tx.objectStore(MESSAGES_STORE).delete(id);
        tx.objectStore(QUEUE_STORE).delete(id);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('Could not remove the waiting message.'));
        };
    });
};

export const loadQueuedMessages = async (): Promise<MeshMessage[]> => {
    return runStore<MeshMessage[]>(QUEUE_STORE, 'readonly', store => store.getAll());
};

export const removeQueuedMessage = async (id: string): Promise<void> => {
    await runStore(QUEUE_STORE, 'readwrite', store => store.delete(id));
};

export const markQueuedMessageSent = async (message: MeshMessage): Promise<void> => {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([MESSAGES_STORE, QUEUE_STORE], 'readwrite');
        tx.objectStore(MESSAGES_STORE).put(message);
        tx.objectStore(QUEUE_STORE).delete(message.id);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('Could not update the sent message.'));
        };
    });
};

export const makeMessageId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
