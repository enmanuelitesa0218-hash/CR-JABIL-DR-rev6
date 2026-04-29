// ==========================================
// Productivity JABIL DR - FULL ENGINE PRO
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

        console.log(`📡 Conectado a Site: ${currentSiteId}`);
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

        // Migración Granular Dominicana
        if (currentSiteId === 'dominicana') {
            const nodes = ['technicians', 'productivity', 'downtime', 'actions', 'meta', 'wip'];
            for (const node of nodes) {
                try {
                    const siteSnap = await window.db.ref(`sites/dominicana/${node}`).once('value');
                    if (!siteSnap.exists()) {
                        const rootSnap = await window.db.ref(node).once('value');
                        if (rootSnap.exists()) {
                            await window.db.ref(`sites/dominicana/${node}`).set(rootSnap.val());
                        }
                    }
                } catch (e) { console.error(e); }
            }
        }

        const sitePath = `sites/${currentSiteId}`;

        // Meta del Site
        window.db.ref(`${sitePath}/meta`).on('value', (snapshot) => {
            shiftGoal = snapshot.val() || 0;
            const goalInput = document.getElementById('shift-goal-input');
            if (goalInput && shiftGoal > 0) goalInput.value = shiftGoal;
            updateKPIs();
        });

        // Técnicos del Site
        window.db.ref(`${sitePath}/technicians`).on('value', (snapshot) => {
            const data = snapshot.val();
            appTechnicians = data ? Object.values(data) : [];
            populateAllTechSelects();
            refreshUI();
        });

        // Productividad del Site
        window.db.ref(`${sitePath}/productivity`).on('value', (snapshot) => {
            const raw = snapshot.val() || {};
            productivityData = {};
            Object.keys(raw).forEach(day => {
                productivityData[day] = {};
                Object.keys(raw[day] || {}).forEach(tid => {
                    productivityData[day][tid] = {};
                    Object.keys(raw[day][tid] || {}).forEach(hK => {
                        const hData = raw[day][tid][hK];
                        const normK = hK.replace(/:/g, '-').replace(/ /g, '_').replace(/_-_24-00$/, '_-_00-00');
                        let entries = [];
                        if (hData && typeof hData === 'object' && !Array.isArray(hData)) {
                            entries = Object.keys(hData).map(k => ({ ...hData[k], pushKey: k }));
                        } else if (Array.isArray(hData)) {
                            entries = hData.filter(e => e !== null);
                        }
                        if (!productivityData[day][tid][normK]) productivityData[day][tid][normK] = [];
                        productivityData[day][tid][normK].push(...entries);
                    });
                });
            });
            renderDashboard();
            updateKPIs();
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderChart();
            if (document.getElementById('tv-mode-overlay').style.display === 'flex') renderTVLeaderboard();
        });

        // Paradas del Site
        window.db.ref(`${sitePath}/downtime`).on('value', (snapshot) => {
            downtimeData = snapshot.val() || {};
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderDowntimeChart();
            if (document.getElementById('paradas-view')?.classList.contains('active')) renderDowntimeTable();
            if (document.getElementById('tv-mode-overlay').style.display === 'flex') renderTVParadas();
        });

        // WIP del Site
        window.db.ref(`${sitePath}/wip`).on('value', (snapshot) => {
            const data = snapshot.val() || {};
            wipData = data.counts || {};
            const tsEl = document.getElementById('wip-last-update');
            if (tsEl && data.updatedAt) tsEl.textContent = `Actualizado: ${data.updatedAt}`;
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderWipChart();
            if (document.getElementById('actions-view')?.classList.contains('active')) renderMiniWipChart();
        });

        // Acciones del Site
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
    if (!id || !name || !pass) { alert("Todos los campos son obligatorios"); return; }
    const safeId = id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (window.db) {
        await window.db.ref(`available_sites/${safeId}`).set({ id: safeId, name: name, pass: pass });
        await window.db.ref(`sites/${safeId}/meta`).set(0);
        showToast(`Site '${name}' creado`, "success");
    }
}

