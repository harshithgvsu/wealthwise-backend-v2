#!/usr/bin/env node
/**
 * Weekly credit card benefit scraper.
 * Uses Playwright to visit each card's official page and extract
 * reward rates from the fully-rendered DOM.
 *
 * Usage:
 *   node scripts/refresh-presets.js              # update all cards
 *   node scripts/refresh-presets.js amex-gold    # update one card
 *
 * Run automatically via GitHub Actions on a weekly schedule.
 * Requires: MONGODB_URI in env, Playwright installed (npx playwright install chromium).
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const CardPreset = require("../src/models/CardPreset");

// ── Per-card scrape strategies ────────────────────────────────────────────────
// Each extractor receives the Playwright page object (fully rendered) and
// returns a partial CardPreset object with only the fields that changed.
// Return null to signal "no data found, keep existing".

const STRATEGIES = {
  "amex-gold": async (page) => {
    await page.goto("https://www.americanexpress.com/us/credit-cards/card/gold-card/", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractAmex(page, "amex-gold");
  },

  "amex-blue-cash-preferred": async (page) => {
    await page.goto("https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractAmex(page, "amex-blue-cash-preferred");
  },

  "chase-sapphire-preferred": async (page) => {
    await page.goto("https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractChase(page);
  },

  "chase-sapphire-reserve": async (page) => {
    await page.goto("https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractChase(page);
  },

  "citi-double-cash": async (page) => {
    await page.goto("https://www.citi.com/credit-cards/citi-double-cash-credit-card", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractCiti(page);
  },

  "discover-it": async (page) => {
    await page.goto("https://www.discover.com/credit-cards/cash-back/it-card.html", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractDiscover(page);
  },

  "venture-x": async (page) => {
    await page.goto("https://creditcards.capitalone.com/venture-x-credit-card", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractCapitalOne(page);
  },

  "apple-card": async (page) => {
    await page.goto("https://www.apple.com/apple-card/", {
      waitUntil: "networkidle", timeout: 30000,
    });
    return extractApple(page);
  },
};

// ── Extractors ────────────────────────────────────────────────────────────────

async function extractAmex(page, presetId) {
  try {
    // Amex renders reward rates in text like "4X points" or "6% Cash Back"
    const text = await page.evaluate(() => document.body.innerText);
    const rewards = {};
    const feeMatch = text.match(/\$(\d+)\s*annual fee/i);
    const annualFee = feeMatch ? parseInt(feeMatch[1]) : null;

    // Look for "NX points at [category]" or "N% cash back at [category]"
    const ratePattern = /(\d+)[xX×]\s+(?:Membership Rewards®?\s+)?[Pp]oints?\s+(?:at\s+)?(?:eligible\s+)?([\w\s&]+?)(?:\.|,|$|\n)/g;
    const cashPattern = /(\d+)%\s+[Cc]ash\s+[Bb]ack\s+(?:at\s+)?(?:eligible\s+)?([\w\s&]+?)(?:\.|,|$|\n)/g;

    for (const m of text.matchAll(ratePattern)) {
      const rate = parseInt(m[1]);
      const cat = normalizeCat(m[2].trim());
      if (cat && rate > 1) rewards[cat] = rate;
    }
    for (const m of text.matchAll(cashPattern)) {
      const rate = parseInt(m[1]);
      const cat = normalizeCat(m[2].trim());
      if (cat && rate > 1) rewards[cat] = rate;
    }

    const result = {};
    if (Object.keys(rewards).length) result.rewards = rewards;
    if (annualFee !== null) result.annualFee = annualFee;
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}

async function extractChase(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    const rewards = {};

    // Chase uses "Earn NX points on [category]" patterns
    const pattern = /[Ee]arn\s+(\d+)[xX×]\s+(?:total\s+)?[Pp]oints?\s+(?:on\s+)?([\w\s&,]+?)(?:\.|—|and|\n|$)/g;
    for (const m of text.matchAll(pattern)) {
      const rate = parseInt(m[1]);
      const cats = m[2].split(/,|and/).map((c) => normalizeCat(c.trim())).filter(Boolean);
      cats.forEach((c) => { if (rate > 1) rewards[c] = rate; });
    }

    const feeMatch = text.match(/\$(\d+)\s*annual fee/i);
    const result = {};
    if (Object.keys(rewards).length) result.rewards = rewards;
    if (feeMatch) result.annualFee = parseInt(feeMatch[1]);
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}

async function extractCiti(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    // Citi Double Cash: look for "2% cash back" confirmation
    const baseMatch = text.match(/(\d+)%\s+cash\s+back\s+on\s+(?:all|every)/i);
    if (baseMatch) return { baseReward: parseInt(baseMatch[1]) };
    return null;
  } catch {
    return null;
  }
}

async function extractDiscover(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    const rewards = {};
    const pattern = /(\d+)%\s+cash\s+back\s+(?:at\s+)?([\w\s&]+?)(?:\.|,|\n|$)/gi;
    for (const m of text.matchAll(pattern)) {
      const rate = parseInt(m[1]);
      const cat = normalizeCat(m[2].trim());
      if (cat && rate > 1) rewards[cat] = rate;
    }
    return Object.keys(rewards).length ? { rewards } : null;
  } catch {
    return null;
  }
}

async function extractCapitalOne(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    const rewards = {};
    const pattern = /(\d+)[xX×]\s+miles?\s+(?:on\s+)?([\w\s&]+?)(?:\.|,|\n|$)/gi;
    for (const m of text.matchAll(pattern)) {
      const rate = parseInt(m[1]);
      const cat = normalizeCat(m[2].trim());
      if (cat && rate > 1) rewards[cat] = rate;
    }
    const feeMatch = text.match(/\$(\d+)\s*annual fee/i);
    const result = {};
    if (Object.keys(rewards).length) result.rewards = rewards;
    if (feeMatch) result.annualFee = parseInt(feeMatch[1]);
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}

async function extractApple(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    const rewards = {};
    // Apple Card: "3% Daily Cash at Apple", "2% with Apple Pay"
    const pattern = /(\d+)%\s+Daily\s+Cash\s+(?:at\s+|with\s+)?([\w\s]+?)(?:\.|,|\n|$)/gi;
    for (const m of text.matchAll(pattern)) {
      const rate = parseInt(m[1]);
      const cat = normalizeCat(m[2].trim());
      if (cat && rate > 1) rewards[cat] = rate;
    }
    return Object.keys(rewards).length ? { rewards } : null;
  } catch {
    return null;
  }
}

// ── Category normalizer ───────────────────────────────────────────────────────
const CAT_MAP = {
  restaurant: "Food & Dining", restaurants: "Food & Dining", dining: "Food & Dining",
  "food & dining": "Food & Dining", food: "Food & Dining",
  supermarket: "Groceries", "u.s. supermarket": "Groceries", grocery: "Groceries",
  groceries: "Groceries",
  travel: "Travel", hotel: "Travel", flight: "Travel", airline: "Travel",
  gas: "Gas", "gas station": "Gas", "u.s. gas station": "Gas",
  streaming: "Streaming",
  transit: "Transit",
  "apple pay": "Apple Pay",
  apple: "Apple",
};
function normalizeCat(raw) {
  const lower = raw.toLowerCase().trim();
  if (CAT_MAP[lower]) return CAT_MAP[lower];
  for (const [k, v] of Object.entries(CAT_MAP)) {
    if (lower.includes(k)) return v;
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { chromium } = require("playwright");

  const targetId = process.argv[2]; // optional: update one card only
  const targets = targetId
    ? STRATEGIES[targetId]
      ? { [targetId]: STRATEGIES[targetId] }
      : (() => { console.error(`Unknown presetId: ${targetId}`); process.exit(1); })()
    : STRATEGIES;

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let updated = 0, skipped = 0, failed = 0;

  for (const [presetId, strategy] of Object.entries(targets)) {
    try {
      console.log(`Scraping ${presetId}...`);
      const patch = await strategy(page);

      if (!patch || Object.keys(patch).length === 0) {
        console.log(`  ↳ No data extracted — keeping existing values`);
        skipped++;
        continue;
      }

      await CardPreset.findOneAndUpdate(
        { presetId },
        { $set: { ...patch, lastScraped: new Date() } }
      );
      console.log(`  ↳ Updated: ${JSON.stringify(patch)}`);
      updated++;
    } catch (err) {
      console.error(`  ↳ Failed: ${err.message}`);
      failed++;
    }
  }

  await browser.close();
  await mongoose.disconnect();
  console.log(`\nDone — updated: ${updated}, skipped: ${skipped}, failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
