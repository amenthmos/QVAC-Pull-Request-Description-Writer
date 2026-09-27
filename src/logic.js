// QVAC Pull Request Description Writer — core logic.
// completion() does the actual generation; a small set of deterministic
// guards catch unusable model output (refusals, empty text, preamble).

import { completion } from "@qvac/sdk";

function looksUnusable(text) {
  if (!text || text.trim().length === 0) return true;
  if (text.length > 1200) return true;
  const bad = ["i cannot", "i can't", "as an ai", "i'm not able", "i am not able", "i apologize"];
  const lower = text.toLowerCase();
  return bad.some((phrase) => lower.includes(phrase));
}

function stripPreamble(text) {
  return text
    .trim()
    .replace(/^here'?s?[^:\n]*:\s*/i, "")
    .replace(/^sure[,!]?\s*/i, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

function significantWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

const TEST_KEYWORDS = ["test", "tested", "testing", "verified", "verify", "ran ", "checked", "qa "];

// Split "X, because Y" (or "... since/so that ...") into the change part
// and the reason part, and pull out any clause that actually describes
// testing that was done, so the Testing section can be grounded in what
// the user really said instead of the model guessing or denying it.
function splitInput(text) {
  const reasonMatch = text.match(/\b(because|since|so that)\b/i);
  let changePart = reasonMatch ? text.slice(0, reasonMatch.index).trim() : text.trim();
  const reasonPart = reasonMatch ? text.slice(reasonMatch.index + reasonMatch[0].length).trim() : "";

  const clauses = text.split(/,|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const testingClauses = clauses.filter((c) => TEST_KEYWORDS.some((k) => c.toLowerCase().includes(k)));
  const nonTestingClauses = clauses.filter((c) => !TEST_KEYWORDS.some((k) => c.toLowerCase().includes(k)));

  // Keep the change/summary text free of the testing clause so it doesn't
  // bleed into the wrong section.
  if (nonTestingClauses.length > 0 && !reasonMatch) changePart = nonTestingClauses.join(", ");

  return { changePart, reasonPart, testingClauses };
}

// Rewrite a single grounded fragment into a clean bullet via the model,
// with a strict check that the rewrite doesn't drift from the source
// fragment's own words — otherwise we keep the original fragment verbatim.
async function polish(modelId, fragment) {
  const run = completion({
    modelId,
    history: [
      {
        role: "system",
        content:
          "Rewrite the given fragment as one short, clean sentence for a pull-request description. Do NOT add any new information, files, systems, or details that are not already in the text — only clean up grammar and phrasing. Do not merge in content from any other example. Reply with ONLY the rewritten sentence, no bullet mark, no preamble.",
      },
      { role: "user", content: fragment },
    ],
    stream: true,
    completionOpts: { temperature: 0.15, maxTokens: Math.min(60, Math.ceil(fragment.length / 3) + 20) },
  });

  let text = "";
  for await (const token of run.tokenStream) text += token;
  text = stripPreamble(text).split("\n")[0].trim();

  // Grounding guard: require MOST of the rewrite's significant words to
  // actually come from the source fragment (not just one shared word),
  // and cap how much longer than the source it's allowed to be — this
  // catches the model splicing in unrelated content it has seen before.
  const srcWords = significantWords(fragment);
  const outWords = [...significantWords(text)];
  const overlap = outWords.filter((w) => srcWords.has(w)).length;
  const overlapRatio = outWords.length === 0 ? 0 : overlap / outWords.length;
  const safe =
    !looksUnusable(text) &&
    text.length > 0 &&
    text.length <= fragment.length * 1.6 + 20 &&
    (srcWords.size === 0 || overlapRatio >= 0.6);

  const base = (safe ? text : fragment).replace(/[.,;\s]+$/, "");
  const capped = base[0].toUpperCase() + base.slice(1);
  return capped + ".";
}

export async function generate(modelId, changes) {
  const { changePart, reasonPart, testingClauses } = splitInput(changes);

  // Polish changePart once and reuse it for both Summary and Changes —
  // calling polish() separately for each (as this originally did) doubled
  // the inference cost and, since generation isn't deterministic, could
  // produce two subtly different wordings of the same change.
  const changeBullet = await polish(modelId, changePart);

  const summaryBullets = [changeBullet];
  if (reasonPart) summaryBullets.push(`Motivation: ${await polish(modelId, reasonPart)}`);

  const changeBullets = [changeBullet];

  const testingBullets =
    testingClauses.length > 0
      ? await Promise.all(testingClauses.map((c) => polish(modelId, c)))
      : ["Manual verification recommended (no specific testing was described)."];

  const section = (title, items) => `## ${title}\n${items.map((i) => `- ${i}`).join("\n")}`;
  const output = [
    section("Summary", summaryBullets),
    section("Changes", changeBullets),
    section("Testing", testingBullets),
  ].join("\n\n");

  return { result: output };
}
