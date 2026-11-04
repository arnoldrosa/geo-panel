let authToken = localStorage.getItem('geopanel_token') || null;
let currentUser = null;
let allVehicles = [];
let allCompanies = [];
let selectedVehicleId = null;
let map = null;
let markersMap = new Map();
let routePolyline = null;
let routeStopMarkers = [];
let refreshInterval = null;

window.addEventListener('DOMContentLoaded', () => {
  setupForms();
  setupMobileAdminForm();

  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const isMobileRequested = params.get('tab') === 'mobile' || hash === '#mobile' || hash === '#downloads';

  if (authToken) {
    verifySession();
  } else if (isMobileRequested) {
    showPublicDownloads();
  }
});

function setupForms() {
  // 1. Login
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    await doLogin(email, password);
  });

  // 2. Configuración Traccar VPS
  document.getElementById('traccar-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('traccar-save-btn');
    const feedback = document.getElementById('traccar-feedback');
    btn.disabled = true;
    btn.textContent = '⏳ Conectando con Traccar en el VPS...';
    feedback.className = 'hidden';

    try {
      const url = document.getElementById('traccar-url').value;
      const email = document.getElementById('traccar-email').value;
      const password = document.getElementById('traccar-password').value;
      const hideDemos = document.getElementById('traccar-hide-demos').checked;

      if (hideDemos) {
        document.getElementById('toggle-demos').checked = false;
      }

      const res = await apiFetch('/api/traccar/config', {
        method: 'POST',
        body: JSON.stringify({ url, email, password, hideDemos })
      });

      feedback.className = 'rounded-xl p-3.5 text-xs bg-emerald-950/70 border border-emerald-700 text-emerald-200';
      feedback.innerHTML = `
        <div class="font-bold text-emerald-300 mb-1">✅ ¡Conexión exitosa con tu servidor Traccar!</div>
        <div>Dispositivos encontrados en Traccar: <strong>${res.totalTraccarDevices}</strong> (Nuevos: ${res.added}, Actualizados: ${res.updated}).</div>
        <div class="mt-2">
          <button type="button" onclick="switchTab('map')" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold">
            🗺️ Ir al Mapa a ver mis dispositivos →
          </button>
        </div>
      `;
      await loadTraccarConfig();
      await loadLiveFleet(true);
    } catch (err) {
      feedback.className = 'rounded-xl p-3.5 text-xs bg-rose-950/70 border border-rose-700 text-rose-200';
      feedback.innerHTML = `<strong>❌ No se pudo autenticar con Traccar:</strong> ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '🔌 Probar Conexión y Sincronizar Dispositivos';
    }
  });

  // 3. Crear Empresa Cliente
  document.getElementById('create-company-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: document.getElementById('new-comp-name').value,
        nit: document.getElementById('new-comp-nit').value,
        phone: document.getElementById('new-comp-phone').value,
        plan: document.getElementById('new-comp-plan').value,
        adminName: document.getElementById('new-comp-admin-name').value,
        adminEmail: document.getElementById('new-comp-admin-email').value,
        adminPassword: document.getElementById('new-comp-admin-pass').value
      };
      await apiFetch('/api/companies', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      e.target.reset();
      document.getElementById('new-comp-admin-pass').value = '123456';
      await loadCompaniesAndAssignments();
      await loadLiveFleet(false);
      showToast('Empresa y usuario cliente creados correctamente', 'success');
    } catch (err) {
      showToast('Error al crear empresa: ' + err.message, 'error');
    }
  });

  // 4. Modal Añadir / Editar Dispositivo (Celular o GPS)
  document.getElementById('device-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('dm-save-btn');
    const fb = document.getElementById('dm-feedback');
    btn.disabled = true;
    btn.textContent = 'GUARDANDO...';
    fb.className = 'hidden';

    try {
      const editId = document.getElementById('dm-id').value;
      const payload = {
        name: document.getElementById('dm-name').value,
        uniqueId: document.getElementById('dm-uniqueid').value,
        companyId: document.getElementById('dm-company').value,
        phone: document.getElementById('dm-phone').value,
        plate: document.getElementById('dm-plate').value,
        driver: document.getElementById('dm-driver').value,
        type: document.getElementById('dm-category').value,
        expirationTime: document.getElementById('dm-expiration').value || null,
        disabled: document.getElementById('dm-disabled').checked
      };

      if (editId) {
        await apiFetch(`/api/vehicles/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/api/vehicles', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      closeDeviceModal();
      await loadCompaniesAndAssignments();
      await loadLiveFleet(true);
    } catch (err) {
      fb.className = 'rounded-xl p-3 text-xs bg-rose-950/80 border border-rose-700 text-rose-200';
      fb.textContent = `❌ ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'GUARDAR';
    }
  });

  // Actualizar QR automáticamente si cambia el Identificador en el modal
  document.getElementById('dm-uniqueid').addEventListener('input', () => {
    const qrBox = document.getElementById('dm-qr-box');
    if (!qrBox.classList.contains('hidden')) {
      renderQrCodeInModal();
    }
  });
}

async function quickLogin(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
  await doLogin(email, password);
}

async function doLogin(email, password) {
  const errBox = document.getElementById('login-error');
  errBox.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    authToken = data.token;
    localStorage.setItem('geopanel_token', authToken);
    currentUser = data.user;
    enterApp();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
}

async function verifySession() {
  try {
    const data = await apiFetch('/api/auth/me');
    currentUser = data.user;
    enterApp();
  } catch (err) {
    logout();
  }
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('geopanel_token');
  if (refreshInterval) clearInterval(refreshInterval);
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

async function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  document.getElementById('header-user-name').textContent = currentUser.name;
  document.getElementById('header-company-name').textContent = currentUser.companyName;

  const badge = document.getElementById('header-role-badge');
  const isSuper = currentUser.role === 'SUPERADMIN';
  const roleLabels = {
    'SUPERADMIN': 'SUPER ADMIN',
    'COMPANY_ADMIN': 'ADMIN EMPRESA',
    'OPERATOR': 'OPERADOR',
    'MOBILE_USER': 'DISPOSITIVO MÓVIL'
  };
  badge.textContent = roleLabels[currentUser.role] || currentUser.role || 'USUARIO';
  badge.className = isSuper
    ? 'text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
    : 'text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30';

  document.getElementById('tab-btn-companies').classList.toggle('hidden', !isSuper);
  document.getElementById('tab-btn-traccar').classList.toggle('hidden', !isSuper);
  document.getElementById('superadmin-company-filter-box').classList.toggle('hidden', !isSuper);

  const publicHeader = document.getElementById('public-download-header');
  if (publicHeader) publicHeader.classList.add('hidden');

  const mobileAdminPanel = document.getElementById('mobile-admin-panel');
  if (mobileAdminPanel) mobileAdminPanel.classList.toggle('hidden', !isSuper);

  // Control granular de acciones de gestión de dispositivos según rol
  const canManage = isSuper || currentUser.role === 'COMPANY_ADMIN';
  const addBtn = document.getElementById('btn-add-device');
  if (addBtn) addBtn.classList.toggle('hidden', !canManage);
  const editBtn = document.getElementById('card-btn-edit');
  if (editBtn) editBtn.classList.toggle('hidden', !canManage);
  const delBtn = document.getElementById('card-btn-delete');
  if (delBtn) delBtn.classList.toggle('hidden', !canManage);

  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'mobile' || window.location.hash === '#mobile') {
    switchTab('mobile');
  } else {
    switchTab('map');
  }
  initMapIfNeeded();

  await loadTraccarConfig();
  await loadCompaniesAndAssignments();
  await loadLiveFleet(true);

  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    loadLiveFleet(false);
  }, 8000);
}

function initMapIfNeeded() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 150);
    return;
  }
  map = L.map('map', {
    zoomControl: false
  }).setView([-17.7833, -63.1821], 13);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap · GEO-PANEL Bolivia'
  });

  const satLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: '© Esri Satélite · GEO-PANEL'
    }
  );

  osmLayer.addTo(map);
  L.control.layers({ '🗺️ Mapa Callejero SCZ': osmLayer, '🛰️ Vista Satelital': satLayer }, null, {
    position: 'bottomright'
  }).addTo(map);
}

function toggleFloatingPanel(show) {
  document.getElementById('floating-devices-panel').classList.toggle('hidden', !show);
  document.getElementById('show-floating-panel-btn').classList.toggle('hidden', show);
}

function switchTab(tabName) {
  const tabs = ['map', 'companies', 'traccar', 'mobile'];
  for (const t of tabs) {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (el) el.classList.toggle('hidden', t !== tabName);
    if (btn) {
      btn.className =
        t === tabName
          ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white transition'
          : 'px-3 py-1 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition';
    }
  }
  if (tabName === 'map' && map) {
    setTimeout(() => map.invalidateSize(), 120);
  }
  if (tabName === 'companies') {
    loadCompaniesAndAssignments();
  }
  if (tabName === 'mobile') {
    loadMobileDownloadCenter();
  }
}

function openTraccarTabIfAdmin() {
  if (currentUser && currentUser.role === 'SUPERADMIN') {
    switchTab('traccar');
  }
}

async function loadTraccarConfig() {
  try {
    const cfg = await apiFetch('/api/traccar/config');
    if (cfg.url) document.getElementById('traccar-url').value = cfg.url;
    if (cfg.email) document.getElementById('traccar-email').value = cfg.email;

    updateTraccarStatusPill(cfg.connected, cfg.lastError);
  } catch (err) {
    console.warn('No se pudo leer config de Traccar:', err.message);
  }
}

function updateTraccarStatusPill(connected, lastError) {
  const pill = document.getElementById('traccar-status-pill');
  const dot = document.getElementById('traccar-status-dot');
  const txt = document.getElementById('traccar-status-text');

  if (connected) {
    pill.className =
      'flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 transition';
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    txt.textContent = 'Traccar VPS: Conectado';
  } else {
    pill.className =
      'flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition';
    dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    txt.textContent = lastError ? 'Traccar: Revisar Credenciales' : 'Conectar Traccar VPS';
  }
}

async function loadLiveFleet(fitMap = false) {
  try {
    const companyFilter = document.getElementById('company-filter-select')?.value || 'ALL';
    const includeDemos = document.getElementById('toggle-demos')?.checked ?? false;
    const data = await apiFetch(
      `/api/fleet/live?companyId=${encodeURIComponent(companyFilter)}&includeDemos=${includeDemos}`
    );

    allVehicles = data.vehicles || [];
    updateTraccarStatusPill(data.traccarConnected, data.lastError);
    renderVehicleList();
    renderMapMarkers(fitMap);

    if (selectedVehicleId) {
      updateDeviceCard(selectedVehicleId);
    }
  } catch (err) {
    console.error('Error cargando flota:', err.message);
  }
}

function onFilterCompanyChange() {
  loadLiveFleet(true);
}

// Formato de tiempo relativo en español igual a Traccar ("hace una hora", "hace 2 días")
function formatRelativeTime(isoStr) {
  if (!isoStr) return 'Sin lecturas';
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return 'Sin lecturas';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (diffSec < 45) return 'hace unos segundos';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return 'hace 1 minuto';
  if (diffMin < 60) return `hace ${diffMin} minutos`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours === 1) return 'hace una hora';
  if (diffHours < 24) return `hace ${diffHours} horas`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'hace 1 día';
  return `hace ${diffDays} días`;
}

function getCategoryEmoji(type) {
  if (type === 'truck') return '🚚';
  if (type === 'van') return '🚐';
  if (type === 'motorcycle') return '🏍️';
  if (type === 'person') return '📱';
  if (type === 'car') return '🚗';
  return '📍';
}

function renderVehicleList() {
  const listEl = document.getElementById('vehicle-list');
  const search = (document.getElementById('vehicle-search')?.value || '').toLowerCase().trim();

  const filtered = allVehicles.filter((v) => {
    if (!search) return true;
    return (
      (v.name || '').toLowerCase().includes(search) ||
      (v.plate || '').toLowerCase().includes(search) ||
      (v.driver || '').toLowerCase().includes(search) ||
      (v.uniqueId || '').toLowerCase().includes(search) ||
      (v.companyName || '').toLowerCase().includes(search)
    );
  });

  const total = filtered.length;
  const online = filtered.filter((v) => (v.traccarStatus || v.lastPosition?.status) === 'online').length;
  const moving = filtered.filter((v) => (v.lastPosition?.speedKmh || 0) > 1).length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-online').textContent = online;
  document.getElementById('stat-moving').textContent = moving;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-8 px-4 text-xs text-slate-400">
        <div class="text-2xl mb-2">📡</div>
        <div class="font-semibold text-slate-300 mb-1">No hay dispositivos en esta vista</div>
        <p class="mb-3">Usa el botón <strong>"+"</strong> arriba para añadir un nuevo celular/GPS o cambia el filtro de empresa.</p>
        <button onclick="openDeviceModal()" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs">
          + Añadir Dispositivo
        </button>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered
    .map((v) => {
      const pos = v.lastPosition || {};
      const isOnline = (v.traccarStatus || pos.status) === 'online';
      const isMoving = isOnline && (pos.speedKmh || 0) > 1;
      const isSelected = v.id === selectedVehicleId;
      const relTime = formatRelativeTime(v.lastUpdate || pos.fixTime);

      const statusTextHtml = isOnline
        ? `<span class="text-emerald-400 font-semibold">En línea</span>`
        : `<span class="text-slate-400">${escapeHtml(relTime)}</span>`;

      // Ícono de batería con colores (verde, naranja, rojo) igual a tu captura
      const bat = pos.batteryLevel;
      let batteryHtml = '';
      if (bat !== null && bat !== undefined) {
        const batColor = bat >= 50 ? 'text-emerald-400' : bat >= 25 ? 'text-amber-400' : 'text-rose-500';
        batteryHtml = `<span class="${batColor} font-bold text-xs flex items-center gap-0.5" title="Batería ${bat}%">🔋 ${bat}%</span>`;
      } else {
        batteryHtml = `<span class="text-slate-400 text-xs flex items-center gap-0.5" title="El celular aún no incluyó nivel de batería en su paquete GPS">🔋 --%</span>`;
      }

      const circleBg = isMoving
        ? 'bg-sky-600 text-white'
        : isOnline
        ? 'bg-emerald-600 text-white'
        : 'bg-slate-700 text-slate-200';

      return `
        <div onclick="selectVehicle('${v.id}')"
          class="px-3.5 py-3 flex items-center justify-between gap-2 transition cursor-pointer ${
            isSelected ? 'bg-emerald-500/15 border-l-4 border-l-emerald-500' : 'hover:bg-slate-800/70'
          }">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-full ${circleBg} flex items-center justify-center text-sm shrink-0 shadow">
              ${getCategoryEmoji(v.type)}
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-bold text-xs text-white truncate">${escapeHtml(v.name)}</span>
                <span class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-xs truncate">
                  ${escapeHtml(v.companyName)}
                </span>
              </div>
              <div class="text-xs flex items-center gap-2 mt-0.5">
                ${statusTextHtml}
                ${isMoving ? `<span class="text-sky-400 font-semibold">· ${pos.speedKmh} km/h</span>` : ''}
                ${v.disabled ? `<span class="text-rose-400 font-semibold">· Deshabilitado</span>` : ''}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            ${batteryHtml}
          </div>
        </div>
      `;
    })
    .join('');
}

function renderMapMarkers(fitMap = false) {
  if (!map) return;

  const activeIds = new Set(allVehicles.map((v) => v.id));
  for (const [id, marker] of markersMap.entries()) {
    if (!activeIds.has(id)) {
      map.removeLayer(marker);
      markersMap.delete(id);
    }
  }

  const bounds = [];

  for (const v of allVehicles) {
    const pos = v.lastPosition;
    if (!pos || typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') continue;

    const latLng = [pos.latitude, pos.longitude];
    bounds.push(latLng);

    const isMoving = (pos.speedKmh || 0) > 1;
    const isOnline = pos.status === 'online';
    const bgColor = isMoving ? '#0284c7' : isOnline ? '#059669' : '#334155';
    const emoji = getCategoryEmoji(v.type);

    const icon = L.divIcon({
      className: '',
      html: `
        <div class="flex flex-col items-center">
          <div class="marker-label mb-1">${escapeHtml(v.name)}</div>
          <div class="vehicle-marker" style="width:34px;height:34px;background:${bgColor};color:#fff;font-size:16px;border:2px solid #fff;">
            ${emoji}
          </div>
        </div>
      `,
      iconSize: [90, 56],
      iconAnchor: [45, 42]
    });

    if (markersMap.has(v.id)) {
      const m = markersMap.get(v.id);
      m.setLatLng(latLng);
      m.setIcon(icon);
    } else {
      const m = L.marker(latLng, { icon })
        .addTo(map)
        .on('click', () => {
          selectVehicle(v.id);
        });
      markersMap.set(v.id, m);
    }
  }

  if (fitMap && bounds.length > 0) {
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 15 });
  }
}

function selectVehicle(vehicleId) {
  selectedVehicleId = vehicleId;
  renderVehicleList();
  updateDeviceCard(vehicleId);

  const v = allVehicles.find((item) => item.id === vehicleId);
  if (v && v.lastPosition && map) {
    map.setView([v.lastPosition.latitude, v.lastPosition.longitude], 16, { animate: true });
  }
}

// Actualiza la tarjeta flotante inferior derecha (igual a la captura de ARNOLD)
function updateDeviceCard(vehicleId) {
  const card = document.getElementById('map-device-card');
  const v = allVehicles.find((item) => item.id === vehicleId);
  if (!v) {
    card.classList.add('hidden');
    return;
  }

  const pos = v.lastPosition || {};
  card.classList.remove('hidden');

  // En pantallas móviles/pequeñas, contraer el panel flotante de lista para evitar superposición
  if (window.innerWidth < 768) {
    toggleFloatingPanel(false);
  }

  document.getElementById('card-device-name').textContent = v.name;
  document.getElementById('card-device-company').textContent = v.companyName || 'Sin empresa';

  const fixDate = pos.fixTime ? new Date(pos.fixTime) : null;
  const formattedDate =
    fixDate && !isNaN(fixDate.getTime())
      ? `${fixDate.toLocaleDateString('es-BO')}, ${fixDate.toLocaleTimeString('es-BO')}`
      : '--';
  document.getElementById('card-device-time').textContent = formattedDate;

  const streetEl = document.getElementById('card-device-street');
  if (pos.streetName) {
    streetEl.textContent = pos.streetName;
    streetEl.className = 'text-slate-200 font-medium text-right';
  } else {
    streetEl.textContent = 'Mostrar calle';
    streetEl.className = 'text-sky-400 font-semibold text-right cursor-pointer underline';
  }

  const speedKmh = (pos.speedKmh || 0).toFixed(2);
  const speedKnots = (pos.speedKnots || 0).toFixed(2);
  document.getElementById('card-device-speed').textContent = `${speedKmh} km/h (${speedKnots} Nudos)`;

  const totalDist = (pos.totalDistanceKm || 0).toFixed(2);
  document.getElementById('card-device-distance').textContent = `${totalDist} Km`;

  const batEl = document.getElementById('card-device-battery');
  if (batEl) {
    if (pos.batteryLevel !== null && pos.batteryLevel !== undefined) {
      batEl.textContent = `🔋 ${pos.batteryLevel}%`;
      batEl.className =
        pos.batteryLevel >= 50
          ? 'font-bold text-emerald-400'
          : pos.batteryLevel >= 25
          ? 'font-bold text-amber-400'
          : 'font-bold text-rose-400';
    } else {
      batEl.textContent = 'No enviado por la App';
      batEl.className = 'font-medium text-slate-400';
    }
  }

  document.getElementById('card-device-uniqueid').textContent = v.phone
    ? `${v.uniqueId} · ${v.phone}`
    : v.uniqueId;
}

function closeDeviceCard() {
  document.getElementById('map-device-card').classList.add('hidden');
}

function centerOnSelected() {
  if (selectedVehicleId) {
    selectVehicle(selectedVehicleId);
  }
}

async function revealStreetAddress() {
  if (!selectedVehicleId) return;
  const v = allVehicles.find((item) => item.id === selectedVehicleId);
  if (!v || !v.lastPosition) return;

  const streetEl = document.getElementById('card-device-street');
  streetEl.textContent = 'Consultando calle...';

  try {
    const res = await apiFetch(
      `/api/geocode?lat=${encodeURIComponent(v.lastPosition.latitude)}&lng=${encodeURIComponent(
        v.lastPosition.longitude
      )}&vehicleId=${encodeURIComponent(v.id)}`
    );
    v.lastPosition.streetName = res.street;
    streetEl.textContent = res.street;
    streetEl.className = 'text-slate-200 font-medium text-right';
  } catch (err) {
    streetEl.textContent = `Lat ${v.lastPosition.latitude.toFixed(4)}, Lng ${v.lastPosition.longitude.toFixed(4)}`;
  }
}

// Abrir modal de Añadir o Editar Dispositivo (con todos los campos de Traccar + QR)
function openDeviceModal(vehicleId = null) {
  const modal = document.getElementById('device-modal');
  const form = document.getElementById('device-modal-form');
  const fb = document.getElementById('dm-feedback');
  const qrBox = document.getElementById('dm-qr-box');

  form.reset();
  fb.className = 'hidden';
  qrBox.classList.add('hidden');

  // Llenar opciones de empresas
  const compSelect = document.getElementById('dm-company');
  compSelect.innerHTML = allCompanies
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');

  if (vehicleId) {
    const v = allVehicles.find((item) => item.id === vehicleId);
    if (v) {
      document.getElementById('device-modal-title').textContent = `✏️ Editar Dispositivo: ${v.name}`;
      document.getElementById('dm-id').value = v.id;
      document.getElementById('dm-name').value = v.name || '';
      document.getElementById('dm-uniqueid').value = v.uniqueId || '';
      if (v.companyId) compSelect.value = v.companyId;
      document.getElementById('dm-phone').value = v.phone || '';
      document.getElementById('dm-plate').value = v.plate || '';
      document.getElementById('dm-driver').value = v.driver || '';
      document.getElementById('dm-category').value = v.type || 'default';
      document.getElementById('dm-expiration').value = v.expirationTime
        ? v.expirationTime.slice(0, 10)
        : '';
      document.getElementById('dm-disabled').checked = !!v.disabled;
    }
  } else {
    document.getElementById('device-modal-title').textContent = '📱 Añadir Nuevo Dispositivo (Celular o GPS)';
    document.getElementById('dm-id').value = '';
    // Por defecto vencimiento en 1 año
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    document.getElementById('dm-expiration').value = nextYear.toISOString().slice(0, 10);
  }

  modal.classList.remove('hidden');
}

function closeDeviceModal() {
  document.getElementById('device-modal').classList.add('hidden');
}

function openQrModalForSelected() {
  if (!selectedVehicleId) return;
  openDeviceModal(selectedVehicleId);
  toggleQrPreviewInModal(true);
}

function toggleQrPreviewInModal(forceShow = null) {
  const qrBox = document.getElementById('dm-qr-box');
  const shouldShow = forceShow !== null ? forceShow : qrBox.classList.contains('hidden');
  qrBox.classList.toggle('hidden', !shouldShow);
  if (shouldShow) {
    renderQrCodeInModal();
  }
}

function renderQrCodeInModal() {
  const uniqueId = document.getElementById('dm-uniqueid').value.trim() || 'SIN-ID';
  document.getElementById('dm-qr-id-text').textContent = uniqueId;
  const qrContainer = document.getElementById('dm-qr-canvas');
  qrContainer.innerHTML = '';

  const qrContent = `http://187.127.33.214:5055/?id=${encodeURIComponent(uniqueId)}`;
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrContainer, {
      text: qrContent,
      width: 140,
      height: 140,
      colorDark: '#0f172a',
      colorLight: '#ffffff'
    });
  } else {
    qrContainer.innerHTML = `<div class="p-3 text-xs text-slate-900 font-bold">${escapeHtml(qrContent)}</div>`;
  }
}

