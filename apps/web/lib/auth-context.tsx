'use client';

import type { AuthUser } from '@jobradar/shared';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

import { logout as apiLogout } from './auth';

interface AuthContextValue {
  user: AuthUser;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Seeds client components with the server-resolved user and a logout action. */
export function AuthProvider({ user, children }: { user: AuthUser; children: ReactNode }) {
  const router = useRouter();

  const logout = useCallback(async () => {
    await apiLogout();
    router.replace('/login');
    router.refresh();
  }, [router]);

  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
