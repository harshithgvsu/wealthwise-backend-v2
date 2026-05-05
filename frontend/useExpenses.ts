import { useState, useEffect, useCallback, useRef } from "react";

export type Category =
  | "Food & Dining"
  | "Transport"
  | "Shopping"
  | "Health"
  | "Entertainment"
  | "Bills & Utilities"
  | "Education"
  | "Other";

export type RewardType = "points" | "miles" | "cashback";

export interface CardOption {
  id: string;
  label: string;
  rewardType: RewardType;
  baseRate: number;
  categoryRates?: Partial<Record<Category, number>>;
}

export interface Expense {
  id: string;
  amount: number;
  category: Category;
  description: string;
  date: string;
  createdAt: number;
  cardId?: string;
  cardLabel?: string;
  rewardRate?: number;
  rewardsEarned?: number;
  rewardType?: RewardType;
}

interface HubCard {
  id: string;
  name: string;
  issuer?: string;
  rewardType?: RewardType;
  baseReward?: number;
  rewards?: Record<string, unknown>;
}

export const CATEGORIES: Category[] = [
  "Food & Dining",
  "Transport",
  "Shopping",
  "Health",
  "Entertainment",
  "Bills & Utilities",
  "Education",
  "Other",
];

export const DEFAULT_CARD_OPTION: CardOption = {
  id: "no-rewards",
  label: "Cash / Debit (No rewards)",
  rewardType: "cashback",
  baseRate: 0,
};

export const CATEGORY_COLORS: Record<Category, string> = {
  "Food & Dining": "hsl(152 76% 40%)",
  Transport: "hsl(210 80% 55%)",
  Shopping: "hsl(280 70% 55%)",
  Health: "hsl(0 72% 55%)",
  Entertainment: "hsl(45 90% 55%)",
  "Bills & Utilities": "hsl(200 80% 50%)",
  Education: "hsl(170 70% 45%)",
  Other: "hsl(215 20% 55%)",
};

// ── Config ─────────────────────────────────────────────────────────────────
const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "ww_token";
const LOCAL_KEY = (userId?: string) => `ww_expenses_${userId || "anon"}`;
const CARDS_KEY = (userId?: string) => `ww_cards_${userId || "anon"}`;

// ── Category normalization (same as before) ────────────────────────────────
const CATEGORY_NORMALIZATION: Record<string, Category> = {
  food: "Food & Dining", dining: "Food & Dining", restaurant: "Food & Dining",
  restaurants: "Food & Dining", groceries: "Food & Dining", grocery: "Food & Dining",
  transport: "Transport", travel: "Transport", transit: "Transport", gas: "Transport",
  shopping: "Shopping", retail: "Shopping",
  health: "Health", medical: "Health",
  entertainment: "Entertainment",
  bills: "Bills & Utilities", utilities: "Bills & Utilities",
  education: "Education",
};

function normalizeCategoryKey(key: string): Category | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const direct = CATEGORIES.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  if (direct) return direct;
  const cleaned = trimmed.toLowerCase().replace(/[^a-z& ]/g, "").trim();
  return CATEGORY_NORMALIZATION[cleaned] || null;
}

// ── Card helpers (reads from localStorage — cards hook writes there) ────────
export function getExpenseCardOptions(userId?: string): CardOption[] {
  try {
    const cards = JSON.parse(localStorage.getItem(CARDS_KEY(userId)) || "[]") as HubCard[];
    if (!Array.isArray(cards) || cards.length === 0) return [DEFAULT_CARD_OPTION];

    const mapped: CardOption[] = cards
      .filter((c) => typeof c?.id === "string" && typeof c?.name === "string")
      .map((card) => {
        const categoryRates: Partial<Record<Category, number>> = {};
        for (const [key, rawValue] of Object.entries(card.rewards || {})) {
          const norm = normalizeCategoryKey(key);
          const val = typeof rawValue === "number" ? rawValue : Number(rawValue);
          if (norm && Number.isFinite(val)) categoryRates[norm] = val;
        }
        return {
          id: card.id,
          label: card.issuer ? `${card.name} (${card.issuer})` : card.name,
          rewardType: card.rewardType || "points",
          baseRate: Number.isFinite(card.baseReward) ? Number(card.baseReward) : 1,
          categoryRates,
        };
      });

    return mapped.length ? [DEFAULT_CARD_OPTION, ...mapped] : [DEFAULT_CARD_OPTION];
  } catch {
    return [DEFAULT_CARD_OPTION];
  }
}