async function deleteSite(id) {
    if (id === 'dominicana' || !confirm("¿Eliminar dashboard y todos sus datos?")) return;
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
    
    if(document.getElementById('btn-auth-cancel')) document.getElementById('btn-auth-cancel').onclick = () => modal?.classList.remove('active');
    if(document.getElementById('btn-auth-submit')) {
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
    }

    navBtns.forEach(btn => {
        btn.onclick = () => {
            const target = btn.getAttribute('data-target');
            if(!target) return;
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
    tvIdleTimer = setTimeout(enterTVMode, 300000); 
}
function enterTVMode() { 
    const o = document.getElementById('tv-mode-overlay');
    if(o) o.style.display = 'flex'; 
    tvClockInterval = setInterval(() => { const el = document.getElementById('tv-time-display'); if(el) el.textContent = new Date().toLocaleTimeString('es-DO', {hour12:false}); }, 1000);
    startTVSlides(); 
}
function exitTVMode() { 
    const o = document.getElementById('tv-mode-overlay');
    if(o) o.style.display = 'none'; 
    clearInterval(tvClockInterval); clearInterval(tvSlideTimer); 
}
function startTVSlides() { currentTvSlide = 0; updateTVSlideVisibility(); tvSlideTimer = setInterval(() => { currentTvSlide = (currentTvSlide + 1) % 4; updateTVSlideVisibility(); }, 8000); }
function updateTVSlideVisibility() { 
    const titles = ["Ranking Hoy", "Paradas Activas", "Distribución WIP", "Acciones Ingeniería"];
    const tEl = document.getElementById('tv-slide-title'); if(tEl) tEl.textContent = titles[currentTvSlide];
    for(let i=0; i<4; i++){ const el = document.getElementById(`tv-slide-${i}`); if(el) el.style.display = (i === currentTvSlide) ? 'flex' : 'none'; } 
    if (currentTvSlide === 0) renderTVLeaderboard(); 
    else if (currentTvSlide === 1) renderTVParadas();
    else if (currentTvSlide === 2) renderTVWip();
    else if (currentTvSlide === 3) renderTVActions();
}
function renderTVLeaderboard() {
    const d = getLocalDayStr();
    const sts = appTechnicians.map(t => {
        let c = 0; if (productivityData[d]?.[t.id]) Object.values(productivityData[d][t.id]).forEach(is => c += is.length);
        return { name: t.name, count: c };
    }).sort((a,b) => b.count - a.count);
    const el = document.getElementById('tv-leaderboard'); if(el) el.innerHTML = sts.slice(0, 7).map((s, i) => `<div style="display:flex; justify-content:space-between; width:100%; font-size:2rem; color:#fff; background:rgba(255,255,255,0.05); padding:15px 30px; border-radius:15px; border-left:8px solid ${i===0?'#f59e0b':'#8b5cf6'}"><span>${i+1}. ${s.name}</span><strong>${s.count}</strong></div>`).join('');
}
function renderTVParadas() {
    const d = getLocalDayStr(); const act = [];
    Object.keys(downtimeData[d] || {}).forEach(h => Object.values(downtimeData[d][h]).forEach(e => { if(e.status==='Abierta') act.push(e); }));
    const c = document.getElementById('tv-paradas-content'); if(c) c.innerHTML = act.length > 0 ? act.map(p => `<div style="background:rgba(239,68,68,0.1); border:2px solid #ef4444; padding:20px; border-radius:15px; text-align:center;"><div style="color:#ef4444; font-size:1.5rem; font-weight:700;">${p.cause}</div><div style="font-size:2rem; color:#fff;">${p.startTime}</div></div>`).join('') : '<div style="color:#22c55e; font-size:2rem; text-align:center; width:100%;">Sin paradas activas</div>';
}
function renderTVWip() {
    const c = document.getElementById('tv-wip-content'); if(!c) return;
    const assys = Object.keys(wipData).sort((a,b) => Object.values(wipData[b]).reduce((s,v)=>s+v,0) - Object.values(wipData[a]).reduce((s,v)=>s+v,0)).slice(0, 5);
    c.innerHTML = assys.map(a => `<div style="display:flex; justify-content:space-between; width:100%; font-size:2rem; color:#fff; background:rgba(255,255,255,0.05); padding:15px 30px; border-radius:15px;"><span>${a}</span><strong>${Object.values(wipData[a]).reduce((s,v)=>s+v,0)}</strong></div>`).join('');
}
function renderTVActions() {
    const c = document.getElementById('tv-acciones-content'); if(!c) return;
    const act = engineerActions.filter(a => a.status !== 'Cerrado').slice(0, 4);
    c.innerHTML = act.map(a => `<div style="background:rgba(139,92,246,0.1); border:2px solid #8b5cf6; padding:20px; border-radius:15px;"><div style="color:#a78bfa; font-weight:700;">${a.area}</div><div style="font-size:1.5rem; color:#fff;">${a.desc}</div></div>`).join('');
}

// ------------------------------------------
// REGISTRO Y FORMULARIOS
// ------------------------------------------
function initForm() {
    const techSel = document.getElementById('tech-select');
    if(techSel) techSel.onchange = () => { const t = appTechnicians.find(x => x.id === techSel.value); if(t?.pin) showTechPinModal(t, () => document.getElementById('scanner-input')?.focus(), () => techSel.value = ''); };
    
    document.getElementById('registro-form').onsubmit = async (e) => {
        e.preventDefault(); const tid = techSel.value; if(!tid) return;
        const qty = parseInt(document.getElementById('repairs-input').value) || 1;
        const day = getLocalDayStr(); const hour = autoDetectHour().replace(/:/g,'-').replace(/ /g,'_');
        const ref = getDbRef(`productivity/${day}/${tid}/${hour}`);
        const ts = new Date().toLocaleTimeString('es-DO', {hour12:false}).substring(0,5);
        for(let i=0; i<qty; i++) await ref.push({ serial: "Manual", timestamp: ts });
        document.getElementById('repairs-input').value = 1; showToast("¡Registrado!", "success");
    };

    const scanner = document.getElementById('scanner-input');
    if(scanner) scanner.onkeypress = async (e) => {
        if(e.key !== 'Enter') return; e.preventDefault(); const val = scanner.value.trim(); if(!val) return;
        const found = appTechnicians.find(t => t.id === val); if(found) { techSel.value = found.id; scanner.value = ''; return; }
        if(!techSel.value) { alert("Selecciona técnico"); scanner.value = ''; return; }
        const day = getLocalDayStr(); const hour = autoDetectHour().replace(/:/g,'-').replace(/ /g,'_');
        const ts = new Date().toLocaleTimeString('es-DO', {hour12:false}).substring(0,5);
        await getDbRef(`productivity/${day}/${techSel.value}/${hour}`).push({ serial: val, timestamp: ts });
        scanner.value = ''; showToast("Escaneado", "success");
    };

    // Paradas
    document.getElementById('parada-form').onsubmit = async (e) => {
        e.preventDefault();
        const tid = document.getElementById('downtime-tech-select').value;
        if(!tid) return;
        const day = getLocalDayStr(); const hour = autoDetectHour().replace(/:/g,'-').replace(/ /g,'_');
        const data = {
            techId: tid,
            cause: document.getElementById('downtime-cause').value,
            comment: document.getElementById('downtime-comment').value,
            status: document.getElementById('downtime-status').value,
            startTime: document.getElementById('downtime-start').value,
            endTime: document.getElementById('downtime-end').value,
            timestamp: new Date().toLocaleTimeString('es-DO', {hour12:false}).substring(0,5)
        };
        if(window.editDowntimeId) {
            await getDbRef(`downtime/${window.editDowntimeId.day}/${window.editDowntimeId.hourK}/${window.editDowntimeId.pk}`).update(data);
            window.editDowntimeId = null;
        } else {
            await getDbRef(`downtime/${day}/${hour}`).push(data);
        }
        e.target.reset(); showToast("Parada guardada", "success");
    };

    // WIP Excel
    const wipIn = document.getElementById('wip-excel-input');
    if(wipIn) wipIn.onchange = (e) => {
        const file = e.target.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const data = new Uint8Array(ev.target.result); const wb = XLSX.read(data, {type:'array'});
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                const processed = {};
                rows.forEach(row => {
                    const assy = row.AssemblyNumber || row.Assembly || 'Sin Assembly';
                    let cat = (row.WIPCategory || row.Status || 'Otros').toString().trim();
                    if(/diag/i.test(cat)) cat = "To Diag"; else if(/repair/i.test(cat)) cat = "To Repair"; else if(/test/i.test(cat)) cat = "To Test"; else cat = "Otros";
                    if(!processed[assy]) processed[assy] = {}; processed[assy][cat] = (processed[assy][cat] || 0) + 1;
                });
                await getDbRef('wip').set({ counts: processed, updatedAt: new Date().toLocaleString('es-DO') });
                showToast("WIP Actualizado", "success");
            } catch(err) { alert("Error al procesar Excel"); }
        };
        reader.readAsArrayBuffer(file);
    };
}

// ------------------------------------------
// ADMINISTRACIÓN
// ------------------------------------------
function initAdmin() {
    window.renderAdminTable = () => {
        const b = document.getElementById('tech-admin-body'); if(!b) return;
        b.innerHTML = appTechnicians.map(t => `<tr><td>${t.photo?`<img src="${t.photo}" style="width:35px;height:35px;border-radius:50%;object-fit:cover;">`:'-'}</td><td>${t.id}</td><td>${t.name}</td><td>${t.goal}</td><td><button onclick="editTech('${t.id}')">Editar</button><button onclick="deleteTech('${t.id}')">Eliminar</button></td></tr>`).join('');
    };
    window.editTech = (id) => {
        const t = appTechnicians.find(x => x.id === id); if(!t) return;
        document.getElementById('new-tech-id').value = t.id;
        document.getElementById('new-tech-name').value = t.name;
        document.getElementById('new-tech-pin').value = t.pin;
        document.getElementById('new-tech-goal').value = t.goal;
    };
    window.deleteTech = async (id) => { if(confirm("¿Eliminar técnico?")) await getDbRef(`technicians/${id}`).remove(); };
    
    document.getElementById('add-tech-form').onsubmit = async (e) => {
        e.preventDefault();
        const pIn = document.getElementById('new-tech-photo');
        let photo = null;
        if(pIn.files[0]) photo = await new Promise(r => { const rd = new FileReader(); rd.onload = ev => r(ev.target.result); rd.readAsDataURL(pIn.files[0]); });
        const tech = {
            id: document.getElementById('new-tech-id').value,
            name: document.getElementById('new-tech-name').value,
            pin: document.getElementById('new-tech-pin').value,
            goal: document.getElementById('new-tech-goal').value,
            photo: photo || (appTechnicians.find(t=>t.id===document.getElementById('new-tech-id').value)?.photo || null)
        };
        await getDbRef(`technicians/${tech.id}`).set(tech);
        e.target.reset(); showToast("Técnico guardado", "success");
    };
}

// ------------------------------------------
// HISTORIAL Y ACCIONES
// ------------------------------------------
function renderHistorial() {
    const b = document.getElementById('historial-body'); if(!b) return;
    const fT = document.getElementById('hist-tech-filter').value;
    const fS = document.getElementById('hist-date-start').value;
    const fE = document.getElementById('hist-date-end').value;
    const rows = [];
    Object.keys(productivityData).sort().reverse().forEach(day => {
        if(fS && day < fS) return; if(fE && day > fE) return;
        Object.keys(productivityData[day]).forEach(tid => {
            if(fT && tid !== fT) return;
            const t = appTechnicians.find(x => x.id === tid);
            Object.keys(productivityData[day][tid]).forEach(hK => {
                productivityData[day][tid][hK].forEach(e => {
                    rows.push(`<tr><td>${day}</td><td>${t?t.name:tid}</td><td>${e.timestamp}</td><td>${e.serial}</td><td><button onclick="deleteEntry('${day}','${tid}','${hK}','${e.pushKey}')">Borrar</button></td></tr>`);
                });
            });
        });
    });
    b.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;">Sin registros</td></tr>';
}
window.deleteEntry = async (d, tid, h, pk) => { if(confirm("¿Borrar registro?")) await getDbRef(`productivity/${d}/${tid}/${h}/${pk}`).remove(); };

function initActions() {
    document.getElementById('action-form').onsubmit = async (e) => {
        e.preventDefault();
        const data = {
            area: document.getElementById('action-area').value,
            category: document.getElementById('action-category').value,
            desc: document.getElementById('action-desc').value,
            owner: document.getElementById('action-owner').value,
            status: document.getElementById('action-status').value,
            date: new Date().toLocaleDateString('es-DO'),
            timestamp: Date.now()
        };
        if(window.editActionId) {
            await getDbRef(`actions/${window.editActionId}`).update(data);
            window.editActionId = null;
        } else {
            await getDbRef('actions').push(data);
        }
        e.target.reset(); showToast("Acción guardada", "success");
    };
}
window.editAction = (pk) => {
    const a = engineerActions.find(x => x.pushKey === pk); if(!a) return;
    window.editActionId = pk;
    document.getElementById('action-area').value = a.area;
    document.getElementById('action-desc').value = a.desc;
    document.getElementById('action-owner').value = a.owner;
    document.getElementById('action-status').value = a.status;
};

// ------------------------------------------
// RENDERIZADO DE TABLAS Y GRÁFICAS
// ------------------------------------------
function renderDashboard() {
    const b = document.getElementById('dashboard-table-body'); if(!b) return;
    const start = document.getElementById('filter-date-start')?.value || getLocalDayStr();
    const end = document.getElementById('filter-date-end')?.value || getLocalDayStr();
    
    b.innerHTML = appTechnicians.map(t => {
        let rTot = 0;
        const cells = globalHours.map(hour => {
            const safeH = hour.replace(/:/g, '-').replace(/ /g, '_');
            let hourTotal = 0;
            Object.keys(productivityData).forEach(day => { if (day >= start && day <= end) hourTotal += (productivityData[day]?.[t.id]?.[safeH] || []).length; });
            rTot += hourTotal; 
            return `<td class="val-cell ${hourTotal===0?'zero':hourTotal<=5?'heat-low':hourTotal<=10?'heat-med':'heat-high'}">${hourTotal||'-'}</td>`;
        }).join('');
        const g = parseInt(t.goal) || 0; const eff = g > 0 ? Math.round((rTot / g) * 100) : null;
        return `<tr><td style="display:flex; align-items:center; gap:10px;">${t.photo?`<img src="${t.photo}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">`:'-'} ${t.name}</td><td>${g}</td>${cells}<td class="total-col">${rTot}</td><td class="total-col" style="color:${eff>=100?'#22c55e':eff>=70?'#f59e0b':'#ef4444'}">${eff!==null?eff+'%':'N/A'}</td></tr>`;
    }).join('');
}

function renderDowntimeTable() {
    const b = document.getElementById('downtime-table-body'); if(!b) return;
    const day = getLocalDayStr(); const rows = [];
    Object.keys(downtimeData[day] || {}).forEach(h => Object.keys(downtimeData[day][h]).forEach(pk => {
        const e = downtimeData[day][h][pk]; const t = appTechnicians.find(x => x.id === e.techId);
        rows.push(`<tr><td>${e.timestamp}</td><td>${t?t.name:e.techId}</td><td>${e.cause}</td><td>${e.status}</td><td><button onclick="editDowntime('${day}','${h}','${pk}')">Editar</button></td></tr>`);
    }));
    b.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;">Sin paradas</td></tr>';
}
window.editDowntime = (d, h, pk) => {
    const e = downtimeData[d][h][pk]; if(!e) return;
    window.editDowntimeId = { day: d, hourK: h, pk: pk };
    document.getElementById('downtime-tech-select').value = e.techId;
    document.getElementById('downtime-cause').value = e.cause;
    document.getElementById('downtime-status').value = e.status;
    document.getElementById('downtime-start').value = e.startTime;
};

function renderActionsTable() {
    const b = document.getElementById('actions-table-body'); if(!b) return;
    b.innerHTML = engineerActions.map(a => `<tr><td>${a.date}</td><td>${a.area}</td><td>${a.desc}</td><td>${a.owner}</td><td>${a.status}</td><td><button onclick="editAction('${a.pushKey}')">Editar</button></td></tr>`).join('');
}
function renderActionsSummary() {
    const c = document.getElementById('actions-summary-list'); if(!c) return;
    c.innerHTML = engineerActions.filter(a => a.status !== 'Cerrado').slice(0, 5).map(a => `<div class="glass-panel" style="padding:10px; border-left:4px solid #ef4444; margin-bottom:5px;"><strong>${a.area}</strong>: ${a.desc}</div>`).join('');
}

// ------------------------------------------
// GRÁFICAS (Chart.js)
// ------------------------------------------
function renderChart() {
    const c = document.getElementById('productivityChart'); if(!c) return;
    const ds = appTechnicians.map((t, i) => ({ label: t.name, data: globalHours.map(h => { const safeH = h.replace(/:/g,'-').replace(/ /g,'_'); return (productivityData[getLocalDayStr()]?.[t.id]?.[safeH] || []).length; }), backgroundColor: `hsla(${i*60},70%,50%,0.6)` }));
    if(productivityChartInstance) productivityChartInstance.destroy();
    productivityChartInstance = new Chart(c.getContext('2d'), { type:'bar', data: { labels: globalHours.map(h=>h.split(' ')[0]), datasets: ds }, options: { responsive:true, maintainAspectRatio:false } });
}
function renderDowntimeChart() {
    const c = document.getElementById('downtimeChart'); if(!c) return;
    const counts = {}; Object.values(downtimeData[getLocalDayStr()] || {}).forEach(h => Object.values(h).forEach(e => counts[e.cause] = (counts[e.cause] || 0) + 1));
    if(downtimeChartInstance) downtimeChartInstance.destroy();
    downtimeChartInstance = new Chart(c.getContext('2d'), { type:'doughnut', data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: ['#ef4444','#f59e0b','#3b82f6','#10b981'] }] }, options: { responsive:true, maintainAspectRatio:false } });
}
function renderWipChart() {
    const c = document.getElementById('wipChart'); if(!c) return;
    const assys = Object.keys(wipData).slice(0, 5);
    const ds = ["To Diag", "To Repair", "To Test"].map(cat => ({ label: cat, data: assys.map(a => wipData[a][cat] || 0), backgroundColor: cat==='To Diag'?'#3b82f6':cat==='To Repair'?'#f59e0b':'#10b981' }));
    if(wipChartInstance) wipChartInstance.destroy();
    wipChartInstance = new Chart(c.getContext('2d'), { type:'bar', data: { labels: assys, datasets: ds }, options: { responsive:true, maintainAspectRatio:false, scales: { y: { stacked: true } } } });
}
function renderMiniWipChart() {
    const c = document.getElementById('miniWipChart'); if(!c) return;
    const counts = { "To Diag": 0, "To Repair": 0, "To Test": 0 };
    Object.values(wipData).forEach(a => Object.keys(a).forEach(cat => counts[cat] = (counts[cat] || 0) + a[cat]));
    if(miniWipChartInstance) miniWipChartInstance.destroy();
    miniWipChartInstance = new Chart(c.getContext('2d'), { type:'pie', data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: ['#3b82f6','#f59e0b','#10b981'] }] }, options: { responsive:true, maintainAspectRatio:false, plugins: { legend: { display: false } } } });
}

