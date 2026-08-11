import * as assert from 'assert';
import { getRecordingSize, INITIAL_POINTER_STYLE, resolvePlaywrightColorScheme } from '../capture';
import { expandPortTemplate, validateComparisonRequest, type ComparisonRequest } from '../model';
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
				scenario: { name: 'Invalid resize', actions: [{ type: 'resize', width: 200, height: 844, movingEdge: 'left' }] },
			}),
			/at least 320 by 240/,
		);
	});

	test('requires an explicit moving edge for every resize', () => {
		assert.throws(
			() => validateComparisonRequest({
				...validRequest,
				scenario: {
					name: 'Ambiguous resize',
					actions: [{ type: 'resize', width: 640, height: 480 } as never],
				},
			}),
			/requires movingEdge/,
		);
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
					{ type: 'resize', width: 390, height: 844, movingEdge: 'left' },
					{ type: 'resize', width: 1440, height: 640, movingEdge: 'left' },
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

	test('honors an explicit layout override', () => {
		const menuBar = { x: 0, y: 0, width: 1200, height: 80 };
		assert.strictEqual(resolveComparisonLayout({ width: 1280, height: 720 }, menuBar, menuBar, 'horizontal'), 'horizontal');
	});
});
