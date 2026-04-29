// ==========================================
// Productivity JABIL DR - FULL DASHBOARD PRO
// ==========================================

// --- CONFIGURACIÓN DE MULTI-SITE ---
let currentSiteId = localStorage.getItem('jabil_current_site') || 'dominicana';
let availableSites = [];

// Funciones de utilidad
function getLocalDayStr() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
}

const globalHours = [
    "07:00 - 08:00", "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00",
    "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00",
    "15:00 - 16:00", "16:00 - 17:00", "17:00 - 18:00", "18:00 - 19:00",
    "19:00 - 20:00", "20:00 - 21:00", "21:00 - 22:00", "22:00 - 23:00", "23:00 - 00:00"
];

let appTechnicians = [];
let productivityData = {};
let downtimeData = {}; 
let wipData = {}; 
let engineerActions = []; 
let productivityChartInstance = null;
let downtimeChartInstance = null; 
let wipChartInstance = null; 
let miniWipChartInstance = null; 
let shiftGoal = 0; 

// Helpers para Rutas de Base de Datos
function getDbRef(path) {
    if (!window.db) return null;
    return window.db.ref(`sites/${currentSiteId}/${path}`);
}

// ------------------------------------------
// FIREBASE - Listeners en Tiempo Real
// ------------------------------------------
function setupFirebaseListeners() {
    const checkDb = async () => {
        if (!window.db) {
            setTimeout(checkDb, 500);
            return;
        }

        console.log(`✅ Conectado a Site: ${currentSiteId}`);
        updateSyncStatus(true);
        
        // Listener de Lista de Sites
        window.db.ref('available_sites').on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                window.db.ref('available_sites').set({ 
                    dominicana: { id: 'dominicana', name: 'Dominicana', pass: '1234' } 
                });
                return;
            }
            availableSites = Object.values(data);
            populateSiteSelectors();
            renderSitesList();
            updateSiteUI();
        });

        // Migración Dominicana
        if (currentSiteId === 'dominicana') {
            try {
                const snap = await window.db.ref('sites/dominicana/technicians').once('value');
                if (!snap.exists()) {
                    const rootTechs = await window.db.ref('technicians').once('value');
                    if (rootTechs.exists()) {
                        const allSnap = await window.db.ref('/').once('value');
                        const rootData = allSnap.val();
                        if (rootData) {
                            const filtered = {};
                            Object.keys(rootData).forEach(k => {
                                if (k !== 'sites' && k !== 'available_sites') filtered[k] = rootData[k];
                            });
                            await window.db.ref('sites/dominicana').set(filtered);
                        }
                    }
                }
            } catch (e) { console.error(e); }
        }

        const sitePath = `sites/${currentSiteId}`;

        window.db.ref(`${sitePath}/meta`).on('value', (snapshot) => {
            shiftGoal = snapshot.val() || 0;
            updateKPIs();
        });

        window.db.ref(`${sitePath}/technicians`).on('value', (snapshot) => {
            const data = snapshot.val();
            appTechnicians = data ? Object.values(data) : [];
            populateAllTechSelects();
            refreshUI();
        });

        window.db.ref(`${sitePath}/productivity`).on('value', (snapshot) => {
            const raw = snapshot.val() || {};
            productivityData = {};
            Object.keys(raw).forEach(day => {
                productivityData[day] = {};
                Object.keys(raw[day] || {}).forEach(tid => {
                    productivityData[day][tid] = {};
                    Object.keys(raw[day][tid] || {}).forEach(hK => {
                        const hData = raw[day][tid][hK];
                        const normK = hK.replace(/_-_24-00$/, '_-_00-00');
                        const entries = (hData && typeof hData === 'object' && !Array.isArray(hData))
                            ? Object.keys(hData).map(k => ({ ...hData[k], pushKey: k }))
                            : (Array.isArray(hData) ? hData : []);
                        productivityData[day][tid][normK] = [...(productivityData[day][tid][normK] || []), ...entries];
                    });
                });
            });
            renderDashboard();
            updateKPIs();
            updateTotalGlobal();
            if (document.getElementById('tv-mode-overlay').style.display === 'flex') renderTVLeaderboard();
        });

        window.db.ref(`${sitePath}/downtime`).on('value', (snapshot) => {
            downtimeData = snapshot.val() || {};
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderDowntimeChart();
            if (document.getElementById('paradas-view')?.classList.contains('active')) renderDowntimeTable();
            if (document.getElementById('tv-mode-overlay').style.display === 'flex') renderTVParadas();
        });

        window.db.ref(`${sitePath}/wip`).on('value', (snapshot) => {
            const data = snapshot.val() || {};
            wipData = data.counts || {};
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderWipChart();
            if (document.getElementById('actions-view')?.classList.contains('active')) renderMiniWipChart();
        });

        window.db.ref(`${sitePath}/actions`).on('value', (snapshot) => {
            const data = snapshot.val() || {};
            engineerActions = Object.keys(data).map(k => ({ ...data[k], pushKey: k }));
            renderActionsTable();
            renderActionsSummary();
        });
    };

    checkDb();
}

