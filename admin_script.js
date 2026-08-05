// ==========================================
// ☁️ GITHUB GIST CLOUD SYNC SETTINGS (ADMIN ONLY)
// ==========================================
const GITHUB_PAT = "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"; 
const GIST_ID = "2d93e5e61cf6e2f7292d57edebf29fac";
const GIST_FILENAME = "abhishek_loans.json"; 
// ==========================================

// 🔒 ADMIN SECURITY CHECK
// Check agar user login karke aaya hai ya nahi
if (sessionStorage.getItem('adminLoggedIn') !== 'true') {
    alert("Unauthorized Access! Kripya pehle login karein.");
    window.location.href = 'advanced_admin_login_panel.html';
}

function logoutAdmin() {
    sessionStorage.removeItem('adminLoggedIn');
    window.location.href = 'index.html';
}

// Purane offline cache (Service Worker) ko hatane ka code taaki live data aaye
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
            registration.unregister();
        }
    });
}

let loans = [];
let currentTab = 'folder'; 
let currentOpenFolder = null;
let isGridView = false; 

const monthOrder = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const emiRegex = /(?:\(\d+\))?\s*(\d+)[-\s\/]+([a-zA-Z]+)[-\s\/]+(\d+)/;

async function initApp() {
    if(localStorage.getItem('abhishek_dark_mode') === 'yes') {
        document.body.classList.add('dark-mode');
        document.getElementById('darkModeBtn').innerText = "☀️ Light";
        document.getElementById('darkModeBtn').style.background = "#fbbc05";
        document.getElementById('darkModeBtn').style.color = "#333";
    }

    const layoutPref = localStorage.getItem('abhishek_layout_pref');
    if(layoutPref === 'grid') {
        isGridView = true;
        document.getElementById('folderView').classList.add('grid-view');
        document.getElementById('layoutToggleBtn').innerText = "📜 List View";
    }

    if (GITHUB_PAT !== "") {
        await fetchFromCloud();
    } else {
        alert("GitHub API keys nahi mili! App kaam nahi karegi.");
    }
}

// DATE FORMAT HELPER
function formatUpdateTime(dateStr) {
    const updatedAt = new Date(dateStr);
    return updatedAt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

async function manualSync() {
    await fetchFromCloud();
}

async function fetchFromCloud() {
    const badge = document.getElementById('lastUpdatedBadge');
    try {
        badge.innerHTML = `<span class="spin-icon">🔄</span><br>Updating ✨`;
        
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: { 
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
        });
        const data = await response.json();
        
        if(data.files) {
            let file = data.files[GIST_FILENAME];
            if(!file) {
                const fileNames = Object.keys(data.files);
                if(fileNames.length > 0) file = data.files[fileNames[0]];
            }

            if(file && file.content) {
                loans = JSON.parse(file.content);
                updateDashboard();
                renderFolders();
                if (currentTab === 'month') renderMonthFolders();
                if (currentOpenFolder) openFolder(currentOpenFolder);
                
                badge.innerHTML = `Updated! ✅`;
                setTimeout(() => {
                    badge.innerHTML = `Updated:<br>${formatUpdateTime(data.updated_at)}`;
                }, 2000);
            }
        }
    } catch (err) {
        console.error("Cloud fetch error:", err);
        badge.innerHTML = `Offline ❌`;
        alert("Data fetch nahi ho paya. Internet connection check karein.");
    }
}

