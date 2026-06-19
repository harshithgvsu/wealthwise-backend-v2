const mongoose = require("mongoose");

const cardPresetSchema = new mongoose.Schema(
  {
    presetId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    issuer: { type: String, required: true },
    network: { type: String, required: true },
    annualFee: { type: Number, default: 0 },
    rewardType: { type: String, enum: ["points", "cashback", "miles"], default: "cashback" },
    baseReward: { type: Number, default: 1 },
    rewards: { type: Map, of: Number, default: {} },
    centsPerPoint: { type: Number, default: 1 },
    cardBg: { type: String },
    color: { type: String },
    signupBonus: { type: String },
    signupSpend: { type: Number },
    scrapeSource: { type: String },
    lastScraped: { type: Date },
  },
  { timestamps: true }
);

cardPresetSchema.methods.toClient = function () {
  const obj = this.toObject();
  obj.id = obj.presetId;
  delete obj._id;
  delete obj.__v;
  if (obj.rewards instanceof Map) {
    obj.rewards = Object.fromEntries(obj.rewards);
  }
  return obj;
};

module.exports = mongoose.model("CardPreset", cardPresetSchema);
