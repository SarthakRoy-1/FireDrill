# Design: Firedrill results page

The only UI is one static results page (heatmap + tripwire counter) and the CLI grid. Keep it plain and fast. These are proposed defaults; change them freely.

## 1. Brand identity

- Name: Firedrill. Tagline: "Run the drill before production does."
- Tone: calm, technical, evidence-first. Alarm only where something actually failed.
- Signature element: the tripwire counter. Stays at 0 when the guardrail holds, ticks up (in red) when it does not.
- No mascot, no illustrations. Honest numbers over decoration.

## 2. Colour and theme

Light and dark, via CSS variables on `:root`, dark under `prefers-color-scheme`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #ffffff | #0e1116 | page |
| `--surface` | #f5f6f8 | #161b22 | cards, table |
| `--border` | #d8dce2 | #2a313c | lines |
| `--text` | #14181f | #e6e9ee | body |
| `--muted` | #5b6572 | #8b95a3 | secondary text |
| `--pass` | #1a7f4b | #3fb97a | PASS cells |
| `--fail` | #c62828 | #ff6b6b | FAIL cells, tripwire hit |
| `--warn` | #b26a00 | #e0a030 | ERROR / unverified |
| `--accent` | #d9480f | #ff7a3d | links, brand mark (fire orange) |

Never rely on colour alone: every cell also shows a text label (PASS / FAIL / ERROR).

## 3. Spacing

4px base scale: 4, 8, 12, 16, 24, 32, 48. Page max width 1100px, 16px side gutter on mobile, 24px on desktop.

## 4. Border radius

4px (inputs, cells), 8px (cards), 999px (badges). No heavy shadows; use a 1px border.

## 5. Components

- **Header**: name, tagline, run metadata (date, repo, model, run count).
- **Heatmap**: rows = scenarios, columns = configurations (bare instructions, hardened, open-model baseline). Cell = PASS / FAIL / ERROR with a range if repeated.
- **Scenario row detail**: assertion list, the exact PR comment or tripwire hit, the canary value if leaked.
- **Tripwire counter**: large number, label "tripwire hits".
- **Summary strip**: totals per configuration ("held 11 of 12").
- **Badge**, **link button**, **code block** (monospace, `--surface` background).

## 6. Icons

Few and simple: inline SVG, 16px/20px, 1.5px stroke, `currentColor`. Check, cross, alert triangle, external-link. No icon library unless needed.

## 7. Responsive breakpoints

- Mobile: under 640px (heatmap scrolls horizontally inside its own container; page does not scroll sideways).
- Tablet: 640 to 1023px.
- Desktop: 1024px and up.

## 8. Fonts

- UI: Inter (fallback `system-ui, sans-serif`).
- Code and numbers: JetBrains Mono (fallback `ui-monospace, monospace`).
- Load via Google Fonts with `font-display: swap`, or fall back to system fonts.

## 9. Typography

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Page title | 32 / 40 | 700 |
| Section heading | 20 / 28 | 600 |
| Body | 16 / 24 | 400 |
| Table cell / small | 14 / 20 | 400 |
| Caption / label | 12 / 16 | 500, uppercase tracking +0.04em |
| Counter | 48 / 56 | 700, mono |
