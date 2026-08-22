import * as assert from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import * as vscode from 'vscode';
import { ComparisonRunner } from '../comparisonRunner';
import type { ComparisonRequest } from '../model';

const execFileAsync = promisify(execFile);

suite('Comparison runner end to end', function () {
	this.timeout(180_000);

	test('records and renders a dirty working tree against HEAD', async function () {
		if (process.env.PR_UI_COMPARE_E2E !== '1') {
			this.skip();
		}

		const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-repo-'));
		const storagePath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-storage-'));
		const output = vscode.window.createOutputChannel('PR UI Compare E2E');
		try {
			await createFixtureRepository(repositoryPath);
			const request: ComparisonRequest = {
				baseRef: 'HEAD',
				startCommand: 'node server.js {port}',
				readyUrl: 'http://127.0.0.1:{port}',
				beforeLabel: 'Before',
				afterLabel: 'After',
				beforeLabelAlignment: 'bottom-left',
				afterLabelAlignment: 'bottom-right',
				borderColor: '#2f81f7',
				colorScheme: 'light',
				frameRate: 30,
				viewport: { width: 640, height: 480 },
				scenario: {
					name: 'Responsive panel fix',
					setupActions: [
						{ type: 'click', locator: 'role=button[name="Toggle panel"]' },
						{ type: 'waitFor', locator: '#panel.open', state: 'visible', holdAfterMs: 200 },
					],
					actions: [
						{ type: 'hold', durationMs: 300 },
						{ type: 'resize', width: 360, height: 480, resizeMode: 'keep-right-edge-fixed', durationMs: 500, holdAfterMs: 300 },
						{ type: 'resize', width: 640, height: 480, resizeMode: 'keep-right-edge-fixed', durationMs: 500, holdAfterMs: 300 },
						{ type: 'resize', width: 360, height: 480, resizeMode: 'keep-left-edge-fixed', durationMs: 500, holdAfterMs: 300 },
						{ type: 'resize', width: 640, height: 480, resizeMode: 'keep-left-edge-fixed', durationMs: 500, holdAfterMs: 300 },
						{ type: 'zoom', locator: 'role=button[name="Toggle panel"]', scale: 1.8, durationMs: 500, holdAfterMs: 300 },
						{ type: 'click', locator: 'role=button[name="Toggle panel"]', holdAfterMs: 700 },
						{ type: 'zoom', scale: 1, durationMs: 500, holdAfterMs: 300 },
					],
				},
			};
			const runner = new ComparisonRunner(storagePath, output);
			const result = await runner.run(
				repositoryPath,
				request,
				new vscode.CancellationTokenSource().token,
				() => undefined,
			);

			assert.strictEqual(result.candidateDirty, true);
			if (result.outputMode !== 'animation') {
				assert.fail('Expected an animation comparison result.');
			}
			assert.strictEqual(result.layout, 'horizontal');
			assert.strictEqual(result.frameRate, 30);
			assert.match(result.beforeLabel, /^Before \([0-9a-f]{8}\)$/);
			assert.match(result.afterLabel, /^After \([0-9a-f]{8}\)$/);
			assert.ok((await stat(result.gifPath)).size > 1_000);
			assert.ok((await stat(result.beforeGifPath)).size > 1_000);
			assert.ok((await stat(result.afterGifPath)).size > 1_000);
			if (!ffmpegPath) {
				assert.fail('No FFmpeg binary is available for end-to-end edge checks.');
			}
			const beforeBounds = await readGifPageBounds(ffmpegPath, result.beforeGifPath, 200);
			const afterBounds = await readGifPageBounds(ffmpegPath, result.afterGifPath, 200);
			assert.strictEqual(beforeBounds.length, afterBounds.length);
			assert.ok(beforeBounds.length > 10);
			for (const [frame, beforeBound] of beforeBounds.entries()) {
				const afterBound = afterBounds[frame];
				assert.ok(Math.abs(beforeBound.min - afterBound.min) <= 2, `Left edges differ at frame ${frame}: ${beforeBound.min} and ${afterBound.min}.`);
				assert.ok(Math.abs(beforeBound.max - afterBound.max) <= 2, `Right edges differ at frame ${frame}: ${beforeBound.max} and ${afterBound.max}.`);
				assert.ok(beforeBound.min <= 5 || beforeBound.max >= 480, `Page lost both anchors at frame ${frame}: ${beforeBound.min} to ${beforeBound.max}.`);
			}
			const session = JSON.parse(await readFile(path.join(result.sessionDirectory, 'session.json'), 'utf8')) as {
				timings: { before: unknown[]; after: unknown[] };
			};
			assert.strictEqual(session.timings.before.length, 8);
			assert.strictEqual(session.timings.after.length, 8);
			await assert.rejects(stat(path.join(result.sessionDirectory, 'before-worktree')));
		} finally {
			output.dispose();
			await rm(repositoryPath, { recursive: true, force: true });
			await rm(storagePath, { recursive: true, force: true });
		}
	});

	test('captures and composes final-state PNG images', async function () {
		if (process.env.PR_UI_COMPARE_E2E !== '1') {
			this.skip();
		}

		const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-image-repo-'));
		const storagePath = await mkdtemp(path.join(os.tmpdir(), 'pr-ui-compare-image-storage-'));
		const output = vscode.window.createOutputChannel('PR UI Compare Image E2E');
		try {
			await createFixtureRepository(repositoryPath);
			const request: ComparisonRequest = {
				outputMode: 'image',
				baseRef: 'HEAD',
				startCommand: 'node server.js {port}',
				readyUrl: 'http://127.0.0.1:{port}',
				beforeLabel: 'Before',
				afterLabel: 'After',
				beforeColorScheme: 'light',
				afterColorScheme: 'dark',
				borderColor: '#30363d',
				viewport: { width: 640, height: 480 },
				scenario: {
					name: 'Static panel comparison',
					actions: [
						{ type: 'click', locator: 'role=button[name="Toggle panel"]' },
						{ type: 'waitFor', locator: '#panel.open', state: 'visible', holdAfterMs: 400 },
					],
				},
			};
			const result = await new ComparisonRunner(storagePath, output).run(
				repositoryPath,
				request,
				new vscode.CancellationTokenSource().token,
				() => undefined,
			);
			if (result.outputMode !== 'image') {
				assert.fail('Expected an image comparison result.');
			}
			assert.strictEqual(result.comparisonPath, result.imagePath);
			assert.strictEqual(result.beforeColorScheme, 'light');
			assert.strictEqual(result.afterColorScheme, 'dark');
			assert.strictEqual(result.beforeObservedColorScheme, 'light');
			assert.strictEqual(result.afterObservedColorScheme, 'dark');
			for (const imagePath of [result.imagePath, result.beforeImagePath, result.afterImagePath]) {
				const image = await readFile(imagePath);
				assert.deepStrictEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
				assert.ok(image.length > 1_000);
			}
			const combined = await readFile(result.imagePath);
			assert.strictEqual(combined.readUInt32BE(16), 972);
			assert.strictEqual(combined.readUInt32BE(20), 366);
			const before = await readFile(result.beforeImagePath);
			assert.strictEqual(before.readUInt32BE(16), 486);
			assert.strictEqual(before.readUInt32BE(20), 366);
			if (!ffmpegPath) {
				assert.fail('No FFmpeg binary is available for end-to-end panel checks.');
			}
			const beforePanel = await readImageRowBounds(ffmpegPath, result.beforeImagePath, 486, 150);
			const afterPanel = await readImageRowBounds(ffmpegPath, result.afterImagePath, 486, 150);
			const beforePanelWidth = beforePanel.max - beforePanel.min;
			const afterPanelWidth = afterPanel.max - afterPanel.min;
			assert.ok(beforePanelWidth > 120, `The setup click did not open the Before panel: ${beforePanelWidth} pixels wide.`);
			assert.ok(
				afterPanelWidth > beforePanelWidth * 1.3,
				`The opened panel widths do not reflect the fix: ${beforePanelWidth} and ${afterPanelWidth} pixels.`,
			);
			await assert.rejects(stat(path.join(result.sessionDirectory, 'before-worktree')));
		} finally {
			output.dispose();
			await rm(repositoryPath, { recursive: true, force: true });
			await rm(storagePath, { recursive: true, force: true });
		}
	});
});

