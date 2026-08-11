import * as path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import * as vscode from 'vscode';
import type { ActionTiming, CaptureRegion, CaptureResult, ComparisonScenario, ScenarioAction, Viewport } from './model';

export async function captureScenario(
	baseUrl: string,
	route: string | undefined,
	scenario: ComparisonScenario,
	viewport: Viewport,
	focusLocator: string | undefined,
	focusPadding: number,
	outputDirectory: string,
	token: vscode.CancellationToken,
): Promise<CaptureResult> {
	const browser = await launchBrowser();
	try {
		const recordingSize = getRecordingSize(viewport, scenario);
		const context = await browser.newContext({
			viewport,
			recordVideo: { dir: outputDirectory, size: recordingSize },
		});
		const page = await context.newPage();
		const captureStartedAt = performance.now();
		const video = page.video();
		const initialUrl = new URL(route || '/', baseUrl).toString();
		await page.goto(initialUrl, { waitUntil: 'networkidle' });
		await installCursorOverlay(page);
		const regionSamples: CaptureRegion[] = [];
		if (focusLocator) {
			await page.locator(focusLocator).waitFor({ state: 'visible' });
			const initialRegion = await measureFocusRegion(page, focusLocator, focusPadding);
			if (!initialRegion) {
				throw new Error(`Focus locator "${focusLocator}" did not have visible bounds.`);
			}
			regionSamples.push(initialRegion);
		}
		const replayOffsetMs = performance.now() - captureStartedAt;
		const timings = await replayScenario(page, baseUrl, scenario, focusLocator, focusPadding, regionSamples, token);
		await context.close();
		if (!video) {
			throw new Error('Playwright did not create a video for the comparison.');
		}
		return { videoPath: await video.path(), timings, replayOffsetMs, region: unionRegions(regionSamples) };
	} finally {
		await browser.close();
	}
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
	token: vscode.CancellationToken,
): Promise<ActionTiming[]> {
	const timings: ActionTiming[] = [];
	const recordingStartedAt = performance.now();
	for (const [index, action] of scenario.actions.entries()) {
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const startedAtMs = performance.now() - recordingStartedAt;
		await performAction(page, baseUrl, action);
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
	const steps = Math.max(1, Math.min(60, Math.ceil(durationMs / 50)));
	for (let step = 1; step <= steps; step += 1) {
		const progress = step / steps;
		await page.setViewportSize({
			width: Math.round(start.width + (width - start.width) * progress),
			height: Math.round(start.height + (height - start.height) * progress),
		});
		await page.waitForTimeout(durationMs / steps);
	}
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
	await page.evaluate(() => {
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
			left: '12px',
			pointerEvents: 'none',
			position: 'fixed',
			top: '12px',
			transform: 'translate(-50%, -50%)',
			transition: 'left 180ms ease, top 180ms ease',
			width: '16px',
			zIndex: '2147483647',
		});
		document.documentElement.appendChild(cursor);
	});
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
			cursor.style.left = `${x}px`;
			cursor.style.top = `${y}px`;
		}
	}, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
	await locator.page().waitForTimeout(200);
}

export function captureDirectory(sessionDirectory: string, side: 'before' | 'after'): string {
	return path.join(sessionDirectory, `${side}-capture`);
}