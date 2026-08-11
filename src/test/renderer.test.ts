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
					resizeMode: 'keep-window-centered' as const,
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

	test('keeps the selected edge fixed or keeps the window centered throughout resize', async () => {
		if (!ffmpegPath) {
			assert.fail('No FFmpeg binary is available for renderer tests.');
		}
		const directory = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-anchor-'));
		try {
			const before = path.join(directory, 'before.mp4');
			const after = path.join(directory, 'after.mp4');
			await createVideo(ffmpegPath, before, '0xc84b31');
			await createVideo(ffmpegPath, after, '0x2e7d5b');
			const beforeTimings = [{ index: 0, type: 'resize' as const, startedAtMs: 0, endedAtMs: 800 }];
			const afterTimings = [{ index: 0, type: 'resize' as const, startedAtMs: 0, endedAtMs: 1_100 }];
			for (const resizeMode of ['keep-right-edge-fixed', 'keep-left-edge-fixed', 'keep-window-centered'] as const) {
				const resizeCues = [{
					actionIndex: 0,
					from: { width: 640, height: 480 },
					to: { width: 360, height: 480 },
					resizeMode,
					durationMs: 800,
				}];
				const modeDirectory = path.join(directory, resizeMode);
				await mkdir(modeDirectory);
				const rendered = await renderComparisonGif(
					before,
					after,
					modeDirectory,
					'Before',
					'After',
					{ width: 640, height: 480 },
					undefined,
					undefined,
					beforeTimings,
					afterTimings,
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
				const middleBounds = await readGifFrameContentBounds(ffmpegPath, rendered.beforeGifPath, 9, 200);
				for (const frame of [4, 9, 14, 18]) {
					const beforeBounds = frame === 9
						? middleBounds
						: await readGifFrameContentBounds(ffmpegPath, rendered.beforeGifPath, frame, 200);
					const afterBounds = await readGifFrameContentBounds(ffmpegPath, rendered.afterGifPath, frame, 200, isAfterContent);
					assert.ok(Math.abs(beforeBounds.min - afterBounds.min) <= 2, `${resizeMode} left edges differ at frame ${frame}: ${beforeBounds.min} and ${afterBounds.min}`);
					assert.ok(Math.abs(beforeBounds.max - afterBounds.max) <= 2, `${resizeMode} right edges differ at frame ${frame}: ${beforeBounds.max} and ${afterBounds.max}`);
				}
				if (resizeMode === 'keep-right-edge-fixed') {
					const initialLeftPixel = await readGifFramePixel(ffmpegPath, rendered.beforeGifPath, 0, 20, 200);
					const middleLeftPixel = await readGifFramePixel(ffmpegPath, rendered.beforeGifPath, 9, 20, 200);
					const middleRightPixel = await readGifFramePixel(ffmpegPath, rendered.beforeGifPath, 9, 470, 200);
					assert.ok(isContent(initialLeftPixel), `${resizeMode} initial left pixel ${initialLeftPixel}`);
					assert.ok(isBackground(middleLeftPixel), `${resizeMode} middle left pixel ${middleLeftPixel}`);
					assert.ok(isContent(middleRightPixel), `${resizeMode} middle right pixel ${middleRightPixel}`);
					assert.ok(middleBounds.max >= 480, `left motion moved the fixed right edge to ${middleBounds.max}`);
					assert.ok(isBackground(leftPixel), `${resizeMode} left pixel ${leftPixel}`);
					assert.ok(isContent(rightPixel), `${resizeMode} right pixel ${rightPixel}`);
					const labelBounds = await readGifFrameWhiteBounds(ffmpegPath, rendered.beforeGifPath, 0, 8, 8, 150, 60);
					assert.ok(labelBounds.height >= 17, `label glyph height ${labelBounds.height} is below the readable floor`);
				} else if (resizeMode === 'keep-left-edge-fixed') {
					assert.ok(middleBounds.min <= 5, `right motion moved the fixed left edge to ${middleBounds.min}`);
					assert.ok(isContent(leftPixel), `${resizeMode} left pixel ${leftPixel}`);
					assert.ok(isBackground(rightPixel), `${resizeMode} right pixel ${rightPixel}`);
				} else {
					const leftSpace = middleBounds.min - 3;
					const rightSpace = 482 - middleBounds.max;
					assert.ok(Math.abs(leftSpace - rightSpace) <= 3, `centered motion spaces differ: ${leftSpace} and ${rightSpace}`);
					assert.ok(isBackground(leftPixel), `${resizeMode} left pixel ${leftPixel}`);
					assert.ok(isContent(centerPixel), `${resizeMode} center pixel ${centerPixel}`);
					assert.ok(isBackground(rightPixel), `${resizeMode} right pixel ${rightPixel}`);
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

async function readGifFramePixel(
	executablePath: string,
	gifPath: string,
	frame: number,
	x: number,
	y: number,
): Promise<[number, number, number]> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const child = spawn(executablePath, [
			'-v', 'error',
			'-ignore_loop', '1',
			'-i', gifPath,
			'-vf', `select=eq(n\\,${frame}),crop=1:1:${x}:${y},format=rgb24`,
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
				: reject(new Error(`GIF frame sampling exited with ${code}.`));
		});
	});
}

async function readGifFrameContentBounds(
	executablePath: string,
	gifPath: string,
	frame: number,
	y: number,
	isPageContent: (pixel: [number, number, number]) => boolean = isContent,
): Promise<{ min: number; max: number }> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const child = spawn(executablePath, [
			'-v', 'error',
			'-ignore_loop', '1',
			'-i', gifPath,
			'-vf', `select=eq(n\\,${frame}),format=rgb24,crop=iw:1:0:${y}`,
			'-frames:v', '1',
			'-f', 'rawvideo',
			'pipe:1',
		], { windowsHide: true });
		child.stdout.on('data', data => chunks.push(Buffer.from(data)));
		child.once('error', reject);
		child.once('exit', code => {
			const row = Buffer.concat(chunks);
			if (code !== 0 || row.length < 3) {
				reject(new Error(`GIF row sampling exited with ${code}.`));
				return;
			}
			const contentPixels: number[] = [];
			for (let offset = 0; offset < row.length; offset += 3) {
				if (isPageContent([row[offset], row[offset + 1], row[offset + 2]])) {
					contentPixels.push(offset / 3);
				}
			}
			if (contentPixels.length === 0) {
				reject(new Error(`GIF frame ${frame} did not contain the page color.`));
				return;
			}
			resolve({ min: contentPixels[0], max: contentPixels.at(-1)! });
		});
	});
}

