require("./setup");
const request = require("supertest");
const express = require("express");

process.env.JWT_SECRET = "test-secret-key";
process.env.JWT_EXPIRES_IN = "1d";

const app = express();
app.use(express.json());
app.use("/auth", require("../src/routes/auth"));

describe("POST /auth/signup", () => {
  it("creates account with valid data", async () => {
    const res = await request(app).post("/auth/signup").send({
      email: "test@example.com",
      password: "password123",
      name: "Test User",
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects missing fields", async () => {
    const res = await request(app).post("/auth/signup").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects short password", async () => {
    const res = await request(app).post("/auth/signup").send({
      email: "a@b.com", password: "abc", name: "X",
    });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate email", async () => {
    const payload = { email: "dup@example.com", password: "password123", name: "Dup" };
    await request(app).post("/auth/signup").send(payload);
    const res = await request(app).post("/auth/signup").send(payload);
    expect(res.status).toBe(409);
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await request(app).post("/auth/signup").send({
      email: "login@example.com", password: "password123", name: "Login User",
    });
  });

  it("returns token with correct credentials", async () => {
    const res = await request(app).post("/auth/login").send({
      email: "login@example.com", password: "password123",
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it("rejects wrong password", async () => {
    const res = await request(app).post("/auth/login").send({
      email: "login@example.com", password: "wrongpassword",
    });
    expect(res.status).toBe(401);
  });

  it("rejects unknown email", async () => {
    const res = await request(app).post("/auth/login").send({
      email: "nobody@example.com", password: "password123",
    });
    expect(res.status).toBe(401);
  });
});