async function saveToCloud() {
    if (!GITHUB_PAT || !GIST_ID) return; 
    const badge = document.getElementById('lastUpdatedBadge');
    try {
        badge.innerHTML = `<span class="spin-icon">🔄</span><br>Saving... ✨`;
        
        const payload = {
            files: {
                [GIST_FILENAME]: {
                    content: JSON.stringify(loans, null, 2)
                }
            }
        };

        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GITHUB_PAT}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        badge.innerHTML = `Updated! ✅`;
        setTimeout(() => {
            badge.innerHTML = `Updated:<br>${formatUpdateTime(data.updated_at)}`;
        }, 2000);
        
        updateDashboard();
    } catch (err) {
        console.error("Cloud save error:", err);
        alert("⚠️ Cloud me data save nahi ho paya. Internet check karein.");
        badge.innerHTML = `Save Failed ❌`;
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('abhishek_dark_mode', isDark ? 'yes' : 'no');
    
    const btn = document.getElementById('darkModeBtn');
    if(isDark) {
        btn.innerText = "☀️ Light";
        btn.style.background = "#fbbc05";
        btn.style.color = "#333";
    } else {
        btn.innerText = "🌙 Dark";
        btn.style.background = "#5f6368";
        btn.style.color = "white";
    }
}

function toggleLayout() {
    isGridView = !isGridView;
    const folderView = document.getElementById('folderView');
    const btn = document.getElementById('layoutToggleBtn');
    
    if(isGridView) {
        folderView.classList.add('grid-view');
        btn.innerText = "📜 List View";
        localStorage.setItem('abhishek_layout_pref', 'grid');
    } else {
        folderView.classList.remove('grid-view');
        btn.innerText = "🔲 Grid View";
        localStorage.setItem('abhishek_layout_pref', 'list');
    }
}

function updateDashboard() {
    let totalAmount = 0;
    let dueThisMonth = 0;
    
    const currentMonthShort = new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase();
    document.getElementById('dueThisMonthLabel').innerText = "Due in " + currentMonthShort;

    loans.forEach(loan => { 
        totalAmount += parseInt(loan.amount) || 0; 
        
        if(loan.emis) {
            let lines = loan.emis.split('\n');
            lines.forEach(line => {
                let match = line.match(emiRegex); 
                if(match) {
                    let emiMonth = match[2].toUpperCase();
                    let emiAmount = parseInt(match[3]);
                    if(emiMonth === currentMonthShort && !isNaN(emiAmount)) {
                        dueThisMonth += emiAmount;
                    }
                }
            });
        }
    });
    
    document.getElementById('totalLoansCount').innerText = loans.length;
    document.getElementById('totalAmountSum').innerText = "₹" + totalAmount.toLocaleString('en-IN');
    document.getElementById('dueThisMonthSum').innerText = "₹" + dueThisMonth.toLocaleString('en-IN');
}

function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tabFolder').classList.remove('active');
    document.getElementById('tabMonth').classList.remove('active');
    
    document.getElementById('folderView').style.display = 'none';
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('monthView').style.display = 'none';
    document.getElementById('monthDetailView').style.display = 'none';

    if(tab === 'folder') {
        document.getElementById('tabFolder').classList.add('active');
        document.getElementById('folderView').style.display = 'block';
        document.getElementById('viewControlsContainer').style.display = 'flex'; 
        document.querySelector('.search-container').style.display = 'flex';
        handleSearch(); 
    } else {
        document.getElementById('tabMonth').classList.add('active');
        document.getElementById('monthView').style.display = 'block';
        document.getElementById('viewControlsContainer').style.display = 'none'; 
        document.querySelector('.search-container').style.display = 'none';
        renderMonthFolders();
    }
}

function renderFolders(searchQuery = '', sortMode = 'name') {
    const folders = {};
    loans.forEach(loan => {
        const name = loan.name.toUpperCase();
        if(searchQuery && !name.includes(searchQuery) && !loan.id.toUpperCase().includes(searchQuery)) return;
        
        if (!folders[name]) folders[name] = { count: 0, sum: 0 };
        folders[name].count++;
        folders[name].sum += parseInt(loan.amount) || 0;
    });

    const folderDiv = document.getElementById('folderView');
    folderDiv.innerHTML = '';

    let sortedFolderNames = Object.keys(folders);
    if (sortMode === 'highest') sortedFolderNames.sort((a, b) => folders[b].sum - folders[a].sum);
    else if (sortMode === 'lowest') sortedFolderNames.sort((a, b) => folders[a].sum - folders[b].sum);
    else sortedFolderNames.sort();

    sortedFolderNames.forEach(name => {
        const div = document.createElement('div');
        div.className = 'folder';
        div.onclick = () => openFolder(name);
        div.innerHTML = `
            <div>📁 ${name}</div>
            <div><span>${folders[name].count} Loans | ₹${folders[name].sum}</span></div>
        `;
        folderDiv.appendChild(div);
    });
    
    if(sortedFolderNames.length === 0) {
        folderDiv.innerHTML = '<p style="text-align:center; color:#777; margin-top:20px; grid-column: 1 / -1;">No records found.</p>';
    }
}

