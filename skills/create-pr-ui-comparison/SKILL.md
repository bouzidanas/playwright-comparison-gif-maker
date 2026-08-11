---
name: create-pr-ui-comparison
description: "Create synchronized GIF Before and After UI comparisons by default, with static PNG as a narrow exception for explicit, completely motionless cases. Use when: the user asks for a PR visual comparison, comparison against a Git ref, screenshot comparison, or recorded UI fix demonstration."
argument-hint: Describe the UI behavior to demonstrate
---

# Create a PR UI comparison

Use the `pr-ui-compare_createComparison` tool to produce a reviewable artifact outside the repository.

Animation is the default. Use `outputMode: image` only when the user explicitly asks for static images or the comparison is truly motionless. Truly static means nothing happens during the demonstration: no events, clicks, hovers, key presses, transitions, loading sequence, resizing, zooming, scrolling, opening, closing, or state changes. Image mode requires an empty action list and captures only the settled initial route. When there is any doubt, use `animation`.

Static image mode is appropriate for an already-visible difference in colors, typography, spacing, icons, borders, light versus dark appearance, or initial layout. It creates `comparison.png`, `before.png`, and `after.png`. Animation mode creates synchronized GIF files and is required for every scenario action.

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
9. Keep `layout` set to `auto` unless the user requests otherwise. Auto is side by side for normal captures and only stacks top and bottom when the focused region is at least three times wider than tall.
10. Use short Before and After labels. They are rendered inside the outer top corners of the recordings.
11. Do not include credentials, tokens, private account data, or destructive interactions in a recording.

Use `resize` whenever changing viewport dimensions is part of the behavior or reproduction. This includes breakpoint changes, fluid reflow, text wrapping, overflow and clipping, fixed or sticky positioning, viewport units, resize observers, canvas sizing, sidebar behavior, and layout stability. Choose start and target sizes that make the specific difference visible. They do not need to cross a CSS media-query breakpoint. Add a short hold before resizing, animate the resize over 600 to 1000 milliseconds when the transition matters, then hold the resulting state. Add another resize when the reverse transition provides useful evidence. Do not add resize actions to comparisons where viewport changes are unrelated.

Every resize action must set `movingEdge`. This names the edge that visibly moves, not the edge that stays fixed. Set `movingEdge` to `left` when the user wants the left edge to slide right during a shrink while the right edge stays fixed. Set it to `right` when the user wants the right edge to slide left while the left edge stays fixed. Set it to `both` to move both edges equally and keep the page centered. Never omit `movingEdge`, and do not infer its meaning from the word anchor.

For a breakpoint-specific change, start on one side of the relevant breakpoint and cross it during the recording instead of showing only a fixed target state. The initial `viewport` and every resize target use the same 320 by 240 minimum and 3840 by 2160 maximum.

Use `zoom` sparingly to orient viewers before a detailed interaction or to draw attention to the affected region. A zoom action with a locator smoothly moves the recording camera toward that element and remains zoomed for following actions. The default scale is 1.8 and the default transition is 800 milliseconds. Use `{ "type": "zoom", "scale": 1 }` to smoothly return to the full frame. Prefer scales from 1.4 to 2.2, allow time for viewers to orient before interacting, and avoid rapid or repeated zooms that feel jarring. Zoom is a camera effect only; it must not replace the clicks, resizing, scrolling, or other behavior that demonstrates the change.

Use `borderColor` when the user requests a frame or accent color. It must be a six-digit hex color. The default is GitHub dark border `#30363d`, which is also used for unused canvas revealed by resize movement. Set `beforeLabelAlignment` and `afterLabelAlignment` independently to any corner. Defaults place the Before label at `top-left` and the After label at `top-right`, keeping labels on the outer corners for both side-by-side and top-and-bottom layouts.

The supported actions are `goto`, `click`, `hover`, `fill`, `press`, `scroll`, `resize`, `zoom`, `waitFor`, and `hold`. Pointer actions accept a Playwright locator string. A resize action requires `width`, `height`, and `movingEdge`, and accepts an optional `durationMs`. A zoom action accepts an optional `locator`, `scale`, and `durationMs`. Add `holdAfterMs` when the resulting state should remain visible.

After the tool returns, report the GIF path, whether the candidate included uncommitted changes, and the exact baseline and candidate SHAs. Remind the user to regenerate after committing and pushing when the candidate was dirty.