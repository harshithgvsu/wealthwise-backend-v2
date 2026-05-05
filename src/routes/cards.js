const express = require("express");
const router = express.Router();
const Card = require("../models/Card");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// GET /cards — all cards for the logged-in user
router.get("/", async (req, res) => {
  try {
    const cards = await Card.find({ userId: req.user._id }).sort({ createdAt: 1 });
    res.json({
      success: true,
      cards: cards.map((c) => c.toClient()),
    });
  } catch (err) {
    console.error("Get cards error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /cards — add a card
router.post("/", async (req, res) => {
  try {
    const data = req.body;
    const clientId = data.id || data.clientId;

    if (!clientId || !data.name || !data.issuer) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const card = await Card.findOneAndUpdate(
      { userId: req.user._id, clientId },
      {
        userId: req.user._id,
        clientId,
        presetId: data.presetId,
        name: data.name,
        issuer: data.issuer,
        network: data.network,
        annualFee: data.annualFee || 0,
        rewardType: data.rewardType || "cashback",
        baseReward: data.baseReward || 1,
        rewards: data.rewards || {},
        centsPerPoint: data.centsPerPoint || 1,
        cardBg: data.cardBg,
        color: data.color,
        creditLimit: data.creditLimit,
        currentBalance: data.currentBalance,
        signupBonus: data.signupBonus,
        signupSpend: data.signupSpend,
        spentTowardBonus: data.spentTowardBonus || 0,
      },
      { upsert: true, new: true }
    );

    res.status(201).json({
      success: true,
      card: card.toClient(),
    });
  } catch (err) {
    console.error("Create card error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /cards/bulk — sync all cards at once
router.post("/bulk", async (req, res) => {
  try {
    const { cards } = req.body;
    if (!Array.isArray(cards)) {
      return res.status(400).json({ success: false, error: "cards must be an array" });
    }

    const ops = cards.map((data) => {
      const clientId = data.id || data.clientId;
      return {
        updateOne: {
          filter: { userId: req.user._id, clientId },
          update: {
            $set: {
              userId: req.user._id,
              clientId,
              presetId: data.presetId,
              name: data.name,
              issuer: data.issuer,
              network: data.network,
              annualFee: data.annualFee || 0,
              rewardType: data.rewardType || "cashback",
              baseReward: data.baseReward || 1,
              rewards: data.rewards || {},
              centsPerPoint: data.centsPerPoint || 1,
              cardBg: data.cardBg,
              color: data.color,
              creditLimit: data.creditLimit,
              currentBalance: data.currentBalance,
              signupBonus: data.signupBonus,
              signupSpend: data.signupSpend,
              spentTowardBonus: data.spentTowardBonus || 0,
            },
          },
          upsert: true,
        },
      };
    });

    await Card.bulkWrite(ops);
    res.json({ success: true });
  } catch (err) {
    console.error("Bulk cards error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /cards/:id — delete by clientId
router.delete("/:id", async (req, res) => {
  try {
    const result = await Card.findOneAndDelete({
      userId: req.user._id,
      clientId: req.params.id,
    });

    if (!result) {
      return res.status(404).json({ success: false, error: "Card not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete card error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
