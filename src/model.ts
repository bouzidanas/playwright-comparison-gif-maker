export interface Viewport {
	width: number;
	height: number;
}

export interface CaptureRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type ComparisonLayout = 'auto' | 'horizontal' | 'vertical';
export type ResolvedComparisonLayout = Exclude<ComparisonLayout, 'auto'>;
export type ComparisonOutputMode = 'animation' | 'image';
export type BrowserColorScheme = 'light' | 'dark' | 'system';
export type ResizeAnchor = 'left' | 'right' | 'both';
export type LabelAlignment = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type ScenarioAction =
	| { type: 'goto'; path?: string; holdAfterMs?: number }
	| { type: 'click'; locator: string; holdAfterMs?: number }
	| { type: 'hover'; locator: string; holdAfterMs?: number }
	| { type: 'fill'; locator: string; value: string; holdAfterMs?: number }
	| { type: 'press'; locator: string; key: string; holdAfterMs?: number }
	| { type: 'scroll'; locator?: string; deltaX?: number; deltaY: number; holdAfterMs?: number }
	| { type: 'resize'; width: number; height: number; anchor?: ResizeAnchor; durationMs?: number; holdAfterMs?: number }
	| { type: 'zoom'; locator?: string; scale?: number; durationMs?: number; holdAfterMs?: number }
	| { type: 'waitFor'; locator: string; state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeoutMs?: number; holdAfterMs?: number }
	| { type: 'hold'; durationMs: number };

export interface ComparisonScenario {
	name: string;
	actions: ScenarioAction[];
}

export interface ComparisonRequest {
	outputMode?: ComparisonOutputMode;
	frameRate?: number;
	colorScheme?: BrowserColorScheme;
	beforeColorScheme?: BrowserColorScheme;
	afterColorScheme?: BrowserColorScheme;
	baseRef: string;
	startCommand: string;
	readyUrl: string;
	route?: string;
	installCommand?: string;
	beforeLabel?: string;
	afterLabel?: string;
	beforeLabelAlignment?: LabelAlignment;
	afterLabelAlignment?: LabelAlignment;
	borderColor?: string;
	focusLocator?: string;
	focusPadding?: number;
	layout?: ComparisonLayout;
	viewport?: Viewport;
	scenario: ComparisonScenario;
}

export interface ActionTiming {
	index: number;
	type: ScenarioAction['type'];
	startedAtMs: number;
	endedAtMs: number;
}

export interface ZoomCue {
	actionIndex: number;
	target?: CaptureRegion;
	scale: number;
	durationMs: number;
}

export interface ResizeCue {
	actionIndex: number;
	from: Viewport;
	to: Viewport;
	anchor: ResizeAnchor;
	durationMs: number;
}

export interface CaptureResult {
	videoPath: string;
	observedColorScheme: Exclude<BrowserColorScheme, 'system'>;
	timings: ActionTiming[];
	replayOffsetMs: number;
	recordingSize: Viewport;
	resizeCues: ResizeCue[];
	zoomCues: ZoomCue[];
	region?: CaptureRegion;
}

export interface StaticCaptureResult {
	imagePath: string;
	observedColorScheme: Exclude<BrowserColorScheme, 'system'>;
	recordingSize: Viewport;
	resizeCues: ResizeCue[];
	zoomCues: ZoomCue[];
	region?: CaptureRegion;
}

interface ComparisonResultBase {
	sessionId: string;
	sessionDirectory: string;
	comparisonPath: string;
	beforePath: string;
	afterPath: string;
	baseSha: string;
	candidateSha?: string;
	candidateDirty: boolean;
	beforeLabel: string;
	afterLabel: string;
	beforeColorScheme: BrowserColorScheme;
	afterColorScheme: BrowserColorScheme;
	beforeObservedColorScheme: Exclude<BrowserColorScheme, 'system'>;
	afterObservedColorScheme: Exclude<BrowserColorScheme, 'system'>;
	layout: ResolvedComparisonLayout;
}

export interface AnimationComparisonResult extends ComparisonResultBase {
	outputMode: 'animation';
	frameRate: number;
	gifPath: string;
	beforeGifPath: string;
	afterGifPath: string;
	beforeVideoPath: string;
	afterVideoPath: string;
}

export interface ImageComparisonResult extends ComparisonResultBase {
	outputMode: 'image';
	imagePath: string;
	beforeImagePath: string;
	afterImagePath: string;
}

export type ComparisonResult = AnimationComparisonResult | ImageComparisonResult;

