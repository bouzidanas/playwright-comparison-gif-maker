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

export type ScenarioAction =
	| { type: 'goto'; path?: string; holdAfterMs?: number }
	| { type: 'click'; locator: string; holdAfterMs?: number }
	| { type: 'hover'; locator: string; holdAfterMs?: number }
	| { type: 'fill'; locator: string; value: string; holdAfterMs?: number }
	| { type: 'press'; locator: string; key: string; holdAfterMs?: number }
	| { type: 'scroll'; locator?: string; deltaX?: number; deltaY: number; holdAfterMs?: number }
	| { type: 'waitFor'; locator: string; state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeoutMs?: number; holdAfterMs?: number }
	| { type: 'hold'; durationMs: number };

export interface ComparisonScenario {
	name: string;
	actions: ScenarioAction[];
}

export interface ComparisonRequest {
	baseRef: string;
	startCommand: string;
	readyUrl: string;
	route?: string;
	installCommand?: string;
	beforeLabel?: string;
	afterLabel?: string;
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

export interface CaptureResult {
	videoPath: string;
	timings: ActionTiming[];
	region?: CaptureRegion;
}

export interface ComparisonResult {
	sessionId: string;
	sessionDirectory: string;
	gifPath: string;
	beforeVideoPath: string;
	afterVideoPath: string;
	baseSha: string;
	candidateSha?: string;
	candidateDirty: boolean;
	layout: ResolvedComparisonLayout;
}

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
	if (request.scenario.actions.length === 0) {
		throw new Error('The scenario must contain at least one action.');
	}
	request.scenario.actions.forEach((action, index) => validateAction(action, index));
	if (request.focusPadding !== undefined && (!Number.isFinite(request.focusPadding) || request.focusPadding < 0 || request.focusPadding > 256)) {
		throw new Error('Focus padding must be between 0 and 256 pixels.');
	}
	if (request.layout && !['auto', 'horizontal', 'vertical'].includes(request.layout)) {
		throw new Error(`Unsupported comparison layout "${request.layout}".`);
	}

	const viewport = request.viewport ?? { width: 1280, height: 720 };
	if (viewport.width < 320 || viewport.height < 240) {
		throw new Error('The viewport must be at least 320 by 240 pixels.');
	}
	if (viewport.width > 3840 || viewport.height > 2160) {
		throw new Error('The viewport cannot exceed 3840 by 2160 pixels.');
	}
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