function openFolder(name) {
    currentOpenFolder = name;
    document.getElementById('folderView').style.display = 'none';
    document.getElementById('detailView').style.display = 'block';
    document.getElementById('viewControlsContainer').style.display = 'none'; 
    
    let userTotalAmount = 0;
    let userLoanCount = 0;
    loans.forEach(loan => {
        if(loan.name.toUpperCase() === name.toUpperCase()) {
            userTotalAmount += parseInt(loan.amount) || 0;
            userLoanCount++;
        }
    });

    let badgeBg = document.body.classList.contains('dark-mode') ? '#333' : '#fce8e6';
    document.getElementById('currentFolderName').innerHTML = `
        📁 ${name} <br>
        <span style="font-size: 14px; font-weight: normal; display: inline-block; margin-top: 5px; background: ${badgeBg}; padding: 5px 15px; border-radius: 20px;">
            Loans: <b>${userLoanCount}</b> &nbsp;|&nbsp; Amount: <b>₹${userTotalAmount.toLocaleString('en-IN')}</b>
        </span>
    `;
    renderLoanList(name);
}

function goBackToFolders() {
    currentOpenFolder = null;
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('folderView').style.display = 'block';
    document.getElementById('viewControlsContainer').style.display = 'flex'; 
    handleSearch();
}

function renderLoanList(nameFilter) {
    const list = document.getElementById('loanList');
    list.innerHTML = '';
    
    loans.forEach((loan, index) => {
        if(loan.name.toUpperCase() === nameFilter.toUpperCase()) {
            let emiSum = 0;
            if(loan.emis) {
                let lines = loan.emis.split('\n');
                lines.forEach(line => {
                    let match = line.match(emiRegex);
                    if(match) {
                        let parsedAmount = parseInt(match[3]);
                        if(!isNaN(parsedAmount)) { emiSum += parsedAmount; }
                    }
                });
            }

            const card = document.createElement('div');
            card.className = 'card';
            // Yaha par Edit / Delete button diye gaye hain (Sirf admin ke liye)
            card.innerHTML = `
                <div>
                    <p style="color:#ea4335; font-weight:600; font-size:14px;">ID: ${loan.id}</p>
                    <p><strong>Total Amount:</strong> ₹${loan.amount}</p>
                    <div class="emi-text"><strong>EMI Dates:</strong><br>${loan.emis}</div>
                </div>
                <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div class="no-print">
                        <button class="btn btn-warning" onclick="editLoan(${index})">✏️ Edit</button>
                        <button class="btn btn-danger" onclick="deleteLoan(${index})">🗑️ Delete</button>
                    </div>
                    <div class="emi-sum-box" style="background: #fce8e6; color: #ea4335; padding: 6px 10px; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                        EMI Sum: ₹${emiSum}
                    </div>
                </div>
            `;
            list.appendChild(card);
        }
    });
}

function parseAllEMIs() {
    let monthData = {};
    loans.forEach(loan => {
        let lines = loan.emis.split('\n');
        lines.forEach(line => {
            let match = line.match(emiRegex);
            if(match) {
                let date = parseInt(match[1]);
                let month = match[2].toUpperCase();
                let amount = parseInt(match[3]);

                if(!monthData[month]) monthData[month] = { total: 0, items: [] };
                if(!isNaN(amount)) { monthData[month].total += amount; }
                monthData[month].items.push({ date, amount, name: loan.name, id: loan.id, original: line });
            }
        });
    });
    return monthData;
}

