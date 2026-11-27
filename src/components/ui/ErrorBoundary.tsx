import React from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { Button } from './Primitives.tsx';

export interface ErrorBoundaryFallbackProps {
  error: Error;
  errorInfo: React.ErrorInfo | null;
  resetErrorBoundary: () => void;
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  fallbackRender?: (props: ErrorBoundaryFallbackProps) => React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
  resetKeys?: ReadonlyArray<unknown>;
  title?: string;
  description?: string;
  fullScreen?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

function areResetKeysEqual(
  prevKeys: ReadonlyArray<unknown> = [],
  nextKeys: ReadonlyArray<unknown> = [],
): boolean {
  if (prevKeys.length !== nextKeys.length) return false;
  for (let i = 0; i < prevKeys.length; i += 1) {
    if (!Object.is(prevKeys[i], nextKeys[i])) return false;
  }
  return true;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Uncaught React error:', error, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      this.props.resetKeys &&
      !areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  private handleReload = (): void => {
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const {
      children,
      fallback,
      fallbackRender,
      title = 'Something went wrong',
      description = 'An unexpected error interrupted this screen. You can retry without losing saved work.',
      fullScreen = false,
    } = this.props;

    if (!hasError || !error) {
      return children;
    }

    if (fallbackRender) {
      return fallbackRender({
        error,
        errorInfo,
        resetErrorBoundary: this.resetErrorBoundary,
      });
    }

    if (fallback !== undefined) {
      return fallback;
    }

    return (
      <div
        role="alert"
        className={
          fullScreen
            ? 'min-h-dvh w-full flex items-center justify-center p-6 bg-[var(--pos-bg)] text-[var(--pos-text)]'
            : 'w-full flex items-center justify-center p-6'
        }
      >
        <div
          style={{ borderRadius: 'calc(var(--pos-radius, 10px) + 4px)' }}
          className="w-full max-w-md bg-[var(--pos-surface)] border border-[var(--pos-border)] shadow-lg p-6 text-center space-y-4"
        >
          <div className="mx-auto h-12 w-12 rounded-xl bg-[#DC2626]/10 text-[#DC2626] flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-[var(--pos-text)]">{title}</h2>
            <p className="text-sm text-[var(--pos-text-muted)]">{description}</p>
            {error.message && (
              <p className="text-xs font-mono text-[#DC2626] bg-[#DC2626]/5 border border-[#DC2626]/20 rounded-lg px-3 py-2 break-words mt-2">
                {error.message}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <Button variant="primary" size="sm" onClick={this.resetErrorBoundary}>
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Try Again
            </Button>
            {fullScreen && (
              <Button variant="outline" size="sm" onClick={this.handleReload}>
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Reload App
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
