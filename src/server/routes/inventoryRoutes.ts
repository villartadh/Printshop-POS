import express from 'express';
import { db, writeAuditLog } from '../db.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../auth.ts';
import { evaluateAndDispatchCriticalAlerts } from '../criticalAlertService.ts';
import { HttpError } from '../httpUtils.ts';
import { genId, mapInventoryItemRow, mapStockMovementRow } from '../mappers.ts';
import {
  computeSignedStockDelta,
  generateUniqueInventorySku,
  inferReferenceType,
  validateInventoryItemInput,
  validateStockMovementInput,
} from '../../shared/inventoryModel.ts';
import type {
  BulkInventoryUpdatePayload,
  InventoryItem,
  StockMovement,
  StockMovementType,
  SupplierCsvImportPayload,
  SupplyCategory,
} from '../../shared/types.ts';

export const inventoryRouter = express.Router();

export function applyInventoryAdjustment(
  id: string,
  payload: {
    movementType?: StockMovementType;
    quantityDelta?: number;
    unitCost?: number;
    note?: string;
    reference?: string;
    referenceType?: StockMovement['referenceType'];
    occurredAt?: string;
    orderedAt?: string;
    expectedDeliveryAt?: string;
  },
  actorId: string,
  actorName: string,
) {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    throw new HttpError(404, 'Inventory item not found.');
  }

  const resolvedMovementType: StockMovementType = (payload.movementType ||
    'adjustment') as StockMovementType;
  const validation = validateStockMovementInput({
    movementType: resolvedMovementType,
    quantityDelta: Number(payload.quantityDelta) || 0,
  });
  if (!validation.valid) {
    throw new HttpError(400, validation.error);
  }

  const signedDelta = computeSignedStockDelta(
    resolvedMovementType,
    Number(payload.quantityDelta) || 0,
  );
  const qtyBefore = Number(existing.quantity_on_hand) || 0;
  const nextQty = Math.max(0, Number((qtyBefore + signedDelta).toFixed(2)));
  const now = new Date().toISOString();
  const effectiveTimestamp =
    typeof payload.occurredAt === 'string' && payload.occurredAt ? payload.occurredAt : now;
  const orderedAtStr =
    typeof payload.orderedAt === 'string' && payload.orderedAt ? payload.orderedAt.trim().slice(0, 64) : '';
  const expectedDeliveryAtStr =
    typeof payload.expectedDeliveryAt === 'string' && payload.expectedDeliveryAt
      ? payload.expectedDeliveryAt.trim().slice(0, 64)
      : '';
  const restockedAt =
    signedDelta > 0 && (resolvedMovementType === 'purchase' || resolvedMovementType === 'return')
      ? effectiveTimestamp
      : existing.last_restocked_at
        ? String(existing.last_restocked_at)
        : null;

  const hasCustomUnitCost =
    payload.unitCost !== undefined &&
    Number.isFinite(Number(payload.unitCost)) &&
    Number(payload.unitCost) >= 0;
  const movementUnitCost = hasCustomUnitCost
    ? Number(Number(payload.unitCost).toFixed(2))
    : Number(existing.unit_cost) || 0;
  const nextItemUnitCost =
    hasCustomUnitCost &&
    (resolvedMovementType === 'purchase' || resolvedMovementType === 'initial_stock')
      ? movementUnitCost
      : Number(existing.unit_cost) || 0;

  const movementId = genId('mov');
  const resolvedRefType = payload.referenceType || inferReferenceType(resolvedMovementType);

  const run = db.transaction(() => {
    db.prepare(
      'UPDATE inventory_items SET quantity_on_hand = ?, unit_cost = ?, last_restocked_at = ?, updated_at = ? WHERE id = ?',
    ).run(nextQty, nextItemUnitCost, restockedAt, now, id);
    db.prepare(`
      INSERT INTO stock_movements (
        id, inventory_item_id, item_name, movement_type, quantity_before, quantity_delta,
        balance_after, unit_cost_at_movement, reference_type, reference, performed_by_id,
        performed_by, note, occurred_at, ordered_at, expected_delivery_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      movementId,
      id,
      String(existing.name),
      resolvedMovementType,
      qtyBefore,
      signedDelta,
      nextQty,
      movementUnitCost,
      resolvedRefType,
      payload.reference || '',
      actorId,
      actorName,
      payload.note || '',
      effectiveTimestamp,
      orderedAtStr,
      expectedDeliveryAtStr,
      now,
    );
  });
  run();

  if (signedDelta < 0) {
    void evaluateAndDispatchCriticalAlerts({
      targetItemIds: [id],
      actorId,
      actorName,
    }).catch(() => undefined);
  }

  const updatedRow = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  const movementRow = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(movementId) as Record<
    string,
    unknown
  >;

  return {
    id,
    quantityOnHand: nextQty,
    lastRestockedAt: restockedAt,
    updatedAt: now,
    item: mapInventoryItemRow(updatedRow),
    movement: mapStockMovementRow(movementRow),
  };
}

inventoryRouter.get('/inventory', requireAuth, (_req, res) => {
  const supplyCategories: SupplyCategory[] = (
    db.prepare('SELECT * FROM supply_categories ORDER BY sort_order ASC, name ASC').all() as Array<
      Record<string, unknown>
    >
  ).map((sc) => ({
    id: String(sc.id),
    name: String(sc.name),
    description: String(sc.description || ''),
    defaultUnit: String(sc.default_unit || 'pc'),
    sortOrder: Number(sc.sort_order) || 0,
    isDemo: sc.is_demo === 1,
  }));

  const items = (
    db.prepare('SELECT * FROM inventory_items ORDER BY name ASC').all() as Array<
      Record<string, unknown>
    >
  ).map(mapInventoryItemRow);

  const stockMovements = (
    db.prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 200').all() as Array<
      Record<string, unknown>
    >
  ).map(mapStockMovementRow);

  res.json({
    items,
    stockMovements,
    supplyCategories,
    serverTime: new Date().toISOString(),
  });
});

inventoryRouter.post(
  '/inventory',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const i = req.body as Partial<InventoryItem>;
    const validation = validateInventoryItemInput(i);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const id = genId('inv');
    const now = new Date().toISOString();
    const initialQty = Math.max(0, Number(i.quantityOnHand ?? i.currentStock) || 0);
    const reorderLevel = Math.max(0, Number(i.reorderLevel ?? i.reorderThreshold) || 0);
    const minimumThreshold = Math.max(0, Number(i.minimumThreshold) || 0);
    const reorderQuantity =
      i.reorderQuantity !== undefined
        ? Math.max(0, Number(i.reorderQuantity) || 0)
        : Math.max(reorderLevel * 2, 0);
    const unitCost = Math.max(0, Number(i.unitCost) || 0);
    const itemName = i.name!.trim();

    const supplierDetails = i.supplierDetails ?? i.supplierInfo;
    const supplierName = (i.supplier ?? supplierDetails?.name ?? '').trim();
    const supplierContact = (i.supplierContact ?? supplierDetails?.contact ?? '').trim();
    const supplierSku = (i.supplierSku ?? supplierDetails?.supplierSku ?? '').trim();
    const leadTimeDays = Math.max(0, Number(i.leadTimeDays ?? supplierDetails?.leadTimeDays) || 0);

    const existingSkuRows = db
      .prepare('SELECT id, sku FROM inventory_items')
      .all() as Array<{ id: string; sku: string }>;
    const requestedSku = (i.sku || '').trim();
    if (requestedSku) {
      const duplicate = existingSkuRows.find(
        (row) => row.sku.trim().toUpperCase() === requestedSku.toUpperCase(),
      );
      if (duplicate) {
        return res.status(400).json({
          error: `SKU "${requestedSku}" is already assigned to another inventory item.`,
        });
      }
    }

    const finalSku =
      requestedSku ||
      generateUniqueInventorySku({
        categoryId: (i.categoryId || '').trim(),
        categoryName: (i.category || 'Supplies').trim(),
        supplier: supplierName,
        existingItems: existingSkuRows,
      }).sku;

    const run = db.transaction(() => {
      db.prepare(`
        INSERT INTO inventory_items (
          id, sku, barcode, name, category_id, category, item_type, unit, quantity_on_hand, reserved_quantity,
          reorder_level, minimum_threshold, reorder_quantity, unit_cost, supplier, supplier_contact, supplier_sku,
          lead_time_days, storage_location, last_restocked_at, is_demo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id,
        finalSku,
        (i.barcode || '').trim(),
        itemName,
        (i.categoryId || '').trim(),
        (i.category || 'Supplies').trim(),
        i.itemType === 'finished_product' ? 'finished_product' : 'consumable',
        i.unit!.trim(),
        initialQty,
        Math.max(0, Number(i.reservedQuantity) || 0),
        reorderLevel,
        minimumThreshold,
        reorderQuantity,
        unitCost,
        supplierName,
        supplierContact,
        supplierSku,
        leadTimeDays,
        (i.storageLocation || '').trim(),
        initialQty > 0 ? now : null,
        now,
        now,
      );

      if (initialQty > 0) {
        db.prepare(`
          INSERT INTO stock_movements (
            id, inventory_item_id, item_name, movement_type, quantity_before, quantity_delta,
            balance_after, unit_cost_at_movement, reference_type, reference, performed_by_id,
            performed_by, note, occurred_at, created_at
          ) VALUES (?, ?, ?, 'initial_stock', 0, ?, ?, ?, 'system', 'INIT', ?, ?, 'Initial opening stock balance', ?, ?)
        `).run(
          genId('mov'),
          id,
          itemName,
          initialQty,
          initialQty,
          unitCost,
          req.authUser!.id,
          req.authUser!.fullName,
          now,
          now,
        );
      }
    });
    run();

    const created = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(201).json(mapInventoryItemRow(created));
  },
);

