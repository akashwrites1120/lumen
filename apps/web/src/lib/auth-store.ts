"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PublicUser } from "@lumen/schemas";

interface AuthState {
  token: string | null;
  user: PublicUser | null;
  setAuth: (token: string, user: PublicUser) => void;
  setUser: (user: PublicUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: "lumen-auth" }
  )
);
