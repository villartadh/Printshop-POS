import React from 'react';
import { AppStateProvider } from './context/AppStateContext.tsx';
import { AppProvider, useApp } from './context/AppContext.tsx';
import { AuthScreen } from './modules/auth/AuthScreen.tsx';
import { PinLockModal } from './modules/auth/PinLockModal.tsx';
import { AppShell } from './components/layout/AppShell.tsx';
import { LoadingState } from './components/ui/Overlays.tsx';
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx';
import { appendDiagnosticLog } from './services/offlineDb.ts';

const RootRouter: React.FC = () => {
  const { authChecked, session } = useApp();

  if (!authChecked) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-[var(--pos-bg)]">
        <div className="w-full max-w-sm">
          <LoadingState rows={3} />
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <>
      <AppShell />
      <PinLockModal />
    </>
  );
};

export default function App() {
  return (
    <AppStateProvider>
      <AppProvider>
        <ErrorBoundary
          fullScreen
          title="Application Error"
          description="Something unexpected happened while rendering the workspace. Try recovering the view or reloading the app."
          onError={(error) => {
            void appendDiagnosticLog({
              level: 'error',
              category: 'storage',
              message: `Runtime UI error: ${error.message || 'Unknown error'}`,
            });
          }}
        >
          <RootRouter />
        </ErrorBoundary>
      </AppProvider>
    </AppStateProvider>
  );
}