export function validateComparisonRequest(request: ComparisonRequest): void {
	if (!request.baseRef.trim()) {
		throw new Error('A base Git ref is required.');
	}
	if (!request.startCommand.trim()) {
		throw new Error('A start command is required.');
	}
	if (!request.readyUrl.trim()) {
		throw new Error('A readiness URL is required.');
	}
	if (!request.scenario.name.trim()) {
		throw new Error('The scenario must have a name.');
	}
	if ((request.outputMode ?? 'animation') === 'animation' && request.scenario.actions.length === 0) {
		throw new Error('The scenario must contain at least one action.');
	}
	if (request.outputMode === 'image' && request.scenario.actions.length > 0) {
		throw new Error('Static image comparisons cannot contain actions. Use animation mode whenever anything happens or changes.');
	}
	if (request.frameRate !== undefined) {
		if ((request.outputMode ?? 'animation') === 'image') {
			throw new Error('Frame rate is only available for animated GIF comparisons.');
		}
		if (!Number.isInteger(request.frameRate) || request.frameRate < 5 || request.frameRate > 30) {
			throw new Error('Frame rate must be an integer between 5 and 30 fps.');
		}
	}
	request.scenario.actions.forEach((action, index) => validateAction(action, index));
	if (request.focusPadding !== undefined && (!Number.isFinite(request.focusPadding) || request.focusPadding < 0 || request.focusPadding > 256)) {
		throw new Error('Focus padding must be between 0 and 256 pixels.');
	}
	if (request.layout && !['auto', 'horizontal', 'vertical'].includes(request.layout)) {
		throw new Error(`Unsupported comparison layout "${request.layout}".`);
	}
	for (const [name, alignment] of [
		['Before label', request.beforeLabelAlignment],
		['After label', request.afterLabelAlignment],
	] as const) {
		if (alignment && !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(alignment)) {
			throw new Error(`${name} alignment "${alignment}" is unsupported.`);
		}
	}
	if (request.borderColor && !/^#[0-9a-f]{6}$/i.test(request.borderColor)) {
		throw new Error('Border color must be a six-digit hex color such as #30363d.');
	}
	for (const [name, colorScheme] of [
		['Color scheme', request.colorScheme],
		['Before color scheme', request.beforeColorScheme],
		['After color scheme', request.afterColorScheme],
	] as const) {
		if (colorScheme && !['light', 'dark', 'system'].includes(colorScheme)) {
			throw new Error(`${name} "${colorScheme}" is unsupported.`);
		}
	}

	const viewport = request.viewport ?? { width: 1280, height: 720 };
	validateViewport(viewport, 'The viewport');
}

function validateAction(action: ScenarioAction, index: number): void {
	const invalid = (message: string): never => {
		throw new Error(`Scenario action ${index + 1} ${message}`);
	};
	if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
		invalid('must be an object with a type.');
	}
	if ('holdAfterMs' in action && action.holdAfterMs !== undefined && (!Number.isFinite(action.holdAfterMs) || action.holdAfterMs < 0)) {
		invalid('has an invalid holdAfterMs value.');
	}

	switch (action.type) {
		case 'goto':
			return;
		case 'click':
		case 'hover':
			if (!action.locator?.trim()) {
				invalid('requires a locator.');
			}
			return;
		case 'fill':
			if (!action.locator?.trim() || typeof action.value !== 'string') {
				invalid('requires a locator and string value.');
			}
			return;
		case 'press':
			if (!action.locator?.trim() || !action.key?.trim()) {
				invalid('requires a locator and key.');
			}
			return;
		case 'scroll':
			if (!Number.isFinite(action.deltaY)) {
				invalid('requires a numeric deltaY.');
			}
			return;
		case 'resize':
			validateViewport(action, `Scenario action ${index + 1} resize`);
			if (action.anchor && !['left', 'right', 'both'].includes(action.anchor)) {
				invalid(`has unsupported anchor "${action.anchor}".`);
			}
			if (action.durationMs !== undefined && (!Number.isFinite(action.durationMs) || action.durationMs < 0 || action.durationMs > 10_000)) {
				invalid('requires durationMs between 0 and 10000.');
			}
			return;
		case 'zoom': {
			const scale = action.scale ?? (action.locator ? 1.8 : 1);
			if (!Number.isFinite(scale) || scale < 1 || scale > 4) {
				invalid('requires scale between 1 and 4.');
			}
			if (scale > 1 && !action.locator?.trim()) {
				invalid('requires a locator when scale is greater than 1.');
			}
			if (action.durationMs !== undefined && (!Number.isFinite(action.durationMs) || action.durationMs < 0 || action.durationMs > 10_000)) {
				invalid('requires durationMs between 0 and 10000.');
			}
			return;
		}
		case 'waitFor':
			if (!action.locator?.trim()) {
				invalid('requires a locator.');
			}
			return;
		case 'hold':
			if (!Number.isFinite(action.durationMs) || action.durationMs < 0) {
				invalid('requires a nonnegative durationMs.');
			}
			return;
		default:
			invalid(`has unsupported type "${(action as { type: string }).type}".`);
	}
}

export function expandPortTemplate(value: string, port: number): string {
	return value.replaceAll('{port}', String(port));
}

function validateViewport(viewport: Viewport, subject: string): void {
	if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width < 320 || viewport.height < 240) {
		throw new Error(`${subject} must be at least 320 by 240 pixels.`);
	}
	if (viewport.width > 3840 || viewport.height > 2160) {
		throw new Error(`${subject} cannot exceed 3840 by 2160 pixels.`);
	}
}