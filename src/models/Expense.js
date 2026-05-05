const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    category: {
      type: String,
      required: true,
      enum: [
        "Food & Dining",
        "Transport",
        "Shopping",
        "Health",
        "Entertainment",
        "Bills & Utilities",
        "Education",
        "Other",
      ],
    },
    description: { type: String, required: true, trim: true, maxlength: 200 },
    date: { type: String, required: true }, // YYYY-MM-DD — kept as string to match frontend
    cardId: { type: String },
    cardLabel: { type: String },
    rewardRate: { type: Number, default: 0 },
    rewardsEarned: { type: Number, default: 0 },
    rewardType: {
      type: String,
      enum: ["points", "miles", "cashback"],
      default: "cashback",
    },
    // clientId is the UUID generated on the frontend — used for deduplication
    // so if the same expense is synced twice we don't create a duplicate
    clientId: { type: String, index: true },
  },
  {
    timestamps: true,
  }
);

// Compound index: one clientId per user
expenseSchema.index({ userId: 1, clientId: 1 }, { unique: true, sparse: true });

expenseSchema.methods.toClient = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  delete obj._id;
  delete obj.__v;
  delete obj.userId;
  return obj;
};

module.exports = mongoose.model("Expense", expenseSchema);
