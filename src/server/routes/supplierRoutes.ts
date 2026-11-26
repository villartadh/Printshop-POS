import express from 'express';
import fs from 'fs';
import { db, writeAuditLog } from '../db.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.ts';
import { applyInventoryAdjustment } from './inventoryRoutes.ts';
import {
  ALLOWED_SUPPLIER_DOC_MIMES,
  ALLOWED_SUPPLIER_DOC_TYPES,
  MAX_SUPPLIER_DOC_BYTES,
  genId,
  mapSupplierDocumentRow,
  mapSupplierRow,
  resolveSupplierDocPath,
  sanitizeDownloadFilename,
} from '../mappers.ts';
import type {
  InventoryItem,
  RecordSupplierOrderPayload,
  StockMovement,
  SupplierDocumentType,
  SupplierDocumentUploadPayload,
  SupplierSavePayload,
} from '../../shared/types.ts';

export const supplierRouter = express.Router();

supplierRouter.get('/suppliers', requireAuth, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM suppliers ORDER BY name ASC')
    .all() as Array<Record<string, unknown>>;
  res.json({
    suppliers: rows.map(mapSupplierRow),
    serverTime: new Date().toISOString(),
  });
});

supplierRouter.get('/suppliers/documents', requireAuth, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM supplier_documents ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>;
  res.json({
    documents: rows.map(mapSupplierDocumentRow),
  });
});

