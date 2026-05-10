const MODE_RULES = {
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
};
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
export function fullRules(mode) {
    return (MODE_RULES[mode] ?? MODE_RULES.full) + EXCEPTIONS;
}
export function reinforcement(mode) {
    switch (mode) {
        case "lite":
            return "[RUNES: LITE] COMPRESS LITE: Drop filler/hedging. Keep articles + full sentences. Professional-tight.";
        case "ultra":
            return "[RUNES: ULTRA] COMPRESS ULTRA: MetaGlyph (∈ → ∀ ∃ ∴ !). Abbreviate prose (DB/fn/req/res/impl/ctx/err). Strip conjunctions. CoD: reason silently → answer. Arrows for causality.";
        default:
            return "[RUNES: FULL] COMPRESS FULL: Drop articles. Fragments OK. No pleasantries. High-signal.";
    }
}
export function badge(mode) {
    if (!mode || mode === "off")
        return "[RUNES: OFF]";
    return `[RUNES: ${mode.toUpperCase()}]`;
}
//# sourceMappingURL=rules.js.map