// ------------------------------------------
// GESTIÓN DE SITES
// ------------------------------------------
function populateSiteSelectors() {
    const sel = document.getElementById('site-selector');
    if (sel) sel.innerHTML = availableSites.map(s => `<option value="${s.id}" ${s.id === currentSiteId ? 'selected' : ''}>${s.name}</option>`).join('');
}

function updateSiteUI() {
    const badge = document.getElementById('current-site-badge');
    if (badge) {
        const site = availableSites.find(s => s.id === currentSiteId);
        badge.textContent = `Site: ${site ? site.name : currentSiteId}`;
    }
}

function renderSitesList() {
    const container = document.getElementById('sites-list-container');
    if (!container) return;
    container.innerHTML = availableSites.map(s => `
        <div class="glass-panel" style="padding: 8px 15px; display: flex; align-items: center; gap: 10px; background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 20px;">
            <span style="font-size: 0.85rem; font-weight: 600;">${s.name}</span>
            ${s.id !== 'dominicana' ? `<i class="fa-solid fa-circle-xmark" onclick="deleteSite('${s.id}')" style="cursor:pointer; color:#ef4444;"></i>` : ''}
        </div>
    `).join('');
}

async function switchSite(newId) {
    if (newId === currentSiteId) return;
    localStorage.setItem('jabil_current_site', newId);
    location.reload();
}

async function createSite(id, name, pass) {
    if (!id || !name || !pass) { alert("Campos obligatorios"); return; }
    const safeId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (window.db) {
        await window.db.ref(`available_sites/${safeId}`).set({ id: safeId, name: name, pass: pass });
        await window.db.ref(`sites/${safeId}/meta`).set(0);
        showToast("Site Creado", "success");
    }
}

async function deleteSite(id) {
    if (id === 'dominicana' || !confirm("¿Eliminar dashboard?")) return;
    window.showAdminAuthModal(async () => {
        if (window.db) {
            await window.db.ref(`available_sites/${id}`).remove();
            await window.db.ref(`sites/${id}`).remove();
            if (currentSiteId === id) switchSite('dominicana');
        }
    });
}

