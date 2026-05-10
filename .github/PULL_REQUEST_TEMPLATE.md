<!--
Thanks for sending a PR! A few quick rules so the review goes smoothly:

- One concern per PR. Tangential fixes belong in a separate PR.
- For changes that touch the wire protocol or security model, link to
  the relevant section of docs/remote-browser-design.md.
- Bug fixes should include a regression test that fails on main.
- New behavior should land with vitest coverage.
- Don't skip pre-commit hooks. If a hook fails, fix the underlying issue.

See CONTRIBUTING.md for the full flow.
-->

## Summary

<!-- One paragraph: what changed, and why. Write for a reviewer who hasn't been in your head. -->

## Test plan

<!-- A checklist a reviewer can run to gain confidence the change works. -->

- [ ] `pnpm lint` clean (eslint + prettier + recursive `tsc --noEmit`)
- [ ] `pnpm test` green
- [ ] `pnpm build` succeeds in every workspace
- [ ] Added / updated vitest coverage for new behavior or regressions
- [ ] Manual smoke test of `pnpm demo` end-to-end (only if the change touches a runtime path)
- [ ] Updated relevant package README / `docs/` if user-facing behavior changed

## Scope

<!-- Tick whichever apply. -->

- [ ] No public API change
- [ ] Adds public API (please describe below)
- [ ] Changes public API behavior or types (please describe below; needs a major bump or a deprecation note)
- [ ] Changes the wire protocol (`@atriumjs/protocol`) — linked design discussion or doc update below
- [ ] Touches the security model, auth, or credentials handling — see checklist in `SECURITY.md`

## Changeset

<!--
For any change that affects a published @atriumjs/* package, run
`pnpm exec changeset add` and commit the generated file. Mention here which
packages bump and at what level (patch / minor / major).

For docs / infra-only changes, write "No published package affected."
-->

## Linked issues

<!-- "Closes #123" / "Refs #456" — helps GitHub auto-close on merge. -->