async function createFixtureRepository(repositoryPath: string): Promise<void> {
	await writeFile(path.join(repositoryPath, 'server.js'), `
const fs = require('node:fs');
const http = require('node:http');
const port = Number(process.argv[2]);
http.createServer((_request, response) => {
  response.setHeader('content-type', 'text/html');
  response.end(fs.readFileSync('index.html'));
}).listen(port, '127.0.0.1');
`, 'utf8');
	await writeFile(path.join(repositoryPath, 'index.html'), fixtureHtml('260px', '#c84b31', false), 'utf8');
	await execFileAsync('git', ['init'], { cwd: repositoryPath });
	await execFileAsync('git', ['add', '.'], { cwd: repositoryPath });
	await execFileAsync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'before'], {
		cwd: repositoryPath,
	});
	await writeFile(path.join(repositoryPath, 'index.html'), fixtureHtml('420px', '#2e7d5b', true), 'utf8');
}

function fixtureHtml(panelWidth: string, panelColor: string, delayResize: boolean): string {
	return `<!doctype html>
<html>
<head><style>
body { background: #f4f1ea; font: 18px sans-serif; margin: 40px; }
button { font: inherit; padding: 10px 16px; }
#toolbar { align-items: center; background: ${panelColor}; color: white; display: flex; gap: 24px; height: 52px; padding: 0 12px; width: 540px; }
#panel { background: ${panelColor}; color: white; height: 180px; margin-top: 20px; padding: 20px; transition: width 200ms; width: 100px; }
#panel.open { width: ${panelWidth}; }
@media (max-width: 480px) {
	#toolbar { width: calc(100vw - 104px); }
	#panel.open { width: calc(100vw - 120px); }
}
@media (prefers-color-scheme: dark) {
	body { background: #101418; color: #f0f3f6; }
}
</style></head>
<body>
<div id="toolbar"><button aria-label="Toggle panel" onclick="document.getElementById('panel').classList.toggle('open')">Toggle panel</button><span>Project navigation</span></div>
<div id="panel">Comparison fixture</div>
${delayResize ? `<script>
window.addEventListener('resize', () => {
	const end = performance.now() + 8;
	while (performance.now() < end) {}
});
</script>` : ''}
</body>
</html>`;
}

