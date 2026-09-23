import { readdir, readFile, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { ComparisonRequest, ComparisonResult } from './model';

export interface StoredSession {
	request: ComparisonRequest;
	result: ComparisonResult;
}

/** Reads back a finished comparison so another process can ask an editor to preview it. */
export async function readStoredSession(sessionDirectory: string): Promise<StoredSession> {
	let session: Partial<StoredSession>;
	try {
		session = JSON.parse(await readFile(path.join(sessionDirectory, 'session.json'), 'utf8')) as Partial<StoredSession>;
	} catch {
		throw new Error(`No PR UI Compare session was found in "${sessionDirectory}".`);
	}
	if (!session.result?.comparisonPath || !session.request?.scenario) {
		throw new Error(`The PR UI Compare session in "${sessionDirectory}" is incomplete.`);
	}
	return session as StoredSession;
}

export async function cleanupExpiredSessions(storageRoot: string, retentionDays: number): Promise<number> {
	const sessionsPath = path.join(storageRoot, 'sessions');
	let entries;
	try {
		entries = await readdir(sessionsPath, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return 0;
		}
		throw error;
	}

	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	let removed = 0;
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const sessionPath = path.join(sessionsPath, entry.name);
		const sessionStat = await stat(sessionPath);
		if (sessionStat.mtimeMs < cutoff) {
			await rm(sessionPath, { recursive: true, force: true });
			removed += 1;
		}
	}
	return removed;
}