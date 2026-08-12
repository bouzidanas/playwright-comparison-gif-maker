---
name: create-pr-ui-comparison
description: "Produce Before and After GIF or PNG files from the running application. Use when the user asks for a visual artifact to look at, such as a GIF, screenshot, Before and After image, theme or visual-state comparison, or a recorded demonstration of a UI fix. Do not use for code comparisons, diff reviews, or change summaries that need no generated media."
argument-hint: Describe the UI behavior to demonstrate
---

# Create a PR UI comparison

Use the `pr-ui-compare_createComparison` tool to produce a reviewable artifact outside the repository.

This tool exists to generate media. Run it only when the user wants a GIF or image to look at or share. A request to compare a branch against `main`, review a fix, explain what changed, or check that something works is a code question, and it should be answered by reading the code and the diff. The tool starts two copies of the application and records them, which is slow and pointless when nobody asked for a picture. If it is unclear whether the user wants generated media, ask first.

Animation is the default. Use `outputMode: image` when the user explicitly asks for static images, or when the thing being compared is a settled state that holds still once it is reached. Use `animation` when the change the user needs to see is the motion itself, such as a transition, a loading sequence, a resize, a scroll, or anything that only makes sense while it is happening. When there is any doubt, use `animation`.

Image mode is not limited to the initial route. Its actions are setup steps rather than the subject, so list whatever clicks, hovers, key presses, navigation, or waits are needed to bring the app into the state you want to photograph. The actions replay identically in both versions, then a single PNG captures the settled final state, so an element that only exists after loading a document or opening an editor can still be compared as a still image. Finish with a `waitFor` on the element you care about, and add a short `hold` when the state needs a moment to settle. The synthetic pointer is not drawn in static images.

Static image mode is appropriate for an already-visible difference in colors, typography, spacing, icons, borders, light versus dark appearance, or layout. It creates `comparison.png`, `before.png`, and `after.png`. Animation mode creates synchronized GIF files.

For animation, set `frameRate` from 5 to 30 fps. The default is 24 fps. Use 30 fps when the evidence contains fast visual events, short transitions, quick orientation changes, or camera zoom where intermediate frames matter. Use 15 fps or lower only for slow, simple motion when reducing file size matters more than temporal detail. Do not set frame rate for image mode.

Set `colorScheme` to `light`, `dark`, or `system` when the comparison should render both versions in one browser appearance. This controls the `prefers-color-scheme` media feature before the page loads, so responsive themes initialize correctly. `system` disables explicit emulation and is the default.

For a direct light-versus-dark comparison, set `beforeColorScheme` and `afterColorScheme` independently, for example Before `light` and After `dark`. Per-side values override the common `colorScheme`. Use independent schemes only when the requested comparison is specifically about appearance modes; normal code-change comparisons should use the same scheme on both sides.

This is a read-only workspace workflow. Do not create, edit, or delete workspace files. Do not write a JavaScript, TypeScript, Playwright, or shell helper script. Do not add dependencies, tests, configuration, or generated media to the repository. Express the recording through the tool's declarative scenario actions.

If the tool is unavailable or disabled, stop and tell the user to enable **Create PR UI Comparison** in the Chat tool picker and reload VS Code. Do not recreate the comparison through terminal commands or temporary workspace files.

Before invoking the tool:

1. Inspect the changed UI and identify the shortest interaction sequence that makes the difference obvious.
2. Determine the intended PR target ref. Prefer the current original-repository target such as `upstream/main`. Do not assume remote names when repository evidence says otherwise.
3. Inspect `package.json`, lockfiles, and existing development instructions to determine the install command, start command, readiness URL, and route.
4. Use `{port}` in the start command and readiness URL. The tool allocates a separate port for each run.
5. Use stable Playwright locators. Prefer roles with accessible names, labels, text, and test IDs. Avoid generated CSS classes and coordinate clicks.
6. Include short holds before the first action and after states a reviewer needs to inspect. Keep the full scenario concise.
7. Choose an initial viewport that contains the relevant UI without making the subject too small. Start with 1280 by 720 for desktop or another size supported by the behavior being demonstrated.
8. Set `focusLocator` when the demonstration concerns one stable region such as a menu bar, dialog, panel, or toolbar. The recorder follows that element's bounds and crops with 16 pixels of padding by default.
9. Keep `layout` set to `auto` unless the user explicitly requests side-by-side output. Top and bottom is renderer-controlled and occurs only when the focused region is strictly greater than 3:1. An exact 3:1 region remains side by side. Never request vertical layout directly.
10. Use short Before and After labels. They are rendered inside the outer top corners of the recordings.
11. Do not include credentials, tokens, private account data, or destructive interactions in a recording.

