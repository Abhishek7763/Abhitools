import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const page = {window:{}};
runInNewContext(readFileSync(new URL('../public_script.js', import.meta.url), 'utf8'), page);
runInNewContext("publicDueData = {businessDate:'2026-11-28'}", page);

test('complete legacy dates are usable and incomplete or impossible dates stay unknown', () => {
    assert.equal(page.publicInstallmentDate({due_day:29, due_month:'FEB', due_year:2024}), '2024-02-29');
    assert.equal(page.publicInstallmentDate({due_day:29, due_month:'FEB', due_year:2025}), '');
    assert.equal(page.publicDueLabel({due_day:1, due_month:'JAN'}), 'Due date not set');
    assert.equal(page.publicDueLabel({due_date:'2026-11-28'}), 'Due today');
    assert.equal(page.publicDueLabel({due_date:'2026-11-27'}), '1 day overdue');
});

test('next installment favors dated unpaid entries and preserves undated balances', () => {
    const noDate = {amount:500, installment_number:1};
    const paid = {amount:100, paid_amount:100, due_date:'2026-10-01', installment_number:2};
    const partial = {amount:200, paid_amount:40, due_date:'2026-12-10', installment_number:3};
    assert.equal(page.publicNextInstallment([noDate, paid, partial]), partial);
    assert.equal(page.publicNextInstallment([noDate, paid]), noDate);
    assert.equal(page.publicNextInstallment([paid]), undefined);
    assert.equal(page.publicNextInstallment([]), undefined);
});
