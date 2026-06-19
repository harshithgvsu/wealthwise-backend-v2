require("./setup");
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret-key";
process.env.JWT_EXPIRES_IN = "1d";

const authApp = express();
authApp.use(express.json());
authApp.use("/auth", require("../src/routes/auth"));

const app = express();
app.use(express.json());
app.use("/cards", require("../src/routes/cards"));

let token;

async function createUser() {
  const res = await request(authApp).post("/auth/signup").send({
    email: `cards_${Date.now()}@example.com`,
    password: "password123",
    name: "Card Tester",
  });
  return res.body.token;
}

beforeEach(async () => {
  token = await createUser();
});

const SAMPLE_CARD = {
  id: "client-uuid-1",
  name: "Chase Sapphire Preferred",
  issuer: "Chase",
  network: "Visa",
  annualFee: 95,
  rewardType: "points",
  baseReward: 1,
  rewards: { Travel: 3 },
  centsPerPoint: 1.25,
  cardBg: "from-blue-900 to-blue-600",
  color: "#2563EB",
};

describe("GET /cards (user cards)", () => {
  it("returns empty list initially", async () => {
    const res = await request(app).get("/cards").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual([]);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/cards");
    expect(res.status).toBe(401);
  });
});

describe("POST /cards (add user card)", () => {
  it("creates a card and returns it", async () => {
    const res = await request(app)
      .post("/cards")
      .set("Authorization", `Bearer ${token}`)
      .send(SAMPLE_CARD);
    expect(res.status).toBe(201);
    expect(res.body.card.name).toBe("Chase Sapphire Preferred");
    expect(res.body.card.id).toBe("client-uuid-1");
  });

  it("requires name and issuer", async () => {
    const res = await request(app)
      .post("/cards")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "x" });
    expect(res.status).toBe(400);
  });

  it("upserts on duplicate clientId", async () => {
    await request(app).post("/cards").set("Authorization", `Bearer ${token}`).send(SAMPLE_CARD);
    const updated = { ...SAMPLE_CARD, annualFee: 150 };
    const res = await request(app).post("/cards").set("Authorization", `Bearer ${token}`).send(updated);
    expect(res.status).toBe(201);

    const list = await request(app).get("/cards").set("Authorization", `Bearer ${token}`);
    expect(list.body.cards).toHaveLength(1);
    expect(list.body.cards[0].annualFee).toBe(150);
  });
});

describe("DELETE /cards/:clientId", () => {
  it("removes a card", async () => {
    await request(app).post("/cards").set("Authorization", `Bearer ${token}`).send(SAMPLE_CARD);
    const del = await request(app)
      .delete(`/cards/${SAMPLE_CARD.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await request(app).get("/cards").set("Authorization", `Bearer ${token}`);
    expect(list.body.cards).toHaveLength(0);
  });
});
