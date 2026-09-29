# Interactive Passport hero — 15 September 2026

> Superseded on 2026-09-30. The landing page now opens with Cleisthenes before an
> alpine lake ([COMPANION.md](COMPANION.md)). The two hand pictures are kept in
> `ui/public/art/passport/`, and the component and its test are in the git history.

## Review scope

Local follow-up to merged PR #29 on `feat/landing-and-passport-ui`.
The human hand replaces the hero orb. Desktop mouse movement tilts both image
layers together around the wrist; a circular reveal exposes the agent only
inside its radius. Proximity to the passport center grows the radius from 12px
to 35% of the art frame's shorter dimension. There is no persistent reveal,
identity change, or action when clicking the illustration.

Mobile (up to 900px), coarse pointers, reduced motion, and browsers without CSS
masks keep the static human image. The agent image is requested only on eligible
devices. A failed agent image leaves the human unmasked; a failed human image
leaves a short fallback and the normal navigation. The Midnight link is separate.

The existing atmosphere remains the background. After the hand is reviewed,
compare lavender/cyan atmosphere, pearlescent bands, and restrained iridescent
folds before choosing the second iteration. The closing mascot slot is untouched.

## Asset provenance and registration

- Inputs supplied by the user: `human-hand.png` and `agent-hand.png`, each
  1672 × 941, from Downloads.
- Built-in image generation removed the incorrect passport marks and healed
  matching leather texture. It returned painted checkerboards on two attempts.
  The user explicitly approved deterministic Python background extraction.
- Reproducible extraction scripts, RGBA masters, and cream/dark composites are
  retained in `outputs/passport-hero-20260915/`. These are private review outputs.
- Production files: `ui/public/art/passport/human-hand.webp` (96,396 bytes) and
  `agent-hand.webp` (135,748 bytes). Both retain the original canvas and true alpha.
- Crop frame: source x=930, y=50, width=742, height=891. Both layers use the same
  crop, transform origin, and pose. The logo is centered at source (1196,345).
- Logo sources: the user's official `Logo - Midnight/Logo - Midnight/02_Symbol/`
  black and white SVGs. The existing white copy is reused; the black copy adds
  only an accessible title. Geometry is unchanged. SVG images are projected
  onto the passport covers with a shared affine transform.
- Complementary masks remove the human pixels beneath the agent's transparent
  gaps. The circular masks remain in the untransformed frame, so their screen
  shape and cursor coordinates do not distort with the wrist tilt.

### Final image-edit prompts

Human: “Remove the full gradient/circle background to transparent alpha; remove
only the incorrect circular logo and heal matching leather; preserve hand,
grip, sleeve, lighting, cover perspective, all lettering and chip symbol;
retain original composition and canvas. Do not add a new logo.”

Agent: “Use case: background-extraction plus precise-object-edit. Produce a
production transparent PNG cutout for a website hero. Keep the original
1672x941 landscape composition and exact subject placement: the robotic hand
holding a silver passport remains on the right, wrist cropped at bottom and
right, all left negative space becomes fully transparent. Remove the entire
baked pastel gradient background and thin circular background arc. Preserve
the whole passport, robotic fingers, hand, wrist, silver embossed leather
texture, lighting, purple rim light, camera angle, silhouette and grip. Remove
the incorrect central circular logo and its three square marks, healing that
small area with matching leather. Do not add a new logo. Keep PASSPORT,
MIDNIGHT NETWORK, YOUR IDENTITY. YOUR PRIVACY. and the chip icon unchanged.
No reframing or repositioning.”

Both received one alpha-only correction request before deterministic extraction.
No image-generation API/CLI fallback or Blender asset was used.

## CI diagnosis

PR #29's failed browser job was `104389837020`, run `34971470406`.
Its saved failure snapshot shows `Preparing your experience…` after navigation
to the app, rather than clipped mobile onboarding. The network trace contains
cold Vite dependency requests taking 4–7.5 seconds. The same 320px test failed
locally on a fresh development server at the unchanged 10-second assertion.

Playwright's managed server now builds and previews the demo production bundle
instead of serving Vite development transforms. This matches deployment behavior
and avoids measuring cold dependency transformation as onboarding readiness.
The assertion timeout remains 10 seconds. Build/server startup allows 180 seconds.
An occupied port is reported rather than silently reusing an unrelated server;
`BASE_URL` remains the explicit way to test an existing preview.

Landing screenshots now use each test's output directory, avoiding repeated
overwrites of the dated design outputs. The initial baseline reproduction ran
the old test before this change and refreshed its existing `landing-320.png`.

## Release boundary

The older Hostinger cutover compose edit is preserved byte-for-byte: SHA-256
`458D25C9E9F2189442AFE3854319647BE4F3DE9F9B83547CA15A45E28D60FECB`.
Unrelated handoff, QA, research, and output files are excluded from the changes.

Hostinger website inventory still returned HTTP 500 on the implementation retry
(the planning retry returned 503). Destination ownership cannot be revalidated.
No push, deployment, DNS change, or service restart is authorized without the
user's next explicit approval. Keep the reviewed demo local until then.

Validation results and visual comparisons are recorded in `design-qa.md`.

## Accepted review iteration

Removed captions below the hand and the independent-experiment strip in the hero.
The secondary hero action is Explore Midnight. Artwork maximum width is 550px
(490px on short desktop screens); the lower/right fade starts earlier. A second
proximity influence enlarges the palm reveal to roughly 26% of artwork width.
The passport center retains its 35% maximum.

Bridge icons are 58px. The section kicker, subheadline and scroll-helper labels
are removed. The centered headline follows native scrolling from A little less
exposure. to A lot more possibility. The user explicitly confirmed possibility.
Desktop has a sticky introduction; mobile, short screens and reduced motion show
both lines without the effect. Step controls now precede the illustrations.

Hostinger work is paused by the user's latest request. No push or deployment.

Revision validation: 18 browser tests passed, 5 environment-specific tests skipped;
234 UI tests passed on Windows and Linux; demo builds passed on both; showcase gate
passed (11 text assets); formatting and git diff checks passed. Earlier full tests
passed 566 tests and Linux contract compilation. This iteration changed only UI
and tests; updated Linux UI source was overlaid onto the isolated prior snapshot.
