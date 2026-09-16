# AGENTS.md

## Project overview

Studio Admin is a responsive admin dashboard built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, and shadcn/ui.

This repository uses the shadcn `radix-nova` style. The shadcn CLI reports `base: "radix"`, which refers to Radix UI. Always inspect the local components in `src/components/ui/` because individual wrappers may use different primitives.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## shadcn skill

Use the shadcn skill for all work involving shadcn/ui components, styling, composition, registries, presets, or `components.json`.

If the skill is not available, install it with:

```bash
npx skills add shadcn/ui
```

The skill contains the component, styling, composition, accessibility, and CLI rules. Do not duplicate those rules here. Always inspect the local component source before using it.

Do not modify files inside `src/components/ui/` or `src/components/calendar/`. Keep these components intact and apply styling or customization where they are used.

## Setup

This project uses npm.

```bash
npm install
npm run dev
```

Available commands:

```bash
npm run build
npm run lint
npm run format
npm run check
npm run check:fix
npm run generate:presets
```

There is currently no automated test command. Run build, lint, check, or other validation commands only when the user explicitly requests that validation.

## Co-location-based structure

Keep feature code close to the route that owns it.

- Dashboard routes: `src/app/(main)/dashboard/<screen>/page.tsx`
- Screen-specific components, data, and schemas: `src/app/(main)/dashboard/<screen>/_components/`
- Shared dashboard components: `src/app/(main)/dashboard/_components/`
- Shared application components: `src/components/`
- Local shadcn components: `src/components/ui/`
- Shared hooks and utilities: `src/hooks/` and `src/lib/`
- Theme presets: `src/styles/presets/`

Keep a component inside its route until it is reused by another feature. Do not move screen-specific code into a shared directory preemptively.

## Creating or extending a screen

1. Inspect the closest current screen before writing code. Finance, Infrastructure, CRM, and Analytics are useful references. Do not use routes under `(legacy)` as references for new screens unless maintaining a legacy route.
2. When reproducing a UI from a screenshot or image, follow its visual direction closely, including layout, hierarchy, spacing, component structure, and important details. Implement it with the project's existing components and semantic theme tokens rather than copying raw color values. If the design needs a color that is not available through the existing theme tokens, or the user explicitly requests a non-theme color, use a named color from Tailwind's default palette. Do not use arbitrary hex, RGB, HSL, or OKLCH values.
3. Reuse the existing dashboard shell, local components, layout controls, and theme tokens.
4. Break each new page into focused components inside the route's `_components/` directory. Keep `page.tsx` small and focused on composing those pieces.
5. Keep `page.tsx` as a Server Component by default. Move interactive or browser-dependent code into a dedicated Client Component.
6. Add the screen to `src/navigation/sidebar/sidebar-items.ts` when it should appear in the dashboard navigation.
7. Decide the information hierarchy before choosing widgets. Let the content determine the page structure.
8. Keep the established visual rhythm where it fits: compact spacing, clear typography hierarchy, responsive action rows, and grids that collapse cleanly on smaller screens.
9. Widget selection is not a fixed formula. Try different arrangements of cards, resource rows, meters, charts, tabs, empty states, and actions, then keep the version that communicates the content clearly and feels consistent with the project.
10. Match nearby screens in card density, borders, radius, spacing, content width, and responsive behavior.
11. Use semantic theme tokens so new screens work with light mode, dark mode, and the existing theme presets.
12. Handle relevant loading, empty, error, disabled, and overflow states.
13. Keep screens accessible with semantic HTML, keyboard support, visible focus states, labels, and appropriate ARIA attributes.

## Code conventions

- TypeScript strict mode is enabled. Use precise types and avoid `any`.
- Use the existing `@/` import aliases.
- Follow the Biome configuration: double quotes, semicolons, two-space indentation, sorted imports, and a 120-character line width.
- Avoid unnecessary dependencies.
- Keep changes focused and do not refactor unrelated files.

## Contributions

- Use conventional commit prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, and `chore:`.
- Include screenshots for new screens and material visual changes. Include mobile and dark-theme states when relevant.
- Explain new reusable patterns or dependencies in the pull request.
- Follow `CONTRIBUTING.md` for the contribution workflow.

---

0. Rules
Copy this whole section into AGENTS.md in Goal 0.

0.1 Build rules
B1. Build only what this spec says. If something you need isn't here, stop and ask Haim. Never add a form, input field, setting, or confirmation step on your own.
B2. Keep the existing stack: framework, database, hosting, and auth if present. Add new dependencies only where §1 names them.
B3. Never touch Donna's live WhatsApp pairing, WhatsApp session folder, email credentials, or allowlists. Test messaging only in the CC Test WhatsApp group (Goal 2).
B4. Every goal adds tests. npm run check (typecheck, lint, unit tests, and e2e tests for finished goals) must pass before a goal is done. Run it yourself and include the last lines of output in your final message.
B5. Your final message for each goal lists every "Done when" line with its evidence: a passing test name, a file path, a log line, or a screenshot path. The goal judge reads only that message.
B6. Secrets live in environment variables and are never committed. Never sign up for or pay for a service. Ask Haim for keys.
B7. Database migrations only add. Never delete Haim's data.
B8. Record every technical decision in docs/STACK.md under "Decisions".

0.2 Product rules
Enforce these in server code, not only in prompts.
P1. No message goes into a chat that has a factory contact in it unless Haim approved that exact version. The server checks a content hash at send time. This includes openers, follow-ups, second and third tries, and the "@Yuki can you pay" message.
P2. Agents may send automatically only to chats where every member is an Ours contact: Haim's DM, Yuki's DM, and internal groups.
P3. Agents never negotiate. No prices, counteroffers, discounts, minimum orders, payment terms, volumes, or order commitments. Quotes are recorded for Haim only. The guardrail in §3.4 enforces this.
P4. Agents may name our brands (AllSett Health, Refreshify, Everlasting) and say we already import and sell. They never state volumes unless Haim turned on "Can share volumes" for that factory.
P5. Messages we send are English only. Messages we receive in another language are stored with an English translation.
P6. Agents ask for a sample only after step 3 (Spec agreed) is done for that factory and product.
P7. Sample fees always go to Haim as a decision. Agents never agree to a fee or argue about it.
P8. Never pushy. Follow-up timing follows §3.6. Agents don't push factories on which day they ship.
P9. No manual data entry. Agents fill in data from chats, email, the Amazon listing, and the approved spec. Haim can edit anything.
P10. Automatic actions that don't send a factory message are logged in the activity log with Undo. This covers creating contacts, marking steps, merging contacts, and archiving.
P11. Each factory and product pair is tracked on its own. A factory working on 3 products has 3 rows and gets 3 separate drafts.
