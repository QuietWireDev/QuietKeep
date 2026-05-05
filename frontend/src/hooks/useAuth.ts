// QuietKeep: hooks/useAuth.ts
// Authentication state management. Checks auth status on mount, provides
// login/logout/setup functions, and exposes state for gating the UI.
// Author: QuietWire (Dennis Ayotte)

import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

interface AuthState {
  loading: boolean;
  authenticated: boolean;
  setupComplete: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    setupComplete: false,
  });

  const checkAuth = useCallback(async () => {
    try {
      // First check if setup is complete
      const statusRes = await fetch(`${API_BASE}/auth/status`, { credentials: 'include' });
      const statusData = await statusRes.json();

      if (!statusData.setup_complete) {
        setState({ loading: false, authenticated: false, setupComplete: false });
        return;
      }

      // Setup is complete, check if we have a valid session
      const meRes = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
      setState({
        loading: false,
        authenticated: meRes.ok,
        setupComplete: true,
      });
    } catch {
      setState({ loading: false, authenticated: false, setupComplete: false });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string, totp_code?: string): Promise<string | null> => {
    const body: Record<string, string> = { username, password };
    if (totp_code) body.totp_code = totp_code;

    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ detail: 'Login failed' }));

    if (res.ok && data.requires_totp) {
      return '__requires_totp__';
    }
    if (res.ok) {
      setState((s) => ({ ...s, authenticated: true }));
      return null;
    }
    return data.detail || 'Login failed';
  };

  const setup = async (password: string): Promise<string | null> => {
    const res = await fetch(`${API_BASE}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Don't update state at all here. The JWT cookie is set by the backend.
      // LoginPage manages the 2FA offer flow locally. On page reload,
      // checkAuth will see setup_complete=true + valid cookie → authenticated.
      return null;
    }
    const data = await res.json().catch(() => ({ detail: 'Setup failed' }));
    return data.detail || 'Setup failed';
  };

  const logout = async () => {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    setState((s) => ({ ...s, authenticated: false }));
  };

  return {
    ...state,
    login,
    logout,
    setup,
    checkAuth,
  };
}
