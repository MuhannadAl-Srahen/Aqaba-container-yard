# Aqaba Yard — Working Rules

## Project
Arabic-only container yard website for the single Aqaba yard.
Fastify + node:sqlite server, React + Tailwind RTL client, shared pure rules.
Specification: SPEC.md. Session log: PROGRESS.md. Standalone repository —
nothing here may import from or depend on the old desktop project.

## Before writing code
1. Read PROGRESS.md, then the SPEC.md sections that matter.
2. For new scope: plan first, wait for the owner's approval.

## Hard rules
- The map IS the application. Every yard operation starts on the yard drawing;
  a form-first flow needs the owner's explicit approval first.
- TypeScript strict. No `any`, no `@ts-ignore`, no `as unknown as`.
- `src/shared` stays pure: no fetch, no DB, no DOM.
- The server is the only authority; client checks mirror it for UX only.
- Soft delete only. The wire carries error CODES; Arabic sentences live in
  `src/client/ar.ts` alone — Jordanian yard register, Western digits.
- Tailwind logical properties only: `ms-4` not `ml-4`.
- No hardcoded yard figures; shapes come from the database, physical limits
  from `src/shared/types.ts`.
- Never invent an unspecified requirement. Ask.

## Verification
`pnpm typecheck`, `pnpm test` and `pnpm lint` must pass before every commit.
