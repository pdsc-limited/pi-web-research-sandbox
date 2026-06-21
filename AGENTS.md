# Agent Notes for pi-web-research-sandbox

## TypeBox imports in this extension

This project is loaded by pi's extension loader. The loader aliases
`@sinclair/typebox` to the unscoped `typebox` package bundled with pi, and only
covers these subpaths:

- `@sinclair/typebox`
- `@sinclair/typebox/compile`
- `@sinclair/typebox/value`

**Do NOT import from `@sinclair/typebox/compiler`.** That subpath is not
aliased and will fail at runtime with:

```
Cannot find module '/app/node_modules/typebox/build/index.mjs/compiler'
```

Use `@sinclair/typebox/value` with `Value.Check()` / `Value.Errors()` instead.
See `src/schema.ts` for the current working pattern.

## Recovery note — 2026-06-21

The project broke when `src/schema.ts` imported `TypeCompiler` from
`@sinclair/typebox/compiler`. The pi extension loader only aliases the
`@sinclair/typebox`, `@sinclair/typebox/compile`, and `@sinclair/typebox/value`
subpaths to the bundled `typebox` package, so the `/compiler` subpath fails at
runtime with:

```
Cannot find module '/app/node_modules/typebox/build/index.mjs/compiler'
```

The recovery was to switch to `@sinclair/typebox/value` (`Value.Check()` /
`Value.Errors()`) and to read the error path from either `path` or
`instancePath` so the same code works both under the real package and under the
aliased package. After the fix, `node test/sanitizer.test.ts` passes all 12
prompt-injection fixtures.