Use `resize` whenever changing viewport dimensions is part of the behavior or reproduction. This includes breakpoint changes, fluid reflow, text wrapping, overflow and clipping, fixed or sticky positioning, viewport units, resize observers, canvas sizing, sidebar behavior, and layout stability. Choose start and target sizes that make the specific difference visible. They do not need to cross a CSS media-query breakpoint. Add a short hold before resizing, animate the resize over 600 to 1000 milliseconds when the transition matters, then hold the resulting state. Add another resize when the reverse transition provides useful evidence. Do not add resize actions to comparisons where viewport changes are unrelated.

Every resize action must set `resizeMode`. Choose the mode from the edge that must remain fixed, not from an isolated direction word. Use `keep-left-edge-fixed` when only the right edge should move. Use `keep-right-edge-fixed` when only the left edge should move. Use `keep-window-centered` when both edges should move simultaneously at the same rate and the window should remain horizontally centered.

Translate common requests literally:

- "Slide the left edge right and keep the right edge fixed" means `resizeMode: keep-right-edge-fixed`.
- "Slide the right edge left and keep the left edge fixed" means `resizeMode: keep-left-edge-fixed`.
- "Resize from both sides at the same rate" means `resizeMode: keep-window-centered`.

Never omit `resizeMode`. Before invoking the tool, verify that the fixed edge named by the selected mode is the fixed edge requested by the user. After the tool returns, compare every `resizeOutcomes` entry in the result against the user's request; if a fixed edge is wrong, correct `resizeMode` and rerun before reporting success.

Resize transitions are captured in stop-motion by default: every output frame is rendered at an exact viewport size, so fixed edges stay perfectly rigid and the Before and After panes resize in exact lockstep. Set `captureStrategy: "live"` on a resize action only when the user asks for the real-time resize behavior or reports that the stop-motion transition differs from what they observe in a real browser, for example when resize-driven animations or debounced handlers matter.

For a breakpoint-specific change, start on one side of the relevant breakpoint and cross it during the recording instead of showing only a fixed target state. The initial `viewport` and every resize target use the same 320 by 240 minimum and 3840 by 2160 maximum.

Use `zoom` sparingly to orient viewers before a detailed interaction or to draw attention to the affected region. A zoom action with a locator smoothly moves the recording camera toward that element and remains zoomed for following actions. The default scale is 1.8 and the default transition is 800 milliseconds. Use `{ "type": "zoom", "scale": 1 }` to smoothly return to the full frame. Prefer scales from 1.4 to 2.2, allow time for viewers to orient before interacting, and avoid rapid or repeated zooms that feel jarring. Zoom is a camera effect only; it must not replace the clicks, resizing, scrolling, or other behavior that demonstrates the change.

Use `borderColor` when the user requests a frame or accent color. It must be a six-digit hex color. The default is GitHub dark border `#30363d`, which is also used for unused canvas revealed by resize movement. Set `beforeLabelAlignment` and `afterLabelAlignment` independently to any corner. Defaults place the Before label at `top-left` and the After label at `top-right`, keeping labels on the outer corners for both side-by-side and top-and-bottom layouts. Never set `labelSize` unless the user explicitly requests a specific label size; the default scales automatically with the output so labels stay consistent and readable.

The supported actions are `goto`, `click`, `hover`, `fill`, `press`, `scroll`, `resize`, `zoom`, `waitFor`, and `hold`. Pointer actions accept a Playwright locator string. A resize action requires `width`, `height`, and `resizeMode`, and accepts an optional `durationMs` and `captureStrategy`. A zoom action accepts an optional `locator`, `scale`, and `durationMs`. Add `holdAfterMs` when the resulting state should remain visible.

After the tool returns, report the GIF path, whether the candidate included uncommitted changes, and the exact baseline and candidate SHAs. Remind the user to regenerate after committing and pushing when the candidate was dirty.