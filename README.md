# Choco

## Development

```sh
pnpm install
pnpm dev          # Vite dev server (http://localhost:1420)
```

## Testing

### Unit tests (vitest)

```sh
pnpm test         # run once
pnpm test:watch   # watch mode
```

### E2E tests (Playwright)

Requires Chromium — install once:

```sh
pnpm exec playwright install chromium
```

Run E2E (automatically starts the Vite dev server on port 1420):

```sh
pnpm e2e          # headless
pnpm e2e:ui       # interactive UI mode
```

E2E test files live under `e2e/`. The smoke suite covers:

- App loads with title "Choco"
- Drop zone visible on initial load
- PNG loaded via file input → canvas appears, drop zone hides
- Canvas click in color mode produces no JS errors
- SVG export button is visible and enabled after image load
