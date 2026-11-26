import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';

const mockNotify = vi.fn();

vi.mock('../../context/AppContext.tsx', () => ({
  useApp: () => ({
    settings: DEFAULT_SETTINGS,
    notify: mockNotify,
  }),
}));

import { CheckoutModal } from '../../modules/pos/CheckoutModal.tsx';

describe('CheckoutModal', () => {
  beforeEach(() => {
    mockNotify.mockReset();
  });

  it('computes change due for cash tender and submits payment payload', async () => {
    const user = userEvent.setup();
    const onCompletePayment = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <CheckoutModal
        open={true}
        onClose={onClose}
        totalAmount={350}
        customerName="Emma Carter"
        isMobileLayout={false}
        onCompletePayment={onCompletePayment}
      />,
    );

    const tenderInput = screen.getByLabelText(/Amount Tendered/i);
    await user.clear(tenderInput);
    await user.type(tenderInput, '500');

    expect(screen.getByText('Change Due')).toBeInTheDocument();
    expect(screen.getByText('₱150.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Complete Payment/i }));

    await waitFor(() => expect(onCompletePayment).toHaveBeenCalledTimes(1));
    const [payments, allowPartial] = onCompletePayment.mock.calls[0];
    expect(allowPartial).toBe(false);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      methodId: 'cash',
      methodType: 'cash',
      amount: 500,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires reference number for GCash and supports partial payments', async () => {
    const user = userEvent.setup();
    const onCompletePayment = vi.fn().mockResolvedValue(undefined);

    render(
      <CheckoutModal
        open={true}
        onClose={vi.fn()}
        totalAmount={500}
        customerName="Mark Rivera"
        isMobileLayout={false}
        onCompletePayment={onCompletePayment}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'GCash' }));
    const tenderInput = screen.getByLabelText(/Amount Tendered/i);
    await user.clear(tenderInput);
    await user.type(tenderInput, '200');

    // Missing reference number notifies error and blocks submission
    await user.click(screen.getByRole('button', { name: /Complete Payment/i }));
    expect(mockNotify).toHaveBeenCalledWith(
      expect.stringMatching(/reference number/i),
      'error',
    );
    expect(onCompletePayment).not.toHaveBeenCalled();

    // Provide reference + toggle Allow partial / down payment
    await user.type(screen.getByLabelText(/Reference \/ Approval #/i), 'GC-123456');
    await user.click(screen.getByLabelText(/Allow partial \/ down payment/i));
    await user.click(screen.getByRole('button', { name: /Complete Payment/i }));

    await waitFor(() => expect(onCompletePayment).toHaveBeenCalledTimes(1));
    expect(onCompletePayment.mock.calls[0][1]).toBe(true);
    expect(onCompletePayment.mock.calls[0][0][0]).toMatchObject({
      methodId: 'gcash',
      amount: 200,
      referenceNumber: 'GC-123456',
      verificationStatus: 'pending_verification',
    });
  });
});
