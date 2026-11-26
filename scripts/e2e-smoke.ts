import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (!address || typeof address === 'string') {
        srv.close(() => reject(new Error('Failed to allocate ephemeral TCP port.')));
        return;
      }
      const { port } = address;
      srv.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(port);
      });
    });
  });
}

async function waitForServerReady(baseUrl: string, timeoutMs = 20_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return;
      }
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${baseUrl}/api/health`);
}

async function stopChildProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore if already exited
      }
      resolve();
    }, 5_000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function runE2ESmoke() {
  const rootDir = process.cwd();
  const distDir = path.resolve(rootDir, 'dist');

  // 1. Verify production build artifacts exist
  for (const requiredFile of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    const fullPath = path.join(distDir, requiredFile);
    assert.ok(
      fs.existsSync(fullPath),
      `Missing production build artifact "${requiredFile}". Run "npm run build" before "npm run test:e2e".`,
    );
  }

  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-e2e-'));
  const tsxBin = path.resolve(
    rootDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );

  let serverLogs = '';
  let child: ChildProcess | undefined;

  try {
    child = spawn(tsxBin, ['server.ts'], {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        PRINTSHOP_DATA_DIR: tmpDataDir,
        DISABLE_HMR: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      serverLogs += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      serverLogs += chunk.toString();
    });

    await waitForServerReady(baseUrl);

    // 2. Verify production SPA + PWA endpoints
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200, 'Root SPA HTML should return 200');
    const htmlBody = await htmlRes.text();
    assert.match(htmlBody, /<div id="root"><\/div>/i, 'Root SPA HTML should contain #root mount node');

    const spaFallbackRes = await fetch(`${baseUrl}/suppliers`);
    assert.equal(spaFallbackRes.status, 200, 'SPA fallback route /suppliers should return 200');

    const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifestRes.status, 200, 'PWA manifest should return 200');
    const manifestJson = (await manifestRes.json()) as { name?: string };
    assert.equal(manifestJson.name, 'Printshop POS', 'PWA manifest name should match Printshop POS');

    const swRes = await fetch(`${baseUrl}/sw.js`);
    assert.equal(swRes.status, 200, 'Service worker /sw.js should return 200');

    // 3. Initial setup & authentication flow
    const statusRes = await fetch(`${baseUrl}/api/auth/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as { needsSetup: boolean };
    assert.equal(statusJson.needsSetup, true, 'Fresh database must require initial admin setup');

    const setupRes = await fetch(`${baseUrl}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'e2e_admin',
        fullName: 'E2E Admin',
        email: 'e2e@printshop.local',
        password: 'e2e-password-123',
        pin: '2468',
      }),
    });
    assert.equal(setupRes.status, 201, 'Admin setup should return 201');
    const setupJson = (await setupRes.json()) as { token: string };
    assert.ok(setupJson.token, 'Setup should issue bearer session token');

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${setupJson.token}`,
    };

    // 4. Bootstrap seeded data check
    const bootstrapRes = await fetch(`${baseUrl}/api/bootstrap`, { headers: authHeaders });
    assert.equal(bootstrapRes.status, 200, 'Authenticated bootstrap should return 200');
    const bootstrapJson = (await bootstrapRes.json()) as {
      inventory: Array<unknown>;
      suppliers: Array<unknown>;
      services: Array<unknown>;
    };
    assert.ok(bootstrapJson.services.length > 0, 'Seeded printshop services should load');
    assert.ok(bootstrapJson.inventory.length > 0, 'Seeded inventory items should load');

    // 5. Inventory create + barcode receiving restock
    const createItemRes = await fetch(`${baseUrl}/api/inventory`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'A3 Glossy Photo Paper',
        sku: 'PAP-E2E-001',
        barcode: '4801112223334',
        category: 'Paper & Media',
        itemType: 'consumable',
        unit: 'pack',
        quantityOnHand: 12,
        reorderLevel: 5,
        minimumThreshold: 3,
        unitCost: 220,
        supplier: 'E2E Paper Co.',
      }),
    });
    assert.equal(createItemRes.status, 201, 'Creating inventory item should return 201');
    const createdItem = (await createItemRes.json()) as { id: string; quantityOnHand: number };

    const receiveRes = await fetch(`${baseUrl}/api/inventory/${createdItem.id}/adjust`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        movementType: 'purchase',
        quantityDelta: 8,
        unitCost: 215,
        reference: 'BARCODE-RCV-E2E',
      }),
    });
    assert.equal(receiveRes.status, 200, 'Receiving stock adjustment should return 200');
    const receivedJson = (await receiveRes.json()) as { quantityOnHand: number };
    assert.equal(receivedJson.quantityOnHand, 20, 'Stock balance should increment to 20');

    // 6. Supplier creation + digital contract upload & download
    const supRes = await fetch(`${baseUrl}/api/suppliers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'E2E Paper Co.',
        contactPerson: 'Elena Tan',
        defaultLeadTimeDays: 2,
        paymentTerms: 'Net 30',
        syncToLinkedItems: true,
      }),
    });
    assert.equal(supRes.status, 201, 'Supplier creation should return 201');
    const supJson = (await supRes.json()) as { supplier: { id: string } };

    const docRes = await fetch(`${baseUrl}/api/suppliers/documents`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        supplierId: supJson.supplier.id,
        supplierName: 'E2E Paper Co.',
        docType: 'pricing_agreement',
        title: 'E2E Rate Card 2026',
        fileName: 'rate-card.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('A3 Glossy Photo Paper: PHP 215/pack').toString('base64'),
      }),
    });
    assert.equal(docRes.status, 201, 'Uploading supplier document should return 201');
    const docJson = (await docRes.json()) as { document: { id: string } };

    const downloadRes = await fetch(`${baseUrl}/api/supplier-documents/${docJson.document.id}/file`, {
      headers: { Authorization: `Bearer ${setupJson.token}` },
    });
    assert.equal(downloadRes.status, 200, 'Downloading supplier document should return 200');
    assert.match(await downloadRes.text(), /PHP 215\/pack/);

    // 7. Shift + POS checkout atomic deduction
    const shiftRes = await fetch(`${baseUrl}/api/shifts/start`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ openingCash: 1500 }),
    });
    assert.equal(shiftRes.status, 201, 'Starting cashier shift should return 201');
    const shiftJson = (await shiftRes.json()) as { id: string };

    const txnRes = await fetch(`${baseUrl}/api/transactions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        type: 'sale',
        clientMutationId: 'e2e-pos-sale-1',
        customerName: 'Walk-in Customer',
        shiftId: shiftJson.id,
        items: [
          {
            id: 'ci-e2e-1',
            serviceId: 'srv-photo',
            sku: 'PRT-PHOTO-01',
            serviceName: 'A3 Photo Print',
            pricingMethod: 'per_piece',
            unitLabel: 'pack',
            unitPrice: 450,
            effectiveQuantity: 2,
            displaySummary: '2 packs',
            config: {
              quantity: 2,
              pages: 1,
              copies: 1,
              width: 1,
              height: 1,
              dimensionUnit: 'ft',
              selectedAttributes: {},
              isRush: false,
              designFee: 0,
              laborFee: 0,
              notes: '',
            },
            discountType: 'none',
            discountValue: 0,
            lineSubtotal: 900,
            lineDiscount: 0,
            lineTotal: 900,
            costTotal: 430,
            requiresProductionJob: false,
            consumables: [{ inventoryItemId: createdItem.id, quantityPerUnit: 1 }],
          },
        ],
        subtotal: 900,
        itemDiscountsTotal: 0,
        orderDiscountType: 'none',
        orderDiscountValue: 0,
        orderDiscountAmount: 0,
        taxAmount: 0,
        totalAmount: 900,
        amountPaid: 900,
        changeAmount: 0,
        balanceDue: 0,
        paymentStatus: 'paid',
        payments: [
          {
            id: 'pay-e2e-1',
            methodId: 'cash',
            methodName: 'Cash',
            methodType: 'cash',
            amount: 900,
            referenceNumber: '',
            verificationStatus: 'verified',
            paidAt: new Date().toISOString(),
          },
        ],
        notes: 'E2E smoke sale',
      }),
    });
    assert.equal(txnRes.status, 201, 'POS sale transaction should return 201');

    const postSaleInvRes = await fetch(`${baseUrl}/api/inventory`, { headers: authHeaders });
    const postSaleInv = (await postSaleInvRes.json()) as {
      items: Array<{ id: string; quantityOnHand: number }>;
    };
    const updatedItem = postSaleInv.items.find((i) => i.id === createdItem.id);
    assert.equal(updatedItem?.quantityOnHand, 18, 'POS sale should deduct 2 packs from stock');

    // 8. Logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: authHeaders,
    });
    assert.equal(logoutRes.status, 200, 'Logout should return 200');

    console.log(`E2E production smoke suite passed against ${baseUrl}`);
  } catch (err) {
    console.error('E2E smoke test failed. Server output:\n', serverLogs);
    throw err;
  } finally {
    await stopChildProcess(child);
    if (fs.existsSync(tmpDataDir)) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
  }
}

runE2ESmoke().catch((err) => {
  console.error(err);
  process.exit(1);
});
