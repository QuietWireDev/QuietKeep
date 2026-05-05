// QuietKeep: components/LoginPage.tsx
// Login and first-run setup page. Shows password setup on first launch,
// offers inline 2FA setup after account creation, then login form on subsequent visits.
// Author: QuietWire (Dennis Ayotte)

import { useState } from 'react';
import { Lock, Shield, Eye, EyeOff, Smartphone, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

interface LoginPageProps {
  setupComplete: boolean;
  onLogin: (username: string, password: string, totpCode?: string) => Promise<string | null>;
  onSetup: (password: string) => Promise<string | null>;
}

type SetupPhase = 'password' | 'offer-2fa' | 'totp-scan' | 'totp-done' | null;

export default function LoginPage({ setupComplete, onLogin, onSetup }: LoginPageProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('password');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const err = await onLogin(username, password, needsTotp ? totpCode : undefined);
    if (err === '__requires_totp__') {
      setNeedsTotp(true);
      setSubmitting(false);
      return;
    }
    if (err) setError(err);
    setSubmitting(false);
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    const err = await onSetup(password);
    if (err) {
      setError(err);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setSetupPhase('offer-2fa');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 mb-4">
            <Shield className="h-7 w-7 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">QuietKeep</h1>
          <p className="text-sm text-gray-500 mt-1">
            {setupPhase === 'offer-2fa' ? 'Account created!' : setupComplete ? 'Sign in to continue' : 'Set up your admin account'}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          {setupPhase === 'offer-2fa' && (
            <div className="space-y-5">
              <div className="text-center">
                <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-400 mb-3" />
                <p className="text-sm text-gray-300">Your admin account has been created.</p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-amber-400 flex-shrink-0" />
                  <p className="text-xs font-medium text-amber-400">Two-Factor Authentication (Recommended)</p>
                </div>
                <p className="text-xs text-gray-400">
                  2FA adds a second layer of security by requiring a code from your phone when you log in.
                  Even if someone learns your password, they cannot access QuietKeep without your phone.
                </p>
                <p className="text-xs text-gray-500">
                  You will need an authenticator app like Google Authenticator, Authy, or 1Password on the
                  device you use to access this management console.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={async () => {
                    setTotpLoading(true);
                    try {
                      const res = await fetch('/api/auth/totp/setup', {
                        method: 'POST', credentials: 'include',
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setQrCode(data.qr_code);
                        setTotpSecret(data.secret);
                        setSetupPhase('totp-scan');
                      } else {
                        setTotpError('Failed to initialize 2FA setup');
                      }
                    } catch {
                      setTotpError('Network error');
                    } finally {
                      setTotpLoading(false);
                    }
                  }}
                  disabled={totpLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                  Enable 2FA Now
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors"
                >
                  Skip for Now
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {totpError && <p className="text-xs text-red-400 text-center">{totpError}</p>}

              <p className="text-[10px] text-gray-600 text-center">
                You can always enable 2FA later in Settings &gt; Security
              </p>
            </div>
          )}

          {setupPhase === 'totp-scan' && (
            <div className="space-y-5">
              <div className="text-center">
                <Smartphone className="h-8 w-8 mx-auto text-amber-400 mb-2" />
                <p className="text-sm font-medium text-gray-200">Scan this QR code</p>
                <p className="text-xs text-gray-500 mt-1">Open your authenticator app and scan the code below</p>
              </div>

              {qrCode && (
                <div className="flex justify-center">
                  <div className="bg-white p-3 rounded-lg">
                    <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48" />
                  </div>
                </div>
              )}

              {totpSecret && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-1">
                  <p className="text-[10px] text-gray-500">Can't scan? Enter this code manually:</p>
                  <p className="font-mono text-xs text-gray-300 select-all break-all text-center tracking-wider">{totpSecret}</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={totpVerifyCode}
                  onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono tracking-widest text-center"
                  placeholder="000000"
                  autoFocus
                />
                <p className="text-[10px] text-gray-500 mt-1">Enter the 6-digit code shown in your app to confirm setup</p>
              </div>

              {totpError && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{totpError}</p>}

              <div className="space-y-2">
                <button
                  onClick={async () => {
                    setTotpError('');
                    setTotpLoading(true);
                    try {
                      const res = await fetch('/api/auth/totp/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ code: totpVerifyCode }),
                      });
                      if (res.ok) {
                        setSetupPhase('totp-done');
                      } else {
                        const data = await res.json().catch(() => ({}));
                        setTotpError(data.detail || 'Invalid code. Try again.');
                      }
                    } catch {
                      setTotpError('Network error');
                    } finally {
                      setTotpLoading(false);
                    }
                  }}
                  disabled={totpLoading || totpVerifyCode.length !== 6}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {totpLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Verify &amp; Enable
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-2"
                >
                  Cancel and skip 2FA
                </button>
              </div>
            </div>
          )}

          {setupPhase === 'totp-done' && (
            <div className="space-y-5 text-center">
              <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-gray-200">2FA is now enabled!</p>
                <p className="text-xs text-gray-500 mt-1">
                  You will need your authenticator app every time you sign in.
                </p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {setupPhase === 'password' && !setupComplete && (
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-2">
                <p className="text-xs text-blue-300">
                  Welcome to QuietKeep. Create your admin password to get started.
                  The username is <span className="font-mono font-medium">admin</span>.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="Choose a password (min 8 chars)"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Confirm Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="Confirm password"
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !password || !confirmPassword}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Shield className="h-4 w-4" />
                {submitting ? 'Creating account...' : 'Create Admin Account'}
              </button>
            </form>
          )}

          {setupPhase === 'password' && setupComplete && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="admin"
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="Enter password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {needsTotp && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">2FA Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono tracking-widest text-center"
                    placeholder="000000"
                    autoComplete="one-time-code"
                    autoFocus
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Enter the 6-digit code from your authenticator app</p>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !password || (needsTotp && totpCode.length !== 6)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Lock className="h-4 w-4" />
                {submitting ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          QuietKeep Patch Management
        </p>
      </div>
    </div>
  );
}
