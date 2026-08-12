import * as path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import * as vscode from 'vscode';
import type { ActionTiming, BrowserColorScheme, CaptureRegion, CaptureResult, ComparisonScenario, ResizeCue, ScenarioAction, StaticCaptureResult, Viewport, ZoomCue } from './model';
import { resolveResizeMode } from './model';

const RESIZE_LEAD_IN_MS = 100;
const BEACON_VISIBLE_MS = 150;
const BEACON_SETTLE_MS = 200;

export const SYNC_BEACON_COLOR = '#ff00ff';

export const INITIAL_POINTER_STYLE = {
	left: '-32px',
	opacity: '0',
	top: '-32px',
} as const;

export async function captureScenario(
	baseUrl: string,
	route: string | undefined,
	scenario: ComparisonScenario,
	viewport: Viewport,
	colorScheme: BrowserColorScheme,
	focusLocator: string | undefined,
	focusPadding: number,
	frameRate: number,
	outputDirectory: string,
	token: vscode.CancellationToken,
): Promise<CaptureResult> {
	const browser = await launchBrowser();
	try {
		const recordingSize = getRecordingSize(viewport, scenario);
		const context = await browser.newContext({
			viewport,
			colorScheme: resolvePlaywrightColorScheme(colorScheme),
			recordVideo: { dir: outputDirectory, size: recordingSize },
		});
		const page = await context.newPage();
		const captureStartedAt = performance.now();
		const video = page.video();
		const initialUrl = new URL(route || '/', baseUrl).toString();
		await page.goto(initialUrl, { waitUntil: 'networkidle' });
		const observedColorScheme = await readObservedColorScheme(page);
		await installCursorOverlay(page);
		const regionSamples: CaptureRegion[] = [];
		const resizeCues: ResizeCue[] = [];
		const zoomCues: ZoomCue[] = [];
		if (focusLocator) {
			await page.locator(focusLocator).waitFor({ state: 'visible' });
			const initialRegion = await measureFocusRegion(page, focusLocator, focusPadding);
			if (!initialRegion) {
				throw new Error(`Focus locator "${focusLocator}" did not have visible bounds.`);
			}
			regionSamples.push(initialRegion);
		}
		const beaconAtMs = await flashSyncBeacon(page, captureStartedAt);
		const replayOffsetMs = performance.now() - captureStartedAt;
		const timings = await replayScenario(page, baseUrl, scenario, focusLocator, focusPadding, regionSamples, resizeCues, zoomCues, frameRate, outputDirectory, token);
		await context.close();
		if (!video) {
			throw new Error('Playwright did not create a video for the comparison.');
		}
		return {
			videoPath: await video.path(),
			observedColorScheme,
			timings,
			replayOffsetMs,
			beaconAtMs,
			recordingSize,
			resizeCues,
			zoomCues,
			region: unionRegions(regionSamples),
		};
	} finally {
		await browser.close();
	}
}

export async function captureStaticScenario(
	baseUrl: string,
	route: string | undefined,
	scenario: ComparisonScenario,
	viewport: Viewport,
	colorScheme: BrowserColorScheme,
	focusLocator: string | undefined,
	focusPadding: number,
	outputDirectory: string,
	token: vscode.CancellationToken,
): Promise<StaticCaptureResult> {
	const browser = await launchBrowser();
	try {
		const recordingSize = getRecordingSize(viewport, scenario);
		const context = await browser.newContext({
			viewport,
			colorScheme: resolvePlaywrightColorScheme(colorScheme),
		});
		const page = await context.newPage();
		await page.goto(new URL(route || '/', baseUrl).toString(), { waitUntil: 'networkidle' });
		const observedColorScheme = await readObservedColorScheme(page);
		await installCursorOverlay(page);
		const resizeCues: ResizeCue[] = [];
		const zoomCues: ZoomCue[] = [];
		await replayScenario(page, baseUrl, scenario, undefined, focusPadding, [], resizeCues, zoomCues, 0, outputDirectory, token);
		let region: CaptureRegion | undefined;
		if (focusLocator) {
			await page.locator(focusLocator).waitFor({ state: 'visible' });
			region = await measureFocusRegion(page, focusLocator, focusPadding);
			if (!region) {
				throw new Error(`Focus locator "${focusLocator}" did not have visible bounds in the final state.`);
			}
		}
		// The synthetic pointer only explains motion, so a still frame should not keep it.
		await page.evaluate(() => document.querySelector('[data-pr-ui-compare-cursor]')?.remove());
		const imagePath = path.join(outputDirectory, 'screenshot.png');
		await page.screenshot({ path: imagePath });
		await context.close();
		return { imagePath, observedColorScheme, recordingSize, resizeCues, zoomCues, region };
	} finally {
		await browser.close();
	}
}