async function deleteSelectedDevice() {
  if (!selectedVehicleId) return;
  const v = allVehicles.find((item) => item.id === selectedVehicleId);
  if (!v) return;

  const confirmDelete = confirm(
    `¿Estás seguro de eliminar el dispositivo "${v.name}" (ID: ${v.uniqueId})?`
  );
  if (!confirmDelete) return;

  try {
    await apiFetch(`/api/vehicles/${v.id}`, { method: 'DELETE' });
    selectedVehicleId = null;
    closeDeviceCard();
    await loadCompaniesAndAssignments();
    await loadLiveFleet(false);
    showToast(`Dispositivo "${v.name}" eliminado correctamente`, 'success');
  } catch (err) {
    showToast('No se pudo eliminar: ' + err.message, 'error');
  }
}

function centerMapOnFleet() {
  renderMapMarkers(true);
}

async function openVehicleHistory(vehicleId) {
  if (!vehicleId) return;
  selectedVehicleId = vehicleId;
  const v = allVehicles.find((item) => item.id === vehicleId);
  if (!v) return;

  document.getElementById('history-panel').classList.remove('hidden');
  document.getElementById('history-vehicle-title').textContent = `${v.name} (${v.uniqueId})`;
  await loadVehicleHistory(6);
}

async function loadVehicleHistory(hours) {
  if (!selectedVehicleId) return;
  try {
    const data = await apiFetch(
      `/api/fleet/history?vehicleId=${encodeURIComponent(selectedVehicleId)}&hours=${hours}`
    );
    clearHistoryRoute(false);

    const pts = data.points || [];
    if (pts.length > 0 && map) {
      const latLngs = pts.map((p) => [p.latitude, p.longitude]);
      routePolyline = L.polyline(latLngs, {
        color: '#38bdf8',
        weight: 4,
        opacity: 0.9,
        dashArray: data.source === 'demo' ? '8, 6' : null
      }).addTo(map);

      pts.forEach((p, idx) => {
        if (p.speedKmh < 1 && idx > 0 && idx < pts.length - 1) {
          const stopMarker = L.circleMarker([p.latitude, p.longitude], {
            radius: 6,
            fillColor: '#f43f5e',
            color: '#fff',
            weight: 2,
            fillOpacity: 1
          })
            .addTo(map)
            .bindPopup(
              `🛑 <strong>Parada registrada</strong><br/>Hora: ${new Date(
                p.fixTime
              ).toLocaleTimeString('es-BO')}`
            );
          routeStopMarkers.push(stopMarker);
        }
      });

      map.fitBounds(routePolyline.getBounds(), { padding: [70, 70] });
    }

    document.getElementById('hist-dist').textContent = `${data.summary.distanceKm} km`;
    document.getElementById('hist-maxspeed').textContent = `${data.summary.maxSpeedKmh} km/h`;
    document.getElementById('hist-stops').textContent = data.summary.stopsCount;
  } catch (err) {
    showToast('Error cargando historial: ' + err.message, 'error');
  }
}