inventoryRouter.patch(
  '/inventory/bulk',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as Partial<BulkInventoryUpdatePayload>;
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const ids = Array.from(
      new Set(
        rawIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    );

    if (ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one inventory item to update.' });
    }
    if (ids.length > 500) {
      return res.status(400).json({ error: 'Cannot bulk-update more than 500 items at once.' });
    }

    const hasCategoryUpdate = body.categoryId !== undefined || body.category !== undefined;
    const hasSupplierUpdate =
      body.supplier !== undefined ||
      body.supplierContact !== undefined ||
      body.supplierSku !== undefined ||
      body.leadTimeDays !== undefined;

    if (!hasCategoryUpdate && !hasSupplierUpdate) {
      return res.status(400).json({
        error: 'Provide a supply category or supplier update to apply.',
      });
    }

    let resolvedCategoryId: string | undefined;
    let resolvedCategoryName: string | undefined;

    if (hasCategoryUpdate) {
      const incomingCatId =
        typeof body.categoryId === 'string' ? body.categoryId.trim() : '';
      const incomingCatName =
        typeof body.category === 'string' ? body.category.trim() : '';

      if (incomingCatId) {
        const catRow = db
          .prepare('SELECT id, name FROM supply_categories WHERE id = ?')
          .get(incomingCatId) as { id: string; name: string } | undefined;
        if (!catRow && !incomingCatName) {
          return res.status(400).json({ error: 'Selected supply category was not found.' });
        }
        resolvedCategoryId = catRow ? catRow.id : incomingCatId;
        resolvedCategoryName = incomingCatName || (catRow ? catRow.name : 'Supplies');
      } else {
        if (!incomingCatName) {
          return res.status(400).json({ error: 'Category name cannot be empty.' });
        }
        resolvedCategoryId = '';
        resolvedCategoryName = incomingCatName;
      }
    }

    const placeholders = ids.map(() => '?').join(', ');
    const existingRows = db
      .prepare(`SELECT * FROM inventory_items WHERE id IN (${placeholders})`)
      .all(...ids) as Array<Record<string, unknown>>;

    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'No matching inventory items found.' });
    }

    const now = new Date().toISOString();
    const incomingSupplier =
      body.supplier !== undefined ? String(body.supplier).trim() : undefined;
    const incomingSupplierContact =
      body.supplierContact !== undefined ? String(body.supplierContact).trim() : undefined;
    const incomingSupplierSku =
      body.supplierSku !== undefined ? String(body.supplierSku).trim() : undefined;
    const incomingLeadTime =
      body.leadTimeDays !== undefined && Number.isFinite(Number(body.leadTimeDays))
        ? Math.max(0, Math.round(Number(body.leadTimeDays)))
        : undefined;

    const updateStmt = db.prepare(`
      UPDATE inventory_items
      SET category_id = ?, category = ?, supplier = ?, supplier_contact = ?,
          supplier_sku = ?, lead_time_days = ?, updated_at = ?
      WHERE id = ?
    `);

    const run = db.transaction(() => {
      for (const existing of existingRows) {
        const nextCategoryId = hasCategoryUpdate
          ? (resolvedCategoryId ?? '')
          : String(existing.category_id || '');
        const nextCategory = hasCategoryUpdate
          ? (resolvedCategoryName ?? String(existing.category || 'Supplies'))
          : String(existing.category || 'Supplies');

        const existingSupplier = String(existing.supplier || '');
        const nextSupplier =
          incomingSupplier !== undefined ? incomingSupplier : existingSupplier;
        const supplierChanged =
          incomingSupplier !== undefined &&
          incomingSupplier.toLowerCase() !== existingSupplier.toLowerCase();

        const nextSupplierContact =
          incomingSupplierContact !== undefined
            ? incomingSupplierContact
            : supplierChanged
              ? ''
              : String(existing.supplier_contact || '');
        const nextSupplierSku =
          incomingSupplierSku !== undefined
            ? incomingSupplierSku
            : supplierChanged
              ? ''
              : String(existing.supplier_sku || '');
        const nextLeadTime =
          incomingLeadTime !== undefined
            ? incomingLeadTime
            : supplierChanged
              ? 0
              : Number(existing.lead_time_days) || 0;

        updateStmt.run(
          nextCategoryId,
          nextCategory,
          nextSupplier,
          nextSupplierContact,
          nextSupplierSku,
          nextLeadTime,
          now,
          String(existing.id),
        );
      }

      const changedParts: string[] = [];
      if (hasCategoryUpdate && resolvedCategoryName) {
        changedParts.push(`category → ${resolvedCategoryName}`);
      }
      if (incomingSupplier !== undefined) {
        changedParts.push(`supplier → ${incomingSupplier || 'Unassigned'}`);
      }
      writeAuditLog(
        req.authUser!.id,
        req.authUser!.fullName,
        'INVENTORY_BULK_UPDATED',
        'inventory_item',
        ids.slice(0, 5).join(','),
        `Bulk updated ${existingRows.length} item(s) (${changedParts.join(', ')})`,
      );
    });
    run();

    const updatedRows = db
      .prepare(`SELECT * FROM inventory_items WHERE id IN (${placeholders}) ORDER BY name ASC`)
      .all(...ids) as Array<Record<string, unknown>>;

    res.json({
      items: updatedRows.map(mapInventoryItemRow),
      updatedCount: updatedRows.length,
    });
  },
);

