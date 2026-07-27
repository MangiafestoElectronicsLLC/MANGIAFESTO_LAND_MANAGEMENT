import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GpxFileRecord = {
    name: string;
    modifiedMs: number;
    content: string;
    fullPath: string;
};

const isGpxLike = (fileName: string) => {
    const lower = fileName.toLowerCase();
    return lower.endsWith('.gpx') || lower.endsWith('.xml');
};

const resolveSharedFolderPath = () => {
    const configured = process.env.ONX_SHARED_GPX_DIR;
    if (configured && configured.trim().length > 0) {
        return configured.trim();
    }

    return path.join(process.cwd(), 'shared-gpx');
};

const toSafeInteger = (value: string | null, fallback: number) => {
    const parsed = Number(value ?? '');
    if (!Number.isFinite(parsed)) return fallback;
    return Math.floor(parsed);
};

const toSafeBoolean = (value: string | null, fallback = false) => {
    if (value === null) return fallback;
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const sanitizeArchiveFolderName = (value: string | null) => {
    const raw = (value || 'imported').trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '');
    return safe.length > 0 ? safe : 'imported';
};

const ensureUniqueArchivePath = async (targetPath: string) => {
    let candidate = targetPath;
    let suffix = 1;

    // Keep incrementing until a free filename is found.
    for (; ;) {
        try {
            await fs.access(candidate);
            const parsed = path.parse(targetPath);
            candidate = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
            suffix += 1;
        } catch {
            return candidate;
        }
    }
};

const moveFileWithFallback = async (sourcePath: string, targetPath: string) => {
    try {
        await fs.rename(sourcePath, targetPath);
        return;
    } catch (err: any) {
        if (err?.code !== 'EXDEV') {
            throw err;
        }
    }

    await fs.copyFile(sourcePath, targetPath);
    await fs.unlink(sourcePath);
};

export async function GET(request: NextRequest) {
    const folderPath = resolveSharedFolderPath();
    const sinceMs = Math.max(0, toSafeInteger(request.nextUrl.searchParams.get('sinceMs'), 0));
    const maxFiles = Math.min(25, Math.max(1, toSafeInteger(request.nextUrl.searchParams.get('maxFiles'), 8)));
    const archiveOnRead = toSafeBoolean(request.nextUrl.searchParams.get('archive'), false);
    const archiveFolderName = sanitizeArchiveFolderName(request.nextUrl.searchParams.get('archiveDir'));

    try {
        const folderStats = await fs.stat(folderPath);
        if (!folderStats.isDirectory()) {
            return NextResponse.json({
                enabled: false,
                folderPath,
                files: [],
                message: 'ONX_SHARED_GPX_DIR exists but is not a directory.'
            });
        }
    } catch {
        return NextResponse.json({
            enabled: false,
            folderPath,
            files: [],
            message: 'Shared GPX folder not found. Set ONX_SHARED_GPX_DIR on your server.'
        });
    }

    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const candidateFileNames = entries
        .filter(entry => entry.isFile() && isGpxLike(entry.name))
        .map(entry => entry.name);

    const records: GpxFileRecord[] = [];

    for (const fileName of candidateFileNames) {
        const fullPath = path.join(folderPath, fileName);

        try {
            const stats = await fs.stat(fullPath);
            if (stats.mtimeMs <= sinceMs) continue;

            const content = await fs.readFile(fullPath, 'utf-8');
            records.push({
                name: fileName,
                modifiedMs: Math.floor(stats.mtimeMs),
                content,
                fullPath
            });
        } catch {
            // Skip unreadable files and continue processing the rest.
        }
    }

    records.sort((a, b) => a.modifiedMs - b.modifiedMs);

    const selectedRecords = records.slice(0, maxFiles);
    let archivedCount = 0;

    if (archiveOnRead && selectedRecords.length > 0) {
        const archiveDirectoryPath = path.join(folderPath, archiveFolderName);
        await fs.mkdir(archiveDirectoryPath, { recursive: true });

        for (const record of selectedRecords) {
            try {
                const requestedTargetPath = path.join(archiveDirectoryPath, record.name);
                const targetPath = await ensureUniqueArchivePath(requestedTargetPath);
                await moveFileWithFallback(record.fullPath, targetPath);
                archivedCount += 1;
            } catch {
                // Keep processing even if one archive move fails.
            }
        }
    }

    return NextResponse.json({
        enabled: true,
        folderPath,
        sinceMs,
        archiveOnRead,
        archiveDir: archiveFolderName,
        archivedCount,
        files: selectedRecords.map(record => ({
            name: record.name,
            modifiedMs: record.modifiedMs,
            content: record.content
        }))
    });
}
