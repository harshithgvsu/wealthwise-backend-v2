const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

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

module.exports = router;
