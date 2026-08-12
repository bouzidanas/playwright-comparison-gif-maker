import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, rename } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';
import { CancellationError, hostConfiguration, type CancellationToken, type OutputSink } from './host';

// Same static builds the ffmpeg-static npm package installs from.
const DOWNLOAD_BASE_URL = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';
const DOWNLOADABLE_TARGETS = new Set([
	'darwin-arm64',
	'darwin-x64',
	'linux-arm',
	'linux-arm64',
	'linux-ia32',
	'linux-x64',
	'win32-ia32',
	'win32-x64',
]);

let globalStorageDir: string | undefined;

export function initializeFfmpegLocator(storageDir: string): void {
	globalStorageDir = storageDir;
}

export async function resolveFfmpegPath(): Promise<string | undefined> {
	const configured = hostConfiguration().ffmpegPath();
	if (configured) {
		if (!await isFile(configured)) {
			throw new Error(`The prUiCompare.ffmpegPath setting points to "${configured}", which does not exist.`);
		}
		return configured;
	}
	const fromEnvironment = process.env.PR_UI_COMPARE_FFMPEG;
	if (fromEnvironment) {
		return fromEnvironment;
	}
	const onPath = await findOnPath();
	if (onPath) {
		return onPath;
	}
	const installed = installedFfmpegPath();
	if (installed && await isFile(installed)) {
		return installed;
	}
	return undefined;
}

export async function installFfmpeg(
	output: OutputSink,
	token: CancellationToken,
): Promise<string> {
	const destination = installedFfmpegPath();
	if (!destination) {
		throw new Error('FFmpeg storage is not initialized.');
	}
	const target = `${process.platform}-${process.arch}`;
	if (!DOWNLOADABLE_TARGETS.has(target)) {
		throw new Error(`No FFmpeg download is available for ${target}. Install FFmpeg manually and set prUiCompare.ffmpegPath.`);
	}
	await mkdir(path.dirname(destination), { recursive: true });
	const url = `${DOWNLOAD_BASE_URL}/ffmpeg-${target}.gz`;
	output.appendLine(`Downloading ${url}`);
	const controller = new AbortController();
	const cancellation = token.onCancellationRequested(() => controller.abort());
	const partPath = `${destination}.download`;
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok || !response.body) {
			throw new Error(`FFmpeg download failed with HTTP status ${response.status}.`);
		}
		await pipeline(Readable.fromWeb(response.body as ReadableStream), createGunzip(), createWriteStream(partPath));
		if (process.platform !== 'win32') {
			await chmod(partPath, 0o755);
		}
		await rename(partPath, destination);
		output.appendLine(`FFmpeg installed at ${destination}`);
		return destination;
	} catch (error) {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		throw error;
	} finally {
		cancellation.dispose();
	}
}

function installedFfmpegPath(): string | undefined {
	return globalStorageDir ? path.join(globalStorageDir, 'ffmpeg', executableName()) : undefined;
}

function executableName(): string {
	return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

async function findOnPath(): Promise<string | undefined> {
	const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	const names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg.cmd', 'ffmpeg.bat'] : ['ffmpeg'];
	for (const directory of directories) {
		for (const name of names) {
			const candidate = path.join(directory, name);
			if (await isFile(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

async function isFile(candidate: string): Promise<boolean> {
	try {
		await access(candidate);
		return true;
	} catch {
		return false;
	}
}
