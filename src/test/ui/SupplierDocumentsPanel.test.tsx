import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupplierDocumentsPanel } from '../../components/suppliers/SupplierDocumentsPanel.tsx';
import type { SupplierProfile } from '../../shared/supplierModel.ts';
import type { SupplierDocument } from '../../types/inventory.ts';

const baseDocs: SupplierDocument[] = [
  {
    id: 'doc-1',
    supplierId: 'sup-paperone',
    supplierName: 'PaperOne Supply',
    docType: 'contract',
    title: '2026 Bond Paper SLA',
    referenceNumber: 'SLA-2026',
    effectiveDate: '2026-01-01',
    expiryDate: '2027-12-31',
    agreedTermsSummary: 'Net 15 free delivery above 5000',
    fileName: 'bond_sla.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    uploadedBy: 'Studio Manager',
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
  },
  {
    id: 'doc-2',
    supplierId: 'sup-paperone',
    supplierName: 'PaperOne Supply',
    docType: 'invoice',
    title: 'February Stock Invoice',
    referenceNumber: 'INV-4421',
    effectiveDate: '2026-02-01',
    expiryDate: '',
    agreedTermsSummary: '',
    fileName: 'feb_invoice.txt',
    mimeType: 'text/plain',
    fileSize: 512,
    uploadedBy: 'Studio Manager',
    createdAt: '2026-02-02T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  },
];

const mockProfile: SupplierProfile = {
  key: 'paperone supply',
  record: {
    id: 'sup-paperone',
    name: 'PaperOne Supply',
    contactPerson: 'Ana',
    phone: '+63 2 8810 2200',
    email: 'orders@paperone.local',
    address: 'Pasig City',
    defaultLeadTimeDays: 2,
    paymentTerms: 'Net 15',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  name: 'PaperOne Supply',
  contactPerson: 'Ana',
  phone: '+63 2 8810 2200',
  email: 'orders@paperone.local',
  address: 'Pasig City',
  paymentTerms: 'Net 15',
  notes: '',
  defaultLeadTimeDays: 2,
  minLeadTimeDays: 2,
  maxLeadTimeDays: 2,
  effectiveLeadTimeDays: 2,
  items: [],
  totalStockValue: 0,
  lowStockCount: 0,
  belowMinimumCount: 0,
  historicalOrders: [],
  totalOrderCount: 0,
  totalOrderSpend: 0,
  lastOrderDate: null,
  onTimeDeliveryRate: null,
  trackedDeliveryCount: 0,
  onTimeDeliveryCount: 0,
  lateDeliveryCount: 0,
  avgActualDeliveryDays: null,
  avgCostVariancePct: null,
  avgCostVarianceAmount: null,
  costVarianceLineCount: 0,
  forecasts: [],
  urgentForecastCount: 0,
  recommendedOrderSpend: 0,
  earliestStockoutDays: null,
  leadTimeRiskCount: 0,
  documents: baseDocs,
};

describe('SupplierDocumentsPanel', () => {
  it('filters documents by type, uploads new attachments, and confirms deletion', async () => {
    const user = userEvent.setup();
    const onUploadDocument = vi.fn().mockResolvedValue(baseDocs[0]);
    const onDeleteDocument = vi.fn().mockResolvedValue(undefined);

    render(
      <SupplierDocumentsPanel
        supplier={mockProfile}
        canManage={true}
        onUploadDocument={onUploadDocument}
        onDeleteDocument={onDeleteDocument}
        onNotify={vi.fn()}
      />,
    );

    // Both documents visible initially
    expect(screen.getAllByText('2026 Bond Paper SLA').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('February Stock Invoice')).toBeInTheDocument();

    // Filter to Invoices only -> removes SLA row from table
    await user.selectOptions(screen.getByLabelText(/Filter supplier documents/i), 'invoice');
    expect(screen.getByText('February Stock Invoice')).toBeInTheDocument();
    expect(screen.queryByText('bond_sla.pdf')).not.toBeInTheDocument();

    // Delete filtered invoice document
    await user.click(screen.getByRole('button', { name: 'Delete February Stock Invoice' }));
    await user.click(screen.getByRole('button', { name: /Remove Document/i }));
    await waitFor(() => expect(onDeleteDocument).toHaveBeenCalledWith('doc-2'));

    // Open Attach Contract modal and submit a text file
    await user.click(screen.getByRole('button', { name: /Attach Contract \/ Agreement/i }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(['Rate card v2'], 'rate_card_v2.txt', { type: 'text/plain' });
    await user.upload(fileInput, testFile);

    await user.type(screen.getByLabelText(/Reference \/ Invoice #/i), 'PA-99');
    await user.click(screen.getByRole('button', { name: /Save Attachment/i }));

    await waitFor(() => expect(onUploadDocument).toHaveBeenCalledTimes(1));
    expect(onUploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierId: 'sup-paperone',
        supplierName: 'PaperOne Supply',
        docType: 'contract',
        fileName: 'rate_card_v2.txt',
        mimeType: 'text/plain',
        referenceNumber: 'PA-99',
      }),
    );
  });
});
