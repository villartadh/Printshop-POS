import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary.tsx';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Simulated render crash');
  }
  return <div>Healthy Workspace</div>;
}

describe('ErrorBoundary', () => {
  it('renders children normally when no runtime error is thrown', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Healthy Workspace')).toBeInTheDocument();
  });

  it('catches render errors, logs them via console.error and onError, and resets on Try Again', async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const onReset = vi.fn();

    let shouldThrow = true;
    function DynamicBomb() {
      if (shouldThrow) {
        throw new Error('Simulated render crash');
      }
      return <div>Recovered Workspace</div>;
    }

    render(
      <ErrorBoundary fullScreen onError={onError} onReset={onReset}>
        <DynamicBomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Simulated render crash')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload App/i })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(consoleErrorSpy).toHaveBeenCalled();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /Try Again/i }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Recovered Workspace')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('automatically resets error state when resetKeys change and supports custom fallbackRender', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary
        resetKeys={['route-a']}
        fallbackRender={({ error }) => <div data-testid="custom-fallback">{error.message}</div>}
      >
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('custom-fallback')).toHaveTextContent('Simulated render crash');

    rerender(
      <ErrorBoundary
        resetKeys={['route-b']}
        fallbackRender={({ error }) => <div data-testid="custom-fallback">{error.message}</div>}
      >
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Healthy Workspace')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});
