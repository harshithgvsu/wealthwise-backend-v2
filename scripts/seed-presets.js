#!/usr/bin/env node
/**
 * Seed the card_presets collection with the initial catalog.
 * Safe to re-run — uses upsert so existing overrides from the scraper are preserved.
 *
 * Usage: node scripts/seed-presets.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const CardPreset = require("../src/models/CardPreset");

const SEED = [
  {
    presetId: "amex-gold",
    name: "Gold Card",
    issuer: "Amex",
    network: "Amex",
    annualFee: 250,
    signupBonus: "60,000 pts ($600)",
    signupSpend: 4000,
    rewards: { "Food & Dining": 4, Restaurant: 4, Groceries: 4, Travel: 3 },
    baseReward: 1,
    rewardType: "points",
    centsPerPoint: 1.0,
    color: "#D4A843",
    cardBg: "from-yellow-700 via-yellow-600 to-yellow-400",
    scrapeSource: "https://www.americanexpress.com/us/credit-cards/card/gold-card/",
  },
  {
    presetId: "chase-sapphire-preferred",
    name: "Sapphire Preferred",
    issuer: "Chase",
    network: "Visa",
    annualFee: 95,
    signupBonus: "60,000 pts ($750 travel)",
    signupSpend: 4000,
    rewards: { Travel: 3, "Food & Dining": 3, Restaurant: 3, Streaming: 3 },
    baseReward: 1,
    rewardType: "points",
    centsPerPoint: 1.25,
    color: "#2A6FBF",
    cardBg: "from-blue-900 via-blue-800 to-blue-600",
    scrapeSource: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
  },
  {
    presetId: "chase-sapphire-reserve",
    name: "Sapphire Reserve",
    issuer: "Chase",
    network: "Visa",
    annualFee: 550,
    signupBonus: "60,000 pts ($900 travel)",
    signupSpend: 4000,
    rewards: { Travel: 10, "Food & Dining": 3, Restaurant: 3, Gas: 3 },
    baseReward: 1,
    rewardType: "points",
    centsPerPoint: 1.5,
    color: "#1A1A2E",
    cardBg: "from-slate-900 via-slate-800 to-slate-700",
    scrapeSource: "https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve",
  },
  {
    presetId: "citi-double-cash",
    name: "Double Cash",
    issuer: "Citi",
    network: "Mastercard",
    annualFee: 0,
    rewards: {},
    baseReward: 2,
    rewardType: "cashback",
    centsPerPoint: 1,
    color: "#005792",
    cardBg: "from-sky-900 via-sky-800 to-sky-600",
    scrapeSource: "https://www.citi.com/credit-cards/citi-double-cash-credit-card",
  },
  {
    presetId: "amex-blue-cash-preferred",
    name: "Blue Cash Preferred",
    issuer: "Amex",
    network: "Amex",
    annualFee: 95,
    signupBonus: "$250 statement credit",
    signupSpend: 3000,
    rewards: { Groceries: 6, Streaming: 6, Gas: 3, Transit: 3 },
    baseReward: 1,
    rewardType: "cashback",
    centsPerPoint: 1,
    color: "#1A5276",
    cardBg: "from-blue-900 via-cyan-800 to-blue-500",
    scrapeSource: "https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/",
  },
  {
    presetId: "discover-it",
    name: "Discover it® Cash Back",
    issuer: "Discover",
    network: "Discover",
    annualFee: 0,
    signupBonus: "Cashback match first year",
    signupSpend: 0,
    rewards: { Groceries: 5, Gas: 5, Restaurants: 5 },
    baseReward: 1,
    rewardType: "cashback",
    centsPerPoint: 1,
    color: "#F97316",
    cardBg: "from-orange-700 via-orange-600 to-orange-400",
    scrapeSource: "https://www.discover.com/credit-cards/cash-back/",
  },
  {
    presetId: "venture-x",
    name: "Venture X",
    issuer: "Capital One",
    network: "Visa",
    annualFee: 395,
    signupBonus: "75,000 miles ($750 travel)",
    signupSpend: 4000,
    rewards: { Travel: 10, "Food & Dining": 2, Restaurant: 2 },
    baseReward: 2,
    rewardType: "miles",
    centsPerPoint: 1.0,
    color: "#C0392B",
    cardBg: "from-red-900 via-red-800 to-rose-600",
    scrapeSource: "https://creditcards.capitalone.com/venture-x-credit-card",
  },
  {
    presetId: "apple-card",
    name: "Apple Card",
    issuer: "Goldman Sachs",
    network: "Mastercard",
    annualFee: 0,
    rewards: { Apple: 3 },
    baseReward: 1,
    rewardType: "cashback",
    centsPerPoint: 1,
    color: "#9CA3AF",
    cardBg: "from-gray-600 via-gray-400 to-white",
    scrapeSource: "https://www.apple.com/apple-card/",
  },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  let seeded = 0;
  for (const preset of SEED) {
    await CardPreset.findOneAndUpdate(
      { presetId: preset.presetId },
      { $setOnInsert: preset }, // only insert if new — preserves scraper updates
      { upsert: true, new: true }
    );
    seeded++;
  }

  console.log(`Seeded ${seeded} card presets`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
