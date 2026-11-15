'use strict';

// Characterization tests for current pricing/invoice behavior.
// All fixtures are in memory; these tests never import the filesystem store.
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../lib/pricing');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

function currentOrder(overrides) {
  return Object.assign({
    id: 42,
    date: '15/11/2026',
    customer: 'In-memory customer',
    paymentMode: 'cash',
    status: 'completed',
    coupon: '',
    items: [{ id: 1, sku: 'RICE-1', name: 'Rice', hsn: '1006', price: 100, qty: 1 }],
    subtotal: 100,
    discount: 0,
    tax: 5,
    total: 105
  }, overrides || {});
}

test('CURRENT BEHAVIOUR: order pricing applies the HSN slab to the undiscounted line', () => {
  const result = pricing.computeTotals([
    { id: 1, name: 'Rice', hsn: '1006', price: 100, qty: 1 }
  ], '');

  assert.deepEqual(
    { subtotal: result.subtotal, discount: result.discount, taxable: result.taxable, tax: result.tax, total: result.total },
    { subtotal: 100, discount: 0, taxable: 100, tax: 5, total: 105 }
  );
  assert.deepEqual({ cgst: result.cgst, sgst: result.sgst }, { cgst: 2.5, sgst: 2.5 });
});

test('invoice uses the HSN slab when order lines omit gstRate', () => {
  const result = invoice.computeInvoiceFigures(currentOrder());
  assert.equal(result.rows[0].gstPercent, 5);
  assert.equal(result.tax, 5);
  assert.equal(result.total, 105);
});

test('invoice derives GST from HSN even when a line has a gstRate field', () => {
  const result = invoice.computeInvoiceFigures(currentOrder({
    items: [{ id: 1, name: 'Rice', hsn: '1006', gstRate: 5, price: 100, qty: 1 }]
  }));
  assert.equal(result.rows[0].gstPercent, 5);
  assert.equal(result.tax, 5);
  assert.equal(result.total, 105);
});

test('CURRENT BEHAVIOUR: order discount reduces taxable value before GST', () => {
  const result = pricing.computeTotals([
    { id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 1 }
  ], 'SAVE10');
  assert.equal(result.discount, 100);
  assert.equal(result.taxable, 900);
  assert.equal(result.tax, 45);
  assert.equal(result.total, 945);
});

test('invoice uses the same coupon cap and taxable base as order pricing', () => {
  const result = invoice.computeInvoiceFigures(currentOrder({
    coupon: 'SAVE10',
    items: [{ id: 1, name: 'Rice', hsn: '1006', gstRate: 5, price: 2000, qty: 1 }]
  }));
  // Invoice tax is 100; discount is 10% of 2,100 = 210 (order pricing caps at 150 and taxes post-discount).
  assert.equal(result.tax, 92.5);
  assert.equal(result.discount, 150);
  assert.equal(result.total, 1942.5);
});

test('GST reconciliation reports matching invoice and order totals for HSN line items', () => {
  const order = currentOrder();
  const result = reports.getGstReconciliation({ orders: [order] });
  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.rows[0].ledgerTax, 5);
  assert.equal(result.rows[0].invoiceTax, 5);
  assert.equal(result.rows[0].ledgerTotal, 105);
  assert.equal(result.rows[0].invoiceTotal, 105);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});

test('CURRENT BEHAVIOUR: GST reconciliation excludes cancelled orders', () => {
  const result = reports.getGstReconciliation({ orders: [currentOrder({ status: 'cancelled' })] });
  assert.equal(result.totalChecked, 0);
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.rows, []);
});

test('invoice total and GST breakdown match order pricing for mixed HSNs and capped coupon', () => {
  const items = [
    { id: 1, hsn: '1006', name: 'Rice', price: 2000, qty: 1 },
    { id: 2, hsn: '0405', name: 'Ghee', price: 500, qty: 1 }
  ];
  const totals = pricing.computeTotals(items, 'SAVE10');
  const result = invoice.computeInvoiceFigures(currentOrder({ items, coupon: 'SAVE10', ...totals }));
  assert.equal(result.subtotal, totals.subtotal);
  assert.equal(result.discount, totals.discount);
  assert.equal(result.tax, totals.tax);
  assert.equal(result.cgst + result.sgst, totals.tax);
  assert.equal(result.total, totals.total);
});