async function readGifFrameWhiteBounds(
	executablePath: string,
	gifPath: string,
	frame: number,
	x: number,
	y: number,
	width: number,
	height: number,
): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const child = spawn(executablePath, [
			'-v', 'error',
			'-ignore_loop', '1',
			'-i', gifPath,
			'-vf', `select=eq(n\\,${frame}),crop=${width}:${height}:${x}:${y},format=rgb24`,
			'-frames:v', '1',
			'-f', 'rawvideo',
			'pipe:1',
		], { windowsHide: true });
		child.stdout.on('data', data => chunks.push(Buffer.from(data)));
		child.once('error', reject);
		child.once('exit', code => {
			const pixels = Buffer.concat(chunks);
			if (code !== 0 || pixels.length < width * height * 3) {
				reject(new Error(`GIF label sampling exited with ${code}.`));
				return;
			}
			const whiteX: number[] = [];
			const whiteY: number[] = [];
			for (let offset = 0; offset < pixels.length; offset += 3) {
				if (pixels[offset] > 220 && pixels[offset + 1] > 220 && pixels[offset + 2] > 220) {
					const pixel = offset / 3;
					whiteX.push(pixel % width);
					whiteY.push(Math.floor(pixel / width));
				}
			}
			if (whiteX.length === 0) {
				reject(new Error(`GIF frame ${frame} did not contain white label pixels.`));
				return;
			}
			resolve({
				width: Math.max(...whiteX) - Math.min(...whiteX) + 1,
				height: Math.max(...whiteY) - Math.min(...whiteY) + 1,
			});
		});
	});
}

function isContent([red, green, blue]: [number, number, number]): boolean {
	return red > 140 && red > green * 1.5 && red > blue * 1.5;
}

function isAfterContent([red, green, blue]: [number, number, number]): boolean {
	return green > 90 && green > red * 1.25 && green > blue * 1.15;
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