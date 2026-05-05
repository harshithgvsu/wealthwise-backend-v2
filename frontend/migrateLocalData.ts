/**
 * migrateLocalData.ts
 *
 * Call this once after a user logs in for the first time with the new backend.
 * It reads any existing expenses and cards from the old localStorage keys
 * and pushes them to MongoDB, then cleans up the old keys.
 *
 * Usage in Index.tsx:
 *   import { migrateLocalData } from "@/utils/migrateLocalData";
 *   // After successful login:
 *   await migrateLocalData(user.id, token);
 */

const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

// Old localStorage key formats used before the backend
const OLD_EXPENSE_KEYS = [
  (id: string) => `spendwise_expenses_${id}`,
  (id: string) => `ww_expenses_${id}`,
];
const OLD_CARD_KEYS = [
  (id: string) => `spendwise_cards_${id}`,
  (id: string) => `ww_cards_${id}`,
];
const MIGRATED_FLAG = (id: string) => `ww_migrated_${id}`;

export async function migrateLocalData(userId: string, token: string): Promise<void> {
  // Don't migrate twice
  if (localStorage.getItem(MIGRATED_FLAG(userId))) return;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  try {
    // ── Expenses ──────────────────────────────────────────────────────────
    let expenses: unknown[] = [];
    for (const keyFn of OLD_EXPENSE_KEYS) {
      try {
        const raw = localStorage.getItem(keyFn(userId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            expenses = parsed;
            break;
          }
        }
      } catch {}
    }

    if (expenses.length > 0) {
      console.log(`Migrating ${expenses.length} expenses to MongoDB...`);
      await fetch(`${API}/expenses/bulk`, {
        method: "POST",
        headers,
        body: JSON.stringify({ expenses }),
      });
      console.log("✅ Expenses migrated");
    }

    // ── Cards ─────────────────────────────────────────────────────────────
    let cards: unknown[] = [];
    for (const keyFn of OLD_CARD_KEYS) {
      try {
        const raw = localStorage.getItem(keyFn(userId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            cards = parsed;
            break;
          }
        }
      } catch {}
    }

    if (cards.length > 0) {
      console.log(`Migrating ${cards.length} cards to MongoDB...`);
      await fetch(`${API}/cards/bulk`, {
        method: "POST",
        headers,
        body: JSON.stringify({ cards }),
      });
      console.log("✅ Cards migrated");
    }

    // Mark as migrated so we don't run this again
    localStorage.setItem(MIGRATED_FLAG(userId), "1");
  } catch (err) {
    console.warn("Migration failed — will retry on next login:", err);
  }
}
