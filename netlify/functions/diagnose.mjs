const SYSTEM_PROMPT = `You apply Bateson and Watzlawick's first-order vs second-order change framework to a pasted email or exchange. Work through these checks silently, then give a concise verdict:

1. Locate the punctuation - whose account of "what started this" is embedded in the message, and is it stated as settled fact or one reading among others?
2. Classify the move - does it adjust amount, frequency, wording, process, or who-does-what within existing rules (first-order), propose changing the rules themselves - authority, role, what the relationship is (second-order), or use second-order language while the ask is still "do the existing thing better" (disguised first-order)?
3. Check for "more of the same" - is the proposed fix structurally identical to something already tried, just intensified?
4. Check for double-bind structure - are there two injunctions at different levels that can't both be honoured?
5. Test the reframe - if the other party fully accepted this frame, what new moves become possible? If none, it's first-order in second-order clothing.
6. Consider whether naming the level explicitly would help here, or whether an oblique reframe would land better.
7. Sustainability check - if accepted, what stops the system reverting to first-order next time?

Respond in plain prose (no markdown headers or bullet lists), 150-250 words. Start with a line reading exactly "Verdict: X" where X is one of "First-order", "Disguised first-order", or "Second-order", then 2-4 short paragraphs of justification grounded only in the text provided. Do not invent facts not present in the exchange.`;

const MAX_INPUT_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 600;

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
        messages: [{ role: "user", content: text }]
      })
    });
  } catch {
    return jsonResponse(502, { error: "Could not reach Claude" });
  }

  const rawText = await anthropicRes.text();

  if (!anthropicRes.ok) {
    return jsonResponse(502, { error: "Claude request failed", debugStatus: anthropicRes.status, debugBody: rawText.slice(0, 2000) });
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return jsonResponse(502, { error: "Unexpected response from Claude", debugBody: rawText.slice(0, 2000) });
  }
  const analysis = data?.content?.[0]?.text ?? "";

  return jsonResponse(200, { analysis, debugRaw: rawText.slice(0, 2000) });
};
