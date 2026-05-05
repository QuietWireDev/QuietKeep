// QuietKeep: Layout.tsx
// App shell with sticky header, tab navigation, GitHub CTA, and gear dropdown
// for Settings/Help. Settings and Help are in a dropdown to keep the nav clean.
// Author: QuietWire (Dennis Ayotte)

import { Home, Package, Container, Activity, Shield, HelpCircle, Settings as SettingsIcon, LogOut, Bug, Lightbulb } from 'lucide-react';
import { type ReactNode, useState, useRef, useEffect } from 'react';

type Tab = 'home' | 'patches' | 'docker' | 'diagnostics' | 'threats' | 'settings' | 'help';

interface LayoutProps {
  children: ReactNode;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onLogout?: () => void;
}

export default function Layout({ children, activeTab, onTabChange, onLogout }: LayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className="h-7 w-7">
                  <path d="M32 4L8 14v18c0 16 24 28 24 28s24-12 24-28V14L32 4z" fill="#0a0e17" stroke="#10b981" strokeWidth="3"/>
                  <text x="32" y="42" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="bold" fontSize="22" fill="#60a5fa" letterSpacing="-1">QW</text>
                </svg>
                <h1 className="text-lg font-bold tracking-tight">QuietKeep</h1>
              </div>
              <nav className="flex items-center gap-1 ml-2">
                {([
                  { id: 'home' as Tab, label: 'Home', icon: <Home className="h-4 w-4" /> },
                  { id: 'patches' as Tab, label: 'System Patches', icon: <Package className="h-4 w-4" /> },
                  { id: 'docker' as Tab, label: 'Docker Stacks', icon: <Container className="h-4 w-4" /> },
                  { id: 'diagnostics' as Tab, label: 'Diagnostics', icon: <Activity className="h-4 w-4" /> },
                  { id: 'threats' as Tab, label: 'Threat Intel', icon: <Shield className="h-4 w-4" /> },
                ] as const).map(item => (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === item.id
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2">
            {/* GitHub CTA */}
            <a
              href="https://github.com/quietwire-dev/quietkeep"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              Star on GitHub
            </a>

            {/* Gear dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={`p-2 rounded-lg transition-colors ${
                  menuOpen || activeTab === 'settings' || activeTab === 'help'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
                aria-label="Settings menu"
              >
                <SettingsIcon className="h-4.5 w-4.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-44 bg-gray-900 border border-gray-800 rounded-xl shadow-xl overflow-hidden py-1 z-50">
                  <button
                    onClick={() => { onTabChange('settings'); setMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === 'settings' ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                    }`}
                  >
                    <SettingsIcon className="h-4 w-4" />
                    Settings
                  </button>
                  <button
                    onClick={() => { onTabChange('help'); setMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === 'help' ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                    }`}
                  >
                    <HelpCircle className="h-4 w-4" />
                    Help & FAQ
                  </button>
                  <div className="border-t border-gray-800 my-1" />
                  <a
                    href="https://github.com/quietwire-dev/quietkeep/issues/new?template=bug_report.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-gray-800/60 transition-colors"
                  >
                    <Bug className="h-4 w-4" />
                    Report Bug
                  </a>
                  <a
                    href="https://github.com/quietwire-dev/quietkeep/issues/new?template=feature_request.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-amber-400 hover:bg-gray-800/60 transition-colors"
                  >
                    <Lightbulb className="h-4 w-4" />
                    Feature Request
                  </a>
                  {onLogout && (
                    <>
                      <div className="border-t border-gray-800 my-1" />
                      <button
                        onClick={() => { onLogout(); setMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-gray-800/60 transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        Logout
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
