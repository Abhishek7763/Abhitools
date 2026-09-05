import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function intLikeProduction(value) {
  return Number.parseInt(value, 10) || 0;
}

function remainingAmount(emi) {
  const amount = intLikeProduction(emi?.amount);
  const paid = Math.max(0, Math.min(intLikeProduction(emi?.paid_amount), amount));
  return Math.max(amount - paid, 0);
}

function dateAdd(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}

function summarize(items) {
  return {
    count: items.length,
    amount: items.reduce((sum, item) => sum + intLikeProduction(item.remaining), 0)
  };
}

function dueBuckets(items, businessDate) {
  const tomorrow = dateAdd(businessDate, 1);
  const next7End = dateAdd(businessDate, 6);
  const thisMonth = monthKey(businessDate);
  const overdue = items.filter(x => x.due_date < businessDate);
  const today = items.filter(x => x.due_date === businessDate);
  const tomorrowItems = items.filter(x => x.due_date === tomorrow);
  const next7 = items.filter(x => x.due_date >= businessDate && x.due_date <= next7End);
  const month = items.filter(x => monthKey(x.due_date) === thisMonth);
  return {
    summary: {
      overdue: summarize(overdue),
      today: summarize(today),
      tomorrow: summarize(tomorrowItems),
      next7: summarize(next7),
      month: summarize(month)
    },
    buckets: { overdue, today, tomorrow: tomorrowItems, next7, month }
  };
}

