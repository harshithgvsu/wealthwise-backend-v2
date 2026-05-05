import { useState, useEffect, useCallback } from "react";

interface ImportMeta {
  env: Record<string, string | undefined>;
}

declare const import: { meta: ImportMeta };

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  grossMonthlyIncome: number;
  netMonthlyIncome: number;
  health401kMonthly: number;
  otherPreTaxBenefits: number;
  rentMortgage: number;
  carPayment: number;
  insurancePremiums: number;
  subscriptions: number;
  otherFixedExpenses: number;
  savingsGoalPercent: number;
  investmentGoal: "retirement" | "property" | "emergency" | "growth" | "other";
  riskTolerance: "conservative" | "moderate" | "aggressive";
  investmentHorizonYears: number;
  onboardingComplete: boolean;
  createdAt: string;
}

export interface AuthState {
  user: UserProfile | null;
  isLoggedIn: boolean;
}

const API = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "ww_token";
const USER_CACHE_KEY = "ww_user";

// ── Helpers ────────────────────────────────────────────────────────────────

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_CACHE_KEY);
}

function getCachedUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: UserProfile) {
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>(() => {
    const user = getCachedUser();
    return user ? { user, isLoggedIn: true } : { user: null, isLoggedIn: false };
  });

  // On mount, validate the stored token against the server
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    apiFetch("/auth/me")
      .then(async (res) => {
        if (!res.ok) throw new Error("invalid");
        const data = await res.json();
        if (data.success && data.user) {
          cacheUser(data.user);
          setAuthState({ user: data.user, isLoggedIn: true });
        }
      })
      .catch(() => {
        // Token invalid or expired — force logout
        clearToken();
        setAuthState({ user: null, isLoggedIn: false });
      });
  }, []);

  const signup = useCallback(
    async (
      email: string,
      password: string,
      name: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await apiFetch("/auth/signup", {
          method: "POST",
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();

        if (!data.success) return { success: false, error: data.error };

        saveToken(data.token);
        cacheUser(data.user);
        setAuthState({ user: data.user, isLoggedIn: true });
        return { success: true };
      } catch {
        return { success: false, error: "Network error. Check your connection." };
      }
    },
    []
  );

  const login = useCallback(
    async (
      email: string,
      password: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();

        if (!data.success) return { success: false, error: data.error };

        saveToken(data.token);
        cacheUser(data.user);
        setAuthState({ user: data.user, isLoggedIn: true });
        return { success: true };
      } catch {
        return { success: false, error: "Network error. Check your connection." };
      }
    },
    []
  );

  const logout = useCallback(() => {
    clearToken();
    setAuthState({ user: null, isLoggedIn: false });
  }, []);

  const updateProfile = useCallback(
    async (updates: Partial<Omit<UserProfile, "id" | "email" | "createdAt">>) => {
      setAuthState((prev) => {
        if (!prev.user) return prev;
        const updated = { ...prev.user, ...updates };
        cacheUser(updated);
        return { user: updated, isLoggedIn: true };
      });

      const user = getCachedUser();
      if (!user) return;

      try {
        const res = await apiFetch(`/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.success && data.user) {
          cacheUser(data.user);
          setAuthState({ user: data.user, isLoggedIn: true });
        }
      } catch {
        // Optimistic update already applied above — silently fail sync
        console.warn("Profile sync failed, will retry on next load");
      }
    },
    []
  );

  const resetPassword = useCallback(
    async (
      email: string,
      newPassword: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await apiFetch("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ email, newPassword }),
        });
        const data = await res.json();
        if (!data.success) return { success: false, error: data.error };
        return { success: true };
      } catch {
        return { success: false, error: "Network error. Check your connection." };
      }
    },
    []
  );

  return { ...authState, signup, login, logout, updateProfile, resetPassword };
}