export function calculateRewards(
  amount: number,
  cardId: string | undefined,
  category: Category,
  userId?: string
): { rate: number; rewardType: RewardType; rewardsEarned: number } {
  const options = getExpenseCardOptions(userId);
  const card = options.find((c) => c.id === cardId) || DEFAULT_CARD_OPTION;
  const rate = card.categoryRates?.[category] ?? card.baseRate;
  return {
    rate,
    rewardType: card.rewardType,
    rewardsEarned: Number((amount * rate).toFixed(2)),
  };
}

// ── Date helpers (timezone-safe) ───────────────────────────────────────────
export function localDateString(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ── API helper ─────────────────────────────────────────────────────────────
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY);
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
}

// ── Local cache helpers ────────────────────────────────────────────────────
function readLocal(userId?: string): Expense[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(expenses: Expense[], userId?: string) {
  localStorage.setItem(LOCAL_KEY(userId), JSON.stringify(expenses));
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useExpenses(userId?: string) {
  const [expenses, setExpenses] = useState<Expense[]>(() => readLocal(userId));
  const [syncing, setSyncing] = useState(false);
  const prevUserId = useRef(userId);

  // When userId changes (login/logout) reload from cache
  useEffect(() => {
    if (prevUserId.current !== userId) {
      prevUserId.current = userId;
      setExpenses(readLocal(userId));
    }
  }, [userId]);

  // On mount (or userId change) — fetch from server and merge
  useEffect(() => {
    if (!userId) return;

    setSyncing(true);
    apiFetch("/expenses")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.expenses)) {
          setExpenses(data.expenses);
          writeLocal(data.expenses, userId);
        }
      })
      .catch(() => {
        // Server unreachable — keep using local cache
        console.warn("Expenses fetch failed, using local cache");
      })
      .finally(() => setSyncing(false));
  }, [userId]);

  // Keep local cache in sync with state
  useEffect(() => {
    writeLocal(expenses, userId);
  }, [expenses, userId]);

  const addExpense = useCallback(
    (expense: Omit<Expense, "id" | "createdAt">) => {
      const cardOptions = getExpenseCardOptions(userId);
      const cardId = expense.cardId || DEFAULT_CARD_OPTION.id;
      const selectedCard = cardOptions.find((c) => c.id === cardId) || DEFAULT_CARD_OPTION;
      const rewards = calculateRewards(expense.amount, cardId, expense.category, userId);

      const newExpense: Expense = {
        ...expense,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        cardId,
        cardLabel: expense.cardLabel || selectedCard.label,
        rewardRate: rewards.rate,
        rewardType: rewards.rewardType,
        rewardsEarned: rewards.rewardsEarned,
      };

      // Optimistic update
      setExpenses((prev) => [newExpense, ...prev]);

      // Sync to server
      apiFetch("/expenses", {
        method: "POST",
        body: JSON.stringify({ expense: newExpense }),
      }).catch(() => console.warn("Expense sync failed — saved locally"));

      return newExpense;
    },
    [userId]
  );

  const deleteExpense = useCallback(
    (id: string) => {
      setExpenses((prev) => prev.filter((e) => e.id !== id));

      apiFetch(`/expenses/${id}`, { method: "DELETE" }).catch(() =>
        console.warn("Delete sync failed")
      );
    },
    []
  );

  const resetExpenses = useCallback(() => {
    setExpenses([]);
    localStorage.removeItem(LOCAL_KEY(userId));

    apiFetch("/expenses", { method: "DELETE" }).catch(() =>
      console.warn("Reset sync failed")
    );
  }, [userId]);

  const getMonthExpenses = useCallback(
    (year: number, month: number) =>
      expenses.filter((e) => {
        // Parse YYYY-MM-DD safely without UTC conversion
        const [y, m] = e.date.split("-").map(Number);
        return y === year && m === month;
      }),
    [expenses]
  );

  const getTotalByCategory = useCallback((exps: Expense[]) => {
    const map: Partial<Record<Category, number>> = {};
    for (const e of exps) map[e.category] = (map[e.category] || 0) + e.amount;
    return map;
  }, []);

  const getDailyTotals = useCallback((exps: Expense[]) => {
    const map: Record<string, number> = {};
    for (const e of exps) map[e.date] = (map[e.date] || 0) + e.amount;
    return map;
  }, []);

  // Bulk sync — call this once after login to push any locally-saved expenses
  // that were created while the user was offline or before backend was set up
  const syncLocalToServer = useCallback(async () => {
    const local = readLocal(userId);
    if (!local.length) return;

    try {
      await apiFetch("/expenses/bulk", {
        method: "POST",
        body: JSON.stringify({ expenses: local }),
      });
    } catch {
      console.warn("Bulk sync failed");
    }
  }, [userId]);

  return {
    expenses,
    syncing,
    addExpense,
    deleteExpense,
    resetExpenses,
    getMonthExpenses,
    getTotalByCategory,
    getDailyTotals,
    syncLocalToServer,
  };
}