// ------------------------------------------
// UTILIDADES FINALES
// ------------------------------------------
function updateKPIs() {
    const d = getLocalDayStr(); let tot = 0;
    Object.keys(productivityData[d] || {}).forEach(tid => Object.values(productivityData[d][tid]).forEach(is => tot += is.length));
    const el = document.getElementById('total-hoy'); if(el) el.textContent = tot;
}
function autoDetectHour() { const h = new Date().getHours(); return `${h.toString().padStart(2,'0')}:00 - ${(h+1).toString().padStart(2,'0')}:00`; }
function showToast(m, t) { const el = document.getElementById('success-toast'); if(el) { el.style.display = 'flex'; setTimeout(()=>el.style.display='none', 3000); } }
function showTechPinModal(t, ok, cancel) { const p = prompt(`PIN para ${t.name}:`); if(p === t.pin) ok(); else cancel(); }
function populateAllTechSelects() {
    ['tech-select', 'hist-tech-filter', 'downtime-tech-select'].forEach(id => {
        const el = document.getElementById(id); if(!el) return;
        el.innerHTML = '<option value="">Selecciona técnico...</option>';
        appTechnicians.forEach(t => el.innerHTML += `<option value="${t.id}">${t.name}</option>`);
    });
}
function refreshUI() { renderAdminTable(); renderDashboard(); updateKPIs(); }
function updateSyncStatus(o) { const el = document.getElementById('last-sync-time'); if(el) el.innerHTML = o ? `<i class="fa-solid fa-cloud-check" style="color:#22c55e"></i> Online: ${currentSiteId}` : "Offline"; }
function updateTotalGlobal() {}