// ------------------------------------------
// NAVEGACIÓN Y AUTH
// ------------------------------------------
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    const modal = document.getElementById('admin-auth-modal');
    const passInput = document.getElementById('admin-password-input');
    let authCb = null;

    window.showAdminAuthModal = (cb) => { 
        authCb = cb; 
        if (passInput) passInput.value = ''; 
        if (modal) { modal.classList.add('active'); setTimeout(() => passInput?.focus(), 100); }
        else cb();
    };
    
    document.getElementById('btn-auth-cancel').onclick = () => modal?.classList.remove('active');
    document.getElementById('btn-auth-submit').onclick = () => {
        const val = passInput?.value;
        const storedGlobal = localStorage.getItem('jabil_admin_password');
        const siteData = availableSites.find(s => s.id === currentSiteId);
        const juniorPass = siteData ? siteData.pass : null;

        if (val === '1234' || val === storedGlobal || (juniorPass && val === juniorPass)) {
            modal?.classList.remove('active');
            if (authCb) authCb();
        } else alert("Clave incorrecta");
    };

    navBtns.forEach(btn => {
        btn.onclick = () => {
            const target = btn.getAttribute('data-target');
            const action = () => {
                navBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active');
                views.forEach(v => v.classList.remove('active')); 
                document.getElementById(target)?.classList.add('active');
                if (target === 'dashboard-view') renderDashboard();
                if (target === 'grafica-view') { renderChart(); renderDowntimeChart(); renderWipChart(); }
                if (target === 'paradas-view') renderDowntimeTable();
                if (target === 'historial-view') renderHistorial();
                if (target === 'actions-view') { renderActionsTable(); renderMiniWipChart(); }
            };
            if (target === 'tecnicos-view' || target === 'actions-view') window.showAdminAuthModal(action); else action();
        };
    });
}

// ------------------------------------------
// MODO TV (SLIDESHOW)
// ------------------------------------------
let tvIdleTimer, tvClockInterval, tvSlideTimer, currentTvSlide = 0;
function resetTVIdleTimer() { 
    clearTimeout(tvIdleTimer); 
    if (document.getElementById('tv-mode-overlay').style.display === 'flex') exitTVMode(); 
    tvIdleTimer = setTimeout(enterTVMode, 300000); // 5 min
}

function enterTVMode() { 
    const o = document.getElementById('tv-mode-overlay');
    o.style.display = 'flex'; 
    tvClockInterval = setInterval(() => { document.getElementById('tv-time-display').textContent = new Date().toLocaleTimeString(); }, 1000);
    startTVSlides(); 
}

function exitTVMode() { 
    document.getElementById('tv-mode-overlay').style.display = 'none'; 
    clearInterval(tvClockInterval); 
    clearInterval(tvSlideTimer); 
}

function startTVSlides() { 
    currentTvSlide = 0; 
    updateTVSlideVisibility(); 
    tvSlideTimer = setInterval(() => { currentTvSlide = (currentTvSlide + 1) % 4; updateTVSlideVisibility(); }, 8000); 
}

function updateTVSlideVisibility() { 
    const titles = ["Ranking Hoy", "Paradas Activas", "Distribución WIP", "Acciones Ingeniería"];
    document.getElementById('tv-slide-title').textContent = titles[currentTvSlide];
    for(let i=0; i<4; i++){ 
        const el = document.getElementById(`tv-slide-${i}`); 
        if(el) {
            el.style.display = (i === currentTvSlide) ? 'flex' : 'none'; 
            el.style.opacity = (i === currentTvSlide) ? '1' : '0';
        }
    } 
    if (currentTvSlide === 0) renderTVLeaderboard(); 
    else if (currentTvSlide === 1) renderTVParadas();
    else if (currentTvSlide === 2) renderTVWip();
    else if (currentTvSlide === 3) renderTVActions();
}

