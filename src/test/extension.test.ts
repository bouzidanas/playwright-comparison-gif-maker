import * as assert from 'assert';
import { getRecordingSize, INITIAL_POINTER_STYLE, resolvePlaywrightColorScheme } from '../capture';
import { describeResizeOutcomes, expandPortTemplate, validateComparisonRequest, type ComparisonRequest } from '../model';
import { resolveComparisonLayout } from '../renderer';

suite('Comparison model', () => {
	const validRequest: ComparisonRequest = {
		baseRef: 'upstream/main',
		startCommand: 'npm run dev -- --port {port}',
		readyUrl: 'http://127.0.0.1:{port}',
		scenario: {
			name: 'Menu fix',
			actions: [{ type: 'click', locator: 'role=button[name="Menu"]' }],
		},
	};

	test('accepts a complete request', () => {
		assert.doesNotThrow(() => validateComparisonRequest(validRequest));
	});

	test('maps browser color scheme modes to Playwright emulation', () => {
		assert.strictEqual(resolvePlaywrightColorScheme('light'), 'light');
		assert.strictEqual(resolvePlaywrightColorScheme('dark'), 'dark');
		assert.strictEqual(resolvePlaywrightColorScheme('system'), null);
	});

	test('starts the synthetic pointer outside the visible page', () => {
		assert.deepStrictEqual(INITIAL_POINTER_STYLE, {
			left: '-32px',
			opacity: '0',
			top: '-32px',
		});
	});

	test('rejects an empty scenario', () => {
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, scenario: { name: 'Empty', actions: [] } }),
			/at least one action/,
		);
	});

	test('accepts an empty scenario for a route-only image comparison', () => {
		assert.doesNotThrow(() => validateComparisonRequest({
			...validRequest,
			outputMode: 'image',
			scenario: { name: 'Static route', actions: [] },
		}));
	});

	test('rejects actions in static image mode', () => {
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, outputMode: 'image' }),
			/cannot contain actions/,
		);
	});

	test('validates animation frame rate', () => {
		assert.doesNotThrow(() => validateComparisonRequest({ ...validRequest, frameRate: 30 }));
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, frameRate: 60 }),
			/integer between 5 and 30/,
		);
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				outputMode: 'image',
				frameRate: 24,
				scenario: { name: 'Static', actions: [] },
			}),
			/only available for animated GIF/,
		);
	});

	test('rejects a malformed scenario action', () => {
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: { name: 'Invalid', actions: [{ type: 'click', locator: '' }] },
			}),
			/requires a locator/,
		);
	});

	test('rejects an invalid resize target', () => {
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: { name: 'Invalid resize', actions: [{ type: 'resize', width: 200, height: 844, resizeMode: 'keep-right-edge-fixed' }] },
			}),
			/at least 320 by 240/,
		);
	});

	test('requires an explicit fixed-edge outcome for every resize', () => {
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: {
					name: 'Ambiguous resize',
					actions: [{ type: 'resize', width: 640, height: 480 } as never],
				},
			}),
			/requires resizeMode/,
		);
	});

	test('accepts each fixed-edge resize outcome', () => {
		for (const resizeMode of ['keep-left-edge-fixed', 'keep-right-edge-fixed', 'keep-window-centered'] as const) {
			assert.doesNotThrow(() => validateComparisonRequest({
				...validRequest,
				scenario: {
					name: resizeMode,
					actions: [{ type: 'resize', width: 640, height: 480, resizeMode }],
				},
			}));
		}
	});

	test('accepts saved scenarios that use the legacy moving edge', () => {
		assert.doesNotThrow(() => validateComparisonRequest({
			...validRequest,
			scenario: {
				name: 'Saved resize',
				actions: [{ type: 'resize', width: 640, height: 480, movingEdge: 'left' }],
			},
		}));
	});

	test('validates the resize capture strategy', () => {
		assert.doesNotThrow(() => validateComparisonRequest({
			...validRequest,
			scenario: {
				name: 'Live resize',
				actions: [{ type: 'resize', width: 640, height: 480, resizeMode: 'keep-right-edge-fixed', captureStrategy: 'live' }],
			},
		}));
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: {
					name: 'Invalid strategy',
					actions: [{ type: 'resize', width: 640, height: 480, resizeMode: 'keep-right-edge-fixed', captureStrategy: 'timelapse' as never }],
				},
			}),
			/unsupported captureStrategy/,
		);
	});

	test('validates the explicit label size', () => {
		assert.doesNotThrow(() => validateComparisonRequest({ ...validRequest, labelSize: 28 }));
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, labelSize: 8 }),
			/between 10 and 72/,
		);
	});

	test('describes each resize outcome in fixed-edge language', () => {
		const request: ComparisonRequest = {
			...validRequest,
			viewport: { width: 1280, height: 720 },
			scenario: {
				name: 'Responsive behavior',
				actions: [
					{ type: 'hold', durationMs: 300 },
					{ type: 'resize', width: 390, height: 720, resizeMode: 'keep-right-edge-fixed' },
					{ type: 'resize', width: 1280, height: 640, resizeMode: 'keep-left-edge-fixed' },
					{ type: 'resize', width: 640, height: 640, resizeMode: 'keep-window-centered' },
				],
			},
		};
		assert.deepStrictEqual(describeResizeOutcomes(request), [
			'Action 2 (resize, 1280 to 390 wide): the right edge stays fixed while the left edge slides right.',
			'Action 3 (resize, 390 to 1280 wide): the left edge stays fixed while the right edge slides right; height shrinks from 720 to 640.',
			'Action 4 (resize, 1280 to 640 wide): both edges move inward at the same rate and the window stays centered.',
		]);
	});

	test('rejects invalid visual customization values', () => {
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, borderColor: 'blue' }),
			/six-digit hex color/,
		);
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, beforeLabelAlignment: 'center' as never }),
			/alignment .* unsupported/,
		);
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, colorScheme: 'sepia' as never }),
			/Color scheme .* unsupported/,
		);
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: {
					name: 'Invalid anchor',
					actions: [{ type: 'resize', width: 640, height: 480, anchor: 'middle' as never }],
				},
			}),
			/unsupported legacy anchor/,
		);
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: {
					name: 'Invalid resize mode',
					actions: [{ type: 'resize', width: 640, height: 480, resizeMode: 'move-left' as never }],
				},
			}),
			/unsupported resizeMode/,
		);
	});

	test('rejects zoom magnification without a target', () => {
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: { name: 'Invalid zoom', actions: [{ type: 'zoom', scale: 2 }] },
			}),
			/requires a locator/,
		);
	});

	test('keeps a stable canvas large enough for every resize target', () => {
		assert.deepStrictEqual(getRecordingSize(
			{ width: 1280, height: 720 },
			{
				name: 'Responsive transition',
				actions: [
					{ type: 'resize', width: 390, height: 844, resizeMode: 'keep-right-edge-fixed' },
					{ type: 'resize', width: 1440, height: 640, resizeMode: 'keep-right-edge-fixed' },
				],
			},
		), { width: 1440, height: 844 });
	});

	test('expands every port placeholder', () => {
		assert.strictEqual(
			expandPortTemplate('http://127.0.0.1:{port}/proxy/{port}', 4317),
			'http://127.0.0.1:4317/proxy/4317',
		);
	});

	test('keeps normal widescreen comparisons side by side', () => {
		assert.strictEqual(resolveComparisonLayout({ width: 1280, height: 720 }, undefined, undefined), 'horizontal');
	});

	test('stacks extremely wide focused regions vertically', () => {
		const menuBar = { x: 0, y: 0, width: 1200, height: 80 };
		assert.strictEqual(resolveComparisonLayout({ width: 1280, height: 720 }, menuBar, menuBar), 'vertical');
	});

	test('keeps an exact three-to-one focused region side by side', () => {
		const region = { x: 0, y: 0, width: 600, height: 200 };
		assert.strictEqual(resolveComparisonLayout({ width: 1280, height: 720 }, region, region), 'horizontal');
		assert.strictEqual(resolveComparisonLayout({ width: 1280, height: 720 }, region, region, 'vertical'), 'horizontal');
	});

	test('honors an explicit layout override', () => {
		const menuBar = { x: 0, y: 0, width: 1200, height: 80 };
		assert.strictEqual(resolveComparisonLayout({ width: 1280, height: 720 }, menuBar, menuBar, 'horizontal'), 'horizontal');
	});
});
