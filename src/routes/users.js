const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");

// PATCH /users/:id — update financial profile
router.patch("/:id", authenticate, async (req, res) => {
  try {
    // Users can only update their own profile
    if (req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    const allowed = [
      "name",
      "grossMonthlyIncome",
      "netMonthlyIncome",
      "health401kMonthly",
      "otherPreTaxBenefits",
      "rentMortgage",
      "carPayment",
      "insurancePremiums",
      "subscriptions",
      "otherFixedExpenses",
      "savingsGoalPercent",
      "investmentGoal",
      "riskTolerance",
      "investmentHorizonYears",
      "onboardingComplete",
    ];

    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    Object.assign(req.user, updates);
    await req.user.save();

    res.json({
      success: true,
      user: req.user.toProfile(),
    });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
