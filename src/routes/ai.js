const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// GET /ai/health — diagnostic only, never leaks the key itself.
// Hit this on the deployed backend (logged in) to check whether AI chat
// is actually configured, instead of guessing from silent fallback: true
// responses. See graphify audit finding #7.
router.get("/health", async (_req, res) => {
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  let ollamaReachable = false;
  try {
    const r = await fetch(`${ollamaHost}/v1/models`, { signal: AbortSignal.timeout(2000) });
    ollamaReachable = r.ok;
  } catch {
    ollamaReachable = false;
  }
  const anthropicKeyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const activeProvider = ollamaReachable ? "ollama" : anthropicKeyConfigured ? "anthropic" : "none";
  res.json({
    activeProvider,
    ollamaReachable,
    anthropicKeyConfigured,
    note: activeProvider === "none"
      ? "Neither Ollama nor ANTHROPIC_API_KEY is reachable/set — /ai/chat and /ai/parse-expense will always return { fallback: true }."
      : `AI calls will use ${activeProvider}.`,
  });
});

// ── LLM client factory ────────────────────────────────────────────────────────
// Priority: Ollama (local, free) → Anthropic (cloud, API key required)
async function callLLM({ system, messages, maxTokens = 350 }) {
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.1";

  // Try Ollama first
  try {
    const res = await fetch(`${ollamaHost}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: "system", content: system }, ...messages],
        stream: false,
        max_tokens: maxTokens,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, provider: "ollama" };
    }
  } catch {
    // Ollama not running — fall through to Anthropic
  }

  // Fall back to Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages,
    });
    return { text: response.content[0].text, provider: "anthropic" };
  }

  return null;
}

// POST /ai/chat
router.post("/chat", async (req, res) => {
  const { message, expenses = [], profile = {}, history = [] } = req.body;
  if (!message) return res.status(400).json({ success: false, error: "message required" });

  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  const monthExp = expenses.filter((e) => {
    const d = new Date(e.date);
    return d.getFullYear() === cy && d.getMonth() + 1 === cm;
  });
  const total = monthExp.reduce((s, e) => s + (e.amount || 0), 0);
  const byCat = {};
  for (const e of monthExp) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const fixed = (profile.rentMortgage || 0) + (profile.carPayment || 0) +
    (profile.insurancePremiums || 0) + (profile.subscriptions || 0) + (profile.otherFixedExpenses || 0);
  const disposable = (profile.netMonthlyIncome || 0) - fixed;

  const systemPrompt = `You are a personal finance AI assistant for WealthWise. Be concise, practical, and encouraging. Use markdown bold (**text**) for key numbers. Keep replies under 150 words unless the user explicitly asks for detail.

User profile:
- Name: ${profile.name || "User"}
- Gross monthly income: $${profile.grossMonthlyIncome || 0}
- Take-home: $${profile.netMonthlyIncome || 0}/mo
- Fixed expenses: $${fixed.toFixed(0)}/mo (rent, car, insurance, subscriptions)
- Disposable income: $${disposable.toFixed(0)}/mo
- Savings goal: ${profile.savingsGoalPercent || 20}% of income
- Investment goal: ${profile.investmentGoal || "retirement"}
- Risk tolerance: ${profile.riskTolerance || "moderate"}
- Investment horizon: ${profile.investmentHorizonYears || 20} years

This month so far:
- Total spent: $${total.toFixed(2)} across ${monthExp.length} transactions
- By category: ${Object.entries(byCat).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(", ") || "none yet"}
- Remaining disposable: $${(disposable - total).toFixed(2)}

When suggesting investments, give specific ETF/fund names and allocation percentages. Always ground advice in their actual numbers above.`;

  const safeHistory = (history || [])
    .slice(-8)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const result = await callLLM({
      system: systemPrompt,
      messages: [...safeHistory, { role: "user", content: message }],
      maxTokens: 350,
    });

    if (!result) return res.json({ success: true, fallback: true });
    res.json({ success: true, reply: result.text, provider: result.provider, fallback: false });
  } catch (err) {
    const status = err.status || err.statusCode;
    if (status === 429 || status === 529 || status === 402) {
      return res.json({ success: true, fallback: true });
    }
    console.error("AI chat error:", err.message);
    res.json({ success: true, fallback: true });
  }
});

// POST /ai/parse-expense
router.post("/parse-expense", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ success: false, error: "text required" });

  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `Extract expense details from the user's message. Return ONLY valid JSON — no explanation, no markdown.

Schema:
{
  "amount": number,       // positive dollar amount, required
  "category": string,     // exactly one of: "Food & Dining" | "Transport" | "Shopping" | "Health" | "Entertainment" | "Bills & Utilities" | "Education" | "Other"
  "description": string,  // short clean description (3-6 words)
  "date": string          // YYYY-MM-DD, use ${today} if not specified
}

If you cannot find a dollar amount, return: {"error": "no amount"}`;

  try {
    const result = await callLLM({
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
      maxTokens: 120,
    });

    if (!result) return res.json({ success: true, fallback: true });

    let parsed;
    try {
      const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(raw);
    } catch {
      return res.json({ success: true, fallback: true });
    }

    if (parsed.error || !parsed.amount || parsed.amount <= 0) {
      return res.json({ success: true, fallback: true });
    }

    res.json({ success: true, parsed, provider: result.provider, fallback: false });
  } catch (err) {
    const status = err.status || err.statusCode;
    if (status === 429 || status === 529 || status === 402) {
      return res.json({ success: true, fallback: true });
    }
    console.error("AI parse error:", err.message);
    res.json({ success: true, fallback: true });
  }
});

// POST /ai/trip-ideas — seasonal trip budget narrative.
// Cross-platform: nothing here or on the frontend caller (SeasonalTripPlanner.tsx)
// is gated to any device/OS. The frontend computes and shows a deterministic
// seasonal breakdown itself and works fully without this endpoint; this only
// adds an optional, more personalized narrative on top when a provider is
// configured. No dedicated "Travel" expense category exists yet, so this
// reasons from total monthly spend vs. disposable income, same as the
// deterministic version — it doesn't pretend to know more than the data does.
router.post("/trip-ideas", async (req, res) => {
  const { expenses = [], profile = {} } = req.body;

  const SEASON_OF = (m) => (m === 12 || m <= 2 ? "Winter" : m <= 5 ? "Spring" : m <= 8 ? "Summer" : "Fall");
  const spendByMonth = {};
  for (const e of expenses) {
    const key = String(e.date || "").slice(0, 7);
    if (!key) continue;
    spendByMonth[key] = (spendByMonth[key] || 0) + (e.amount || 0);
  }
  const seasonTotals = { Winter: { sum: 0, n: 0 }, Spring: { sum: 0, n: 0 }, Summer: { sum: 0, n: 0 }, Fall: { sum: 0, n: 0 } };
  for (const [key, total] of Object.entries(spendByMonth)) {
    const month = Number(key.slice(5, 7));
    if (!month) continue;
    const s = SEASON_OF(month);
    seasonTotals[s].sum += total;
    seasonTotals[s].n += 1;
  }
  const seasonAverages = Object.entries(seasonTotals)
    .filter(([, v]) => v.n > 0)
    .map(([season, v]) => ({ season, avg: v.sum / v.n }));

  if (seasonAverages.length < 2) {
    return res.json({ success: true, fallback: true }); // not enough seasonal spread yet
  }

  const fixed = (profile.rentMortgage || 0) + (profile.carPayment || 0) +
    (profile.insurancePremiums || 0) + (profile.subscriptions || 0) + (profile.otherFixedExpenses || 0);
  const disposable = (profile.netMonthlyIncome || 0) - fixed;
  const best = seasonAverages.reduce((a, b) => (disposable - b.avg > disposable - a.avg ? b : a));

  const systemPrompt = `You are a travel budget assistant for WealthWise, a personal finance app. Be concise (under 120 words), practical, and grounded only in the numbers given — never invent prices, destinations-as-facts, or currency conversions you weren't given. Use markdown bold (**text**) for key numbers.

User's seasonal spending history (average total monthly spend per season):
${seasonAverages.map((s) => `- ${s.season}: $${s.avg.toFixed(0)}/mo`).join("\n")}

Disposable income: ~$${disposable.toFixed(0)}/mo
Historically lightest-spending season: ${best.season} (avg $${best.avg.toFixed(0)}/mo)
Savings goal: ${profile.savingsGoalPercent || 20}% of income

Suggest: (1) a realistic trip budget range grounded in the numbers above, (2) why ${best.season} (or another season if the data suggests otherwise) is a good window, (3) one lower-cost alternative if they want to save more first. Do not suggest specific destinations you have no basis for — talk in terms of trip scale (weekend/regional vs. week-long/international) instead.`;

  try {
    const result = await callLLM({ system: systemPrompt, messages: [{ role: "user", content: "Suggest a trip budget and timing based on my spending." }], maxTokens: 300 });
    if (!result) return res.json({ success: true, fallback: true });
    res.json({ success: true, reply: result.text, provider: result.provider, fallback: false });
  } catch (err) {
    const status = err.status || err.statusCode;
    if (status === 429 || status === 529 || status === 402) {
      return res.json({ success: true, fallback: true });
    }
    console.error("AI trip-ideas error:", err.message);
    res.json({ success: true, fallback: true });
  }
});

// Best card for travel purchases is computed here, not asked of the LLM —
// it's a deterministic lookup over data we already have (the user's real
// cards), so there's no reason to let the model reason about it and risk
// getting a real card's reward rate wrong.
function bestTravelCard(cards) {
  if (!Array.isArray(cards)) return null;
  let best = null;
  for (const c of cards) {
    if (!c || c.cardType === "debit") continue;
    const travelRate = c.rewards && typeof c.rewards.Travel === "number" ? c.rewards.Travel : null;
    const rate = travelRate ?? (typeof c.baseReward === "number" ? c.baseReward : 0);
    if (!best || rate > best.rate) {
      best = { name: c.name, issuer: c.issuer, rewardType: c.rewardType || "points", rate, usesBaseRate: travelRate === null };
    }
  }
  return best;
}

// POST /ai/trip-search — cheapest-way-to-get-there estimates for a specific
// origin/destination/date range, plus a feasibility read against the user's
// budget. This has no live flight/car-rental data source (Claude has no web
// access here — see callLLM above), so every price is a rough, clearly-
// labeled ballpark from the model's general knowledge, never a real quote.
router.post("/trip-search", async (req, res) => {
  const { originZip, destination, startDate, endDate, profile = {}, cards = [] } = req.body;

  if (!originZip || !destination || !startDate || !endDate) {
    return res.status(400).json({ success: false, error: "originZip, destination, startDate, and endDate are required" });
  }

  const depart = new Date(startDate);
  const ret = new Date(endDate);
  if (Number.isNaN(depart.getTime()) || Number.isNaN(ret.getTime()) || ret < depart) {
    return res.status(400).json({ success: false, error: "Invalid date range" });
  }
  const tripDays = Math.max(1, Math.round((ret - depart) / 86_400_000) + 1);

  const fixed = (profile.rentMortgage || 0) + (profile.carPayment || 0) +
    (profile.insurancePremiums || 0) + (profile.subscriptions || 0) + (profile.otherFixedExpenses || 0);
  const disposable = Math.max(0, (profile.netMonthlyIncome || 0) - fixed);
  const daysUntilTrip = Math.max(0, Math.round((depart - new Date()) / 86_400_000));
  const monthsUntilTrip = Math.max(0.25, daysUntilTrip / 30);

  const travelCard = bestTravelCard(cards);

  const systemPrompt = `You are a travel-cost estimation assistant for WealthWise, a personal finance app. You have no live internet access and no real-time pricing feed — every number you give is a rough, honest ballpark from general/historical knowledge of typical costs for this kind of route and season. NEVER imply these are real, current, or bookable quotes; never invent specific flight numbers, airline names, or exact prices framed as fact.

Trip request:
- Origin ZIP code: ${originZip}
- Destination: ${destination}
- Depart: ${startDate}, Return: ${endDate} (${tripDays} day trip)

Traveler's financial context:
- Disposable income: ~$${disposable.toFixed(0)}/month after fixed expenses
- Time until departure: ~${monthsUntilTrip.toFixed(1)} months
- Savings goal: ${profile.savingsGoalPercent || 20}% of income

Return ONLY valid JSON, no markdown fencing, no text outside the JSON, matching exactly:
{
  "options": [ { "mode": string, "estimateLow": number, "estimateHigh": number, "notes": string } ],
  "feasibility": string
}

Requirements:
- 2-4 realistic options for getting from the origin ZIP to the destination for these dates (e.g. flight + rental car, flight only using rideshare/transit, driving, train) — omit any mode that doesn't make sense for the likely distance (don't suggest driving for a clearly transcontinental or international trip).
- Each estimateLow/estimateHigh is a total round-trip USD range for ONE traveler covering that mode's transportation (and rental car cost if included), rounded to the nearest $10. Low should be a realistic budget-conscious price, high a realistic comfortable price — not worst-case.
- "notes" is one short sentence (max ~20 words) per option, no invented specifics framed as fact.
- "feasibility" is 1-3 direct sentences: given the disposable income and months until departure above, state plainly whether the cheapest realistic option looks affordable as-is, or whether they'd need to cut spending or wait longer — don't hedge into vagueness.`;

  try {
    const result = await callLLM({
      system: systemPrompt,
      messages: [{ role: "user", content: "Give me the cheapest realistic ways to make this trip, with a feasibility read against my budget." }],
      maxTokens: 500,
    });
    if (!result) return res.json({ success: true, fallback: true });

    let parsed;
    try {
      const raw = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      parsed = JSON.parse(raw);
    } catch {
      return res.json({ success: true, fallback: true });
    }
    if (!Array.isArray(parsed.options) || !parsed.options.length || typeof parsed.feasibility !== "string") {
      return res.json({ success: true, fallback: true });
    }

    res.json({
      success: true,
      fallback: false,
      provider: result.provider,
      tripPlan: { options: parsed.options, feasibility: parsed.feasibility, bestCardForTravel: travelCard },
    });
  } catch (err) {
    const status = err.status || err.statusCode;
    if (status === 429 || status === 529 || status === 402) {
      return res.json({ success: true, fallback: true });
    }
    console.error("AI trip-search error:", err.message);
    res.json({ success: true, fallback: true });
  }
});

module.exports = router;
