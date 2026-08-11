import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import * as vscode from 'vscode';
import { renderComparisonGif, resolveSynchronizedDurations } from '../renderer';

suite('Comparison renderer', function () {
	this.timeout(30_000);

	test('stacks extreme-width crops vertically with in-frame labels', async () => {
		if (!ffmpegPath) {
			assert.fail('No FFmpeg binary is available for renderer tests.');
		}
		const directory = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-renderer-'));
		try {
			const before = path.join(directory, 'before.mp4');
			const after = path.join(directory, 'after.mp4');
			await createVideo(ffmpegPath, before, '0xc84b31');
			await createVideo(ffmpegPath, after, '0x2e7d5b');
			const menuBar = { x: 20, y: 20, width: 600, height: 80 };
			const beforeTimings = [
				{ index: 0, type: 'hold' as const, startedAtMs: 0, endedAtMs: 200 },
				{ index: 1, type: 'resize' as const, startedAtMs: 200, endedAtMs: 1_000 },
			];
			const afterTimings = [
				{ index: 0, type: 'hold' as const, startedAtMs: 0, endedAtMs: 600 },
				{ index: 1, type: 'resize' as const, startedAtMs: 600, endedAtMs: 1_000 },
			];
			const rendered = await renderComparisonGif(
				before,
				after,
				directory,
				'Before',
				'After',
				{ width: 640, height: 480 },
				menuBar,
				menuBar,
				beforeTimings,
				afterTimings,
				0,
				0,
				'vertical',
				new vscode.CancellationTokenSource().token,
				() => undefined,
			);
			assert.ok((await stat(rendered.comparisonGifPath)).size > 1_000);
			assert.ok((await stat(rendered.beforeGifPath)).size > 1_000);
			assert.ok((await stat(rendered.afterGifPath)).size > 1_000);
			const header = await readFile(rendered.comparisonGifPath);
			assert.strictEqual(header.readUInt16LE(6), 966);
			assert.strictEqual(header.readUInt16LE(8), 268);
			const beforeHeader = await readFile(rendered.beforeGifPath);
			assert.strictEqual(beforeHeader.readUInt16LE(6), 966);
			assert.strictEqual(beforeHeader.readUInt16LE(8), 134);
			const afterHeader = await readFile(rendered.afterGifPath);
			assert.strictEqual(afterHeader.readUInt16LE(6), 966);
			assert.strictEqual(afterHeader.readUInt16LE(8), 134);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('normalizes each paired action to the longer duration', () => {
		assert.deepStrictEqual(resolveSynchronizedDurations(
			[
				{ index: 0, type: 'click', startedAtMs: 0, endedAtMs: 250 },
				{ index: 1, type: 'hold', startedAtMs: 250, endedAtMs: 1_000 },
			],
			[
				{ index: 0, type: 'click', startedAtMs: 0, endedAtMs: 500 },
				{ index: 1, type: 'hold', startedAtMs: 500, endedAtMs: 900 },
			],
		), [500, 750]);
	});
});

async function createVideo(executablePath: string, outputPath: string, color: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(executablePath, [
			'-y',
			'-f', 'lavfi',
			'-i', `color=c=${color}:s=640x480:d=1`,
			'-pix_fmt', 'yuv420p',
			outputPath,
		], { windowsHide: true });
		child.once('error', reject);
		child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Fixture FFmpeg exited with ${code}.`)));
	});
}