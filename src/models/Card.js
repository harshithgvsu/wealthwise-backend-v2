const mongoose = require("mongoose");

const cardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // clientId = the UUID generated on the frontend
    clientId: { type: String, required: true },
    presetId: { type: String },
    name: { type: String, required: true },
    issuer: { type: String, required: true },
    network: { type: String, required: true },
    annualFee: { type: Number, default: 0 },
    rewardType: {
      type: String,
      enum: ["points", "cashback", "miles"],
      default: "cashback",
    },
    baseReward: { type: Number, default: 1 },
    rewards: { type: Map, of: Number, default: {} },
    centsPerPoint: { type: Number, default: 1 },
    cardBg: { type: String },
    color: { type: String },
    creditLimit: { type: Number },
    currentBalance: { type: Number },
    signupBonus: { type: String },
    signupSpend: { type: Number },
    spentTowardBonus: { type: Number, default: 0 },
    cardType: { type: String, enum: ["credit", "debit"], default: "credit" },
  },
  {
    timestamps: true,
  }
);

cardSchema.index({ userId: 1, clientId: 1 }, { unique: true });

cardSchema.methods.toClient = function () {
  const obj = this.toObject();
  obj.id = obj.clientId; // Frontend uses clientId as the card's id
  delete obj._id;
  delete obj.__v;
  delete obj.userId;
  // Convert Map to plain object for JSON
  if (obj.rewards instanceof Map) {
    obj.rewards = Object.fromEntries(obj.rewards);
  }
  return obj;
};

module.exports = mongoose.model("Card", cardSchema);