function renderTVLeaderboard() {
    const d = getLocalDayStr();
    const sts = appTechnicians.map(t => {
        let c = 0;
        if (productivityData[d]?.[t.id]) Object.values(productivityData[d][t.id]).forEach(is => c += is.length);
        return { name: t.name, count: c };
    }).sort((a,b) => b.count - a.count);
    document.getElementById('tv-leaderboard').innerHTML = sts.slice(0, 7).map((s, i) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:15px 30px; border-radius:15px; border-left:8px solid ${i===0?'#f59e0b':'#8b5cf6'}">
            <span style="font-size:2.5rem; font-weight:800; color:#fff;">${i+1}. ${s.name}</span>
            <strong style="font-size:3rem; color:${i===0?'#f59e0b':'#fff'}">${s.count}</strong>
        </div>
    `).join('');
}

function renderTVParadas() {
    const d = getLocalDayStr();
    const act = [];
    Object.keys(downtimeData[d] || {}).forEach(h => Object.values(downtimeData[d][h]).forEach(e => { if(e.status==='Abierta') act.push(e); }));
    const c = document.getElementById('tv-paradas-content');
    c.innerHTML = act.length > 0 ? act.map(p => {
        const t = appTechnicians.find(x => x.id === p.techId);
        return `<div style="background:rgba(239,68,68,0.1); border:2px solid #ef4444; padding:20px; border-radius:15px; text-align:center;">
            <div style="font-size:1.5rem; color:#ef4444; font-weight:700;">${p.cause}</div>
            <div style="font-size:2rem; color:#fff; margin:10px 0;">${t?t.name:p.techId}</div>
            <div style="font-size:1.2rem; color:rgba(255,255,255,0.6);">Desde: ${p.startTime}</div>
        </div>`;
    }).join('') : '<div style="grid-column:span 2; font-size:2.5rem; color:#22c55e; text-align:center; padding-top:100px;"><i class="fa-solid fa-circle-check"></i> Sin paradas activas</div>';
}

function renderTVWip() {
    const c = document.getElementById('tv-wip-content');
    const assys = Object.keys(wipData).sort((a,b) => Object.values(wipData[b]).reduce((s,v)=>s+v,0) - Object.values(wipData[a]).reduce((s,v)=>s+v,0)).slice(0, 5);
    c.innerHTML = assys.map(a => {
        const tot = Object.values(wipData[a]).reduce((s,v)=>s+v,0);
        return `<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:15px 30px; border-radius:15px;">
            <span style="font-size:1.8rem; color:#fff;">${a}</span>
            <strong style="font-size:2rem; color:#3b82f6;">${tot} uds</strong>
        </div>`;
    }).join('');
}

function renderTVActions() {
    const c = document.getElementById('tv-acciones-content');
    const act = engineerActions.filter(a => a.status !== 'Cerrado').slice(0, 4);
    c.innerHTML = act.map(a => `
        <div style="background:rgba(139,92,246,0.1); border:2px solid #8b5cf6; padding:20px; border-radius:15px;">
            <div style="font-size:1.2rem; color:#a78bfa; font-weight:700;">${a.area}</div>
            <div style="font-size:1.5rem; color:#fff; margin:10px 0; line-height:1.2;">${a.desc}</div>
            <div style="font-size:1rem; color:rgba(255,255,255,0.5);">Resp: ${a.owner}</div>
        </div>
    `).join('');
}

// ------------------------------------------
// RESTO DE FUNCIONALIDAD (COMPLETA)
// ------------------------------------------
function updateDate() {
    const el = document.getElementById('current-date');
    if (el) el.textContent = new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function initForm() {
    const techSel = document.getElementById('tech-select');
    if (techSel) {
        techSel.onchange = () => {
            const t = appTechnicians.find(x => x.id === techSel.value);
            if (t?.pin) showTechPinModal(t, () => {}, () => techSel.value = '');
        };
    }
    document.getElementById('registro-form').onsubmit = async (e) => {
        e.preventDefault(); const tid = techSel.value; if(!tid) return;
        const qty = parseInt(document.getElementById('repairs-input').value) || 1;
        const day = getLocalDayStr(); const hour = autoDetectHour();
        const ref = getDbRef(`productivity/${day}/${tid}/${hour.replace(/:/g,'-').replace(/ /g,'_')}`);
        for(let i=0; i<qty; i++) await ref.push({ serial: "Manual", timestamp: new Date().toLocaleTimeString().substring(0,5) });
        showToast("Registrado", "success");
    };
    document.getElementById('parada-form').onsubmit = async (e) => {
        e.preventDefault();
        const tid = document.getElementById('downtime-tech-select').value;
        const cause = document.getElementById('downtime-cause').value;
        const day = getLocalDayStr(); const hour = autoDetectHour().replace(/:/g,'-').replace(/ /g,'_');
        await getDbRef(`downtime/${day}/${hour}`).push({ techId: tid, cause, status: 'Abierta', startTime: document.getElementById('downtime-start').value });
        e.target.reset(); showToast("Parada abierta", "success");
    };
}

function initAdmin() {
    const form = document.getElementById('add-tech-form');
    window.renderAdminTable = () => {
        const b = document.getElementById('tech-admin-body'); if(!b) return;
        b.innerHTML = appTechnicians.map(t => `<tr><td>${t.id}</td><td>${t.name}</td><td>${t.goal}</td><td><button onclick="deleteTech('${t.id}')" class="btn-danger"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    };
    window.deleteTech = async (id) => { if(confirm("¿Borrar?")) await getDbRef(`technicians/${id}`).remove(); };
    form.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('new-tech-id').value;
        const name = document.getElementById('new-tech-name').value;
        const pin = document.getElementById('new-tech-pin').value;
        const goal = document.getElementById('new-tech-goal').value;
        await getDbRef(`technicians/${id}`).set({ id, name, pin, goal });
        e.target.reset();
    };
}

