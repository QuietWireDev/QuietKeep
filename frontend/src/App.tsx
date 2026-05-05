// QuietKeep: App.tsx
// Root component. Manages tab navigation, first-run wizard display, and theme.
// Gates the entire UI behind authentication. Shows login/setup page when not
// authenticated, the normal app when authenticated.
// Author: QuietWire (Dennis Ayotte)

import { useState } from 'react'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import DockerDashboard from './components/DockerDashboard'
import SettingsPage from './components/SettingsPage'
import HomePage from './components/HomePage'
import HelpFAQ from './components/HelpFAQ'
import ThreatIntel from './components/ThreatIntel'
import DiagnosticsPage from './components/DiagnosticsPage'
import FirstRunWizard from './components/FirstRunWizard'
import LoginPage from './components/LoginPage'
import { useHosts, useSettings, triggerScanAll, triggerDockerScanAll } from './hooks/useApi'
import { useAuth } from './hooks/useAuth'
import { useThemeListener } from './hooks/useTheme'

type Tab = 'home' | 'patches' | 'docker' | 'diagnostics' | 'threats' | 'settings' | 'help';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [settingsSection, setSettingsSection] = useState<string | undefined>();
  const auth = useAuth();
  const { hosts, loading, refresh } = useHosts();
  const { settings } = useSettings();
  const [wizardDismissed, setWizardDismissed] = useState(false);

  useThemeListener(settings?.theme ?? 'dark');

  // Show loading spinner while checking auth state
  if (auth.loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated: show login or setup page
  if (!auth.authenticated) {
    return (
      <LoginPage
        setupComplete={auth.setupComplete}
        onLogin={auth.login}
        onSetup={auth.setup}
      />
    );
  }

  // Authenticated but no hosts: show first-run wizard
  if (!loading && hosts.length === 0 && !wizardDismissed) {
    return (
      <FirstRunWizard
        onComplete={(destination?: string, sshReady?: boolean) => {
          if (destination === 'settings:ssh') {
            setActiveTab('settings');
            setSettingsSection('ssh');
          }
          // Fire scan before state update. setWizardDismissed triggers
          // a re-render that unmounts the wizard, so any .then() chained
          // after it would be lost.
          if (sshReady) {
            triggerScanAll().catch(() => {});
            triggerDockerScanAll().catch(() => {});
          }
          refresh().catch(() => {});
          setWizardDismissed(true);
        }}
      />
    );
  }

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab} onLogout={auth.logout}>
      {activeTab === 'home' && <HomePage onNavigate={(tab) => setActiveTab(tab as Tab)} />}
      {activeTab === 'patches' && <Dashboard />}
      {activeTab === 'docker' && <DockerDashboard />}
      {activeTab === 'diagnostics' && <DiagnosticsPage />}
      {activeTab === 'threats' && <ThreatIntel />}
      {activeTab === 'settings' && <SettingsPage initialSection={settingsSection} />}
      {activeTab === 'help' && <HelpFAQ />}
    </Layout>
  )
}

export default App