function renderMonthFolders() {
    const data = parseAllEMIs();
    const monthViewDiv = document.getElementById('monthView');
    monthViewDiv.innerHTML = '';

    let availableMonths = Object.keys(data).sort((a, b) => {
        let idxA = monthOrder.indexOf(a);
        let idxB = monthOrder.indexOf(b);
        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    availableMonths.forEach(month => {
        const div = document.createElement('div');
        div.className = 'month-folder';
        div.onclick = () => openMonthDetail(month, data[month]);
        div.innerHTML = `
            <div>📅 ${month}</div>
            <div><span style="color:#ea4335; font-weight:600;">Total EMI: ₹${data[month].total}</span></div>
        `;
        monthViewDiv.appendChild(div);
    });

    if(availableMonths.length === 0) {
        monthViewDiv.innerHTML = '<p style="text-align:center; color:#777; margin-top:20px;">No EMI schedules found.</p>';
    }
}

function openMonthDetail(month, monthObj) {
    document.getElementById('monthView').style.display = 'none';
    document.getElementById('monthDetailView').style.display = 'block';
    document.getElementById('currentMonthName').innerText = `📅 ${month} Collection - Total: ₹${monthObj.total}`;
    
    const list = document.getElementById('monthDateList');
    list.innerHTML = '';

    let sortedItems = monthObj.items.sort((a, b) => a.date - b.date);

    sortedItems.forEach(item => {
        const div = document.createElement('div');
        div.className = 'monthly-item';
        div.innerHTML = `
            <div><span style="background:#ea4335;color:white;padding:2px 6px;border-radius:4px;margin-right:5px;">${item.date}</span> <strong>${item.name}</strong> <br><small style="color:#888;">${item.id}</small></div>
            <div style="font-size:16px; font-weight:600; color:#333;">₹${item.amount}</div>
        `;
        list.appendChild(div);
    });
}

function goBackToMonths() {
    document.getElementById('monthDetailView').style.display = 'none';
    document.getElementById('monthView').style.display = 'block';
    renderMonthFolders();
}

function handleSearch() {
    let query = document.getElementById('searchInput').value.toUpperCase().trim();
    let sortMode = document.getElementById('sortSelect').value;
    if(currentTab === 'folder') {
        if(currentOpenFolder) {
            currentOpenFolder = null;
            document.getElementById('detailView').style.display = 'none';
            document.getElementById('folderView').style.display = 'block';
            document.getElementById('viewControlsContainer').style.display = 'flex';
        }
        renderFolders(query, sortMode);
    }
}

/* DYNAMIC EMI LOGIC */
function addEmiRow(date = '', month = '', amount = '') {
    const container = document.getElementById('dynamicEmiContainer');
    const row = document.createElement('div');
    row.className = 'emi-row';
    
    row.innerHTML = `
        <input type="number" placeholder="Date (e.g. 10)" value="${date}" style="width: 25%;" min="1" max="31">
        <input type="text" placeholder="Month (e.g. AUG)" value="${month}" style="width: 35%; text-transform: uppercase;">
        <input type="number" placeholder="Amount (₹)" value="${amount}" style="width: 30%;" min="1">
        <button class="btn btn-danger" onclick="this.parentElement.remove()" style="padding: 8px; width: 10%;">❌</button>
    `;
    container.appendChild(row);
}

function showForm() {
    document.getElementById('loanFormContainer').style.display = 'block';
    document.getElementById('editOriginalId').value = '';
    document.getElementById('loanName').value = currentOpenFolder ? currentOpenFolder : '';
    document.getElementById('loanId').value = '';
    document.getElementById('loanAmount').value = '';
    
    document.getElementById('dynamicEmiContainer').innerHTML = ''; 
    addEmiRow(); 
    window.scrollTo(0, 0);
}

function hideForm() {
    document.getElementById('loanFormContainer').style.display = 'none';
}

async function saveLoan() {
    const name = document.getElementById('loanName').value.trim().toUpperCase();
    const id = document.getElementById('loanId').value.trim();
    const amount = document.getElementById('loanAmount').value;
    const originalId = document.getElementById('editOriginalId').value;

    if (!name || !id || !amount) {
        alert("Name, ID and Amount required!");
        return;
    }
    
    let emiString = '';
    const emiRows = document.querySelectorAll('.emi-row');
    let validIndex = 1;
    emiRows.forEach((row) => {
        const inputs = row.querySelectorAll('input');
        const date = inputs[0].value.trim();
        const month = inputs[1].value.trim().toUpperCase();
        const emiAmt = inputs[2].value.trim();
        
        if(date && month && emiAmt) {
            emiString += `(${validIndex}) ${date} ${month} ${emiAmt}\n`;
            validIndex++;
        }
    });
    emiString = emiString.trim();

    const loanData = { name, id, amount, emis: emiString };

    if (originalId !== '') {
        const index = loans.findIndex(l => l.id === originalId);
        if(index > -1) loans[index] = loanData;
    } else {
        const exists = loans.find(l => l.id === id);
        if (exists) {
            alert("Error: This Loan ID already exists! Please enter a unique ID.");
            return;
        }
        loans.push(loanData);
    }

    await saveToCloud();
    hideForm();
    
    if(currentTab === 'folder') {
        if (currentOpenFolder && currentOpenFolder === name) openFolder(name);
        else goBackToFolders();
    } else {
        renderMonthFolders();
    }
}

function editLoan(index) {
    const loan = loans[index];
    document.getElementById('editOriginalId').value = loan.id;
    document.getElementById('loanName').value = loan.name;
    document.getElementById('loanId').value = loan.id;
    document.getElementById('loanAmount').value = loan.amount;
    
    const container = document.getElementById('dynamicEmiContainer');
    container.innerHTML = '';
    
    if(loan.emis) {
        let lines = loan.emis.split('\n');
        lines.forEach(line => {
            let match = line.match(emiRegex);
            if(match) addEmiRow(match[1], match[2], match[3]);
        });
    }
    if(container.innerHTML === '') addEmiRow();

    document.getElementById('loanFormContainer').style.display = 'block';
    window.scrollTo(0, 0);
}

async function deleteLoan(index) {
    if(confirm("Kya aap sach mein ise delete karna chahte hain?")) {
        loans.splice(index, 1);
        await saveToCloud();
        if (currentOpenFolder) openFolder(currentOpenFolder);
        else handleSearch();
    }
}

function exportData() {
    const dataStr = JSON.stringify(loans, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0'); 
    const yyyy = today.getFullYear();
    const formattedDate = dd + '-' + mm + '-' + yyyy;
    
    a.download = `Loan data ${formattedDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported) && imported.length > 0 && imported[0].hasOwnProperty('id')) {
                let choice = confirm("Press 'OK' to MERGE this data with existing.\nPress 'Cancel' to OVERWRITE completely.");
                
                if (choice) {
                    const existingIds = new Set(loans.map(l => l.id));
                    imported.forEach(newLoan => {
                        if(!existingIds.has(newLoan.id)) loans.push(newLoan);
                    });
                    alert("✅ Data Merged Successfully!");
                } else {
                    loans = imported;
                    alert("✅ Data Overwritten Successfully!");
                }
                
                await saveToCloud();
                switchTab('folder');
            } else if (Array.isArray(imported) && imported.length === 0) {
                alert("⚠️ Upload ki gayi file khali hai.");
            } else {
                alert("❌ Galat file format!");
            }
        } catch (error) { 
            alert("❌ Invalid JSON file! Kripya sahi file upload karein."); 
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

window.onload = initApp;