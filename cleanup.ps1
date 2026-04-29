$content = [System.IO.File]::ReadAllText('app.js', [System.Text.Encoding]::UTF8)

# 1. Eliminar currentSiteId, siteName y la funcion getDbRef rota del inicio
$content = $content -replace '(?s)window\.currentSiteId = localStorage.*?function getLocalDayStr', 'function getLocalDayStr'

# 2. Reemplazar todo el bloque setupFirebaseListeners + autoMigrateIfNeeded + startListeners
#    con una version limpia y directa
$oldBlock = '(?s)function setupFirebaseListeners\(\).*?(?=function loadLocalFallback)'

$newBlock = @'
function setupFirebaseListeners() {
    if (!window.db) {
        console.error("Firebase no disponible.");
        loadLocalFallback();
        return;
    }
    console.log("Firebase activo. Escuchando cambios...");
    updateSyncStatus(true);

    window.db.ref('meta').on('value', (snapshot) => {
        shiftGoal = snapshot.val() || 0;
        const goalInput = document.getElementById('shift-goal-input');
        if (goalInput && shiftGoal > 0) goalInput.value = shiftGoal;
        updateKPIs();
    });

    window.db.ref('technicians').on('value', (snapshot) => {
        const data = snapshot.val();
        appTechnicians = data ? Object.values(data) : [];
        localStorage.setItem('jabil_techs_list', JSON.stringify(appTechnicians));
        populateAllTechSelects();
        refreshUI();
    }, (error) => {
        console.error("Error leyendo tecnicos:", error);
        updateSyncStatus(false);
    });

    window.db.ref('productivity').on('value', (snapshot) => {
        const raw = snapshot.val() || {};
        productivityData = {};
        Object.keys(raw).forEach(day => {
            productivityData[day] = {};
            Object.keys(raw[day] || {}).forEach(techId => {
                productivityData[day][techId] = {};
                Object.keys(raw[day][techId] || {}).forEach(rawHourKey => {
                    const hourData = raw[day][techId][rawHourKey];
                    const normalizedKey = rawHourKey.replace(/_-_24-00$/, '_-_00-00');
                    const existing = productivityData[day][techId][normalizedKey] || [];
                    let entries;
                    if (hourData && typeof hourData === 'object' && !Array.isArray(hourData)) {
                        entries = Object.keys(hourData).map(k => ({ ...hourData[k], pushKey: k, originalHourKey: rawHourKey }));
                    } else {
                        entries = Array.isArray(hourData) ? hourData : [];
                    }
                    productivityData[day][techId][normalizedKey] = [...existing, ...entries];
                });
            });
        });
        localStorage.setItem('jabil_proto_data', JSON.stringify(productivityData));
        renderDashboard();
        updateKPIs();
        updateTotalGlobal();
        updateSyncStatus(true);
        if (typeof renderTVLeaderboard === 'function') renderTVLeaderboard();
    }, (error) => {
        console.error("Error leyendo productividad:", error);
        updateSyncStatus(false);
    });

    window.db.ref('downtime').on('value', (snapshot) => {
        downtimeData = snapshot.val() || {};
        if (document.getElementById('grafica-view')?.classList.contains('active')) {
            renderDowntimeChart();
            renderChart();
        }
        if (document.getElementById('paradas-view')?.classList.contains('active')) renderDowntimeTable();
    });

    window.db.ref('wip').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        wipData = data.counts || {};
        const timestamp = data.updatedAt || null;
        localStorage.setItem('jabil_wip_data', JSON.stringify(data));
        const tsEl = document.getElementById('wip-last-update');
        if (tsEl && timestamp) tsEl.textContent = `Actualizado: ${timestamp}`;
        if (document.getElementById('grafica-view')?.classList.contains('active')) renderWipChart();
        if (document.getElementById('actions-view')?.classList.contains('active')) renderMiniWipChart();
    });

    window.db.ref('actions').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        engineerActions = Object.keys(data).map(k => ({ ...data[k], pushKey: k }));
        renderActionsTable();
        renderActionsSummary();
    });
}

'@

$content = $content -replace $oldBlock, $newBlock

# 3. Restaurar showAdminAuthModal a version localStorage
$oldAuth = '(?s)window\.showAdminAuthModal = \(cb\) => \{.*?document\.getElementById\(''btn-auth-submit''\)\.onclick = async \(\) => \{.*?\}\s*\};'
$newAuth = @'
window.showAdminAuthModal = (cb) => {
        authCb = cb;
        passInput.value = '';
        const stored = localStorage.getItem('jabil_admin_password');
        document.getElementById('auth-modal-desc').textContent = stored ? "Ingresa la Clave Maestra." : "Crea una Clave Maestra (minimo 3 caracteres):";
        modal.classList.add('active');
        setTimeout(() => passInput.focus(), 100);
    };

    document.getElementById('btn-auth-cancel').onclick = () => modal.classList.remove('active');
    document.getElementById('btn-auth-submit').onclick = () => {
        const val = passInput.value;
        const stored = localStorage.getItem('jabil_admin_password');
        if (!stored && val.length >= 3) {
            localStorage.setItem('jabil_admin_password', val);
            modal.classList.remove('active');
            if (authCb) authCb();
        } else if (val === stored) {
            modal.classList.remove('active');
            if (authCb) authCb();
        } else {
            alert("Clave incorrecta.");
            passInput.value = '';
        }
    };
'@
$content = $content -replace $oldAuth, $newAuth

# 4. Eliminar bloque de Site Selection al final
$content = $content -replace '(?s)// ={10,}\s*// SITE SELECTION LOGIC.*$', ''

# 5. Eliminar funciones de migracion al final
$content = $content -replace '(?s)// Migrar datos existentes.*$', ''
$content = $content -replace '(?s)// Re-importar datos.*$', ''

[System.IO.File]::WriteAllText('app.js', $content, [System.Text.Encoding]::UTF8)
Write-Host "app.js limpiado correctamente"
