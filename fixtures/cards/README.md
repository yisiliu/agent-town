# Card fixtures

Sample `card.md` files used for testing the upload pipeline and for
manual UI smoke testing. Drop any of these into the `/upload` page in a
.zip (via `scripts/build-fixture-zip.sh` or the in-test
`buildTestZip()` helper) and observe how each gate reacts.

| File | Valid schema? | piiScan | promptInjectionScan | Final outcome |
|---|---|---|---|---|
| `clean-zh.md` | yes | pass | pass | active (3 codes issued) |
| `with-pii.md` | yes | block (regex: phone + email + address) | pass | rejected |
| `with-injection.md` | yes | pass (no real-person PII) | block (Llama Guard) | rejected |
| `invalid-missing-section.md` | no (missing Voice + Signature phrases) | n/a — synchronous validator throws | n/a | upload fails at validation step |

The `with-pii.md` and `with-injection.md` cards exist so the rejection
path is visible in dev — flagged content is in the body (and visible
in source) so an instructor reviewing a real student rejection sees
what kind of content triggered the block.

If you add a fixture, update this table and add a corresponding case
in `convex/tests/uploadFixtures.test.ts`.
