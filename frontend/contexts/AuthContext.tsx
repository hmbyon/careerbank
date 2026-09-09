"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import * as api from "@/lib/api";
import { setToken as persistToken, getToken } from "@/lib/api";
import type { User } from "@/lib/types";

const USER_KEY = "cb_user";

interface AuthContextValue {
  user: User | null;
  /** True while restoring the session from localStorage on first load. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Deliberately synchronous: localStorage is only available on the client, so session
    // restoration must happen post-mount (never during the initial render/SSR pass) to avoid
    // a server/client markup mismatch. `loading` gates all rendering until this settles.
    try {
      const token = getToken();
      const rawUser = localStorage.getItem(USER_KEY);
      if (token && rawUser) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUser(JSON.parse(rawUser) as User);
      }
    } catch {
      // Corrupt/unavailable storage - just start logged out.
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSession = useCallback(() => {
    persistToken(null);
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    setUser(null);
  }, []);

  useEffect(() => {
    function handleUnauthorized() {
      clearSession();
      router.replace("/login");
    }
    window.addEventListener("cb:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("cb:unauthorized", handleUnauthorized);
  }, [clearSession, router]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    persistToken(res.access_token);
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    } catch {
      // ignore
    }
    setUser(res.user);
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    await api.signup(name, email, password);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    router.push("/login");
  }, [clearSession, router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
