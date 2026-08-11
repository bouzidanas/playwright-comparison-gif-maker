import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import * as vscode from 'vscode';
import { DEFAULT_ANIMATION_FRAME_RATE, renderComparisonGif, resolveSynchronizedDurations } from '../renderer';

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
			await createPatternVideo(ffmpegPath, before, 'testsrc2');
			await createPatternVideo(ffmpegPath, after, 'smptebars');
			const menuBar = { x: 20, y: 20, width: 600, height: 80 };
			const zoomTarget = { x: 220, y: 30, width: 120, height: 40 };
			const beforeTimings = [
				{ index: 0, type: 'zoom' as const, startedAtMs: 0, endedAtMs: 300 },
				{ index: 1, type: 'resize' as const, startedAtMs: 300, endedAtMs: 700 },
				{ index: 2, type: 'zoom' as const, startedAtMs: 700, endedAtMs: 1_000 },
			];
			const afterTimings = [
				{ index: 0, type: 'zoom' as const, startedAtMs: 0, endedAtMs: 400 },
				{ index: 1, type: 'resize' as const, startedAtMs: 400, endedAtMs: 600 },
				{ index: 2, type: 'zoom' as const, startedAtMs: 600, endedAtMs: 1_000 },
			];
			const resizeCues = [
				{
					actionIndex: 1,
					from: { width: 640, height: 480 },
					to: { width: 360, height: 480 },
					anchor: 'both' as const,
					durationMs: 300,
				},
			];
			const zoomCues = [
				{ actionIndex: 0, target: zoomTarget, scale: 2, durationMs: 300 },
				{ actionIndex: 2, scale: 1, durationMs: 300 },
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
				{ width: 640, height: 480 },
				{ width: 640, height: 480 },
				resizeCues,
				resizeCues,
				zoomCues,
				zoomCues,
				'#2f81f7',
				'bottom-left',
				'bottom-right',
				30,
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

	test('renders camera motion at a smooth frame cadence', () => {
		assert.strictEqual(DEFAULT_ANIMATION_FRAME_RATE, 24);
	});

	test('places a shrinking page from the left, right, or both edges', async () => {
		if (!ffmpegPath) {
			assert.fail('No FFmpeg binary is available for renderer tests.');
		}
		const directory = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-anchor-'));
		try {
			const before = path.join(directory, 'before.mp4');
			const after = path.join(directory, 'after.mp4');
			await createVideo(ffmpegPath, before, '0xc84b31');
			await createVideo(ffmpegPath, after, '0x2e7d5b');
			const timings = [{ index: 0, type: 'resize' as const, startedAtMs: 0, endedAtMs: 800 }];
			for (const anchor of ['left', 'right', 'both'] as const) {
				const resizeCues = [{
					actionIndex: 0,
					from: { width: 640, height: 480 },
					to: { width: 360, height: 480 },
					anchor,
					durationMs: 800,
				}];
				const anchorDirectory = path.join(directory, anchor);
				await mkdir(anchorDirectory);
				const rendered = await renderComparisonGif(
					before,
					after,
					anchorDirectory,
					'Before',
					'After',
					{ width: 640, height: 480 },
					undefined,
					undefined,
					timings,
					timings,
					0,
					0,
					{ width: 640, height: 480 },
					{ width: 640, height: 480 },
					resizeCues,
					resizeCues,
					[],
					[],
					'#30363d',
					'top-left',
					'top-right',
					24,
					'horizontal',
					new vscode.CancellationTokenSource().token,
					() => undefined,
				);
				const leftPixel = await readGifPixel(ffmpegPath, rendered.beforeGifPath, 20, 200);
				const centerPixel = await readGifPixel(ffmpegPath, rendered.beforeGifPath, 243, 200);
				const rightPixel = await readGifPixel(ffmpegPath, rendered.beforeGifPath, 470, 200);
				if (anchor === 'left') {
					assert.ok(isBackground(leftPixel), `${anchor} left pixel ${leftPixel}`);
					assert.ok(isContent(rightPixel), `${anchor} right pixel ${rightPixel}`);
				} else if (anchor === 'right') {
					assert.ok(isContent(leftPixel), `${anchor} left pixel ${leftPixel}`);
					assert.ok(isBackground(rightPixel), `${anchor} right pixel ${rightPixel}`);
				} else {
					assert.ok(isBackground(leftPixel), `${anchor} left pixel ${leftPixel}`);
					assert.ok(isContent(centerPixel), `${anchor} center pixel ${centerPixel}`);
					assert.ok(isBackground(rightPixel), `${anchor} right pixel ${rightPixel}`);
				}
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
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

async function readGifPixel(
	executablePath: string,
	gifPath: string,
	x: number,
	y: number,
): Promise<[number, number, number]> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const child = spawn(executablePath, [
			'-v', 'error',
			'-ignore_loop', '1',
			'-sseof', '-0.05',
			'-i', gifPath,
			'-vf', `crop=1:1:${x}:${y},format=rgb24`,
			'-frames:v', '1',
			'-f', 'rawvideo',
			'pipe:1',
		], { windowsHide: true });
		child.stdout.on('data', data => chunks.push(Buffer.from(data)));
		child.once('error', reject);
		child.once('exit', code => {
			const pixel = Buffer.concat(chunks);
			code === 0 && pixel.length >= 3
				? resolve([pixel[0], pixel[1], pixel[2]])
				: reject(new Error(`Pixel sampling FFmpeg exited with ${code}.`));
		});
	});
}

function isContent([red, green, blue]: [number, number, number]): boolean {
	return red > 140 && red > green * 1.5 && red > blue * 1.5;
}

function isBackground([red, green, blue]: [number, number, number]): boolean {
	return Math.abs(red - 48) < 30 && Math.abs(green - 54) < 30 && Math.abs(blue - 61) < 30;
}

async function createPatternVideo(executablePath: string, outputPath: string, source: 'testsrc2' | 'smptebars'): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(executablePath, [
			'-y',
			'-f', 'lavfi',
			'-i', `${source}=size=640x480:rate=25:duration=1`,
			'-pix_fmt', 'yuv420p',
			outputPath,
		], { windowsHide: true });
		child.once('error', reject);
		child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Pattern FFmpeg exited with ${code}.`)));
	});
}