supplierRouter.post(
  '/suppliers/documents',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as Partial<SupplierDocumentUploadPayload>;
    const supplierName =
      typeof body.supplierName === 'string' ? body.supplierName.trim().slice(0, 140) : '';
    const supplierId =
      typeof body.supplierId === 'string' ? body.supplierId.trim().slice(0, 80) : '';
    const docType: SupplierDocumentType = ALLOWED_SUPPLIER_DOC_TYPES.has(
      body.docType as SupplierDocumentType,
    )
      ? (body.docType as SupplierDocumentType)
      : 'other';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
    const referenceNumber =
      typeof body.referenceNumber === 'string'
        ? body.referenceNumber.trim().slice(0, 80)
        : '';
    const effectiveDate =
      typeof body.effectiveDate === 'string' ? body.effectiveDate.trim().slice(0, 32) : '';
    const expiryDate =
      typeof body.expiryDate === 'string' ? body.expiryDate.trim().slice(0, 32) : '';
    const agreedTermsSummary =
      typeof body.agreedTermsSummary === 'string'
        ? body.agreedTermsSummary.trim().slice(0, 800)
        : '';
    const rawFileName =
      typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 180) : '';
    const mimeType =
      typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';
    const rawBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64.trim() : '';

    if (!supplierName) {
      return res.status(400).json({ error: 'Supplier name is required.' });
    }
    if (!title) {
      return res.status(400).json({ error: 'Document title is required.' });
    }
    if (!rawFileName || !rawBase64) {
      return res.status(400).json({ error: 'Select a valid document file to upload.' });
    }

    const safeExt = ALLOWED_SUPPLIER_DOC_MIMES[mimeType];
    if (!safeExt) {
      return res.status(400).json({
        error:
          'Unsupported file format. Upload PDF, PNG, JPG, WebP, TXT, CSV, DOCX, or XLSX files.',
      });
    }

    const cleanBase64 = rawBase64.includes(',')
      ? rawBase64.slice(rawBase64.indexOf(',') + 1)
      : rawBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Uploaded file appears empty or corrupted.' });
    }
    if (buffer.length > MAX_SUPPLIER_DOC_BYTES) {
      return res.status(413).json({
        error: 'File exceeds the 3 MB attachment size limit.',
      });
    }

    const id = genId('sdoc');
    const storageKey = `${id}${safeExt}`;
    const safeDisplayName = sanitizeDownloadFilename(rawFileName);
    const now = new Date().toISOString();

    let resolvedPath: string;
    try {
      resolvedPath = resolveSupplierDocPath(storageKey);
    } catch {
      return res.status(400).json({ error: 'Invalid storage path.' });
    }

    fs.writeFileSync(resolvedPath, buffer);

    try {
      db.prepare(`
        INSERT INTO supplier_documents (
          id, supplier_id, supplier_name, supplier_key, doc_type, title,
          reference_number, effective_date, expiry_date, agreed_terms_summary,
          file_name, mime_type, file_size, storage_key,
          uploaded_by_id, uploaded_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        supplierId,
        supplierName,
        supplierName.toLowerCase(),
        docType,
        title,
        referenceNumber,
        effectiveDate,
        expiryDate,
        agreedTermsSummary,
        safeDisplayName,
        mimeType,
        buffer.length,
        storageKey,
        req.authUser!.id,
        req.authUser!.fullName,
        now,
        now,
      );

      writeAuditLog(
        req.authUser!.id,
        req.authUser!.fullName,
        'SUPPLIER_DOC_UPLOADED',
        'supplier_document',
        id,
        `Attached ${docType} "${title}" (${safeDisplayName}) to ${supplierName}`,
      );
    } catch (err) {
      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
      }
      throw err;
    }

    const created = db
      .prepare('SELECT * FROM supplier_documents WHERE id = ?')
      .get(id) as Record<string, unknown>;
    res.status(201).json({
      document: mapSupplierDocumentRow(created),
    });
  },
);

supplierRouter.get('/supplier-documents/:id/file', requireAuth, (req, res) => {
  const id = String(req.params.id);
  const row = db.prepare('SELECT * FROM supplier_documents WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  const storageKey = String(row.storage_key || '');
  const mimeType = String(row.mime_type || '');
  if (!ALLOWED_SUPPLIER_DOC_MIMES[mimeType]) {
    return res.status(400).json({ error: 'Disallowed document media type.' });
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveSupplierDocPath(storageKey);
  } catch {
    return res.status(400).json({ error: 'Invalid document location.' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Stored document file is no longer on disk.' });
  }

  const safeName = sanitizeDownloadFilename(String(row.file_name || 'document'));
  const forceDownload = req.query.download === '1';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', mimeType);
  res.setHeader(
    'Content-Disposition',
    `${forceDownload ? 'attachment' : 'inline'}; filename="${safeName}"`,
  );
  return res.sendFile(resolvedPath);
});

supplierRouter.delete(
  '/suppliers/documents/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT * FROM supplier_documents WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Supplier document not found.' });
    }

    const storageKey = String(existing.storage_key || '');
    if (storageKey) {
      try {
        const resolvedPath = resolveSupplierDocPath(storageKey);
        if (fs.existsSync(resolvedPath)) {
          fs.unlinkSync(resolvedPath);
        }
      } catch {
        // Ignore path cleanup error when removing DB record
      }
    }

    db.prepare('DELETE FROM supplier_documents WHERE id = ?').run(id);
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'SUPPLIER_DOC_DELETED',
      'supplier_document',
      id,
      `Removed document "${String(existing.title)}" from ${String(existing.supplier_name)}`,
    );
    res.json({ ok: true, id });
  },
);

supplierRouter.post(
  '/suppliers/record-order',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as Partial<RecordSupplierOrderPayload>;
    const supplierName =
      typeof body.supplierName === 'string' ? body.supplierName.trim().slice(0, 140) : '';
    const reference =
      typeof body.reference === 'string' ? body.reference.trim().slice(0, 80) : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    const occurredAt =
      typeof body.occurredAt === 'string' && body.occurredAt.trim()
        ? body.occurredAt.trim()
        : new Date().toISOString();
    const orderedAt =
      typeof body.orderedAt === 'string' && body.orderedAt.trim()
        ? body.orderedAt.trim()
        : undefined;
    const expectedDeliveryAt =
      typeof body.expectedDeliveryAt === 'string' && body.expectedDeliveryAt.trim()
        ? body.expectedDeliveryAt.trim()
        : undefined;
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (!supplierName) {
      return res.status(400).json({ error: 'Supplier name is required.' });
    }
    if (!reference) {
      return res.status(400).json({ error: 'Purchase order reference # is required.' });
    }
    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'Select at least one inventory item to order.' });
    }
    if (rawItems.length > 100) {
      return res.status(400).json({ error: 'Cannot record more than 100 line items per purchase order.' });
    }

    const sanitizedLines = rawItems
      .filter(
        (line): line is NonNullable<typeof line> =>
          Boolean(line) &&
          typeof line.inventoryItemId === 'string' &&
          line.inventoryItemId.trim().length > 0 &&
          Number(line.quantity) > 0,
      )
      .map((line) => ({
        inventoryItemId: line.inventoryItemId.trim(),
        quantity: Number(Number(line.quantity).toFixed(2)),
        unitCost:
          line.unitCost !== undefined &&
          Number.isFinite(Number(line.unitCost)) &&
          Number(line.unitCost) >= 0
            ? Number(Number(line.unitCost).toFixed(2))
            : undefined,
      }));

    if (sanitizedLines.length === 0) {
      return res.status(400).json({ error: 'Each order line requires a positive quantity.' });
    }

    const movements: StockMovement[] = [];
    const updatedItems: InventoryItem[] = [];

    const run = db.transaction(() => {
      for (const line of sanitizedLines) {
        const result = applyInventoryAdjustment(
          line.inventoryItemId,
          {
            movementType: 'purchase',
            quantityDelta: line.quantity,
            unitCost: line.unitCost,
            referenceType: 'purchase_order',
            reference,
            occurredAt,
            orderedAt,
            expectedDeliveryAt,
            note: note || `Purchase order ${reference} from ${supplierName}`,
          },
          req.authUser!.id,
          req.authUser!.fullName,
        );
        movements.push(result.movement);
        updatedItems.push(result.item);
      }

      writeAuditLog(
        req.authUser!.id,
        req.authUser!.fullName,
        'SUPPLIER_PO_RECORDED',
        'supplier',
        reference,
        `Recorded PO ${reference} from ${supplierName} (${sanitizedLines.length} item(s))`,
      );
    });
    run();

    res.status(201).json({
      reference,
      supplierName,
      movements,
      items: updatedItems,
    });
  },
);

supplierRouter.post(
  '/suppliers',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as Partial<SupplierSavePayload>;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 140) : '';
    if (!name) {
      return res.status(400).json({ error: 'Supplier name is required.' });
    }

    const existing = db
      .prepare('SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(?)')
      .get(name) as { id: string } | undefined;
    if (existing) {
      return res.status(409).json({ error: `A supplier named "${name}" already exists.` });
    }

    const id = genId('sup');
    const now = new Date().toISOString();
    const contactPerson =
      typeof body.contactPerson === 'string' ? body.contactPerson.trim().slice(0, 120) : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 60) : '';
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 140) : '';
    const address = typeof body.address === 'string' ? body.address.trim().slice(0, 240) : '';
    const paymentTerms =
      typeof body.paymentTerms === 'string' ? body.paymentTerms.trim().slice(0, 80) : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 600) : '';
    const defaultLeadTimeDays =
      body.defaultLeadTimeDays !== undefined && Number.isFinite(Number(body.defaultLeadTimeDays))
        ? Math.max(0, Math.min(365, Math.round(Number(body.defaultLeadTimeDays))))
        : 3;
    const previousName =
      typeof body.previousName === 'string' ? body.previousName.trim() : '';
    const syncToLinkedItems = Boolean(body.syncToLinkedItems);
    const primaryContact = phone || email || contactPerson;

    let syncedItemsCount = 0;

    const run = db.transaction(() => {
      db.prepare(`
        INSERT INTO suppliers (
          id, name, contact_person, phone, email, address, default_lead_time_days,
          payment_terms, notes, is_demo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id,
        name,
        contactPerson,
        phone,
        email,
        address,
        defaultLeadTimeDays,
        paymentTerms,
        notes,
        now,
        now,
      );

      if (syncToLinkedItems) {
        const matchName = previousName || name;
        const info = db
          .prepare(`
            UPDATE inventory_items
            SET supplier = ?,
                supplier_contact = CASE WHEN ? != '' THEN ? ELSE supplier_contact END,
                lead_time_days = ?,
                updated_at = ?
            WHERE LOWER(TRIM(supplier)) = LOWER(?) OR LOWER(TRIM(supplier)) = LOWER(?)
          `)
          .run(name, primaryContact, primaryContact, defaultLeadTimeDays, now, matchName, name);
        syncedItemsCount = Number(info.changes) || 0;
      }

      writeAuditLog(
        req.authUser!.id,
        req.authUser!.fullName,
        'SUPPLIER_CREATED',
        'supplier',
        id,
        `Added supplier ${name} (${defaultLeadTimeDays}d lead time)`,
      );
    });
    run();

    const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    res.status(201).json({
      supplier: mapSupplierRow(created),
      syncedItemsCount,
    });
  },
);

