const express = require("express");
const router = express.Router();
const Expense = require("../models/Expense");
const { authenticate } = require("../middleware/auth");

// All expense routes require auth
router.use(authenticate);

// GET /expenses — fetch all expenses for the logged-in user
router.get("/", async (req, res) => {
  try {
    const expenses = await Expense.find({ userId: req.user._id })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    res.json({
      success: true,
      expenses: expenses.map((e) => {
        const out = { ...e };
        out.id = out._id.toString();
        delete out._id;
        delete out.__v;
        delete out.userId;
        return out;
      }),
    });
  } catch (err) {
    console.error("Get expenses error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /expenses — create a single expense
// Supports both single object and { expense: {...} } wrapper (frontend sends wrapper)
router.post("/", async (req, res) => {
  try {
    const data = req.body.expense || req.body;

    if (!data.amount || !data.category || !data.description || !data.date) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    // Use clientId (frontend UUID) for deduplication
    const clientId = data.id || data.clientId;

    // Upsert by clientId so re-syncing the same expense is idempotent
    const expense = await Expense.findOneAndUpdate(
      { userId: req.user._id, clientId },
      {
        userId: req.user._id,
        clientId,
        amount: data.amount,
        category: data.category,
        description: data.description,
        date: data.date,
        cardId: data.cardId,
        cardLabel: data.cardLabel,
        rewardRate: data.rewardRate || 0,
        rewardsEarned: data.rewardsEarned || 0,
        rewardType: data.rewardType || "cashback",
      },
      { upsert: true, new: true }
    );

    res.status(201).json({
      success: true,
      expense: expense.toClient(),
    });
  } catch (err) {
    console.error("Create expense error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /expenses/bulk — sync multiple expenses at once (useful for initial migration)
router.post("/bulk", async (req, res) => {
  try {
    const { expenses } = req.body;

    if (!Array.isArray(expenses)) {
      return res.status(400).json({ success: false, error: "expenses must be an array" });
    }

    const ops = expenses.map((data) => {
      const clientId = data.id || data.clientId;
      return {
        updateOne: {
          filter: { userId: req.user._id, clientId },
          update: {
            $set: {
              userId: req.user._id,
              clientId,
              amount: data.amount,
              category: data.category,
              description: data.description,
              date: data.date,
              cardId: data.cardId,
              cardLabel: data.cardLabel,
              rewardRate: data.rewardRate || 0,
              rewardsEarned: data.rewardsEarned || 0,
              rewardType: data.rewardType || "cashback",
            },
          },
          upsert: true,
        },
      };
    });

    const result = await Expense.bulkWrite(ops);

    res.json({
      success: true,
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error("Bulk expense error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /expenses/:id — delete by clientId or MongoDB _id
router.delete("/:id", async (req, res) => {
  try {
    const result = await Expense.findOneAndDelete({
      userId: req.user._id,
      $or: [
        { clientId: req.params.id },
        // Also try matching by _id in case it's a MongoDB ObjectId
        ...(req.params.id.match(/^[a-f\d]{24}$/i)
          ? [{ _id: req.params.id }]
          : []),
      ],
    });

    if (!result) {
      return res.status(404).json({ success: false, error: "Expense not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete expense error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /expenses — delete ALL expenses for the user (reset)
router.delete("/", async (req, res) => {
  try {
    await Expense.deleteMany({ userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    console.error("Reset expenses error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
