function borrowerFolderKey(loan) {
    return loan.folder_key || loan.borrower_id || loan.borrowers?.id || loan.id || loan.loan_code;
}

function borrowerFolderName(key) {
    return loans.find(loan => borrowerFolderKey(loan) === key)?.borrowers?.name || '';
}

function activeBorrowerFolders(records, search, sortMode) {
    const folders = new Map();
    for (const loan of records) {
        if (loan.status !== 'active' || !loan.borrowers) continue;
        const key = borrowerFolderKey(loan);
        const name = String(loan.borrowers.name || 'Unknown').toUpperCase();
        if (search && !name.includes(search) && !String(loan.loan_code || '').toUpperCase().includes(search)) continue;
        if (!folders.has(key)) folders.set(key, { key, name, count: 0, sum: 0, loanCode: loan.loan_code, phone: loan.borrowers.phone });
        const folder = folders.get(key);
        folder.count++;
        folder.sum += Number(loan.amount) || 0;
    }
    return [...folders.values()].sort((a,b) => {
        if (sortMode === 'highest') return b.sum - a.sum;
        if (sortMode === 'lowest') return a.sum - b.sum;
        return a.name.localeCompare(b.name) || String(a.loanCode).localeCompare(String(b.loanCode));
    });
}
