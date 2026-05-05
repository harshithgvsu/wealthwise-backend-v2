# WealthWise Backend

Express + MongoDB API for WealthWise. Replaces localStorage with a real database while keeping localStorage as an offline cache.

---

## Stack

- **Runtime:** Node.js 18+
- **Framework:** Express
- **Database:** MongoDB Atlas (free M0 tier)
- **Auth:** JWT (30-day tokens)
- **Security:** helmet, bcryptjs, express-rate-limit, CORS

---

## Local Development

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/wealthwise?retryWrites=true&w=majority
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
JWT_EXPIRES_IN=30d
PORT=3001
CORS_ORIGIN=http://localhost:5173,https://harshithgvsu.github.io
```

### 3. Run

```bash
npm run dev    # with nodemon auto-reload
npm start      # production
```

Server starts at `http://localhost:3001`. Test it:

```bash
curl http://localhost:3001/health
# → {"ok":true}
```

---

## MongoDB Atlas Setup

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Your cluster → **Connect** → **Drivers** → copy the connection string
3. Replace `<password>` with your database user's password
4. Add your IP (or `0.0.0.0/0` for all IPs) under **Network Access**
5. The database `wealthwise` and collections will be created automatically on first write

---

## Deploying the Backend

You need a server to host this. Three free options:

### Option A — Render (recommended for first deploy)

1. Push `wealthwise-backend/` to a GitHub repo (can be the same repo, just a subfolder, or separate)
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo, set **Root Directory** to `wealthwise-backend`
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables in the Render dashboard (same as your `.env`)
7. Deploy — Render gives you a URL like `https://wealthwise-api.onrender.com`

> ⚠️ Render free tier spins down after 15 min of inactivity. First request after spin-down takes ~30s. Upgrade to $7/mo to avoid this, or use Railway.

### Option B — Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select your repo / subfolder
3. Add env vars in the Railway dashboard
4. Railway auto-detects Node and deploys. You get a URL immediately.
5. Free tier: $5 credit/month (enough for low-traffic personal use)

### Option C — Fly.io

More control, free tier available, slightly more setup. Good if you want Docker.

---

## Wiring the Frontend

### 1. Copy the updated hooks

```bash
# From the repo root
cp wealthwise-backend/frontend/useAuth.ts src/hooks/useAuth.ts
cp wealthwise-backend/frontend/useExpenses.ts src/hooks/useExpenses.ts
cp wealthwise-backend/frontend/migrateLocalData.ts src/utils/migrateLocalData.ts
```

### 2. Add the environment variable

In your frontend repo root, create or edit `.env.local`:

```env
VITE_API_BASE_URL=https://your-backend-url.onrender.com
```

For local dev (backend running on 3001):
```env
VITE_API_BASE_URL=http://localhost:3001
```

### 3. Add migration call in Index.tsx

After login completes, call `migrateLocalData` once to push any existing localStorage data to MongoDB:

```tsx
import { migrateLocalData } from "@/utils/migrateLocalData";

// In your login handler or after useAuth returns isLoggedIn=true:
useEffect(() => {
  if (isLoggedIn && user) {
    const token = localStorage.getItem("ww_token");
    if (token) migrateLocalData(user.id, token);
  }
}, [isLoggedIn, user?.id]);
```

### 4. Update CreditCardHub to sync cards

The cards are still stored in localStorage by `CreditCardHub.tsx`. To sync them to MongoDB, add these calls in `CreditCardHub.tsx`:

```tsx
// After persistAdd():
const token = localStorage.getItem("ww_token");
if (token) {
  fetch(`${import.meta.env.VITE_API_BASE_URL}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(card),
  }).catch(() => {});
}

// After removeCard():
const token = localStorage.getItem("ww_token");
if (token) {
  fetch(`${import.meta.env.VITE_API_BASE_URL}/cards/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}
```

---

## API Reference

All routes except `/auth/*` and `/health` require `Authorization: Bearer <token>`.

### Auth

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | `{email, password, name}` | Create account → returns `{token, user}` |
| POST | `/auth/login` | `{email, password}` | Login → returns `{token, user}` |
| GET | `/auth/me` | — | Validate token → returns `{user}` |
| POST | `/auth/reset-password` | `{email, newPassword}` | Reset password |

### Users

| Method | Path | Body | Description |
|--------|------|------|-------------|
| PATCH | `/users/:id` | `{...profileFields}` | Update financial profile |

### Expenses

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/expenses` | — | All expenses for current user |
| POST | `/expenses` | `{expense: {...}}` | Add expense (idempotent by clientId) |
| POST | `/expenses/bulk` | `{expenses: [...]}` | Bulk upsert (for migration) |
| DELETE | `/expenses/:id` | — | Delete by clientId |
| DELETE | `/expenses` | — | Delete all (reset) |

### Cards

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/cards` | — | All cards for current user |
| POST | `/cards` | `{...card}` | Add card (idempotent by clientId) |
| POST | `/cards/bulk` | `{cards: [...]}` | Bulk upsert |
| DELETE | `/cards/:id` | — | Delete by clientId |

---

## Security Notes

- Passwords are hashed with bcrypt (12 rounds) — never stored in plaintext
- JWT tokens expire after 30 days
- Auth endpoints are rate-limited to 20 requests per 15 minutes per IP
- Global rate limit: 300 requests per 15 minutes
- CORS only allows your configured origins
- `helmet` sets secure HTTP headers
- Users can only access their own data (enforced server-side)

---

## Folder Structure

```
wealthwise-backend/
├── src/
│   ├── index.js              # Express app entry point
│   ├── config/
│   │   └── db.js             # MongoDB connection
│   ├── middleware/
│   │   └── auth.js           # JWT verify + signToken
│   ├── models/
│   │   ├── User.js           # User schema + bcrypt
│   │   ├── Expense.js        # Expense schema
│   │   └── Card.js           # Card schema
│   └── routes/
│       ├── auth.js           # Signup, login, me, reset
│       ├── users.js          # Profile update
│       ├── expenses.js       # CRUD + bulk sync
│       └── cards.js          # CRUD + bulk sync
├── frontend/
│   ├── useAuth.ts            # Drop-in replacement for src/hooks/useAuth.ts
│   ├── useExpenses.ts        # Drop-in replacement for src/hooks/useExpenses.ts
│   └── migrateLocalData.ts   # One-time localStorage → MongoDB migration
├── .env.example
├── .gitignore
└── package.json
```