function updateDate() {
    const el = document.getElementById('current-date');
    if (el) el.textContent = new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const today = getLocalDayStr();
    ['filter-date-start', 'filter-date-end', 'hist-date-start', 'hist-date-end'].forEach(id => { const inp = document.getElementById(id); if(inp) { inp.value = today; inp.onchange = () => { renderDashboard(); updateKPIs(); renderHistorial(); }; } });
    setInterval(() => { const c = document.getElementById('live-clock-display'); if(c) c.textContent = new Date().toLocaleTimeString('es-DO', { hour12: false }); }, 1000);
}

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
    document.getElementById('btn-force-migration')?.addEventListener('click', async () => {
        if (!confirm("¿Recuperar datos antiguos?")) return;
        const nodes = ['technicians', 'productivity', 'downtime', 'actions', 'meta', 'wip'];
        for (const node of nodes) {
            const rootSnap = await window.db.ref(node).once('value');
            if (rootSnap.exists()) await window.db.ref(`sites/dominicana/${node}`).set(rootSnap.val());
        }
        alert("Completado"); location.reload();
    });
    document.getElementById('tv-mode-overlay')?.addEventListener('click', exitTVMode);
    document.getElementById('btn-force-tv')?.addEventListener('click', enterTVMode);
    window.forceTVMode = enterTVMode;
    ['mousemove', 'mousedown', 'keypress', 'touchstart'].forEach(evt => window.addEventListener(evt, resetTVIdleTimer));
    resetTVIdleTimer();
});
