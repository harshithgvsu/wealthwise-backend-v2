const express = require("express");
const router = express.Router();
const {
  PlaidApi,
  Configuration,
  PlaidEnvironments,
  Products,
  CountryCode,
} = require("plaid");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");

const plaidEnv = process.env.PLAID_ENV || "sandbox";

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaid = new PlaidApi(plaidConfig);

router.use(authenticate);

// POST /plaid/link-token — create a Link token for the frontend
router.post("/link-token", async (req, res) => {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return res.status(503).json({ success: false, error: "Plaid not configured" });
  }
  try {
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: req.user.id },
      client_name: "WealthWise",
      products: [Products.Transactions, Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    res.json({ success: true, link_token: response.data.link_token });
  } catch (err) {
    console.error("Plaid link-token error:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Failed to create link token" });
  }
});

// POST /plaid/exchange-token — exchange public_token for access_token
router.post("/exchange-token", async (req, res) => {
  const { public_token, institution_name, institution_id } = req.body;
  if (!public_token) return res.status(400).json({ success: false, error: "public_token required" });

  try {
    const exchangeRes = await plaid.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeRes.data;

    // Get account types to classify this item
    const accountsRes = await plaid.accountsGet({ access_token });
    const accountTypes = [...new Set(accountsRes.data.accounts.map((a) => a.type))];

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    // Replace existing item from same institution if reconnecting
    user.plaidItems = user.plaidItems.filter((i) => i.itemId !== item_id);
    user.plaidItems.push({
      itemId: item_id,
      accessToken: access_token,
      institutionName: institution_name || "Connected Bank",
      institutionId: institution_id || "",
      accountTypes,
      connectedAt: new Date(),
    });

    await user.save();
    res.json({ success: true, item_id, institution_name, account_types: accountTypes });
  } catch (err) {
    console.error("Plaid exchange-token error:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Failed to exchange token" });
  }
});

// GET /plaid/connections — list connected institutions
router.get("/connections", async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: "User not found" });

  const connections = user.plaidItems.map((item) => ({
    itemId: item.itemId,
    institutionName: item.institutionName,
    institutionId: item.institutionId,
    accountTypes: item.accountTypes,
    connectedAt: item.connectedAt,
  }));

  res.json({ success: true, connections });
});

// GET /plaid/transactions — fetch recent transactions from all bank items
router.get("/transactions", async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: "User not found" });

  const bankItems = user.plaidItems.filter((i) =>
    i.accountTypes.some((t) => ["depository", "credit"].includes(t))
  );

  if (!bankItems.length) return res.json({ success: true, transactions: [] });

  const end = new Date().toISOString().split("T")[0];
  const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const allTransactions = [];

    await Promise.all(
      bankItems.map(async (item) => {
        const txRes = await plaid.transactionsGet({
          access_token: item.accessToken,
          start_date: start,
          end_date: end,
          options: { count: 250 },
        });
        for (const tx of txRes.data.transactions) {
          // Skip pending and positive amounts (credits/refunds)
          if (tx.pending || tx.amount <= 0) continue;
          allTransactions.push({
            plaidId: tx.transaction_id,
            amount: tx.amount,
            description: tx.merchant_name || tx.name,
            date: tx.date,
            category: mapPlaidCategory(tx.personal_finance_category?.primary || tx.category?.[0]),
            institutionName: item.institutionName,
            accountId: tx.account_id,
          });
        }
      })
    );

    allTransactions.sort((a, b) => b.date.localeCompare(a.date));
    res.json({ success: true, transactions: allTransactions });
  } catch (err) {
    console.error("Plaid transactions error:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Failed to fetch transactions" });
  }
});

// GET /plaid/investments — fetch holdings from investment items (Robinhood etc.)
router.get("/investments", async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: "User not found" });

  const investmentItems = user.plaidItems.filter((i) =>
    i.accountTypes.includes("investment")
  );

  if (!investmentItems.length) return res.json({ success: true, holdings: [], accounts: [] });

  try {
    const allHoldings = [];
    const allAccounts = [];

    await Promise.all(
      investmentItems.map(async (item) => {
        const holdingsRes = await plaid.investmentsHoldingsGet({
          access_token: item.accessToken,
        });

        const securities = Object.fromEntries(
          holdingsRes.data.securities.map((s) => [s.security_id, s])
        );

        for (const holding of holdingsRes.data.holdings) {
          const sec = securities[holding.security_id] || {};
          allHoldings.push({
            accountId: holding.account_id,
            securityId: holding.security_id,
            ticker: sec.ticker_symbol || null,
            name: sec.name || "Unknown",
            type: sec.type || "other",
            quantity: holding.quantity,
            costBasis: holding.cost_basis,
            institutionValue: holding.institution_value,
            institutionPrice: holding.institution_price,
            institutionName: item.institutionName,
          });
        }

        for (const acct of holdingsRes.data.accounts) {
          allAccounts.push({
            accountId: acct.account_id,
            name: acct.name,
            type: acct.type,
            subtype: acct.subtype,
            balanceCurrent: acct.balances.current,
            institutionName: item.institutionName,
          });
        }
      })
    );

    res.json({ success: true, holdings: allHoldings, accounts: allAccounts });
  } catch (err) {
    console.error("Plaid investments error:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: "Failed to fetch investments" });
  }
});

// DELETE /plaid/disconnect/:itemId — remove a connected institution
router.delete("/disconnect/:itemId", async (req, res) => {
  const { itemId } = req.params;
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ success: false, error: "User not found" });

  const item = user.plaidItems.find((i) => i.itemId === itemId);
  if (!item) return res.status(404).json({ success: false, error: "Item not found" });

  try {
    await plaid.itemRemove({ access_token: item.accessToken });
  } catch {
    // Best-effort removal from Plaid side; still clean up locally
  }

  user.plaidItems = user.plaidItems.filter((i) => i.itemId !== itemId);
  await user.save();
  res.json({ success: true });
});

// Map Plaid categories to WealthWise categories
function mapPlaidCategory(raw) {
  if (!raw) return "Other";
  const r = raw.toLowerCase();
  if (r.includes("food") || r.includes("dining") || r.includes("restaurant") || r.includes("groceries")) return "Food & Dining";
  if (r.includes("transport") || r.includes("travel") || r.includes("taxi") || r.includes("gas_stations") || r.includes("auto")) return "Transport";
  if (r.includes("shops") || r.includes("retail") || r.includes("shopping") || r.includes("merchandise")) return "Shopping";
  if (r.includes("health") || r.includes("medical") || r.includes("pharmacy")) return "Health";
  if (r.includes("entertainment") || r.includes("recreation") || r.includes("arts")) return "Entertainment";
  if (r.includes("bills") || r.includes("utilities") || r.includes("rent") || r.includes("subscription") || r.includes("service")) return "Bills & Utilities";
  if (r.includes("education") || r.includes("university") || r.includes("school")) return "Education";
  return "Other";
}

module.exports = router;
