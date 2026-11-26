import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ImageUp,
  Link2,
  PackagePlus,
  QrCode,
  RefreshCw,
  ScanBarcode,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
} from 'html5-qrcode';
import type {
  InventoryItem,
  StockAdjustmentPayload,
  StockMovement,
  StockMovementType,
} from '../../types/inventory.ts';
import type { TaxAndCurrencyConfig } from '../../shared/types.ts';
import { DEFAULT_SETTINGS } from '../../shared/defaults.ts';
import { formatCurrency } from '../../shared/pricingEngine.ts';
import {
  extractSupplierInfo,
  getInventoryStockStatus,
  getSuggestedRestockQuantity,
  isBelowMinimumThreshold,
} from '../../shared/inventoryModel.ts';
import {
  matchInventoryItemFromScan,
  type InventoryScanMatchResult,
  type ScanMatchMethod,
} from '../../shared/barcodeScannerMatch.ts';
import { Button, Card, Input, Select, StatusIndicator } from '../ui/Primitives.tsx';
import { Modal } from '../ui/Overlays.tsx';

export interface BarcodeReceivingScannerModalProps {
  open: boolean;
  onClose: () => void;
  inventory: InventoryItem[];
  taxAndCurrency?: TaxAndCurrencyConfig;
  canEditCatalog?: boolean;
  onAdjustStock: (itemId: string, payload: StockAdjustmentPayload) => Promise<StockMovement>;
  onAssignBarcode?: (itemId: string, barcode: string) => Promise<InventoryItem>;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

interface CameraOption {
  id: string;
  label: string;
}

interface SessionReceiveEntry {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  quantityDelta: number;
  quantityBefore: number;
  balanceAfter: number;
  unitCost: number;
  reference: string;
  scannedCode: string;
  timestamp: string;
}

const SUPPORTED_SCAN_FORMATS: Html5QrcodeSupportedFormats[] = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.AZTEC,
];

const MATCH_METHOD_LABELS: Record<ScanMatchMethod, string> = {
  barcode: 'Matched by Barcode',
  sku: 'Matched by SKU',
  supplier_sku: 'Matched by Vendor SKU',
  id: 'Matched by Item ID',
};

function defaultReceivingReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCV-${stamp}`;
}

function playScanTone(success: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(success ? 880 : 340, ctx.currentTime);
    if (success) {
      osc.frequency.setValueAtTime(1180, ctx.currentTime + 0.06);
    }
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 250);
  } catch {
    // Ignore audio context restrictions
  }
}

export const BarcodeReceivingScannerModal: React.FC<BarcodeReceivingScannerModalProps> = ({
  open,
  onClose,
  inventory,
  taxAndCurrency = DEFAULT_SETTINGS.taxAndCurrency,
  canEditCatalog = false,
  onAdjustStock,
  onAssignBarcode,
  onNotify,
}) => {
  const rawId = useId();
  const scannerRegionId = useMemo(
    () => `barcode-scanner-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [rawId],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isMountedRef = useRef(true);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const handleScannedTextRef = useRef<(rawText: string, source: 'camera' | 'file' | 'manual') => void>(
    () => {},
  );

  // Camera state
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [cameraStatus, setCameraStatus] = useState<
    'idle' | 'starting' | 'active' | 'error'
  >('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scanningFile, setScanningFile] = useState(false);

  // Manual / USB barcode input
  const [manualCode, setManualCode] = useState('');

  // Receiving session controls
  const [reference, setReference] = useState(defaultReceivingReference);
  const [movementType, setMovementType] = useState<StockMovementType>('purchase');
  const [autoReceiveOnScan, setAutoReceiveOnScan] = useState(false);
  const [autoReceiveQty, setAutoReceiveQty] = useState('1');

  // Active scan result & adjustment form
  const [scanResult, setScanResult] = useState<InventoryScanMatchResult | null>(null);
  const [receiveQty, setReceiveQty] = useState('1');
  const [receiveUnitCost, setReceiveUnitCost] = useState('');
  const [receiveNote, setReceiveNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Unmatched barcode assignment
  const [linkItemId, setLinkItemId] = useState('');
  const [linkingBarcode, setLinkingBarcode] = useState(false);

  // Session receiving log
  const [sessionEntries, setSessionEntries] = useState<SessionReceiveEntry[]>([]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const stopCamera = useCallback(async () => {
    const instance = scannerRef.current;
    if (!instance) {
      if (isMountedRef.current) setCameraStatus('idle');
      return;
    }
    try {
      if (instance.isScanning) {
        await instance.stop();
      }
    } catch {
      // Ignore stop errors if already stopped
    }
    try {
      instance.clear();
    } catch {
      // Ignore clear errors
    }
    if (isMountedRef.current) {
      setCameraStatus('idle');
    }
  }, []);

  const ensureScannerInstance = useCallback(() => {
    if (!scannerRef.current) {
      scannerRef.current = new Html5Qrcode(scannerRegionId, {
        verbose: false,
        formatsToSupport: SUPPORTED_SCAN_FORMATS,
        useBarCodeDetectorIfSupported: true,
      });
    }
    return scannerRef.current;
  }, [scannerRegionId]);

  const startCamera = useCallback(
    async (preferredCameraId?: string) => {
      if (!open) return;
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraStatus('error');
        setCameraError(
          'Camera access is unavailable in this browser context. Use Image Upload or Manual / USB Barcode Input below.',
        );
        return;
      }

      setCameraStatus('starting');
      setCameraError(null);

      try {
        await stopCamera();
        const instance = ensureScannerInstance();

        let cameraTarget: string | MediaTrackConstraints = { facingMode: 'environment' };
        let activeCamId = preferredCameraId || selectedCameraId;

        try {
          const detected = await Html5Qrcode.getCameras();
          if (isMountedRef.current && detected.length > 0) {
            const mapped = detected.map((cam, idx) => ({
              id: cam.id,
              label: cam.label || `Camera ${idx + 1}`,
            }));
            setCameras(mapped);
            if (!activeCamId || !mapped.some((c) => c.id === activeCamId)) {
              const rearCam = mapped.find((c) =>
                /(back|rear|environment)/i.test(c.label),
              );
              activeCamId = (rearCam ?? mapped[0]).id;
              setSelectedCameraId(activeCamId);
            }
            cameraTarget = activeCamId;
          }
        } catch {
          // Proceed with facingMode constraint if camera enumeration fails prior to permission grant
        }

        await instance.start(
          cameraTarget,
          {
            fps: 12,
            qrbox: (viewfinderWidth, viewfinderHeight) => ({
              width: Math.max(180, Math.min(310, Math.floor(viewfinderWidth * 0.82))),
              height: Math.max(110, Math.min(185, Math.floor(viewfinderHeight * 0.62))),
            }),
            aspectRatio: 4 / 3,
          },
          (decodedText) => {
            handleScannedTextRef.current(decodedText, 'camera');
          },
          () => {
            // Ignore frame-by-frame decode misses while scanning
          },
        );

        if (isMountedRef.current) {
          setCameraStatus('active');
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to start device camera.';
        setCameraStatus('error');
        setCameraError(
          /Permission|NotAllowed|denied/i.test(msg)
            ? 'Camera permission was denied. Allow camera access in your browser or use Image Upload / Manual Barcode Input.'
            : /NotFound|Requested device not found/i.test(msg)
              ? 'No camera device detected. You can upload a barcode photo or enter/scan a code below.'
              : msg,
        );
      }
    },
    [open, selectedCameraId, stopCamera, ensureScannerInstance],
  );

  // Stop & reset cleanly on modal open/close
  useEffect(() => {
    if (!open) {
      void stopCamera();
      scannerRef.current = null;
      return;
    }

    setReference(defaultReceivingReference());
    setScanResult(null);
    setManualCode('');
    setReceiveNote('');
    setLinkItemId(inventory[0]?.id ?? '');
    lastScanRef.current = { code: '', at: 0 };

    const timer = window.setTimeout(() => {
      void startCamera();
    }, 120);

    return () => {
      window.clearTimeout(timer);
      void stopCamera();
      scannerRef.current = null;
    };
    // Intentionally run lifecycle on open/close only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyStockUpdate = useCallback(
    async (
      item: InventoryItem,
      qtyNumber: number,
      costValue: number | undefined,
      scannedCode: string,
      noteText: string,
    ) => {
      const movement = await onAdjustStock(item.id, {
        movementType,
        quantityDelta: qtyNumber,
        unitCost: costValue,
        reference: reference.trim(),
        referenceType:
          movementType === 'purchase'
            ? 'purchase_order'
            : movementType === 'return'
              ? 'return'
              : 'manual',
        note: noteText.trim() || `Received via barcode/QR scanner (${scannedCode})`,
      });

      const entry: SessionReceiveEntry = {
        id: movement.id,
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        unit: item.unit,
        quantityDelta: movement.quantityDelta,
        quantityBefore: movement.quantityBefore ?? item.quantityOnHand,
        balanceAfter: movement.balanceAfter,
        unitCost: costValue ?? item.unitCost,
        reference: reference.trim(),
        scannedCode,
        timestamp: new Date().toISOString(),
      };
      setSessionEntries((prev) => [entry, ...prev]);
      return movement;
    },
    [movementType, onAdjustStock, reference],
  );

  const handleScannedText = useCallback(
    (rawText: string, source: 'camera' | 'file' | 'manual') => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      const now = Date.now();
      if (
        source === 'camera' &&
        lastScanRef.current.code === trimmed &&
        now - lastScanRef.current.at < 1800
      ) {
        return;
      }
      lastScanRef.current = { code: trimmed, at: now };

      const match = matchInventoryItemFromScan(trimmed, inventory);
      setScanResult(match);
      setManualCode(match.normalizedCode || trimmed);

      if (soundEnabled) {
        playScanTone(Boolean(match.item));
      }

      if (!match.item) {
        if (!linkItemId && inventory.length > 0) {
          setLinkItemId(inventory[0].id);
        }
        onNotify?.(`No inventory item matched code "${match.normalizedCode}".`, 'info');
        return;
      }

      const matchedItem = match.item;
      const suggested =
        match.suggestedQty ??
        (autoReceiveOnScan
          ? Math.max(0.1, Number(autoReceiveQty) || 1)
          : getSuggestedRestockQuantity(matchedItem) || 1);
      const nextCost =
        match.suggestedUnitCost !== undefined
          ? match.suggestedUnitCost
          : matchedItem.unitCost;

      setReceiveQty(String(suggested));
      setReceiveUnitCost(String(nextCost));
      setReceiveNote('');

      if (autoReceiveOnScan) {
        const autoQty = match.suggestedQty ?? (Number(autoReceiveQty) || 1);
        if (autoQty > 0) {
          setSubmitting(true);
          void applyStockUpdate(
            matchedItem,
            autoQty,
            nextCost,
            match.normalizedCode,
            'Instant scan receive',
          )
            .catch((err) => {
              onNotify?.(
                err instanceof Error ? err.message : 'Unable to update stock level.',
                'error',
              );
            })
            .finally(() => {
              if (isMountedRef.current) setSubmitting(false);
            });
        }
      }
    },
    [
      inventory,
      soundEnabled,
      linkItemId,
      onNotify,
      autoReceiveOnScan,
      autoReceiveQty,
      applyStockUpdate,
    ],
  );

  useEffect(() => {
    handleScannedTextRef.current = handleScannedText;
  }, [handleScannedText]);

  const liveMatchedItem = useMemo(() => {
    if (!scanResult?.item) return null;
    return inventory.find((i) => i.id === scanResult.item?.id) ?? scanResult.item;
  }, [inventory, scanResult]);

  const handleManualLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleScannedText(manualCode, 'manual');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setScanningFile(true);
    try {
      const wasActive = cameraStatus === 'active';
      if (wasActive) {
        await stopCamera();
      }
      const instance = ensureScannerInstance();
      const result = await instance.scanFileV2(file, false);
      handleScannedText(result.decodedText, 'file');
      if (wasActive) {
        void startCamera();
      }
    } catch {
      onNotify?.(
        'No readable barcode or QR code was found in that image.',
        'error',
      );
      if (soundEnabled) playScanTone(false);
    } finally {
      if (isMountedRef.current) setScanningFile(false);
    }
  };

  const handleConfirmReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveMatchedItem) return;

    const parsedQty = Number(receiveQty);
    if (!Number.isFinite(parsedQty) || parsedQty === 0) {
      onNotify?.('Enter a valid non-zero quantity.', 'error');
      return;
    }

    const parsedCost =
      receiveUnitCost.trim() !== '' &&
      Number.isFinite(Number(receiveUnitCost)) &&
      Number(receiveUnitCost) >= 0
        ? Number(receiveUnitCost)
        : undefined;

    setSubmitting(true);
    try {
      await applyStockUpdate(
        liveMatchedItem,
        parsedQty,
        parsedCost,
        scanResult?.normalizedCode || liveMatchedItem.sku,
        receiveNote,
      );
      setReceiveNote('');
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'Unable to update stock level.',
        'error',
      );
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  const handleAssignAndSelect = async () => {
    if (!scanResult?.normalizedCode || !linkItemId || !onAssignBarcode) return;
    setLinkingBarcode(true);
    try {
      const updated = await onAssignBarcode(linkItemId, scanResult.normalizedCode);
      setScanResult({
        rawCode: scanResult.rawCode,
        normalizedCode: scanResult.normalizedCode,
        item: updated,
        matchedBy: 'barcode',
        suggestedQty: scanResult.suggestedQty,
        suggestedUnitCost: scanResult.suggestedUnitCost,
      });
      const suggested =
        scanResult.suggestedQty ?? (getSuggestedRestockQuantity(updated) || 1);
      setReceiveQty(String(suggested));
      setReceiveUnitCost(String(updated.unitCost));
      onNotify?.(
        `Linked barcode "${scanResult.normalizedCode}" to ${updated.name}.`,
        'success',
      );
    } catch (err) {
      onNotify?.(
        err instanceof Error ? err.message : 'Unable to link barcode.',
        'error',
      );
    } finally {
      if (isMountedRef.current) setLinkingBarcode(false);
    }
  };

  const sessionTotals = useMemo(() => {
    const totalUnits = sessionEntries.reduce(
      (sum, entry) => sum + entry.quantityDelta,
      0,
    );
    const totalValue = sessionEntries.reduce(
      (sum, entry) => sum + Math.max(0, entry.quantityDelta) * entry.unitCost,
      0,
    );
    return {
      count: sessionEntries.length,
      totalUnits: Number(totalUnits.toFixed(2)),
      totalValue: Number(totalValue.toFixed(2)),
    };
  }, [sessionEntries]);

  const projectedBalance = useMemo(() => {
    if (!liveMatchedItem) return 0;
    const qty = Number(receiveQty) || 0;
    const delta =
      movementType === 'purchase' || movementType === 'return'
        ? Math.abs(qty)
        : movementType === 'adjustment'
          ? qty
          : -Math.abs(qty);
    return Math.max(0, Number((liveMatchedItem.quantityOnHand + delta).toFixed(2)));
  }, [liveMatchedItem, receiveQty, movementType]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Scan Barcode / QR to Receive Stock"
      subtitle="Use your device camera, barcode image, or handheld scanner to receive deliveries and update inventory counts"
      maxWidth="xl"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[var(--pos-text-muted)] font-mono-num">
            Session: <strong className="text-[var(--pos-text)]">{sessionTotals.count}</strong>{' '}
            update{sessionTotals.count === 1 ? '' : 's'} ·{' '}
            <strong className="text-[var(--pos-text)]">
              {sessionTotals.totalUnits >= 0 ? `+${sessionTotals.totalUnits}` : sessionTotals.totalUnits}
            </strong>{' '}
            units · {formatCurrency(sessionTotals.totalValue, taxAndCurrency)}
          </div>
          <Button variant="secondary" type="button" onClick={onClose}>
            Done Receiving
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column: Camera Viewport + Image / Manual Input */}
        <div className="lg:col-span-6 space-y-3">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <ScanBarcode className="w-4 h-4 text-[var(--pos-primary)] shrink-0" />
                <span className="text-sm font-semibold text-[var(--pos-text)] truncate">
                  Camera Scanner
                </span>
                <StatusIndicator
                  tone={
                    cameraStatus === 'active'
                      ? 'success'
                      : cameraStatus === 'starting'
                        ? 'warning'
                        : cameraStatus === 'error'
                          ? 'error'
                          : 'neutral'
                  }
                  label={
                    cameraStatus === 'active'
                      ? 'Live'
                      : cameraStatus === 'starting'
                        ? 'Starting...'
                        : cameraStatus === 'error'
                          ? 'Unavailable'
                          : 'Paused'
                  }
                />
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={soundEnabled ? 'Mute scan sound' : 'Enable scan sound'}
                  onClick={() => setSoundEnabled((prev) => !prev)}
                >
                  {soundEnabled ? (
                    <Volume2 className="w-3.5 h-3.5" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5" />
                  )}
                </Button>
                {cameraStatus === 'active' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void stopCamera()}
                  >
                    <CameraOff className="w-3.5 h-3.5" />
                    Stop Camera
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    loading={cameraStatus === 'starting'}
                    onClick={() => void startCamera()}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Start Camera
                  </Button>
                )}
              </div>
            </div>

            {cameras.length > 1 && (
              <Select
                label="Camera Source"
                value={selectedCameraId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedCameraId(nextId);
                  if (cameraStatus === 'active') {
                    void startCamera(nextId);
                  }
                }}
                options={cameras.map((cam) => ({
                  value: cam.id,
                  label: cam.label,
                }))}
              />
            )}

            {/* Video mount region */}
            <div
              style={{ borderRadius: 'var(--pos-radius)' }}
              className="relative w-full aspect-[4/3] bg-slate-950 border border-[var(--pos-border)] overflow-hidden flex items-center justify-center"
            >
              <div
                id={scannerRegionId}
                className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover"
              />

              {cameraStatus !== 'active' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-5 bg-slate-950/90 text-slate-200 space-y-2.5">
                  <QrCode className="w-8 h-8 text-slate-400" />
                  <div className="text-xs font-semibold">
                    {cameraStatus === 'starting'
                      ? 'Initializing device camera...'
                      : cameraStatus === 'error'
                        ? 'Camera Unavailable'
                        : 'Camera Stopped'}
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                    {cameraError ||
                      'Point your camera at a SKU barcode (Code 128 / EAN / UPC) or QR label to look up stock.'}
                  </p>
                  {cameraStatus !== 'starting' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void startCamera()}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {cameraStatus === 'error' ? 'Retry Camera' : 'Resume Camera'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Image Upload & Manual / USB Scanner Fallback */}
            <div className="pt-2 border-t border-[var(--pos-border)] space-y-2.5">
              <form onSubmit={handleManualLookup} className="flex items-end gap-2">
                <Input
                  label="Manual / USB Scanner Input"
                  placeholder="Scan or type barcode, SKU, or QR payload..."
                  className="font-mono-num"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                />
                <Button type="submit" variant="outline" className="shrink-0">
                  Lookup
                </Button>
              </form>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleFileUpload(e)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={scanningFile}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageUp className="w-3.5 h-3.5" />
                  Scan Barcode / QR from Image
                </Button>
                <span className="text-[11px] text-[var(--pos-text-muted)]">
                  Supports Code 128, EAN, UPC &amp; QR
                </span>
              </div>
            </div>
          </Card>

          {/* Batch Receiving Mode Controls */}
          <Card className="space-y-3">
            <div className="text-xs font-semibold text-[var(--pos-text)]">
              Receiving Session Settings
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Delivery / PO Reference #"
                className="font-mono-num"
                placeholder="e.g. PO-2026-042"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <Select
                label="Stock Update Type"
                value={movementType}
                onChange={(e) => setMovementType(e.target.value as StockMovementType)}
                options={[
                  { value: 'purchase', label: 'Purchase / Delivery Received (+)' },
                  { value: 'return', label: 'Supplier / Customer Return (+)' },
                  { value: 'adjustment', label: 'Manual Count Adjustment (+/-)' },
                ]}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[var(--pos-border)]">
              <label className="flex items-center gap-2 text-xs text-[var(--pos-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoReceiveOnScan}
                  onChange={(e) => setAutoReceiveOnScan(e.target.checked)}
                  className="h-4 w-4 accent-[var(--pos-primary)]"
                />
                <span>Auto-receive immediately on each camera scan</span>
              </label>
              {autoReceiveOnScan && (
                <div className="w-28">
                  <Input
                    aria-label="Default auto-receive quantity"
                    type="number"
                    min="0.1"
                    step="0.1"
                    className="font-mono-num"
                    value={autoReceiveQty}
                    onChange={(e) => setAutoReceiveQty(e.target.value)}
                  />
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Matched Item Receiving Form & Session History */}
        <div className="lg:col-span-6 space-y-3">
          {!scanResult ? (
            <Card className="py-10 text-center space-y-2.5">
              <ScanBarcode className="w-8 h-8 mx-auto text-[var(--pos-text-muted)] opacity-45" />
              <div className="text-sm font-semibold text-[var(--pos-text)]">
                Ready to scan incoming stock
              </div>
              <p className="text-xs text-[var(--pos-text-muted)] max-w-sm mx-auto leading-relaxed">
                Hold an item&apos;s barcode or QR label inside the camera frame, upload a photo of a label, or type a SKU/barcode to update on-hand stock.
              </p>
            </Card>
          ) : !liveMatchedItem ? (
            <Card className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <StatusIndicator tone="warning" label="Unrecognized Code" />
                  <h4 className="text-sm font-semibold text-[var(--pos-text)] mt-1">
                    No matching inventory item found
                  </h4>
                  <p className="text-xs text-[var(--pos-text-muted)] mt-0.5">
                    Scanned code:{' '}
                    <strong className="font-mono-num text-[var(--pos-text)]">
                      {scanResult.normalizedCode}
                    </strong>
                  </p>
                </div>
              </div>

              {canEditCatalog && onAssignBarcode && inventory.length > 0 ? (
                <div className="space-y-2.5 pt-2 border-t border-[var(--pos-border)]">
                  <div className="text-xs font-medium text-[var(--pos-text)]">
                    Assign this scanned code as the barcode for an existing item:
                  </div>
                  <Select
                    label="Select Inventory Item"
                    value={linkItemId}
                    onChange={(e) => setLinkItemId(e.target.value)}
                    options={inventory.map((i) => ({
                      value: i.id,
                      label: `${i.name} (${i.sku} · On hand: ${i.quantityOnHand} ${i.unit})`,
                    }))}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setScanResult(null)}
                    >
                      Dismiss
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      loading={linkingBarcode}
                      onClick={() => void handleAssignAndSelect()}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Link Barcode to Item
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--pos-text-muted)]">
                  Verify the item&apos;s SKU or barcode in Inventory Management, or ask a manager to link this barcode.
                </p>
              )}
            </Card>
          ) : (
            <Card className="space-y-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2 pb-2.5 border-b border-[var(--pos-border)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--pos-text-muted)]">
                    <span className="font-medium text-[var(--pos-success)]">
                      {scanResult.matchedBy
                        ? MATCH_METHOD_LABELS[scanResult.matchedBy]
                        : 'Item Selected'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">{liveMatchedItem.sku}</span>
                    {liveMatchedItem.barcode && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">
                          Barcode: {liveMatchedItem.barcode}
                        </span>
                      </>
                    )}
                  </div>
                  <h4 className="text-base font-bold text-[var(--pos-text)] mt-0.5 truncate">
                    {liveMatchedItem.name}
                  </h4>
                  <div className="text-[11px] text-[var(--pos-text-muted)] mt-0.5">
                    {extractSupplierInfo(liveMatchedItem).name || 'No supplier assigned'}
                    {liveMatchedItem.storageLocation
                      ? ` · Bin: ${liveMatchedItem.storageLocation}`
                      : ''}
                  </div>
                </div>

                <StatusIndicator
                  tone={
                    isBelowMinimumThreshold(liveMatchedItem) ||
                    getInventoryStockStatus(liveMatchedItem) === 'out_of_stock'
                      ? 'error'
                      : getInventoryStockStatus(liveMatchedItem) === 'low_stock'
                        ? 'warning'
                        : 'success'
                  }
                  label={
                    getInventoryStockStatus(liveMatchedItem) === 'out_of_stock'
                      ? 'Out of Stock'
                      : getInventoryStockStatus(liveMatchedItem) === 'low_stock'
                        ? 'Low Stock'
                        : 'In Stock'
                  }
                />
              </div>

              {/* Current vs Projected Stock Strip */}
              <div className="grid grid-cols-3 gap-3 text-xs py-1">
                <div>
                  <div className="text-[11px] text-[var(--pos-text-muted)]">Current On Hand</div>
                  <div className="text-sm font-bold font-mono-num text-[var(--pos-text)] mt-0.5">
                    {liveMatchedItem.quantityOnHand} {liveMatchedItem.unit}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--pos-text-muted)]">Reorder Level</div>
                  <div className="text-sm font-semibold font-mono-num text-[var(--pos-text-muted)] mt-0.5">
                    {liveMatchedItem.reorderLevel} {liveMatchedItem.unit}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--pos-text-muted)]">After Update</div>
                  <div className="text-sm font-bold font-mono-num text-[var(--pos-success)] mt-0.5">
                    {projectedBalance} {liveMatchedItem.unit}
                  </div>
                </div>
              </div>

              <form onSubmit={handleConfirmReceive} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label={`Quantity (${liveMatchedItem.unit})`}
                    type="number"
                    step="0.1"
                    className="font-mono-num"
                    value={receiveQty}
                    onChange={(e) => setReceiveQty(e.target.value)}
                    required
                  />
                  <Input
                    label={`Unit Cost (${taxAndCurrency.currencySymbol})`}
                    type="number"
                    min="0"
                    step="0.01"
                    className="font-mono-num"
                    value={receiveUnitCost}
                    onChange={(e) => setReceiveUnitCost(e.target.value)}
                  />
                </div>

                {/* Quick Quantity Presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {[1, 5, 10, 25, 50].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setReceiveQty((prev) =>
                          String(Math.max(0, (Number(prev) || 0) + preset)),
                        )
                      }
                    >
                      +{preset}
                    </Button>
                  ))}
                  {getSuggestedRestockQuantity(liveMatchedItem) > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setReceiveQty(
                          String(getSuggestedRestockQuantity(liveMatchedItem)),
                        )
                      }
                    >
                      Restock ({getSuggestedRestockQuantity(liveMatchedItem)})
                    </Button>
                  )}
                </div>

                <Input
                  label="Receiving Note (Optional)"
                  placeholder="e.g. Box 1 of 3 checked in good condition"
                  value={receiveNote}
                  onChange={(e) => setReceiveNote(e.target.value)}
                />

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setScanResult(null)}
                  >
                    Clear
                  </Button>
                  <Button type="submit" size="sm" loading={submitting}>
                    <PackagePlus className="w-3.5 h-3.5" />
                    Confirm &amp; Update Stock
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {/* Session Received Log */}
          <Card padded={false} className="overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--pos-border)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[var(--pos-success)]" />
                <h4 className="text-sm font-semibold text-[var(--pos-text)]">
                  Received This Session ({sessionEntries.length})
                </h4>
              </div>
              {sessionEntries.length > 0 && (
                <span className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                  {sessionTotals.totalUnits >= 0
                    ? `+${sessionTotals.totalUnits}`
                    : sessionTotals.totalUnits}{' '}
                  units
                </span>
              )}
            </div>

            {sessionEntries.length === 0 ? (
              <div className="py-6 px-4 text-center text-xs text-[var(--pos-text-muted)]">
                Scanned stock updates will appear here as items are checked in.
              </div>
            ) : (
              <div className="divide-y divide-[var(--pos-border)] max-h-56 overflow-y-auto">
                {sessionEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--pos-text)] truncate">
                        {entry.itemName}
                      </div>
                      <div className="text-[11px] font-mono-num text-[var(--pos-text-muted)]">
                        {entry.sku}
                        {entry.reference ? ` · ${entry.reference}` : ''} ·{' '}
                        {new Date(entry.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono-num">
                      <div
                        className={`font-semibold ${
                          entry.quantityDelta >= 0
                            ? 'text-[var(--pos-success)]'
                            : 'text-[var(--pos-error)]'
                        }`}
                      >
                        {entry.quantityDelta >= 0
                          ? `+${entry.quantityDelta}`
                          : entry.quantityDelta}{' '}
                        {entry.unit}
                      </div>
                      <div className="text-[11px] text-[var(--pos-text-muted)]">
                        {entry.quantityBefore} → {entry.balanceAfter}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Modal>
  );
};
