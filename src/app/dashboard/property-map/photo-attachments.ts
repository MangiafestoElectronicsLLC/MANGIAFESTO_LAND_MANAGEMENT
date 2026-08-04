import { PhotoAttachment } from './types';
import { createId } from './map-engine';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('Failed to read image.'));
        };
        reader.onerror = () => reject(new Error('Failed to read image.'));
        reader.readAsDataURL(file);
    });

export const filesToAttachments = async (files: FileList | null): Promise<PhotoAttachment[]> => {
    if (!files || files.length === 0) return [];

    const attachments: PhotoAttachment[] = [];

    for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
            throw new Error(`${file.name} is not an image.`);
        }

        if (file.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`${file.name} is too large. Max file size is 8 MB.`);
        }

        const dataUrl = await readAsDataUrl(file);
        attachments.push({
            id: createId('photo'),
            name: file.name,
            dataUrl,
            createdAt: new Date().toISOString()
        });
    }

    return attachments;
};

export const removeAttachmentById = (attachments: PhotoAttachment[], photoId: string) =>
    attachments.filter(photo => photo.id !== photoId);
