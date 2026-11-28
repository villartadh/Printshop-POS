// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

describe('Services Catalog API — Reusable & Dynamic Services', () => {
  let tmpDataDir: string;
  let app: Express;
  let closeDatabaseFn: () => void;
  let adminToken = '';

  beforeAll(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-srv-api-'));
    process.env.PRINTSHOP_DATA_DIR = tmpDataDir;

    const dbModule = await import('../../server/db.ts');
    dbModule.initDatabase();
    closeDatabaseFn = dbModule.closeDatabase;

    const appModule = await import('../../server/app.ts');
    app = appModule.createApiApp();

    const setupRes = await request(app).post('/api/auth/setup-admin').send({
      username: 'srv_admin',
      fullName: 'Catalog Admin',
      password: 'catalog-password-123',
      pin: '1357',
    });
    if (setupRes.status !== 201) {
      throw new Error(`Setup admin failed with status ${setupRes.status}`);
    }
    adminToken = setupRes.body.token as string;
  });

  afterAll(() => {
    closeDatabaseFn();
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
    delete process.env.PRINTSHOP_DATA_DIR;
  });

  it('creates a dynamic service preserving custom option groups, bulk tiers, and multiple consumables', async () => {
    const createRes = await request(app)
      .post('/api/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Custom UV Sticker Sheet',
        sku: 'STK-UV-01',
        categoryId: 'cat-signage',
        pricingMethod: 'formula',
        basePrice: 45,
        unitLabel: 'sheet',
        costEstimate: 14,
        defaultDesignFee: 80,
        allowCustomDimensions: true,
        allowRushFee: true,
        rushFeePercent: 30,
        formulaExpression: '((base + attrDelta) * attrMult) * areaSqFt * qty',
        bulkTiers: [
          { minQty: 50, unitPrice: 35 },
          { minQty: 10, unitPrice: 40 },
        ],
        attributeGroups: [
          {
            key: 'laminationFilm',
            label: 'Protective Laminate',
            defaultOptionId: 'matte',
            options: [
              { id: 'matte', label: 'Matte UV', priceDelta: 0, priceMultiplier: 1 },
              { id: 'holo', label: 'Holographic', priceDelta: 15, priceMultiplier: 1.25 },
            ],
          },
        ],
        consumables: [
          { inventoryItemId: 'inv-tarp-roll', quantityPerUnit: 1 },
          { inventoryItemId: 'inv-lam-film', quantityPerUnit: 1.5 },
        ],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.sku).toBe('STK-UV-01');
    expect(createRes.body.bulkTiers).toEqual([
      { minQty: 10, unitPrice: 40 },
      { minQty: 50, unitPrice: 35 },
    ]);
    expect(createRes.body.attributeGroups[0].key).toBe('laminationFilm');
    expect(createRes.body.attributeGroups[0].options[1].priceMultiplier).toBe(1.25);
    expect(createRes.body.consumables).toHaveLength(2);
    expect(createRes.body.defaultDesignFee).toBe(80);
  });

  it('rejects duplicate SKUs and invalid formula expressions cleanly', async () => {
    const dupRes = await request(app)
      .post('/api/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Duplicate SKU Service',
        sku: 'stk-uv-01',
        categoryId: 'cat-signage',
        pricingMethod: 'per_piece',
        basePrice: 20,
      });
    expect(dupRes.status).toBe(409);

    const badFormulaRes = await request(app)
      .post('/api/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Bad Formula Service',
        sku: 'BAD-FRM-01',
        categoryId: 'cat-signage',
        pricingMethod: 'formula',
        basePrice: 20,
        formulaExpression: 'base * unknownVar',
      });
    expect(badFormulaRes.status).toBe(400);
  });

  it('preserves dynamic rules on partial PUT updates and supports server-side service duplication', async () => {
    const bootstrapRes = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);
    const uvService = (bootstrapRes.body.services as Array<{ id: string; sku: string }>).find(
      (s) => s.sku === 'STK-UV-01',
    )!;

    // Partial toggle update (favorite) must preserve bulkTiers, attributeGroups, and consumables
    const toggleRes = await request(app)
      .put(`/api/services/${uvService.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isFavorite: true });

    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.isFavorite).toBe(true);
    expect(toggleRes.body.consumables).toHaveLength(2);
    expect(toggleRes.body.attributeGroups).toHaveLength(1);
    expect(toggleRes.body.bulkTiers).toHaveLength(2);

    // Server-side duplication produces independent copy with unique SKU
    const cloneRes = await request(app)
      .post(`/api/services/${uvService.id}/duplicate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(cloneRes.status).toBe(201);
    expect(cloneRes.body.id).not.toBe(uvService.id);
    expect(cloneRes.body.sku).toBe('STK-UV-01-COPY');
    expect(cloneRes.body.name).toBe('Custom UV Sticker Sheet (Copy)');
    expect(cloneRes.body.consumables).toHaveLength(2);
    expect(cloneRes.body.attributeGroups).toHaveLength(1);
    expect(cloneRes.body.bulkTiers).toHaveLength(2);
  });
});
