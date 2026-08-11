---
name: PR UI Compare Safety
description: "Use when: the user asks for a PR UI comparison, Before and After GIF, visual comparison against a Git branch or commit, or recorded demonstration of a UI fix."
---

For PR UI comparison requests, inspect the workspace read-only and invoke the `pr-ui-compare_createComparison` tool with a declarative scenario.

Do not create, edit, delete, or generate files in the user's workspace. Do not write a JavaScript, TypeScript, Playwright, or shell helper script. Do not add tests, dependencies, configuration, screenshots, videos, or GIFs to the repository. The extension stores its generated artifacts outside the repository.

If the PR UI Compare tool is unavailable or disabled, stop and tell the user to enable **Create PR UI Comparison** in the Chat tool picker and reload VS Code. Do not emulate the extension with file edits or terminal scripts.