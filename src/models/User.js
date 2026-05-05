const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    // Financial profile
    grossMonthlyIncome: { type: Number, default: 0 },
    netMonthlyIncome: { type: Number, default: 0 },
    health401kMonthly: { type: Number, default: 0 },
    otherPreTaxBenefits: { type: Number, default: 0 },
    rentMortgage: { type: Number, default: 0 },
    carPayment: { type: Number, default: 0 },
    insurancePremiums: { type: Number, default: 0 },
    subscriptions: { type: Number, default: 0 },
    otherFixedExpenses: { type: Number, default: 0 },
    savingsGoalPercent: { type: Number, default: 20 },
    investmentGoal: {
      type: String,
      enum: ["retirement", "property", "emergency", "growth", "other"],
      default: "retirement",
    },
    riskTolerance: {
      type: String,
      enum: ["conservative", "moderate", "aggressive"],
      default: "moderate",
    },
    investmentHorizonYears: { type: Number, default: 20 },
    onboardingComplete: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash")) return next();
  // passwordHash field actually stores the plaintext temporarily before hashing
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (plaintext) {
  return bcrypt.compare(plaintext, this.passwordHash);
};

// Strip sensitive fields when converting to JSON
userSchema.methods.toProfile = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.__v;
  // Rename _id to id for frontend compatibility
  obj.id = obj._id.toString();
  delete obj._id;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