function clearHistoryRoute(hidePanel = true) {
  if (routePolyline && map) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  routeStopMarkers.forEach((m) => map && map.removeLayer(m));
  routeStopMarkers = [];
  if (hidePanel) {
    document.getElementById('history-panel').classList.add('hidden');
  }
}

async function loadCompaniesAndAssignments() {
  try {
    const data = await apiFetch('/api/companies');
    allCompanies = data.companies || [];

    const selectEl = document.getElementById('company-filter-select');
    if (selectEl) {
      const currentVal = selectEl.value;
      selectEl.innerHTML =
        `<option value="ALL">🏢 Todas las empresas (${allCompanies.length})</option>` +
        allCompanies.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      if (currentVal) selectEl.value = currentVal;
    }

    if (currentUser?.role !== 'SUPERADMIN') return;

    const compBody = document.getElementById('companies-table-body');
    const users = data.users || [];
    compBody.innerHTML = allCompanies
      .map((c) => {
        const compUsers = users.filter((u) => u.companyId === c.id);
        return `
          <div class="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/70 space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs text-white">${escapeHtml(c.name)}</span>
              <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                ${c.vehicleCount || 0} dispositivos
              </span>
            </div>
            <div class="text-xs text-slate-400">NIT: ${escapeHtml(c.nit)} · 📞 ${escapeHtml(c.phone || 'S/N')}</div>
            <div class="text-xs text-sky-400">${escapeHtml(c.plan)}</div>
            <div class="text-xs text-slate-400 pt-1 border-t border-slate-700/60">
              👤 Acceso cliente: <strong class="text-slate-200">${compUsers.map((u) => u.email).join(', ') || 'Sin usuario'}</strong>
            </div>
          </div>
        `;
      })
      .join('');

    const assignEl = document.getElementById('vehicles-assign-list');
    const fleetData = await apiFetch('/api/fleet/live?companyId=ALL&includeDemos=false');
    const vehicles = fleetData.vehicles || [];

    assignEl.innerHTML = vehicles
      .map((v) => {
        const options = allCompanies
          .map(
            (c) =>
              `<option value="${c.id}" ${v.companyId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
          )
          .join('');

        return `
          <div class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-xs text-white">${escapeHtml(v.name)}</span>
                <span class="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">ID: ${escapeHtml(v.uniqueId)}</span>
                ${v.isDemo ? '' : '<span class="text-xs px-2 py-0.5 rounded bg-emerald-900 text-emerald-300 font-bold">📡 TRACCAR</span>'}
              </div>
              <div class="text-xs text-slate-400 mt-0.5">
                Teléfono: ${escapeHtml(v.phone || 'S/N')} · Modelo: ${escapeHtml(v.plate || 'S/N')} · Contacto: ${escapeHtml(v.driver || 'S/N')}
              </div>
            </div>
            <div class="flex items-center gap-2">
              <select onchange="assignVehicleCompany('${v.id}', this.value)"
                class="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white">
                ${options}
              </select>
              <button onclick="openDeviceModal('${v.id}')"
                class="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-white">
                ✏️ Editar
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    console.error('Error cargando empresas:', err.message);
  }
}

async function assignVehicleCompany(vehicleId, companyId) {
  try {
    await apiFetch(`/api/vehicles/${vehicleId}`, {
      method: 'PUT',
      body: JSON.stringify({ companyId })
    });
    await loadCompaniesAndAssignments();
    await loadLiveFleet(false);
    showToast('Vehículo asignado a empresa correctamente', 'success');
  } catch (err) {
    showToast('No se pudo asignar el vehículo: ' + err.message, 'error');
  }
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error HTTP ${res.status}`);
  }
  return data;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-950/95 border-emerald-500 text-emerald-200',
    error: 'bg-rose-950/95 border-rose-500 text-rose-200',
    warning: 'bg-amber-950/95 border-amber-500 text-amber-200',
    info: 'bg-slate-900/95 border-sky-500 text-sky-200'
  };
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const colorClass = colors[type] || colors.info;
  const icon = icons[type] || icons.info;

  toast.className = `pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-2xl backdrop-blur text-xs transition-all duration-300 transform translate-y-2 opacity-0 ${colorClass}`;
  toast.innerHTML = `
    <span class="text-base select-none">${icon}</span>
    <div class="flex-1 leading-snug font-medium break-words">${escapeHtml(message)}</div>
    <button type="button" class="text-slate-400 hover:text-white text-sm font-bold leading-none select-none ml-1">&times;</button>
  `;

  const closeBtn = toast.querySelector('button');
  closeBtn.onclick = () => removeToast(toast);

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  const timer = setTimeout(() => {
    removeToast(toast);
  }, duration);

  function removeToast(el) {
    clearTimeout(timer);
    el.classList.add('opacity-0', 'scale-95');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }
}

// ====================================================================
// MÓDULO WEB: APLICACIONES Y DESCARGAS / GEO-PANEL MOBILE (OT-005-A)
// ====================================================================

function showPublicDownloads() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  const publicHeader = document.getElementById('public-download-header');
  if (publicHeader) publicHeader.classList.remove('hidden');

  // Ocultar pestañas operativas y filtros privados para visitantes anónimos
  document.getElementById('tab-btn-map').classList.add('hidden');
  document.getElementById('tab-btn-companies').classList.add('hidden');
  document.getElementById('tab-btn-traccar').classList.add('hidden');
  const superFilter = document.getElementById('superadmin-company-filter-box');
  if (superFilter) superFilter.classList.add('hidden');
  const adminPanel = document.getElementById('mobile-admin-panel');
  if (adminPanel) adminPanel.classList.add('hidden');

  switchTab('mobile');
}

function backToLoginFromDownloads() {
  if (currentUser) {
    switchTab('map');
  } else {
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    const publicHeader = document.getElementById('public-download-header');
    if (publicHeader) publicHeader.classList.add('hidden');
  }
}

async function loadMobileDownloadCenter() {
  // 1. Detección automática del sistema operativo del visitante
  detectClientPlatform();

  // 2. Consulta de versiones públicas vigentes
  try {
    const res = await fetch('/api/v1/mobile/versions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const latest = data.latestVersion;
    const versions = data.versions || [];

    renderLatestReleaseCard(latest);
    renderVersionsChangelog(versions);
  } catch (err) {
    console.warn('Error obteniendo releases:', err.message);
    renderLatestReleaseCard(null);
  }

  // 3. Si el usuario logueado es SuperAdmin, cargar el inventario administrativo
  if (currentUser && currentUser.role === 'SUPERADMIN') {
    await loadAdminMobileReleases();
  }
}

function detectClientPlatform() {
  const ua = (navigator.userAgent || '').toLowerCase();
  const osLabel = document.getElementById('detected-os-label');
  const osTip = document.getElementById('detected-os-tip');
  const btnTitle = document.getElementById('btn-download-title');

  if (/android/i.test(ua)) {
    if (osLabel) osLabel.innerHTML = '<span>🤖</span> <span>Dispositivo Android detectado</span>';
    if (osTip) osTip.textContent = 'Compatible al 100%. Pulsa el botón inferior para descargar e instalar directamente.';
    if (btnTitle) btnTitle.textContent = 'Descargar APK Directo para este Android';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    if (osLabel) osLabel.innerHTML = '<span>🍎</span> <span>Apple iOS detectado</span>';
    if (osTip) osTip.textContent = 'GEO-PANEL Mobile está disponible para Android. Abre este portal desde tu celular Android.';
    if (btnTitle) btnTitle.textContent = 'Descargar APK (Requiere Android 8.0+)';
  } else {
    if (osLabel) osLabel.innerHTML = '<span>💻</span> <span>Computadora de Escritorio</span>';
    if (osTip) osTip.textContent = 'Escanea el código QR con la cámara de tu celular para descargarlo de inmediato.';
    if (btnTitle) btnTitle.textContent = 'Descargar APK en este Equipo';
  }
}

let currentReleaseSha256 = '';

function renderLatestReleaseCard(latest) {
  const badge = document.getElementById('mobile-status-badge');
  const btnDownload = document.getElementById('btn-download-apk');
  const comingSoon = document.getElementById('mobile-coming-soon-banner');
  const qrCanvas = document.getElementById('mobile-download-qr-canvas');
  const qrUrlText = document.getElementById('mobile-qr-url-text');

  if (!latest) {
    // Si todavía no existe un APK firmado y validado en el servidor (Misión 1)
    if (badge) {
      badge.textContent = '🟡 Próximamente';
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40';
    }
    if (btnDownload) btnDownload.classList.add('hidden');
    if (comingSoon) comingSoon.classList.remove('hidden');
    if (qrCanvas) qrCanvas.innerHTML = '<div class="text-[11px] text-slate-500 p-6">Código QR disponible al publicar APK</div>';
    if (qrUrlText) qrUrlText.textContent = 'No hay paquete publicado';
    currentReleaseSha256 = '';
    return;
  }

  if (badge) {
    badge.textContent = '🟢 Versión Oficial Verificada';
    badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  }
  if (btnDownload) btnDownload.classList.remove('hidden');
  if (comingSoon) comingSoon.classList.add('hidden');

  const vNameEl = document.getElementById('mobile-version-name');
  if (vNameEl) vNameEl.textContent = `v${latest.versionName} (Build ${latest.versionCode})`;

  const dateEl = document.getElementById('mobile-release-date');
  if (dateEl) {
    try {
      const d = new Date(latest.releaseDate);
      dateEl.textContent = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (_) {
      dateEl.textContent = latest.releaseDate || 'Reciente';
    }
  }

  const sizeEl = document.getElementById('mobile-file-size');
  if (sizeEl) {
    const mb = (latest.fileSize / (1024 * 1024)).toFixed(1);
    sizeEl.textContent = `~${mb} MB`;
  }

  const minSdkEl = document.getElementById('mobile-min-sdk');
  if (minSdkEl) {
    minSdkEl.textContent = latest.minAndroidVersion || 'Android 8.0+';
  }

  const shaEl = document.getElementById('mobile-sha256-text');
  currentReleaseSha256 = latest.sha256 || '';
  if (shaEl) shaEl.textContent = currentReleaseSha256;

  // Actualizar enlace directo
  const downloadUrl = `${window.location.origin}/api/v1/mobile/download/latest`;
  if (btnDownload) {
    btnDownload.href = downloadUrl;
    btnDownload.setAttribute('download', latest.fileName || `geopanel-v${latest.versionName}.apk`);
  }
  if (qrUrlText) qrUrlText.textContent = downloadUrl;

  // Generar Código QR interactivo
  if (qrCanvas && window.QRCode) {
    qrCanvas.innerHTML = '';
    new QRCode(qrCanvas, {
      text: downloadUrl,
      width: 140,
      height: 140,
      colorDark: '#090d16',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

function copyReleaseSha256() {
  if (!currentReleaseSha256) {
    showToast('No hay hash SHA-256 disponible para copiar', 'warning');
    return;
  }
  navigator.clipboard.writeText(currentReleaseSha256)
    .then(() => {
      const btn = document.getElementById('btn-copy-sha256');
      if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ ¡Copiado!';
        setTimeout(() => { btn.innerHTML = originalText; }, 2500);
      }
      showToast('Checksum SHA-256 copiado al portapapeles', 'success');
    })
    .catch((err) => {
      showToast('Error al copiar al portapapeles: ' + err.message, 'error');
    });
}

function renderVersionsChangelog(versions) {
  const container = document.getElementById('mobile-versions-list');
  if (!container) return;

  if (!versions || versions.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-500 py-3 text-center">No hay versiones registradas aún.</div>';
    return;
  }

  container.innerHTML = versions.map((v) => {
    const mb = (v.fileSize / (1024 * 1024)).toFixed(1);
    let dateStr = v.releaseDate;
    try {
      dateStr = new Date(v.releaseDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {}

    return `
      <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-2 hover:border-slate-700 transition">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-white bg-slate-800 px-2.5 py-1 rounded-lg">v${escapeHtml(v.versionName)}</span>
            <span class="text-[11px] text-slate-400">Build ${v.versionCode}</span>
            <span class="text-[11px] text-slate-500">· ${dateStr}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-[11px] text-slate-400">📦 ${mb} MB</span>
            <span class="text-[11px] text-emerald-400">⬇️ ${v.downloadsCount || 0} descargas</span>
            <a href="/api/v1/mobile/download/${v.versionCode}" download class="text-[11px] font-semibold text-sky-400 hover:text-sky-300">
              Descargar →
            </a>
          </div>
        </div>
        <p class="text-xs text-slate-300 leading-relaxed">${escapeHtml(v.releaseNotes || 'Mejoras de rendimiento y estabilidad.')}</p>
        <div class="text-[10px] text-slate-500 font-mono truncate">
          SHA-256: <span class="text-slate-400 select-all">${v.sha256}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function loadAdminMobileReleases() {
  const tbody = document.getElementById('admin-releases-table-body');
  if (!tbody) return;

  try {
    const res = await apiFetch('/api/v1/admin/mobile/releases');
    const releases = res.releases || [];

    if (releases.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-slate-500">No hay releases registradas en el servidor.</td></tr>';
      return;
    }

    tbody.innerHTML = releases.map((r) => {
      const mb = (r.fileSize / (1024 * 1024)).toFixed(1);
      const isPublished = !!r.isPublished;
      const statusBadge = isPublished
        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Publicado</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">Retirado</span>';

      const actionBtn = isPublished
        ? `<button onclick="toggleReleaseStatus(${r.versionCode}, true)" class="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[10px] font-semibold transition">Retirar</button>`
        : `<button onclick="toggleReleaseStatus(${r.versionCode}, false)" class="px-2.5 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 text-[10px] font-semibold transition">Publicar</button>`;

      return `
        <tr class="hover:bg-slate-900/60 transition">
          <td class="py-2.5 px-3 font-mono text-slate-300 font-bold">${r.versionCode}</td>
          <td class="py-2.5 px-3 font-bold text-white">v${escapeHtml(r.versionName)}</td>
          <td class="py-2.5 px-3 text-slate-400">${mb} MB</td>
          <td class="py-2.5 px-3 font-mono text-[10px] text-slate-500 max-w-[120px] truncate" title="${r.sha256}">${r.sha256 ? r.sha256.substring(0, 12) + '...' : '--'}</td>
          <td class="py-2.5 px-3 text-slate-300 font-semibold">${r.downloadsCount || 0}</td>
          <td class="py-2.5 px-3 text-slate-400 text-[11px]">${escapeHtml(r.publishedBy || 'admin')}</td>
          <td class="py-2.5 px-3">${statusBadge}</td>
          <td class="py-2.5 px-3 text-right space-x-1">
            ${actionBtn}
            <a href="/api/v1/mobile/download/${r.versionCode}" download class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[10px] font-semibold transition inline-block">⬇️</a>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error cargando inventario admin de releases:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-rose-400">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function toggleReleaseStatus(versionCode, currentPublishedState) {
  try {
    const res = await apiFetch(`/api/v1/admin/mobile/releases/${versionCode}/status`, {
      method: 'PUT',
      body: JSON.stringify({ isPublished: !currentPublishedState })
    });
    showToast(res.message || 'Estado actualizado', 'success');
    await loadMobileDownloadCenter();
  } catch (err) {
    showToast('Error al modificar estado: ' + err.message, 'error');
  }
}

function setupMobileAdminForm() {
  const form = document.getElementById('admin-publish-release-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-publish-release');
    const feedback = document.getElementById('admin-release-feedback');
    const fileInput = document.getElementById('admin-apk-file-input');

    if (!fileInput.files || fileInput.files.length === 0) {
      showToast('Selecciona un archivo APK para continuar', 'warning');
      return;
    }

    const file = fileInput.files[0];
    if (!file.name.toLowerCase().endsWith('.apk')) {
      showToast('El archivo debe tener extensión .apk', 'error');
      return;
    }

    if (file.size > 60 * 1024 * 1024) {
      showToast('El archivo supera el límite de 60 MB', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> <span>Validando y procesando APK...</span>';
    feedback.className = 'hidden';

    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          // Quitar encabezado data:application/...;base64,
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('Error leyendo archivo en disco'));
        reader.readAsDataURL(file);
      });

      const payload = {
        versionCode: parseInt(document.getElementById('admin-rel-code').value, 10),
        versionName: document.getElementById('admin-rel-name').value.trim(),
        minSdk: parseInt(document.getElementById('admin-rel-minsdk').value, 10) || 26,
        releaseNotes: document.getElementById('admin-rel-notes').value.trim(),
        isMandatory: document.getElementById('admin-rel-mandatory').checked,
        apkBase64: base64Data
      };

      const res = await apiFetch('/api/v1/admin/mobile/releases', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      feedback.className = 'rounded-xl p-3 text-xs bg-emerald-950/70 border border-emerald-700 text-emerald-200';
      feedback.innerHTML = `<strong>✅ Éxito:</strong> ${escapeHtml(res.message)} · SHA-256: <code>${res.release.sha256.substring(0, 16)}...</code>`;

      form.reset();
      showToast('Versión APK registrada y publicada', 'success');
      await loadMobileDownloadCenter();
    } catch (err) {
      feedback.className = 'rounded-xl p-3 text-xs bg-rose-950/70 border border-rose-700 text-rose-200';
      feedback.innerHTML = `<strong>❌ Error de validación:</strong> ${escapeHtml(err.message)}`;
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>🚀</span> <span>Validar, Firmar Hash y Publicar APK</span>';
    }
  });
}
