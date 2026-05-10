/**
 * rules.ts — Mode-specific compression rules injected into the system prompt.
 *
 * Keeps rule text in one place so both the system-transform hook and any
 * diagnostic tools read from the same source.
 */

import type { Mode } from "./flag.js";

// ---------------------------------------------------------------------------
// Per-mode rule text
// ---------------------------------------------------------------------------

const MODE_RULES: Record<Exclude<Mode, "off">, string> = {
  lite: `[RUNES: LITE] COMPRESS LITE ACTIVE
- Drop filler words (just, really, basically, actually, very, quite).
- Remove pleasantry openers ("Great question!", "Sure!", "Of course!") and hedging.
- Keep standard grammar: full sentences, articles (a/an/the) retained.
- Goal: Professional-tight writing — no fat, still readable.`,

  full: `[RUNES: FULL] COMPRESS FULL ACTIVE
- Omit articles (a/an/the) and filler words.
- No pleasantry openers or closing affirmations.
- Use fragments where subject is obvious. Short synonyms preferred.
- Pattern: [subject] [verb] [reason]. [next step].
- Goal: High-signal, low-ceremony output.`,

  ultra: `[RUNES: ULTRA] COMPRESS ULTRA ACTIVE
- MetaGlyph symbols allowed: ∈ (in/contains), → (leads to/causes), ∀ (all/every), ∃ (exists/there-is), ∴ (therefore), ! (critical/warning).
- Chain-of-Draft (CoD): reason silently in ≤3 minimal draft steps, emit only the final answer.
- Abbreviate prose: DB, auth, cfg, req, res, fn, impl, ctx, err, msg, val, bool, pkg, dep, env, init, ref, var, arg, param, attr, prop.
- Strip conjunctions where unambiguous. One word when one word enough.
- Arrows for causality: X → Y → Z.
- Goal: Maximal information density — every token earns its place.`,
  wenyan: `[RUNES: WENYAN] COMPRESS WENYAN ACTIVE
- Classical Chinese literary style (文言) for compression.
- Use wenyan particles: 之, 其, 者, 也, 矣, 乎, 焉, 哉, 兮, 耳.
- Omit subjects where contextually obvious (pro-drop).
- Verb precedes object (classical Chinese syntax: VO).
- Replace multi-word phrases with classical idioms (成语) where possible.
- Strip all modern filler, articles, conjunctions, pleasantries.
- Numbers as classical Chinese: 一, 二, 三, 四, 五, 六, 七, 八, 九, 十, 百, 千, 万.
- Technical terms preserved as-is (code, API, paths, URLs — NEVER compress).
- Goal: 60-80% character reduction via classical Chinese literary compression.
- Auto-clarity: revert to ultra/full prose for security, destructive ops, legal.`,
};

// ---------------------------------------------------------------------------
// Shared exceptions block (appended to every mode's rules)
// ---------------------------------------------------------------------------

const EXCEPTIONS = `
## Status badge — prepend EVERY response with the badge line:
[RUNES: MODE]
(replace MODE with current mode: LITE, FULL, or ULTRA)

## Auto-safety — ALWAYS use full prose for:
- Security warnings or authentication/authorization failures.
- Irreversible operations (destructive git commands, file deletes, data loss).
- Ambiguous logical sequences where dropping conjunctions changes meaning.
- Legal / compliance notices.

## Hard boundaries — NEVER compress:
- Code blocks (write all code normally).
- Command-line examples, commit messages, PR descriptions.
- Proper nouns, API names, library identifiers, model names.
- Numbers, versions, file paths, URLs.

Deactivate: say "normal mode" or invoke /compress to toggle off.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full rule block for session-start injection (verbose, includes examples).
 */
export function fullRules(mode: Exclude<Mode, "off">): string {
  return (MODE_RULES[mode] ?? MODE_RULES.full) + EXCEPTIONS;
}

/**
 * Short reinforcement line for per-turn injection (keeps context overhead low).
 */
export function reinforcement(mode: Exclude<Mode, "off">): string {
  switch (mode) {
    case "lite":
      return "[RUNES: LITE] COMPRESS LITE: Drop filler/hedging. Keep articles + full sentences. Professional-tight.";
    case "ultra":
      return "[RUNES: ULTRA] COMPRESS ULTRA: MetaGlyph (∈ → ∀ ∃ ∴ !). Abbreviate prose (DB/fn/req/res/impl/ctx/err). Strip conjunctions. CoD: reason silently → answer. Arrows for causality.";
    case "wenyan":
      return "[RUNES: WENYAN] COMPRESS WENYAN: Classical Chinese (wenyan) compression. Use 之/其/者/也/矣 particles. Classical syntax VO. Pro-drop subjects. Replace phrases with 成语 idioms. Technical terms preserved.";
    default:
      return "[RUNES: FULL] COMPRESS FULL: Drop articles. Fragments OK. No pleasantries. High-signal.";
  }
}

/**
 * Status badge string shown in tool output.
 */
export function badge(mode: Mode | null): string {
  if (!mode || mode === "off") return "[RUNES: OFF]";
  return `[RUNES: ${mode.toUpperCase()}]`;
}