function compareSqlNextEmiOrder(a, b) {
  const installment = Number(a.installment_number || 0) - Number(b.installment_number || 0);
  if (installment) return installment;
  const aDate = a.due_date ? String(a.due_date).slice(0, 10) : null;
  const bDate = b.due_date ? String(b.due_date).slice(0, 10) : null;
  if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function nextUnpaidEmi(emis) {
  return [...emis]
    .filter(emi => remainingAmount(emi) > 0)
    .sort(compareSqlNextEmiOrder)[0] || null;
}

function isSequentialEmiEligible(emis, installmentNumber) {
  const next = nextUnpaidEmi(emis);
  return Boolean(next && Number(installmentNumber) === Number(next.installment_number));
}

function loanOutstanding(emis) {
  return emis.reduce((sum, emi) => sum + remainingAmount(emi), 0);
}

function settlementQuote(emis, finalPaymentAmount = 0) {
  const outstanding = loanOutstanding(emis);
  const finalPayment = Math.max(Number(finalPaymentAmount) || 0, 0);
  if (finalPayment > outstanding) {
    throw new RangeError('Final settlement payment exceeds remaining EMI balance');
  }
  return {
    remainingBefore: outstanding,
    finalPaymentAmount: finalPayment,
    waivedAmount: outstanding - finalPayment
  };
}

test('EMI remaining amount clamps paid amount to the scheduled EMI amount', () => {
  assert.equal(remainingAmount({ amount: 1000, paid_amount: 250 }), 750);
  assert.equal(remainingAmount({ amount: 1000, paid_amount: 1000 }), 0);
  assert.equal(remainingAmount({ amount: 1000, paid_amount: 1300 }), 0);
  assert.equal(remainingAmount({ amount: 1000, paid_amount: -50 }), 1000);
  assert.equal(remainingAmount({ amount: '900', paid_amount: '125' }), 775);
  assert.equal(remainingAmount({ amount: null, paid_amount: 50 }), 0);
});

test('due endpoint bucket boundaries match overdue, today, tomorrow, next7 and month rules', () => {
  const businessDate = '2026-09-05';
  const items = [
    { key: 'overdue', due_date: '2026-09-04', remaining: 100 },
    { key: 'today', due_date: '2026-09-05', remaining: 200 },
    { key: 'tomorrow', due_date: '2026-09-06', remaining: 300 },
    { key: 'next7-edge', due_date: '2026-09-11', remaining: 400 },
    { key: 'after-next7', due_date: '2026-09-12', remaining: 500 },
    { key: 'month-end', due_date: '2026-09-30', remaining: 600 },
    { key: 'next-month', due_date: '2026-10-01', remaining: 700 }
  ];
  const result = dueBuckets(items, businessDate);

  assert.deepEqual(result.buckets.overdue.map(x => x.key), ['overdue']);
  assert.deepEqual(result.buckets.today.map(x => x.key), ['today']);
  assert.deepEqual(result.buckets.tomorrow.map(x => x.key), ['tomorrow']);
  assert.deepEqual(result.buckets.next7.map(x => x.key), ['today', 'tomorrow', 'next7-edge']);
  assert.deepEqual(result.buckets.month.map(x => x.key), ['overdue', 'today', 'tomorrow', 'next7-edge', 'after-next7', 'month-end']);

  assert.deepEqual(result.summary.overdue, { count: 1, amount: 100 });
  assert.deepEqual(result.summary.today, { count: 1, amount: 200 });
  assert.deepEqual(result.summary.tomorrow, { count: 1, amount: 300 });
  assert.deepEqual(result.summary.next7, { count: 3, amount: 900 });
  assert.deepEqual(result.summary.month, { count: 6, amount: 2100 });
});

test('sequential EMI eligibility selects only the first EMI with remaining balance', () => {
  const emis = [
    { id: 'a', installment_number: 1, due_date: '2026-07-01', amount: 500, paid_amount: 500 },
    { id: 'b', installment_number: 2, due_date: '2026-08-01', amount: 500, paid_amount: 200 },
    { id: 'c', installment_number: 3, due_date: '2026-09-01', amount: 500, paid_amount: 0 }
  ];

  assert.equal(nextUnpaidEmi(emis)?.installment_number, 2);
  assert.equal(isSequentialEmiEligible(emis, 2), true);
  assert.equal(isSequentialEmiEligible(emis, 3), false);

  const secondPaid = emis.map(emi => emi.installment_number === 2 ? { ...emi, paid_amount: 500 } : emi);
  assert.equal(nextUnpaidEmi(secondPaid)?.installment_number, 3);
  assert.equal(isSequentialEmiEligible(secondPaid, 3), true);
});

test('sequential EMI ordering keeps due_date nulls last and id as the final tie-breaker', () => {
  const emis = [
    { id: 'c', installment_number: 1, due_date: null, amount: 100, paid_amount: 0 },
    { id: 'b', installment_number: 1, due_date: '2026-09-10', amount: 100, paid_amount: 0 },
    { id: 'a', installment_number: 1, due_date: '2026-09-10', amount: 100, paid_amount: 0 }
  ];
  assert.equal(nextUnpaidEmi(emis)?.id, 'a');
});

test('foreclosure amount equals total remaining EMI balance and settlement waiver balances exactly', () => {
  const emis = [
    { amount: 1000, paid_amount: 250 },
    { amount: 500, paid_amount: 500 },
    { amount: 800, paid_amount: 100 }
  ];

  assert.equal(loanOutstanding(emis), 1450);
  assert.equal(loanOutstanding(emis), 750 + 0 + 700);

  assert.deepEqual(settlementQuote(emis, 1000), {
    remainingBefore: 1450,
    finalPaymentAmount: 1000,
    waivedAmount: 450
  });
  assert.deepEqual(settlementQuote(emis, 1450), {
    remainingBefore: 1450,
    finalPaymentAmount: 1450,
    waivedAmount: 0
  });
  assert.deepEqual(settlementQuote(emis, -100), {
    remainingBefore: 1450,
    finalPaymentAmount: 0,
    waivedAmount: 1450
  });
  assert.throws(() => settlementQuote(emis, 1451), /exceeds remaining EMI balance/);
});

test('production due.js still contains the protected remaining and bucketing formulas', () => {
  const source = fs.readFileSync(path.join(root, 'api', 'due.js'), 'utf8');
  assert.match(source, /const paid = Math\.max\(0, Math\.min\(Number\.parseInt\(emi\?\.paid_amount, 10\) \|\| 0, amount\)\);/);
  assert.match(source, /return Math\.max\(amount - paid, 0\);/);
  assert.match(source, /const overdue = all\.filter\(x => x\.due_date < businessDate\);/);
  assert.match(source, /const today = all\.filter\(x => x\.due_date === businessDate\);/);
  assert.match(source, /const tomorrowItems = all\.filter\(x => x\.due_date === tomorrow\);/);
  assert.match(source, /const next7 = all\.filter\(x => x\.due_date >= businessDate && x\.due_date <= next7End\);/);
  assert.match(source, /const month = all\.filter\(x => monthKey\(x\.due_date\) === thisMonth\);/);
});

test('production UPI migration still enforces next-unpaid EMI and foreclosure outstanding rules', () => {
  const source = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260825170000_upi_next_emi_foreclosure_utr.sql'), 'utf8');
  assert.match(source, /greatest\(e\.amount - least\(greatest\(coalesce\(e\.paid_amount,0\),0\),e\.amount\),0\) > 0/i);
  assert.match(source, /order by e\.installment_number,e\.due_date nulls last,e\.id/i);
  assert.match(source, /if p_installment_number <> v_first_installment then raise exception 'Only the next unpaid EMI can be paid online'; end if;/i);
  assert.match(source, /v_remaining := greatest\(v_scheduled - least\(greatest\(v_paid,0\),v_scheduled\),0\);/i);
  assert.match(source, /v_amount := v_remaining;/i);
  assert.match(source, /v_amount := v_outstanding;/i);
  assert.match(source, /if v_amount <> v_request\.amount or v_amount <> v_current_outstanding then/i);
});

test('production settlement migration still computes outstanding, final payment and waiver with the protected balance equation', () => {
  const source = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260824092529_phase11_loan_settlement_closing.sql'), 'utf8');
  assert.match(source, /constraint loan_settlements_balance_check check \(final_payment_amount \+ waived_amount = scheduled_remaining_before\)/i);
  assert.match(source, /select coalesce\(sum\(greatest\(e\.amount - least\(greatest\(coalesce\(e\.paid_amount,0\),0\),e\.amount\),0\)\),0\)::integer/i);
  assert.match(source, /if v_final > v_outstanding then raise exception 'Final settlement payment exceeds remaining EMI balance'; end if;/i);
  assert.match(source, /v_waived := v_outstanding - v_final;/i);
  assert.match(source, /v_emi_remaining := greatest\(v_emi\.amount - least\(greatest\(v_emi\.paid_amount,0\),v_emi\.amount\),0\);/i);
  assert.match(source, /v_alloc := least\(v_left,v_emi_remaining\);/i);
});
