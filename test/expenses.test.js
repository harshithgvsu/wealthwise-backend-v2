require("./setup");
const request = require("supertest");
const express = require("express");

process.env.JWT_SECRET = "test-secret-key";
process.env.JWT_EXPIRES_IN = "1d";

const authApp = express();
authApp.use(express.json());
authApp.use("/auth", require("../src/routes/auth"));

const app = express();
app.use(express.json());
app.use("/expenses", require("../src/routes/expenses"));

async function createUser(email = `exp_${Date.now()}@example.com`) {
  const res = await request(authApp).post("/auth/signup").send({
    email, password: "password123", name: "Expense Tester",
  });
  return res.body.token;
}

let token;
beforeEach(async () => { token = await createUser(); });

const SAMPLE_EXPENSE = {
  amount: 42.5,
  category: "Food & Dining",
  description: "Lunch at cafe",
  date: "2026-06-15",
  clientId: "client-exp-1",
  cardId: "card-1",
  cardLabel: "Chase Sapphire",
  rewardRate: 3,
  rewardsEarned: 1.59,
};

describe("GET /expenses", () => {
  it("returns empty list initially", async () => {
    const res = await request(app).get("/expenses").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.expenses).toEqual([]);
  });

  it("requires auth", async () => {
    const res = await request(app).get("/expenses");
    expect(res.status).toBe(401);
  });
});

describe("POST /expenses", () => {
  it("creates an expense and returns it", async () => {
    const res = await request(app)
      .post("/expenses")
      .set("Authorization", `Bearer ${token}`)
      .send(SAMPLE_EXPENSE);
    expect(res.status).toBe(201);
    expect(res.body.expense.amount).toBe(42.5);
    expect(res.body.expense.rewardsEarned).toBe(1.59);
    expect(res.body.expense.userId).toBeUndefined();
  });

  it("requires amount, category, description, and date", async () => {
    const res = await request(app)
      .post("/expenses")
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 10 });
    expect(res.status).toBe(400);
  });

  it("deduplicates on clientId", async () => {
    await request(app).post("/expenses").set("Authorization", `Bearer ${token}`).send(SAMPLE_EXPENSE);
    await request(app).post("/expenses").set("Authorization", `Bearer ${token}`).send(SAMPLE_EXPENSE);
    const list = await request(app).get("/expenses").set("Authorization", `Bearer ${token}`);
    expect(list.body.expenses).toHaveLength(1);
  });
});

describe("DELETE /expenses/:id", () => {
  it("removes expense by id", async () => {
    const create = await request(app)
      .post("/expenses")
      .set("Authorization", `Bearer ${token}`)
      .send(SAMPLE_EXPENSE);
    const id = create.body.expense.id;

    const del = await request(app)
      .delete(`/expenses/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await request(app).get("/expenses").set("Authorization", `Bearer ${token}`);
    expect(list.body.expenses).toHaveLength(0);
  });
});
