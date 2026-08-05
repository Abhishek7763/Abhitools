// ==========================================
// ☁️ GITHUB GIST CLOUD SYNC SETTINGS (Read-Only)
// ==========================================
const GIST_ID = "2d93e5e61cf6e2f7292d57edebf29fac";
const GIST_FILENAME = "abhishek_loans.json"; 
// ==========================================

// Purane offline cache (Service Worker) ko hatane ka code taaki live data aaye
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
            registration.unregister();
            console.log("Offline Cache hataya gaya, ab app hamesha live chalegi.");
        }
    });
}

// PWA Install Logic
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) {
        installBtn.style.display = 'inline-block';
        installBtn.addEventListener('click', async () => {
            installBtn.style.display = 'none';
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
        });
    }
});

let loans = [];
let currentTab = 'folder'; 
let currentOpenFolder = null;
let isGridView = false; 

const monthOrder = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const emiRegex = /(?:\(\d+\))?\s*(\d+)[-\s\/]+([a-zA-Z]+)[-\s\/]+(\d+)/;

async function initApp() {
    // Restore UI preferences from local storage
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

    // Cloud only data loading (Hamesha fresh data layega, without token)
    await fetchFromCloud();
}

// DATE FORMAT HELPER
function formatUpdateTime(dateStr) {
    const updatedAt = new Date(dateStr);
    return updatedAt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

// MANUAL SYNC FUNCTION
async function manualSync() {
    await fetchFromCloud();
}

async function fetchFromCloud() {
    const badge = document.getElementById('lastUpdatedBadge');
    try {
        badge.innerHTML = `<span class="spin-icon">🔄</span><br>Updating ✨`;
        
        // Read-only fetch (No token required for fetching public/known gist IDs)
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
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
                
                badge.innerHTML = `Updated! ✅🥰`;
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

function printStatement() {
    const today = new Date();
    const dateStr = String(today.getDate()).padStart(2, '0') + '/' + 
                    String(today.getMonth() + 1).padStart(2, '0') + '/' + 
                    today.getFullYear();
    const timeStr = today.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
    document.getElementById('printDateDisplay').innerHTML = `Date Generated: ${dateStr} at ${timeStr}`;
    window.print();
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
    
    if (sortMode === 'highest') {
        sortedFolderNames.sort((a, b) => folders[b].sum - folders[a].sum);
    } else if (sortMode === 'lowest') {
        sortedFolderNames.sort((a, b) => folders[a].sum - folders[b].sum);
    } else {
        sortedFolderNames.sort();
    }

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

    let badgeBg = document.body.classList.contains('dark-mode') ? '#333' : '#e8f0fe';

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
            // Yaha se Edit/Delete button ko hata diya gaya hai
            card.innerHTML = `
                <div>
                    <p style="color:#1a73e8; font-weight:600; font-size:14px;">ID: ${loan.id}</p>
                    <p><strong>Total Amount:</strong> ₹${loan.amount}</p>
                    <div class="emi-text"><strong>EMI Dates:</strong><br>${loan.emis}</div>
                </div>
                <div style="margin-top: 15px; display: flex; justify-content: flex-end; align-items: center;">
                    <div class="emi-sum-box" style="background: #e8f0fe; color: #1a73e8; padding: 6px 10px; border-radius: 6px; font-weight: 600; font-size: 14px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
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
            <div><span style="color:#34a853; font-weight:600;">Total EMI: ₹${data[month].total}</span></div>
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
            <div><span style="background:#34a853;color:white;padding:2px 6px;border-radius:4px;margin-right:5px;">${item.date}</span> <strong>${item.name}</strong> <br><small style="color:#888;">${item.id}</small></div>
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

function showContactPage() {
    document.getElementById('contactPageContainer').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
}

function hideContactPage() {
    document.getElementById('contactPageContainer').style.display = 'none';
}

window.onload = initApp;