require("./setup");
const request = require("supertest");

// Build a minimal express app that mirrors the real one but uses the in-memory DB
const express = require("express");
const app = express();
app.use(express.json());
app.use("/cards", require("../src/routes/cards"));

const CardPreset = require("../src/models/CardPreset");

const SAMPLE_PRESET = {
  presetId: "test-card",
  name: "Test Rewards",
  issuer: "TestBank",
  network: "Visa",
  annualFee: 95,
  rewardType: "points",
  baseReward: 1,
  rewards: { Travel: 3, "Food & Dining": 2 },
  centsPerPoint: 1.25,
  cardBg: "from-blue-900 to-blue-600",
  color: "#2563EB",
};

describe("GET /cards/presets", () => {
  it("returns empty array when no presets exist", async () => {
    const res = await request(app).get("/cards/presets");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.presets).toEqual([]);
  });

  it("returns seeded presets without requiring auth", async () => {
    await CardPreset.create(SAMPLE_PRESET);
    const res = await request(app).get("/cards/presets");
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(1);
    expect(res.body.presets[0].id).toBe("test-card");
    expect(res.body.presets[0].name).toBe("Test Rewards");
  });

  it("returns rewards as a plain object (not Map)", async () => {
    await CardPreset.create(SAMPLE_PRESET);
    const res = await request(app).get("/cards/presets");
    expect(res.body.presets[0].rewards).toEqual({ Travel: 3, "Food & Dining": 2 });
  });

  it("returns multiple presets sorted by issuer then name", async () => {
    await CardPreset.create([
      { ...SAMPLE_PRESET, presetId: "b-card", name: "Z Card", issuer: "Zbank" },
      { ...SAMPLE_PRESET, presetId: "a-card", name: "A Card", issuer: "Abank" },
    ]);
    const res = await request(app).get("/cards/presets");
    expect(res.body.presets[0].issuer).toBe("Abank");
    expect(res.body.presets[1].issuer).toBe("Zbank");
  });

  it("does not expose _id or userId fields", async () => {
    await CardPreset.create(SAMPLE_PRESET);
    const res = await request(app).get("/cards/presets");
    const preset = res.body.presets[0];
    expect(preset._id).toBeUndefined();
    expect(preset.__v).toBeUndefined();
  });
});