inventoryRouter.post(
  '/inventory/supplier-import',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as Partial<SupplierCsvImportPayload>;
    const rawMappings = Array.isArray(body.mappings) ? body.mappings : [];

    if (rawMappings.length === 0) {
      return res.status(400).json({ error: 'Provide at least one supplier mapping to apply.' });
    }
    if (rawMappings.length > 500) {
      return res.status(400).json({ error: 'Cannot apply more than 500 supplier mappings at once.' });
    }

    const sanitizedMappings = rawMappings
      .filter(
        (m): m is NonNullable<typeof m> =>
          Boolean(m) && typeof m.inventoryItemId === 'string' && m.inventoryItemId.trim().length > 0,
      )
      .map((m) => ({
        inventoryItemId: m.inventoryItemId.trim(),
        supplier:
          typeof m.supplier === 'string' ? m.supplier.trim().slice(0, 160) : undefined,
        supplierContact:
          typeof m.supplierContact === 'string'
            ? m.supplierContact.trim().slice(0, 160)
            : undefined,
        supplierSku:
          typeof m.supplierSku === 'string'
            ? m.supplierSku.trim().slice(0, 80)
            : undefined,
        leadTimeDays:
          m.leadTimeDays !== undefined && Number.isFinite(Number(m.leadTimeDays))
            ? Math.max(0, Math.min(365, Math.round(Number(m.leadTimeDays))))
            : undefined,
        unitCost:
          m.unitCost !== undefined && Number.isFinite(Number(m.unitCost))
            ? Math.max(0, Number(Number(m.unitCost).toFixed(2)))
            : undefined,
      }));

    if (sanitizedMappings.length === 0) {
      return res.status(400).json({ error: 'No valid inventory item IDs were provided.' });
    }

    const now = new Date().toISOString();
    const selectStmt = db.prepare('SELECT * FROM inventory_items WHERE id = ?');
    const updateStmt = db.prepare(`
      UPDATE inventory_items
      SET supplier = ?, supplier_contact = ?, supplier_sku = ?, lead_time_days = ?, unit_cost = ?, updated_at = ?
      WHERE id = ?
    `);

    const updatedIds: string[] = [];

    const run = db.transaction(() => {
      for (const mapping of sanitizedMappings) {
        const existing = selectStmt.get(mapping.inventoryItemId) as
          | Record<string, unknown>
          | undefined;
        if (!existing) continue;

        const nextSupplier =
          mapping.supplier !== undefined && mapping.supplier.length > 0
            ? mapping.supplier
            : String(existing.supplier || '');
        const nextContact =
          mapping.supplierContact !== undefined && mapping.supplierContact.length > 0
            ? mapping.supplierContact
            : String(existing.supplier_contact || '');
        const nextVendorSku =
          mapping.supplierSku !== undefined && mapping.supplierSku.length > 0
            ? mapping.supplierSku
            : String(existing.supplier_sku || '');
        const nextLeadTime =
          mapping.leadTimeDays !== undefined
            ? mapping.leadTimeDays
            : Number(existing.lead_time_days) || 0;
        const nextUnitCost =
          mapping.unitCost !== undefined
            ? mapping.unitCost
            : Number(existing.unit_cost) || 0;

        updateStmt.run(
          nextSupplier,
          nextContact,
          nextVendorSku,
          nextLeadTime,
          nextUnitCost,
          now,
          mapping.inventoryItemId,
        );
        updatedIds.push(mapping.inventoryItemId);
      }

      if (updatedIds.length > 0) {
        const safeFilename =
          typeof body.sourceFilename === 'string'
            ? body.sourceFilename.replace(/[^\w.\- ]+/g, '').slice(0, 80)
            : '';
        writeAuditLog(
          req.authUser!.id,
          req.authUser!.fullName,
          'SUPPLIER_CSV_IMPORTED',
          'inventory_item',
          updatedIds.slice(0, 5).join(','),
          `Mapped suppliers${safeFilename ? ` from ${safeFilename}` : ''} onto ${updatedIds.length} inventory item(s)`,
        );
      }
    });
    run();

    if (updatedIds.length === 0) {
      return res.status(404).json({ error: 'No matching inventory items found to update.' });
    }

    const uniqueIds = Array.from(new Set(updatedIds));
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const updatedRows = db
      .prepare(`SELECT * FROM inventory_items WHERE id IN (${placeholders}) ORDER BY name ASC`)
      .all(...uniqueIds) as Array<Record<string, unknown>>;

    res.json({
      items: updatedRows.map(mapInventoryItemRow),
      updatedCount: updatedRows.length,
    });
  },
);

