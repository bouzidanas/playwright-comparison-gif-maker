import * as assert from 'assert';
import { getRecordingSize } from '../capture';
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

	test('rejects an empty scenario', () => {
		assert.throws(
			() => validateComparisonRequest({ ...validRequest, scenario: { name: 'Empty', actions: [] } }),
			/at least one action/,
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
				scenario: { name: 'Invalid resize', actions: [{ type: 'resize', width: 200, height: 844 }] },
			}),
			/at least 320 by 240/,
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
			() => validateComparisonRequest({
				...validRequest,
				scenario: {
					name: 'Invalid anchor',
					actions: [{ type: 'resize', width: 640, height: 480, anchor: 'middle' as never }],
				},
			}),
			/unsupported anchor/,
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
					{ type: 'resize', width: 390, height: 844 },
					{ type: 'resize', width: 1440, height: 640 },
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