supplierRouter.patch(
  '/suppliers/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Supplier not found.' });
    }

    const body = (req.body || {}) as Partial<SupplierSavePayload>;
    const nextName =
      body.name !== undefined
        ? String(body.name).trim().slice(0, 140)
        : String(existing.name);
    if (!nextName) {
      return res.status(400).json({ error: 'Supplier name cannot be empty.' });
    }

    const duplicate = db
      .prepare('SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(?) AND id != ?')
      .get(nextName, id) as { id: string } | undefined;
    if (duplicate) {
      return res.status(409).json({ error: `A supplier named "${nextName}" already exists.` });
    }

    const now = new Date().toISOString();
    const prevName = String(existing.name);
    const contactPerson =
      body.contactPerson !== undefined
        ? String(body.contactPerson).trim().slice(0, 120)
        : String(existing.contact_person || '');
    const phone =
      body.phone !== undefined
        ? String(body.phone).trim().slice(0, 60)
        : String(existing.phone || '');
    const email =
      body.email !== undefined
        ? String(body.email).trim().slice(0, 140)
        : String(existing.email || '');
    const address =
      body.address !== undefined
        ? String(body.address).trim().slice(0, 240)
        : String(existing.address || '');
    const paymentTerms =
      body.paymentTerms !== undefined
        ? String(body.paymentTerms).trim().slice(0, 80)
        : String(existing.payment_terms || '');
    const notes =
      body.notes !== undefined
        ? String(body.notes).trim().slice(0, 600)
        : String(existing.notes || '');
    const defaultLeadTimeDays =
      body.defaultLeadTimeDays !== undefined && Number.isFinite(Number(body.defaultLeadTimeDays))
        ? Math.max(0, Math.min(365, Math.round(Number(body.defaultLeadTimeDays))))
        : Number(existing.default_lead_time_days) || 0;

    const syncToLinkedItems = Boolean(body.syncToLinkedItems);
    const primaryContact = phone || email || contactPerson;
    let syncedItemsCount = 0;

    const run = db.transaction(() => {
      db.prepare(`
        UPDATE suppliers
        SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?,
            default_lead_time_days = ?, payment_terms = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nextName,
        contactPerson,
        phone,
        email,
        address,
        defaultLeadTimeDays,
        paymentTerms,
        notes,
        now,
        id,
      );

      if (syncToLinkedItems || prevName.toLowerCase() !== nextName.toLowerCase()) {
        const info = db
          .prepare(`
            UPDATE inventory_items
            SET supplier = ?,
                supplier_contact = CASE WHEN ? != '' THEN ? ELSE supplier_contact END,
                lead_time_days = CASE WHEN ? THEN ? ELSE lead_time_days END,
                updated_at = ?
            WHERE LOWER(TRIM(supplier)) = LOWER(?) OR LOWER(TRIM(supplier)) = LOWER(?)
          `)
          .run(
            nextName,
            syncToLinkedItems ? primaryContact : '',
            primaryContact,
            syncToLinkedItems ? 1 : 0,
            defaultLeadTimeDays,
            now,
            prevName,
            nextName,
          );
        syncedItemsCount = Number(info.changes) || 0;
      }

      if (prevName.toLowerCase() !== nextName.toLowerCase()) {
        db.prepare(`
          UPDATE supplier_documents
          SET supplier_id = ?, supplier_name = ?, supplier_key = ?, updated_at = ?
          WHERE supplier_id = ? OR LOWER(TRIM(supplier_name)) = LOWER(?)
        `).run(id, nextName, nextName.trim().toLowerCase(), now, id, prevName);
      }

      writeAuditLog(
        req.authUser!.id,
        req.authUser!.fullName,
        'SUPPLIER_UPDATED',
        'supplier',
        id,
        `Updated supplier ${nextName} (${defaultLeadTimeDays}d lead time)`,
      );
    });
    run();

    const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    res.json({
      supplier: mapSupplierRow(updated),
      syncedItemsCount,
    });
  },
);

supplierRouter.delete(
  '/suppliers/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(id) as
      | { id: string; name: string }
      | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Supplier not found.' });
    }
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    writeAuditLog(
      req.authUser!.id,
      req.authUser!.fullName,
      'SUPPLIER_DELETED',
      'supplier',
      id,
      `Removed supplier profile ${existing.name}`,
    );
    res.json({ ok: true, id });
  },
);