inventoryRouter.patch(
  '/inventory/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }
    const patch = req.body as Partial<InventoryItem>;
    const now = new Date().toISOString();

    const patchDetails = patch.supplierDetails ?? patch.supplierInfo;
    const nextSupplier =
      patch.supplier !== undefined
        ? String(patch.supplier).trim()
        : patchDetails?.name !== undefined
          ? String(patchDetails.name).trim()
          : String(existing.supplier || '');
    const nextSupplierContact =
      patch.supplierContact !== undefined
        ? String(patch.supplierContact).trim()
        : patchDetails?.contact !== undefined
          ? String(patchDetails.contact).trim()
          : String(existing.supplier_contact || '');
    const nextSupplierSku =
      patch.supplierSku !== undefined
        ? String(patch.supplierSku).trim()
        : patchDetails?.supplierSku !== undefined
          ? String(patchDetails.supplierSku).trim()
          : String(existing.supplier_sku || '');
    const nextLeadTime =
      patch.leadTimeDays !== undefined
        ? Math.max(0, Number(patch.leadTimeDays) || 0)
        : patchDetails?.leadTimeDays !== undefined
          ? Math.max(0, Number(patchDetails.leadTimeDays) || 0)
          : Number(existing.lead_time_days) || 0;

    const patchReorder = patch.reorderLevel ?? patch.reorderThreshold;

    if (
      patch.minimumThreshold !== undefined &&
      (!Number.isFinite(Number(patch.minimumThreshold)) || Number(patch.minimumThreshold) < 0)
    ) {
      return res.status(400).json({ error: 'Minimum threshold cannot be negative.' });
    }

    let nextSku = String(existing.sku);
    if (patch.sku !== undefined) {
      const trimmedSku = String(patch.sku).trim();
      if (!trimmedSku) {
        return res.status(400).json({ error: 'SKU cannot be empty.' });
      }
      const duplicate = db
        .prepare('SELECT id FROM inventory_items WHERE LOWER(sku) = LOWER(?) AND id != ?')
        .get(trimmedSku, id) as { id: string } | undefined;
      if (duplicate) {
        return res.status(400).json({
          error: `SKU "${trimmedSku}" is already assigned to another inventory item.`,
        });
      }
      nextSku = trimmedSku;
    }

    db.prepare(`
      UPDATE inventory_items
      SET sku = ?, barcode = ?, name = ?, category_id = ?, category = ?, item_type = ?, unit = ?,
          reserved_quantity = ?, reorder_level = ?, minimum_threshold = ?, reorder_quantity = ?, unit_cost = ?,
          supplier = ?, supplier_contact = ?, supplier_sku = ?, lead_time_days = ?,
          storage_location = ?, updated_at = ?
      WHERE id = ?
    `).run(
      nextSku,
      patch.barcode !== undefined ? String(patch.barcode).trim() : String(existing.barcode || ''),
      patch.name !== undefined ? String(patch.name).trim() : String(existing.name),
      patch.categoryId !== undefined
        ? String(patch.categoryId).trim()
        : String(existing.category_id || ''),
      patch.category !== undefined ? String(patch.category).trim() : String(existing.category),
      patch.itemType === 'finished_product' || patch.itemType === 'consumable'
        ? patch.itemType
        : String(existing.item_type),
      patch.unit !== undefined ? String(patch.unit).trim() : String(existing.unit),
      patch.reservedQuantity !== undefined
        ? Math.max(0, Number(patch.reservedQuantity) || 0)
        : Number(existing.reserved_quantity) || 0,
      patchReorder !== undefined
        ? Math.max(0, Number(patchReorder) || 0)
        : Number(existing.reorder_level) || 0,
      patch.minimumThreshold !== undefined
        ? Math.max(0, Number(patch.minimumThreshold) || 0)
        : Number(existing.minimum_threshold) || 0,
      patch.reorderQuantity !== undefined
        ? Math.max(0, Number(patch.reorderQuantity) || 0)
        : Number(existing.reorder_quantity) || 0,
      patch.unitCost !== undefined
        ? Math.max(0, Number(patch.unitCost) || 0)
        : Number(existing.unit_cost) || 0,
      nextSupplier,
      nextSupplierContact,
      nextSupplierSku,
      nextLeadTime,
      patch.storageLocation !== undefined
        ? String(patch.storageLocation).trim()
        : String(existing.storage_location || ''),
      now,
      id,
    );

    const updated = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as Record<string, unknown>;
    void evaluateAndDispatchCriticalAlerts({
      targetItemIds: [id],
      actorId: req.authUser!.id,
      actorName: req.authUser!.fullName,
    }).catch(() => undefined);
    res.json(mapInventoryItemRow(updated));
  },
);

inventoryRouter.delete(
  '/inventory/:id',
  requireAuth,
  requireRole(['admin', 'manager']),
  (req: AuthenticatedRequest, res) => {
    const id = String(req.params.id);
    const existing = db.prepare('SELECT id, name, sku, quantity_on_hand FROM inventory_items WHERE id = ?').get(id) as
      | { id: string; name: string; sku: string; quantity_on_hand: number }
      | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }

    const run = db.transaction(() => {
      db.prepare('DELETE FROM stock_movements WHERE inventory_item_id = ?').run(id);
      db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id);
      writeAuditLog(
        req.authUser!.id,
        req.authUser!.fullName,
        'INVENTORY_ITEM_DELETED',
        'inventory_item',
        id,
        `Deleted inventory item ${existing.name} (${existing.sku}) with stock ${existing.quantity_on_hand}`,
      );
    });
    run();

    res.json({ ok: true, id });
  },
);

inventoryRouter.post('/inventory/:id/adjust', requireAuth, (req: AuthenticatedRequest, res) => {
  const result = applyInventoryAdjustment(
    String(req.params.id),
    req.body || {},
    req.authUser!.id,
    req.authUser!.fullName,
  );
  res.json(result);
});
