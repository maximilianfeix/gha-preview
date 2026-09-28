# Contributing

Thanks for helping make GitHub Actions easier to understand. Small, focused pull requests are easiest to review.

## Before opening a PR

1. Open an issue for a larger change so we can agree on the behavior.
2. Keep the preview conservative: when runtime values cannot be known, show that uncertainty rather than guessing.
3. Add or update a fixture-driven test for parser, layout, or scenario behavior.
4. Run `npm run check` and try the affected interaction at desktop and mobile widths.
5. Remove tokens, private repository names, and other sensitive values from sample YAML.

## Local development

```bash
npm install
npm run dev
npm test
npm run build
```

## Pull requests

Describe the user problem and the change. Link related issues, include screenshots for visual changes, and note any limitations. CI must pass before merge.