export function resolvePlaywrightColorScheme(colorScheme: BrowserColorScheme): 'light' | 'dark' | null {
	return colorScheme === 'system' ? null : colorScheme;
}

async function readObservedColorScheme(page: Page): Promise<'light' | 'dark'> {
	return page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

async function launchBrowser(): Promise<Browser> {
	const failures: string[] = [];
	try {
		return await chromium.launch({ headless: true });
	} catch (error) {
		failures.push(`managed Chromium: ${error instanceof Error ? error.message : String(error)}`);
	}
	const allowSystemBrowser = vscode.workspace.getConfiguration('prUiCompare').get<boolean>('allowSystemBrowser', false);
	if (!allowSystemBrowser) {
		throw new Error(
			'No managed Chromium installation was found. Run "PR UI Compare: Install Managed Chromium" and retry. ' +
			'System browsers are disabled by default so VS Code does not launch an application from the system Applications folder.\n' +
			failures.join('\n'),
		);
	}
	for (const channel of ['chrome', 'msedge'] as const) {
		try {
			return await chromium.launch({ channel, headless: true });
		} catch (error) {
			failures.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	throw new Error(
		'PR UI Compare could not launch managed Chromium, Google Chrome, or Microsoft Edge.\n' +
		failures.join('\n'),
	);
}

async function replayScenario(
	page: Page,
	baseUrl: string,
	scenario: ComparisonScenario,
	focusLocator: string | undefined,
	focusPadding: number,
	regionSamples: CaptureRegion[],
	resizeCues: ResizeCue[],
	zoomCues: ZoomCue[],
	frameRate: number,
	outputDirectory: string,
	token: vscode.CancellationToken,
): Promise<ActionTiming[]> {
	const timings: ActionTiming[] = [];
	const recordingStartedAt = performance.now();
	for (const [index, action] of scenario.actions.entries()) {
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const startedAtMs = performance.now() - recordingStartedAt;
		let activeLiveResizeCue: ResizeCue | undefined;
		let stopMotionResize = false;
		if (action.type === 'resize') {
			const from = page.viewportSize();
			if (!from) {
				throw new Error('The browser viewport is unavailable before resize.');
			}
			const durationMs = action.durationMs ?? 800;
			stopMotionResize = frameRate > 0 && durationMs > 0 && (action.captureStrategy ?? 'stop-motion') === 'stop-motion';
			if (stopMotionResize) {
				resizeCues.push(await captureStopMotionResize(
					page,
					index,
					from,
					{ width: action.width, height: action.height },
					resolveResizeMode(action),
					durationMs,
					frameRate,
					outputDirectory,
					recordingStartedAt,
					token,
				));
			} else {
				activeLiveResizeCue = {
					actionIndex: index,
					from,
					to: { width: action.width, height: action.height },
					resizeMode: resolveResizeMode(action),
					delayMs: RESIZE_LEAD_IN_MS,
					durationMs,
				};
				resizeCues.push(activeLiveResizeCue);
			}
		}
		if (action.type === 'zoom') {
			const scale = action.scale ?? (action.locator ? 1.8 : 1);
			let target: CaptureRegion | undefined;
			if (action.locator) {
				await page.locator(action.locator).waitFor({ state: 'visible' });
				target = await measureElementRegion(page, action.locator);
				if (!target) {
					throw new Error(`Zoom locator "${action.locator}" did not have visible bounds.`);
				}
			}
			zoomCues.push({ actionIndex: index, target, scale, durationMs: action.durationMs ?? 800 });
		}
		if (!stopMotionResize) {
			await performAction(page, baseUrl, action);
		}
		if (activeLiveResizeCue) {
			activeLiveResizeCue.durationMs = Math.max(0, performance.now() - recordingStartedAt - startedAtMs - activeLiveResizeCue.delayMs);
		}
		const holdAfterMs = 'holdAfterMs' in action ? action.holdAfterMs : undefined;
		if (holdAfterMs) {
			await page.waitForTimeout(holdAfterMs);
		}
		if (focusLocator) {
			const region = await measureFocusRegion(page, focusLocator, focusPadding);
			if (region) {
				regionSamples.push(region);
			}
		}
		timings.push({
			index,
			type: action.type,
			startedAtMs,
			endedAtMs: performance.now() - recordingStartedAt,
		});
	}
	return timings;
}

async function measureFocusRegion(
	page: Page,
	locator: string,
	padding: number,
): Promise<CaptureRegion | undefined> {
	const box = await page.locator(locator).boundingBox();
	if (!box) {
		return undefined;
	}
	const viewport = page.viewportSize();
	if (!viewport) {
		return undefined;
	}
	const x = Math.max(0, box.x - padding);
	const y = Math.max(0, box.y - padding);
	const right = Math.min(viewport.width, box.x + box.width + padding);
	const bottom = Math.min(viewport.height, box.y + box.height + padding);
	return { x, y, width: right - x, height: bottom - y };
}

async function measureElementRegion(page: Page, locator: string): Promise<CaptureRegion | undefined> {
	const box = await page.locator(locator).boundingBox();
	if (!box) {
		return undefined;
	}
	return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function unionRegions(regions: CaptureRegion[]): CaptureRegion | undefined {
	if (regions.length === 0) {
		return undefined;
	}
	const x = Math.min(...regions.map(region => region.x));
	const y = Math.min(...regions.map(region => region.y));
	const right = Math.max(...regions.map(region => region.x + region.width));
	const bottom = Math.max(...regions.map(region => region.y + region.height));
	return { x, y, width: right - x, height: bottom - y };
}

async function performAction(page: Page, baseUrl: string, action: ScenarioAction): Promise<void> {
	switch (action.type) {
		case 'goto':
			await page.goto(new URL(action.path || '/', baseUrl).toString(), { waitUntil: 'networkidle' });
			await installCursorOverlay(page);
			return;
		case 'click': {
			const locator = page.locator(action.locator);
			await moveCursorTo(locator);
			await locator.click();
			return;
		}
		case 'hover': {
			const locator = page.locator(action.locator);
			await moveCursorTo(locator);
			await locator.hover();
			return;
		}
		case 'fill':
			await page.locator(action.locator).fill(action.value);
			return;
		case 'press':
			await page.locator(action.locator).press(action.key);
			return;
		case 'scroll':
			if (action.locator) {
				await page.locator(action.locator).evaluate((element, delta) => element.scrollBy(delta.x, delta.y), {
					x: action.deltaX ?? 0,
					y: action.deltaY,
				});
			} else {
				await page.mouse.wheel(action.deltaX ?? 0, action.deltaY);
			}
			return;
		case 'resize':
			await animateViewportResize(page, action.width, action.height, action.durationMs ?? 800);
			return;
		case 'zoom':
			await page.waitForTimeout(action.durationMs ?? 800);
			return;
		case 'waitFor':
			await page.locator(action.locator).waitFor({ state: action.state, timeout: action.timeoutMs });
			return;
		case 'hold':
			await page.waitForTimeout(action.durationMs);
			return;
	}
}

async function animateViewportResize(page: Page, width: number, height: number, durationMs: number): Promise<void> {
	const start = page.viewportSize();
	if (!start || durationMs === 0) {
		await page.setViewportSize({ width, height });
		return;
	}
	await page.waitForTimeout(RESIZE_LEAD_IN_MS);
	const steps = Math.max(1, Math.min(600, Math.ceil(durationMs / (1000 / 60))));
	for (let step = 1; step <= steps; step += 1) {
		const progress = 0.5 - 0.5 * Math.cos(Math.PI * step / steps);
		await page.setViewportSize({
			width: Math.round(start.width + (width - start.width) * progress),
			height: Math.round(start.height + (height - start.height) * progress),
		});
		await page.waitForTimeout(durationMs / steps);
	}
}

async function captureStopMotionResize(
	page: Page,
	actionIndex: number,
	from: Viewport,
	to: Viewport,
	resizeMode: ResizeCue['resizeMode'],
	durationMs: number,
	frameRate: number,
	outputDirectory: string,
	recordingStartedAt: number,
	token: vscode.CancellationToken,
): Promise<ResizeCue> {
	const frameTotal = Math.max(2, Math.round(durationMs * frameRate / 1000));
	const framePaths: string[] = [];
	const frameSizes: Viewport[] = [];
	for (let frame = 0; frame < frameTotal; frame += 1) {
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const progress = 0.5 - 0.5 * Math.cos(Math.PI * frame / (frameTotal - 1));
		const size = {
			width: Math.round(from.width + (to.width - from.width) * progress),
			height: Math.round(from.height + (to.height - from.height) * progress),
		};
		await page.setViewportSize(size);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const framePath = path.join(outputDirectory, `resize-${actionIndex}-frame-${String(frame).padStart(4, '0')}.png`);
		await page.screenshot({ path: framePath, animations: 'allow' });
		framePaths.push(framePath);
		frameSizes.push(size);
	}
	return {
		actionIndex,
		from,
		to,
		resizeMode,
		delayMs: 0,
		durationMs: frameTotal * 1000 / frameRate,
		stopMotion: {
			framePaths,
			frameSizes,
			transitionEndMs: performance.now() - recordingStartedAt,
		},
	};
}

async function flashSyncBeacon(page: Page, captureStartedAt: number): Promise<number> {
	await page.evaluate(color => {
		const beacon = document.createElement('div');
		beacon.dataset.prUiCompareBeacon = '';
		Object.assign(beacon.style, {
			background: color,
			inset: '0',
			pointerEvents: 'none',
			position: 'fixed',
			zIndex: '2147483647',
		});
		document.documentElement.appendChild(beacon);
	}, SYNC_BEACON_COLOR);
	const beaconAtMs = performance.now() - captureStartedAt;
	await page.waitForTimeout(BEACON_VISIBLE_MS);
	await page.evaluate(() => document.querySelector('[data-pr-ui-compare-beacon]')?.remove());
	await page.waitForTimeout(BEACON_SETTLE_MS);
	return beaconAtMs;
}

export function getRecordingSize(viewport: Viewport, scenario: ComparisonScenario): Viewport {
	return scenario.actions.reduce((size, action) => {
		if (action.type !== 'resize') {
			return size;
		}
		return {
			width: Math.max(size.width, action.width),
			height: Math.max(size.height, action.height),
		};
	}, viewport);
}

async function installCursorOverlay(page: Page): Promise<void> {
	await page.evaluate(initialPointerStyle => {
		if (document.querySelector('[data-pr-ui-compare-cursor]')) {
			return;
		}
		const cursor = document.createElement('div');
		cursor.dataset.prUiCompareCursor = '';
		Object.assign(cursor.style, {
			background: '#ffffff',
			border: '2px solid #111111',
			borderRadius: '50%',
			boxShadow: '0 1px 4px rgb(0 0 0 / 45%)',
			height: '16px',
			left: initialPointerStyle.left,
			opacity: initialPointerStyle.opacity,
			pointerEvents: 'none',
			position: 'fixed',
			top: initialPointerStyle.top,
			transform: 'translate(-50%, -50%)',
			transition: 'left 180ms ease, top 180ms ease, opacity 120ms ease',
			width: '16px',
			zIndex: '2147483647',
		});
		document.documentElement.appendChild(cursor);
	}, INITIAL_POINTER_STYLE);
}

async function moveCursorTo(locator: Locator): Promise<void> {
	await locator.waitFor({ state: 'visible' });
	const box = await locator.boundingBox();
	if (!box) {
		return;
	}
	await locator.page().evaluate(({ x, y }) => {
		const cursor = document.querySelector<HTMLElement>('[data-pr-ui-compare-cursor]');
		if (cursor) {
			const firstAppearance = cursor.dataset.visible !== 'true';
			if (firstAppearance) {
				cursor.style.transition = 'none';
			}
			cursor.style.left = `${x}px`;
			cursor.style.top = `${y}px`;
			if (firstAppearance) {
				cursor.getBoundingClientRect();
				cursor.dataset.visible = 'true';
				cursor.style.transition = 'left 180ms ease, top 180ms ease, opacity 120ms ease';
				cursor.style.opacity = '1';
			}
		}
	}, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
	await locator.page().waitForTimeout(200);
}

export function captureDirectory(sessionDirectory: string, side: 'before' | 'after'): string {
	return path.join(sessionDirectory, `${side}-capture`);
}