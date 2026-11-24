import React, { useMemo, useState } from 'react';
import { Copy, Download, Printer } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import type { PrintJob, ReceiptTemplateConfig, Transaction } from '../../shared/types.ts';
import { Button, Select } from '../../components/ui/Primitives.tsx';
import { Modal } from '../../components/ui/Overlays.tsx';

interface ReceiptModalProps {
  open: boolean;
  onClose: () => void;
  transaction?: Transaction | null;
  printJob?: PrintJob | null;
}

function buildDeterministicMatrix(seed: string): boolean[][] {
  const size = 15;
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inTopLeft = r < 5 && c < 5;
      const inTopRight = r < 5 && c >= size - 5;
      const inBottomLeft = r >= size - 5 && c < 5;
      if (inTopLeft || inTopRight || inBottomLeft) {
        const lr = r < 5 ? r : r - (size - 5);
        const lc = c < 5 ? c : c - (size - 5);
        grid[r][c] = lr === 0 || lr === 4 || lc === 0 || lc === 4 || (lr === 2 && lc === 2);
      } else {
        hash ^= (r * 31 + c * 17) & 0xff;
        hash = Math.imul(hash, 16777619);
        grid[r][c] = (hash & 1) === 1;
      }
    }
  }
  return grid;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  open,
  onClose,
  transaction,
  printJob,
}) => {
  const { settings, notify } = useApp();
  const [paperSize, setPaperSize] = useState<ReceiptTemplateConfig['defaultPaperSize']>(
    settings.receiptTemplate.defaultPaperSize,
  );
  const [docType, setDocType] = useState<ReceiptTemplateConfig['defaultDocumentType']>(
    transaction?.type === 'quotation'
      ? 'quotation'
      : printJob && !transaction
        ? 'job_order_slip'
        : settings.receiptTemplate.defaultDocumentType,
  );
  const [copyMode, setCopyMode] = useState<'customer' | 'internal'>('customer');

  const docReference =
    transaction?.receiptNumber || printJob?.jobOrderNumber || 'DOC-PREVIEW';
  const qrMatrix = useMemo(() => buildDeterministicMatrix(docReference), [docReference]);

  if (!open || (!transaction && !printJob)) return null;

  const docTitleMap: Record<ReceiptTemplateConfig['defaultDocumentType'], string> = {
    sales_receipt: 'OFFICIAL RECEIPT / SALES SLIP',
    invoice: 'SERVICE INVOICE',
    quotation: 'PRINTING QUOTATION',
    job_order_slip: 'JOB ORDER PRODUCTION SLIP',
    payment_acknowledgment: 'PAYMENT ACKNOWLEDGMENT',
  };

  const widthPx =
    paperSize === '58mm'
      ? 230
      : paperSize === '80mm'
        ? 315
        : paperSize === 'Custom'
          ? Math.max(200, Math.min(720, Math.round(settings.receiptTemplate.customWidthMm * 3.8)))
          : 640;

  const isWide = widthPx >= 500;
  const taxCurr = settings.taxAndCurrency;

  const handlePrint = () => {
    window.print();
  };

  const handleCopySummary = async () => {
    const total = transaction ? transaction.totalAmount : printJob?.totalAmount || 0;
    const customer = transaction?.customerName || printJob?.customerName || 'Customer';
    const text = `${settings.branding.businessName}\n${docTitleMap[docType]} #${docReference}\nCustomer: ${customer}\nTotal: ${formatCurrency(total, taxCurr)}`;
    try {
      await navigator.clipboard.writeText(text);
      notify('Receipt summary copied to clipboard.', 'success');
    } catch {
      notify('Unable to copy automatically in this browser.', 'error');
    }
  };

  const handleDownloadHtml = () => {
    const el = document.getElementById('printable-document');
    if (!el) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${docReference}</title><style>body{font-family:monospace;padding:16px;background:#fff;color:#000;}</style></head><body>${el.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docReference}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Document & Receipt Preview"
      subtitle={`${docReference} · ${paperSize} layout`}
      maxWidth="xl"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleCopySummary()}>
              <Copy className="w-3.5 h-3.5" />
              Share Summary
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadHtml}>
              <Download className="w-3.5 h-3.5" />
              Export File
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5" />
              Print Document
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label="Document Type"
            value={docType}
            onChange={(e) => setDocType(e.target.value as typeof docType)}
            options={[
              { value: 'sales_receipt', label: 'Sales Receipt' },
              { value: 'invoice', label: 'Invoice' },
              { value: 'quotation', label: 'Quotation' },
              { value: 'job_order_slip', label: 'Job Order Slip' },
              { value: 'payment_acknowledgment', label: 'Payment Acknowledgment' },
            ]}
          />
          <Select
            label="Paper Format"
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as typeof paperSize)}
            options={[
              { value: '58mm', label: '58mm Thermal' },
              { value: '80mm', label: '80mm Thermal' },
              { value: 'A4', label: 'A4 Sheet' },
              { value: 'Letter', label: 'US Letter' },
              { value: 'Custom', label: `Custom (${settings.receiptTemplate.customWidthMm}mm)` },
            ]}
          />
          <Select
            label="Copy Mode"
            value={copyMode}
            onChange={(e) => setCopyMode(e.target.value as 'customer' | 'internal')}
            options={[
              { value: 'customer', label: 'Customer Copy' },
              { value: 'internal', label: 'Internal Production Copy' },
            ]}
          />
        </div>

        <div className="bg-slate-100 dark:bg-slate-900/70 p-4 rounded-xl flex justify-center overflow-x-auto border border-[var(--pos-border)]">
          <div
            id="printable-document"
            style={{ width: `${widthPx}px` }}
            className={`bg-white text-slate-900 border border-slate-300 shadow-sm ${
              isWide ? 'p-8 text-xs' : 'p-4 text-[11px]'
            } font-mono leading-relaxed`}
          >
            <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
              {settings.branding.showLogoOnReceipt && settings.branding.logoDataUrl && (
                <img
                  src={settings.branding.logoDataUrl}
                  alt={settings.branding.businessName}
                  className="h-10 mx-auto mb-2 object-contain"
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="font-bold text-sm">{settings.branding.businessName}</div>
              <div className="text-slate-600">{settings.branding.address}</div>
              <div className="text-slate-600">
                {settings.branding.phone} · {settings.branding.email}
              </div>
              {settings.branding.taxRegistrationNumber && (
                <div className="text-slate-600">
                  {settings.branding.taxIdLabel}: {settings.branding.taxRegistrationNumber}
                </div>
              )}
              <div className="mt-2 font-bold tracking-wide text-slate-900">
                {docTitleMap[docType]}
              </div>
              <div className="text-[10px] text-slate-500">
                {copyMode === 'internal' ? 'INTERNAL PRODUCTION COPY' : 'CUSTOMER COPY'}
              </div>
            </div>

            <div className="space-y-1 border-b border-dashed border-slate-300 pb-2.5 mb-2.5">
              <div className="flex justify-between">
                <span>Ref #:</span>
                <span className="font-bold">{docReference}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>
                  {new Date(
                    transaction?.createdAt || printJob?.createdAt || Date.now(),
                  ).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Customer:</span>
                <span>{transaction?.customerName || printJob?.customerName}</span>
              </div>
              {transaction && (
                <div className="flex justify-between">
                  <span>Cashier:</span>
                  <span>{transaction.cashierName}</span>
                </div>
              )}
              {printJob && (
                <div className="flex justify-between">
                  <span>Job Status:</span>
                  <span className="uppercase">{printJob.productionStatus.replace(/_/g, ' ')}</span>
                </div>
              )}
            </div>

            {transaction ? (
              <>
                <div className="border-b border-dashed border-slate-300 pb-2.5 mb-2.5 space-y-2">
                  {transaction.items.map((item) => (
                    <div key={item.id}>
                      <div className="flex justify-between font-semibold">
                        <span>{item.serviceName}</span>
                        <span>{formatCurrency(item.lineTotal, taxCurr)}</span>
                      </div>
                      <div className="text-[10px] text-slate-600 flex justify-between">
                        <span>
                          {item.effectiveQuantity} {item.unitLabel} ×{' '}
                          {formatCurrency(item.unitPrice, taxCurr)}
                        </span>
                        {item.lineDiscount > 0 && (
                          <span>-{formatCurrency(item.lineDiscount, taxCurr)}</span>
                        )}
                      </div>
                      {item.displaySummary && (
                        <div className="text-[10px] text-slate-500">{item.displaySummary}</div>
                      )}
                      {copyMode === 'internal' && item.config.notes && (
                        <div className="text-[10px] font-semibold text-slate-800">
                          Note: {item.config.notes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="space-y-1 border-b border-dashed border-slate-300 pb-2.5 mb-2.5">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatCurrency(transaction.subtotal, taxCurr)}</span>
                  </div>
                  {transaction.itemDiscountsTotal + transaction.orderDiscountAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Discounts</span>
                      <span>
                        -
                        {formatCurrency(
                          transaction.itemDiscountsTotal + transaction.orderDiscountAmount,
                          taxCurr,
                        )}
                      </span>
                    </div>
                  )}
                  {transaction.taxAmount > 0 && (
                    <div className="flex justify-between">
                      <span>
                        {settings.taxAndCurrency.taxName} ({settings.taxAndCurrency.taxRatePercent}%)
                      </span>
                      <span>{formatCurrency(transaction.taxAmount, taxCurr)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-sm pt-1">
                    <span>TOTAL</span>
                    <span>{formatCurrency(transaction.totalAmount, taxCurr)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Amount Paid</span>
                    <span>{formatCurrency(transaction.amountPaid, taxCurr)}</span>
                  </div>
                  {transaction.changeAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Change</span>
                      <span>{formatCurrency(transaction.changeAmount, taxCurr)}</span>
                    </div>
                  )}
                  {transaction.balanceDue > 0 && (
                    <div className="flex justify-between font-bold">
                      <span>Remaining Balance</span>
                      <span>{formatCurrency(transaction.balanceDue, taxCurr)}</span>
                    </div>
                  )}
                </div>

                {transaction.payments.length > 0 && (
                  <div className="space-y-1 border-b border-dashed border-slate-300 pb-2.5 mb-2.5">
                    <div className="font-semibold">Payments</div>
                    {transaction.payments.map((p) => (
                      <div key={p.id} className="flex justify-between text-[10px]">
                        <span>
                          {p.methodName}
                          {p.referenceNumber ? ` (${p.referenceNumber})` : ''} ·{' '}
                          {p.verificationStatus === 'verified' ? 'Verified' : 'Pending Verification'}
                        </span>
                        <span>{formatCurrency(p.amount, taxCurr)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              printJob && (
                <div className="space-y-2 border-b border-dashed border-slate-300 pb-2.5 mb-2.5">
                  <div className="font-semibold">{printJob.title}</div>
                  <div className="text-[10px] text-slate-600">{printJob.specifications}</div>
                  {printJob.instructions && (
                    <div className="text-[10px] text-slate-700">
                      Instructions: {printJob.instructions}
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-1">
                    <span>Total Amount</span>
                    <span>{formatCurrency(printJob.totalAmount, taxCurr)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Deposit Paid</span>
                    <span>{formatCurrency(printJob.depositAmount, taxCurr)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Balance Due</span>
                    <span>{formatCurrency(printJob.remainingBalance, taxCurr)}</span>
                  </div>
                </div>
              )
            )}

            <div className="text-center space-y-2 pt-1">
              {settings.branding.showQrOnReceipt && (
                <div className="flex flex-col items-center">
                  <svg width="64" height="64" viewBox="0 0 15 15" shapeRendering="crispEdges">
                    <rect width="15" height="15" fill="#ffffff" />
                    {qrMatrix.map((row, rIdx) =>
                      row.map((on, cIdx) =>
                        on ? (
                          <rect
                            key={`${rIdx}-${cIdx}`}
                            x={cIdx}
                            y={rIdx}
                            width="1"
                            height="1"
                            fill="#0F172A"
                          />
                        ) : null,
                      ),
                    )}
                  </svg>
                  <span className="text-[9px] text-slate-500 mt-0.5">{docReference}</span>
                </div>
              )}
              <div className="font-semibold">{settings.branding.receiptHeader}</div>
              <div className="text-[10px] text-slate-600">{settings.branding.receiptFooter}</div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