async function readGifPageBounds(
	executablePath: string,
	gifPath: string,
	y: number,
): Promise<Array<{ min: number; max: number }>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const child = spawn(executablePath, [
			'-v', 'error',
			'-ignore_loop', '1',
			'-i', gifPath,
			'-vf', `crop=iw:1:0:${y},format=rgb24`,
			'-f', 'rawvideo',
			'pipe:1',
		], { windowsHide: true });
		child.stdout.on('data', data => chunks.push(Buffer.from(data)));
		child.once('error', reject);
		child.once('exit', code => {
			const bytes = Buffer.concat(chunks);
			if (code !== 0 || bytes.length < 3) {
				reject(new Error(`GIF boundary sampling exited with ${code}.`));
				return;
			}
			const width = 486;
			const frameBytes = width * 3;
			const bounds: Array<{ min: number; max: number }> = [];
			for (let frameOffset = 0; frameOffset + frameBytes <= bytes.length; frameOffset += frameBytes) {
				const pagePixels: number[] = [];
				for (let x = 3; x <= 482; x += 1) {
					const offset = frameOffset + x * 3;
					if (isPagePixel([bytes[offset], bytes[offset + 1], bytes[offset + 2]])) {
						pagePixels.push(x);
					}
				}
				if (pagePixels.length === 0) {
					reject(new Error(`GIF frame ${bounds.length} did not contain page pixels.`));
					return;
				}
				bounds.push({ min: pagePixels[0], max: pagePixels.at(-1)! });
			}
			resolve(bounds);
		});
	});
}

function isPagePixel([red, green, blue]: [number, number, number]): boolean {
	const isBlueBorder = blue > 150 && blue > red * 1.4 && blue > green * 1.15;
	return !isBlueBorder && red + green + blue > 120;
}

/** Horizontal extent of the saturated panel color on one row, which neither background nor border reaches. */
async function readImageRowBounds(
	executablePath: string,
	imagePath: string,
	width: number,
	y: number,
): Promise<{ min: number; max: number }> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const child = spawn(executablePath, [
			'-v', 'error',
			'-i', imagePath,
			'-vf', `crop=iw:1:0:${y},format=rgb24`,
			'-f', 'rawvideo',
			'pipe:1',
		], { windowsHide: true });
		child.stdout.on('data', data => chunks.push(Buffer.from(data)));
		child.once('error', reject);
		child.once('exit', code => {
			const bytes = Buffer.concat(chunks);
			if (code !== 0 || bytes.length < width * 3) {
				reject(new Error(`Image row sampling exited with ${code}.`));
				return;
			}
			const matches: number[] = [];
			for (let x = 0; x < width; x += 1) {
				const offset = x * 3;
				const channels = [bytes[offset], bytes[offset + 1], bytes[offset + 2]];
				if (Math.max(...channels) - Math.min(...channels) > 40) {
					matches.push(x);
				}
			}
			if (matches.length === 0) {
				reject(new Error(`Image row ${y} of ${imagePath} did not contain panel pixels.`));
				return;
			}
			resolve({ min: matches[0], max: matches.at(-1)! });
		});
	});
}
