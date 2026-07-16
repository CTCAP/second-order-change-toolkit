// Keep this in sync with the STEPS array in Diagnostic-Tool.dc.html —
// the keys here become the checkbox/note field names the client merges in.
const STEP_ITEMS = {
  punctuation: [
    "Whose account of \"what started this\" is embedded in the message is identifiable",
    "It is stated as settled fact rather than one reading among others",
    "The other party could plausibly punctuate the same sequence differently and still be right"
  ],
  classify: [
    "Adjusts amount, frequency, wording, process, or who-does-what within existing rules (first-order)",
    "Proposes changing the rules themselves - authority, role, what the relationship is (second-order)",
    "Uses second-order language but the ask is still \"do the existing thing better\" (disguised first-order)"
  ],
  moreofsame: [
    "The proposed fix is structurally identical to something already tried, just intensified",
    "The attempted solution is plausibly part of the problem rather than the cure"
  ],
  doublebind: [
    "There are two injunctions at different levels that can't both be honoured",
    "Naming the contradiction itself would be treated as the violation",
    "There is no way to respond that isn't penalised either way"
  ],
  reframe: [
    "If the other party fully accepted this frame, genuinely new moves become possible",
    "The honest answer is \"none, it's the same ask restated\" - so it's first-order in second-order clothing"
  ],
  namelevel: [
    "Naming the level explicitly would help here",
    "Naming it would trigger defensiveness, so an oblique reframe would land better",
    "This is a deliberate choice available to the sender, not a default they fell into"
  ],
  sustain: [
    "If a reframe is accepted, something stops the system reverting to first-order next time",
    "The message builds in a way to re-challenge the frame later rather than treat it as a one-off"
  ]
};

function buildFrameworkDescription() {
  return Object.entries(STEP_ITEMS)
    .map(([key, items]) => {
      const lines = items.map((text, idx) => `  ${key}-${idx}: ${text}`).join("\n");
      return `${key}:\n${lines}`;
    })
    .join("\n\n");
}

const SYSTEM_PROMPT = `You apply Bateson and Watzlawick's first-order vs second-order change framework to a pasted email or exchange.

For each of the following checklist items, decide true (this holds, based on the exchange) or false. Keys use "<check>-<index>" format:

${buildFrameworkDescription()}

Decide the overall verdict first, and write the recommendations before anything else: concrete suggestions (strictly 2-3 sentences, no more) for how second-order change could actually be implemented in this situation - specific reframes, questions to ask, or structural moves, not generic advice. This field is the most important part of your answer - never leave it blank.

Only after that, write the per-check notes (strictly one sentence each, max ~20 words - these are secondary, so keep them brief) and decide each of the true/false checklist items. Base everything only on the text provided; do not invent facts not present in the exchange.

Call the submit_diagnosis tool with your answer.`;

const itemProps = {};
const itemKeys = [];
for (const [key, items] of Object.entries(STEP_ITEMS)) {
  items.forEach((_, idx) => {
    const k = `${key}-${idx}`;
    itemProps[k] = { type: "boolean" };
    itemKeys.push(k);
  });
}

const noteKeys = Object.keys(STEP_ITEMS);
const noteProps = {};
noteKeys.forEach((key) => {
  noteProps[key] = { type: "string" };
});

// Order matters: Claude fills tool fields in the order they're listed here.
// verdict + recommendations come first so they survive if a long exchange
// makes the model run out of output tokens before reaching items/notes.
const INPUT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["first", "disguised", "second"] },
    recommendations: { type: "string" },
    items: { type: "object", properties: itemProps, required: itemKeys, additionalProperties: false },
    notes: { type: "object", properties: noteProps, required: noteKeys, additionalProperties: false }
  },
  required: ["verdict", "recommendations", "items", "notes"],
  additionalProperties: false
};

const MAX_INPUT_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 4096;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return jsonResponse(400, { error: "Missing 'text'" });
  }
  if (text.length > MAX_INPUT_CHARS) {
    return jsonResponse(400, { error: `Text too long (max ${MAX_INPUT_CHARS} characters)` });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "Server not configured" });
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        thinking: { type: "disabled" },
        tools: [
          {
            name: "submit_diagnosis",
            description: "Submit the structured second-order change diagnosis for this exchange.",
            input_schema: INPUT_SCHEMA
          }
        ],
        tool_choice: { type: "tool", name: "submit_diagnosis" },
        messages: [{ role: "user", content: text }]
      })
    });
  } catch {
    return jsonResponse(502, { error: "Could not reach Claude" });
  }

  if (!anthropicRes.ok) {
    return jsonResponse(502, { error: "Claude request failed" });
  }

  const data = await anthropicRes.json();
  const toolUse = (data.content || []).find((b) => b.type === "tool_use" && b.name === "submit_diagnosis");
  if (!toolUse) {
    return jsonResponse(502, { error: "Unexpected response from Claude" });
  }

  return jsonResponse(200, toolUse.input);
};
