import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  SupplierDocument,
  SupplierDocumentType,
  SupplierDocumentUploadPayload,
} from '../../types/inventory.ts';
import type { SupplierProfile } from '../../shared/supplierModel.ts';
import { fetchAuthorizedBlob } from '../../services/apiClient.ts';
import { Button, Card, Input, Select, StatusIndicator } from '../ui/Primitives.tsx';
import { Modal } from '../ui/Overlays.tsx';

export interface SupplierDocumentsPanelProps {
  supplier: SupplierProfile;
  canManage: boolean;
  onUploadDocument: (
    payload: SupplierDocumentUploadPayload,
  ) => Promise<SupplierDocument>;
  onDeleteDocument: (id: string) => Promise<void>;
  onNotify: (text: string, tone?: 'success' | 'error' | 'info') => void;
}

const DOC_TYPE_LABELS: Record<SupplierDocumentType, string> = {
  invoice: 'Invoice',
  contract: 'Contract / SLA',
  pricing_agreement: 'Pricing Agreement',
  quote: 'Quotation',
  other: 'Other Document',
};

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const ALLOWED_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv';

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resolveMimeType(file: File): string {
  const raw = (file.type || '').trim().toLowerCase();
  if (raw && Object.values(EXTENSION_MIME_MAP).includes(raw)) {
    return raw;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME_MAP[ext] || raw;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Unable to read file contents.'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

function evaluateExpiryStatus(expiryDate?: string): {
  tone: 'success' | 'warning' | 'error' | 'neutral';
  label: string;
} | null {
  if (!expiryDate) return null;
  const parsed = Date.parse(`${expiryDate}T23:59:59`);
  if (Number.isNaN(parsed)) return null;
  const daysLeft = Math.ceil((parsed - Date.now()) / 86400000);
  if (daysLeft < 0) {
    return { tone: 'error', label: 'Expired' };
  }
  if (daysLeft <= 30) {
    return { tone: 'warning', label: `Expires in ${daysLeft}d` };
  }
  return { tone: 'success', label: 'Active' };
}

export const SupplierDocumentsPanel: React.FC<SupplierDocumentsPanelProps> = ({
  supplier,
  canManage,
  onUploadDocument,
  onDeleteDocument,
  onNotify,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [typeFilter, setTypeFilter] = useState<SupplierDocumentType | 'all'>('all');

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [docType, setDocType] = useState<SupplierDocumentType>('contract');
  const [title, setTitle] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [expiryDate, setExpiryDate] = useState('');
  const [agreedTermsSummary, setAgreedTermsSummary] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Preview modal state
  const [previewDoc, setPreviewDoc] = useState<SupplierDocument | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<SupplierDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  const filteredDocuments = useMemo(() => {
    if (typeFilter === 'all') return supplier.documents;
    return supplier.documents.filter((d) => d.docType === typeFilter);
  }, [supplier.documents, typeFilter]);

  const agreementHighlights = useMemo(
    () =>
      supplier.documents.filter(
        (d) =>
          (d.docType === 'contract' || d.docType === 'pricing_agreement') &&
          Boolean(d.agreedTermsSummary || d.expiryDate),
      ),
    [supplier.documents],
  );

  const resetUploadForm = (initialType: SupplierDocumentType = 'contract') => {
    setDocType(initialType);
    setTitle('');
    setReferenceNumber('');
    setEffectiveDate(new Date().toISOString().slice(0, 10));
    setExpiryDate('');
    setAgreedTermsSummary('');
    setSelectedFile(null);
  };

  const handleOpenUpload = (initialType: SupplierDocumentType = 'contract') => {
    resetUploadForm(initialType);
    setUploadOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      onNotify('File exceeds the 3 MB maximum attachment size.', 'error');
      return;
    }
    const mime = resolveMimeType(file);
    if (!Object.values(EXTENSION_MIME_MAP).includes(mime)) {
      onNotify(
        'Unsupported file type. Upload PDF, PNG, JPG, WebP, TXT, CSV, DOCX, or XLSX.',
        'error',
      );
      return;
    }
    setSelectedFile(file);
    if (!title.trim()) {
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      setTitle(base);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      onNotify('Choose a file to attach.', 'error');
      return;
    }
    if (!title.trim()) {
      onNotify('Document title is required.', 'error');
      return;
    }

    const mimeType = resolveMimeType(selectedFile);
    setUploading(true);
    try {
      const dataBase64 = await readFileAsBase64(selectedFile);
      await onUploadDocument({
        supplierId: supplier.record?.id,
        supplierName: supplier.name,
        docType,
        title: title.trim(),
        referenceNumber: referenceNumber.trim(),
        effectiveDate: effectiveDate.trim(),
        expiryDate: expiryDate.trim(),
        agreedTermsSummary: agreedTermsSummary.trim(),
        fileName: selectedFile.name,
        mimeType,
        dataBase64,
      });
      setUploadOpen(false);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to attach document.',
        'error',
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: SupplierDocument) => {
    setDownloadingId(doc.id);
    try {
      const blob = await fetchAuthorizedBlob(
        `/api/supplier-documents/${doc.id}/file?download=1`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = doc.fileName || 'supplier-document';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to download document.',
        'error',
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePreview = async (doc: SupplierDocument) => {
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewText(null);
    setPreviewDoc(doc);
    setPreviewLoading(true);
    try {
      const blob = await fetchAuthorizedBlob(`/api/supplier-documents/${doc.id}/file`);
      if (doc.mimeType === 'text/plain' || doc.mimeType === 'text/csv') {
        const txt = await blob.text();
        setPreviewText(txt);
      } else if (
        doc.mimeType === 'application/pdf' ||
        doc.mimeType.startsWith('image/')
      ) {
        const url = URL.createObjectURL(blob);
        setPreviewBlobUrl(url);
      }
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to load document preview.',
        'error',
      );
      setPreviewDoc(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewText(null);
    setPreviewDoc(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDeleteDocument(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Unable to delete document.',
        'error',
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-48">
          <Select
            aria-label="Filter supplier documents"
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as SupplierDocumentType | 'all')
            }
            options={[
              { value: 'all', label: `All Files (${supplier.documents.length})` },
              {
                value: 'contract',
                label: `Contracts (${supplier.documents.filter((d) => d.docType === 'contract').length})`,
              },
              {
                value: 'pricing_agreement',
                label: `Pricing Agreements (${supplier.documents.filter((d) => d.docType === 'pricing_agreement').length})`,
              },
              {
                value: 'invoice',
                label: `Invoices (${supplier.documents.filter((d) => d.docType === 'invoice').length})`,
              },
              {
                value: 'quote',
                label: `Quotations (${supplier.documents.filter((d) => d.docType === 'quote').length})`,
              },
              {
                value: 'other',
                label: `Other (${supplier.documents.filter((d) => d.docType === 'other').length})`,
              },
            ]}
          />
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="whitespace-nowrap shrink-0"
              onClick={() => handleOpenUpload('invoice')}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Attach Invoice
            </Button>
            <Button
              type="button"
              size="sm"
              className="whitespace-nowrap shrink-0"
              onClick={() => handleOpenUpload('contract')}
            >
              <Plus className="w-3.5 h-3.5" />
              Attach Contract / Agreement
            </Button>
          </div>
        )}
      </div>

      {/* Terms & Pricing Agreements Quick Reference */}
      {agreementHighlights.length > 0 && (
        <Card className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--pos-text)]">
            <FileCheck2 className="w-4 h-4 text-[var(--pos-primary)]" />
            <span>Terms &amp; Pricing Agreements Summary</span>
          </div>
          <div className="divide-y divide-[var(--pos-border)]">
            {agreementHighlights.slice(0, 3).map((doc) => {
              const expiry = evaluateExpiryStatus(doc.expiryDate);
              return (
                <div
                  key={doc.id}
                  className="py-2 first:pt-0 last:pb-0 flex flex-wrap items-start justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--pos-text)]">
                        {doc.title}
                      </span>
                      <span className="text-[11px] text-[var(--pos-text-muted)]">
                        {DOC_TYPE_LABELS[doc.docType]}
                        {doc.referenceNumber ? ` · Ref: ${doc.referenceNumber}` : ''}
                      </span>
                      {expiry && (
                        <StatusIndicator tone={expiry.tone} label={expiry.label} />
                      )}
                    </div>
                    {doc.agreedTermsSummary && (
                      <p className="text-[11px] text-[var(--pos-text-muted)] leading-relaxed">
                        {doc.agreedTermsSummary}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono-num text-[11px] text-[var(--pos-text-muted)]">
                    {doc.effectiveDate && <span>From {doc.effectiveDate}</span>}
                    {doc.expiryDate && <span>Until {doc.expiryDate}</span>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handlePreview(doc)}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Open
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Attached Documents List */}
      <Card padded={false} className="overflow-hidden">
        {filteredDocuments.length === 0 ? (
          <div className="py-10 px-4 text-center space-y-2.5">
            <Paperclip className="w-7 h-7 mx-auto text-[var(--pos-text-muted)] opacity-45" />
            <div className="text-sm font-semibold text-[var(--pos-text)]">
              {supplier.documents.length === 0
                ? `No digital invoices or contracts attached to ${supplier.name}`
                : 'No documents match this filter'}
            </div>
            <p className="text-xs text-[var(--pos-text-muted)] max-w-md mx-auto">
              Store signed vendor contracts, rate cards, historical pricing agreements, and digital supplier invoices directly on this profile for fast lookup.
            </p>
            {canManage && supplier.documents.length === 0 && (
              <Button
                type="button"
                size="sm"
                onClick={() => handleOpenUpload('contract')}
              >
                <Upload className="w-3.5 h-3.5" />
                Attach First Document
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--pos-border)] text-[11px] uppercase tracking-wider text-[var(--pos-text-muted)] bg-[var(--pos-bg)]">
                  <th className="py-2.5 px-3 font-semibold">Document &amp; Terms</th>
                  <th className="py-2.5 px-3 font-semibold">Type</th>
                  <th className="py-2.5 px-3 font-semibold">Term Dates</th>
                  <th className="py-2.5 px-3 font-semibold">File</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--pos-border)] text-xs">
                {filteredDocuments.map((doc) => {
                  const expiry = evaluateExpiryStatus(doc.expiryDate);
                  return (
                    <tr
                      key={doc.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/35"
                    >
                      <td className="py-2.5 px-3 max-w-xs">
                        <div className="font-semibold text-[var(--pos-text)]">
                          {doc.title}
                        </div>
                        <div className="text-[11px] text-[var(--pos-text-muted)] font-mono-num">
                          {doc.referenceNumber ? `Ref: ${doc.referenceNumber} · ` : ''}
                          Uploaded {new Date(doc.createdAt).toLocaleDateString()} by{' '}
                          {doc.uploadedBy}
                        </div>
                        {doc.agreedTermsSummary && (
                          <div className="text-[11px] text-[var(--pos-text-muted)] mt-1 line-clamp-2">
                            {doc.agreedTermsSummary}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-medium text-[var(--pos-text)]">
                          {DOC_TYPE_LABELS[doc.docType]}
                        </div>
                        {expiry && (
                          <div className="mt-0.5">
                            <StatusIndicator tone={expiry.tone} label={expiry.label} />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono-num text-[11px] text-[var(--pos-text-muted)] whitespace-nowrap">
                        {doc.effectiveDate || doc.expiryDate ? (
                          <div>
                            <div>{doc.effectiveDate ? `Eff: ${doc.effectiveDate}` : 'Eff: —'}</div>
                            <div>{doc.expiryDate ? `Exp: ${doc.expiryDate}` : 'No expiry'}</div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 text-[var(--pos-text)]">
                          <FileText className="w-3.5 h-3.5 text-[var(--pos-primary)] shrink-0" />
                          <span className="truncate max-w-[160px]" title={doc.fileName}>
                            {doc.fileName}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                          {formatBytes(doc.fileSize)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Preview ${doc.title}`}
                            onClick={() => void handlePreview(doc)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            loading={downloadingId === doc.id}
                            aria-label={`Download ${doc.title}`}
                            onClick={() => void handleDownload(doc)}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                          {canManage && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Delete ${doc.title}`}
                              onClick={() => setDeleteTarget(doc)}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-[var(--pos-error)]" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Attach Document Modal */}
      <Modal
        open={uploadOpen}
        onClose={() => {
          if (!uploading) setUploadOpen(false);
        }}
        title={`Attach Document · ${supplier.name}`}
        subtitle="Upload digital invoices, vendor contracts, or historical pricing agreements (max 3 MB)"
        maxWidth="md"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Document Type"
              value={docType}
              onChange={(e) => setDocType(e.target.value as SupplierDocumentType)}
              options={[
                { value: 'contract', label: 'Master Contract / SLA' },
                { value: 'pricing_agreement', label: 'Historical Pricing Agreement' },
                { value: 'invoice', label: 'Digital Supplier Invoice' },
                { value: 'quote', label: 'Vendor Price Quotation' },
                { value: 'other', label: 'Other Agreement' },
              ]}
            />
            <Input
              label="Reference / Invoice #"
              className="font-mono-num"
              placeholder="e.g. INV-2026-412 or SLA-26"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </div>

          <Input
            label="Document Title *"
            placeholder="e.g. 2026 Annual Bond & Gloss Paper Rate Card"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Effective / Issue Date"
              type="date"
              className="font-mono-num"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
            <Input
              label="Expiry / Renewal Date (Optional)"
              type="date"
              className="font-mono-num"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor="supplier_doc_terms_summary"
              className="block text-xs font-medium text-[var(--pos-text-muted)] mb-1.5"
            >
              Agreed Terms &amp; Pricing Notes
            </label>
            <textarea
              id="supplier_doc_terms_summary"
              rows={3}
              placeholder="Summarize payment terms, volume rebates, locked SKU pricing, or SLA delivery windows..."
              value={agreedTermsSummary}
              onChange={(e) => setAgreedTermsSummary(e.target.value)}
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="w-full bg-[var(--pos-surface)] border border-[var(--pos-border)] px-3 py-2 text-sm text-[var(--pos-text)] placeholder:text-[var(--pos-text-muted)]/70 focus:outline-none focus:border-[var(--pos-primary)] focus:ring-2 focus:ring-[var(--pos-primary)]/15 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-[var(--pos-text-muted)]">
              Attachment File *
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_ACCEPT}
              className="hidden"
              onChange={handleFileChange}
            />
            <div
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="p-3 border border-dashed border-[var(--pos-border)] bg-[var(--pos-bg)] flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0 text-xs">
                {selectedFile ? (
                  <div>
                    <div className="font-semibold text-[var(--pos-text)] truncate">
                      {selectedFile.name}
                    </div>
                    <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                      {formatBytes(selectedFile.size)}
                    </div>
                  </div>
                ) : (
                  <div className="text-[var(--pos-text-muted)]">
                    PDF, PNG, JPG, WebP, CSV, TXT, DOCX, or XLSX (up to 3 MB)
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-3.5 h-3.5" />
                {selectedFile ? 'Replace File' : 'Choose File'}
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              disabled={uploading}
              onClick={() => setUploadOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={uploading}>
              <Paperclip className="w-3.5 h-3.5" />
              Save Attachment
            </Button>
          </div>
        </form>
      </Modal>

      {/* In-App Preview Modal */}
      <Modal
        open={Boolean(previewDoc)}
        onClose={closePreview}
        title={previewDoc ? previewDoc.title : 'Document Preview'}
        subtitle={
          previewDoc
            ? `${DOC_TYPE_LABELS[previewDoc.docType]} · ${previewDoc.fileName}${
                previewDoc.referenceNumber ? ` · Ref: ${previewDoc.referenceNumber}` : ''
              }`
            : ''
        }
        maxWidth="xl"
        footer={
          previewDoc && (
            <div className="w-full flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[var(--pos-text-muted)]">
                {previewDoc.agreedTermsSummary ||
                  `Uploaded by ${previewDoc.uploadedBy} on ${new Date(
                    previewDoc.createdAt,
                  ).toLocaleDateString()}`}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={downloadingId === previewDoc.id}
                  onClick={() => void handleDownload(previewDoc)}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={closePreview}>
                  Close
                </Button>
              </div>
            </div>
          )
        }
      >
        {previewDoc && (
          <div className="space-y-3">
            {previewLoading ? (
              <div className="py-16 text-center text-xs text-[var(--pos-text-muted)]">
                Loading document preview...
              </div>
            ) : previewText !== null ? (
              <pre
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="p-4 bg-[var(--pos-bg)] border border-[var(--pos-border)] text-xs font-mono-num text-[var(--pos-text)] max-h-[60vh] overflow-auto whitespace-pre-wrap break-words"
              >
                {previewText}
              </pre>
            ) : previewBlobUrl && previewDoc.mimeType === 'application/pdf' ? (
              <iframe
                src={previewBlobUrl}
                title={previewDoc.title}
                style={{ borderRadius: 'var(--pos-radius)' }}
                className="w-full h-[65vh] border border-[var(--pos-border)] bg-white"
              />
            ) : previewBlobUrl && previewDoc.mimeType.startsWith('image/') ? (
              <div className="flex justify-center bg-[var(--pos-bg)] border border-[var(--pos-border)] rounded-lg p-3 max-h-[65vh] overflow-auto">
                <img
                  src={previewBlobUrl}
                  alt={previewDoc.title}
                  className="max-w-full max-h-[60vh] object-contain"
                />
              </div>
            ) : (
              <div className="py-12 text-center space-y-3">
                <FileText className="w-8 h-8 mx-auto text-[var(--pos-text-muted)] opacity-50" />
                <div className="text-sm font-semibold text-[var(--pos-text)]">
                  Inline preview is unavailable for this file format
                </div>
                <p className="text-xs text-[var(--pos-text-muted)]">
                  Click Download below to open{' '}
                  <strong className="text-[var(--pos-text)]">{previewDoc.fileName}</strong>{' '}
                  in your spreadsheet or document editor.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Document Confirmation */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title="Remove Supplier Document"
        subtitle={deleteTarget?.title || ''}
        maxWidth="sm"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove Document
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <p className="text-xs text-[var(--pos-text-muted)] leading-relaxed">
            Removing <strong className="text-[var(--pos-text)]">{deleteTarget.title}</strong> (
            {deleteTarget.fileName}) permanently deletes this attached file from{' '}
            <strong className="text-[var(--pos-text)]">{supplier.name}</strong>.
          </p>
        )}
      </Modal>
    </div>
  );
};