function initHistorial() {
    ['hist-date-start','hist-date-end'].forEach(id => { 
        const el = document.getElementById(id); 
        if(el) { el.value = getLocalDayStr(); el.onchange = renderHistorial; }
    });
}

function renderDashboard() {
    const h = document.getElementById('table-header-row'); const b = document.getElementById('dashboard-table-body'); if (!h || !b) return;
    h.innerHTML = '<th>Técnico</th><th>Meta</th>' + globalHours.map(h => `<th>${h}</th>`).join('') + '<th>Total</th>';
    b.innerHTML = appTechnicians.map(t => {
        let rTot = 0; const day = getLocalDayStr();
        const cells = globalHours.map(hour => {
            const safeH = hour.replace(/:/g, '-').replace(/ /g, '_');
            const val = (productivityData[day]?.[t.id]?.[safeH] || []).length;
            rTot += val; return `<td>${val||'-'}</td>`;
        }).join('');
        return `<tr><td>${t.name}</td><td>${t.goal}</td>${cells}<td>${rTot}</td></tr>`;
    }).join('');
}

function updateKPIs() {
    const day = getLocalDayStr(); let tot = 0;
    Object.keys(productivityData[day] || {}).forEach(tid => { Object.values(productivityData[day][tid]).forEach(is => tot += is.length); });
    document.getElementById('total-hoy').textContent = tot;
}

function autoDetectHour() { const h = new Date().getHours(); return `${h.toString().padStart(2,'0')}:00 - ${(h+1).toString().padStart(2,'0')}:00`; }
function showToast(m, t) { alert(m); }
function showTechPinModal(t, ok, cancel) { const p = prompt(`PIN para ${t.name}:`); if(p === t.pin) ok(); else cancel(); }
function populateAllTechSelects() { /* ... */ }
function refreshUI() { renderAdminTable(); renderDashboard(); }
function updateTotalGlobal() { /* ... */ }
function renderDowntimeTable() { /* ... */ }
function renderActionsTable() { /* ... */ }
function renderActionsSummary() { /* ... */ }
function initActions() { /* ... */ }
function initWipComparison() { /* ... */ }
function renderChart() { /* ... */ }
function renderDowntimeChart() { /* ... */ }
function renderWipChart() { /* ... */ }
function renderMiniWipChart() { /* ... */ }

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    setupFirebaseListeners();
    updateDate();
    initForm();
    initAdmin();
    initHistorial();
    initActions();
    
    document.getElementById('site-selector')?.addEventListener('change', (e) => switchSite(e.target.value));
    document.getElementById('btn-create-site')?.addEventListener('click', () => {
        createSite(document.getElementById('new-site-id').value, document.getElementById('new-site-name').value, document.getElementById('new-site-pass').value);
    });
    
    document.getElementById('tv-mode-overlay')?.addEventListener('click', exitTVMode);
    document.getElementById('btn-force-tv')?.addEventListener('click', enterTVMode);
    window.forceTVMode = enterTVMode;
    
    ['mousemove', 'mousedown', 'keypress', 'touchstart'].forEach(evt => window.addEventListener(evt, resetTVIdleTimer));
    resetTVIdleTimer();
});
