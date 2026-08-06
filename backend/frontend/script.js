/* ── Scroll-wheel fix ── */
document.addEventListener('wheel', () => {
  if (document.activeElement && ['number','text'].includes(document.activeElement.type))
    document.activeElement.blur();
}, { passive: true });

/* ── CONFIG ── */
const BASE        = 'https://lightpink-mandrill-900007.hostingersite.com/api';
const API         = `${BASE}/members`;
const TAPI        = `${BASE}/trainers`;
const PROFILE_API = `${BASE}/auth/profile`;

const DEFAULT_PLANS = [
  {name:'1 Month Strength',price:1000,months:1},
  {name:'1 Month Strength + Cardio',price:1500,months:1},
  {name:'3 Months Strength',price:2700,months:3},
  {name:'3 Months Strength + Cardio',price:4000,months:3},
  {name:'6 Months Strength',price:5000,months:6},
  {name:'6 Months Strength + Cardio',price:7500,months:6},
  {name:'1 Year Strength',price:9000,months:12},
  {name:'1 Year Strength + Cardio',price:14000,months:12}
];

/* ── In-memory state ── */
let gymPlans   = [...DEFAULT_PLANS];
let gymDisc    = [];
let gymCfg     = {};

// The name the logged-in gym owner set for their gym — used in WhatsApp
// messages instead of the app's own name ("GymPro").
// The name the logged-in gym owner set for their gym — used in WhatsApp
// messages instead of the app's own name ("GymPro").
function getGymName() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    return (u.gymName && u.gymName.trim()) || (gymCfg && gymCfg.upiName && gymCfg.upiName.trim()) || 'Our Gym';
  } catch (e) { return (gymCfg && gymCfg.upiName) || 'Our Gym'; }
}
let trainerMap = {};

let curPayMember = null;
let curPayMethod = null;
let curPayTotal  = 0;
let curStream    = null;

let allMembersCache = [];
let dashMembersCache = [];

/* ── AUTH HELPERS ── */
const hdrs = () => ({ 
  'Content-Type':'application/json', 
  'Authorization':`Bearer ${localStorage.getItem('token')}` 
});

const checkAuth = () => { 
  if (!localStorage.getItem('token')) { 
    location.href='/login.html'; 
    return false; 
  } 
  return true; 
};

/* ══════════════════════════════════════════════════════════════
   MANAGE GYM  -  switch between gyms an owner has, or add a new one
══════════════════════════════════════════════════════════════ */
async function openManageGymModal() {
  // BUG FIX: every other sidebar nav button routes through showPage(),
  // which closes the sidebar as a side effect. "Manage Gym" instead calls
  // this function directly (it's not a page, it's a modal), so it never
  // closed the sidebar — leaving the sidebar open behind the modal, as
  // seen in the screenshot. Close it explicitly here.
  closeSidebar();

  openModal('manageGymModal');
  const container = document.getElementById('gymListContainer');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:#8AABAB">Loading...</div>';
  try {
    const res = await fetch(`${BASE}/auth/my-gyms`, { headers: hdrs() });
    if (!res.ok) throw new Error('Failed to load gyms');
    const gyms = await res.json();
    renderGymList(gyms);
  } catch (e) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#E74C3C">Failed to load gyms</div>';
  }
}

/* ── Safe escaping for inline JavaScript (onclick attributes) ── */
function jsEsc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function renderGymList(gyms) {
  const container = document.getElementById('gymListContainer');
  
  // Exclude rejected gyms
  const visibleGyms = gyms.filter(g => !(g.isApproved === false && g.pendingApproval === false));

  if (!visibleGyms.length) { container.innerHTML = '<div style="text-align:center;padding:20px;color:#8AABAB">No gyms found</div>'; return; }

  container.innerHTML = visibleGyms.map(g => {
    let statusBadge = '';
    let actionBtn = '';
    let deleteBtn = '';

    if (g.current) {
      statusBadge = `<span style="background:#E8F8EF;color:#27AE60;padding:2px 9px;border-radius:12px;font-size:.65rem;font-weight:800">✓ Active</span>`;
    } else if (g.isApproved) {
      // Use jsEsc to prevent apostrophes from breaking the Switch button
      actionBtn = `<button class="btn btn-sm" style="background:#1A8C8C;color:#fff" onclick="switchGym('${jsEsc(String(g.id))}')">Switch</button>`;
    } else if (g.pendingApproval) {
      statusBadge = `<span style="background:#FEF6E7;color:#F39C12;padding:2px 9px;border-radius:12px;font-size:.65rem;font-weight:800">⏳ Pending Approval</span>`;
    }

    // Add a Delete button ONLY for additional gyms
    if (!g.isPrimary) {
      // Use jsEsc to prevent apostrophes from breaking the Delete button
      deleteBtn = `<button class="btn btn-sm" style="background:#FFF0F0;color:#E74C3C;margin-left:6px" onclick="deleteMyGym('${jsEsc(String(g.id))}', '${jsEsc(g.name)}')">🗑️</button>`;
    }

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:${g.current?'#F0F5F5':'#fff'};border:1.5px solid ${g.current?'#1A8C8C':'#E0ECEC'};border-radius:12px">
        <div style="min-width:0">
          <div style="font-weight:800;font-size:.88rem;color:#1A2E2E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.name)}${g.isPrimary?' <span style="font-size:.6rem;color:#8AABAB;font-weight:600">(Primary)</span>':''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">${statusBadge}${actionBtn}${deleteBtn}</div>
      </div>`;
  }).join('');
}

// Add this function directly underneath renderGymList
async function deleteMyGym(gymId, name) {
  doubleConfirm(`Permanently delete "${name}"?\nAll members, trainers, and attendance data linked to this gym will be LOST.`, async () => {
    try {
      const res = await fetch(`${BASE}/auth/my-gym/${gymId}`, { method: 'DELETE', headers: hdrs() });
      const data = await res.json();
      if (!res.ok) { toast(data.error || 'Failed to delete gym', 'error'); return; }
      toast(data.message || 'Gym deleted successfully', 'success');
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (Number(u.gymId) === Number(gymId)) {
          await switchGym(u.id);
      } else {
          openManageGymModal();
      }
    } catch (e) { toast('Network error', 'error'); }
  });
}

async function switchGym(gymId) {
  try {
    const res = await fetch(`${BASE}/auth/switch-gym`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ gymId: Number(gymId) })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to switch gym', 'error'); return; }

    localStorage.setItem('token', data.token);
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    u.gymName = data.gymName;
    localStorage.setItem('user', JSON.stringify(u));

    toast(data.message || 'Switched gym', 'success');
    closeModal('manageGymModal');
    setTimeout(() => { window.location.href = '/'; }, 600);
  } catch (e) {
    toast('Network error — could not switch gym', 'error');
  }
}

function promptAddGym() {
  const name = prompt('Name of your new gym:');
  if (!name || !name.trim()) return;
  addGym(name.trim());
}

async function addGym(name) {
  try {
    const res = await fetch(`${BASE}/auth/add-gym`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to add gym', 'error'); return; }
    toast(data.message || 'Gym submitted for approval', 'success');
    openManageGymModal(); // refresh list to show the new pending entry
  } catch (e) {
    toast('Network error', 'error');
  }
}

function logout() { 
  localStorage.removeItem('token'); 
  localStorage.removeItem('user'); 
  location.href='/login.html'; 
}

/* ── TOAST ── */
function toast(msg, type='') {
  const el = document.getElementById('toast');
  if (!el) { console.log('Toast:', msg); return; }
  el.textContent = msg; 
  el.className = `toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

/* ── ESCAPE ── */
const esc = s => String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmt = d => {
  if(!d) return '—';
  const p = d.split('T')[0].split('-');
  if(p.length===3) return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-IN');
  return new Date(d).toLocaleDateString('en-IN');
};

function getLocalTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/* ── PLAN HELPERS ── */
const getPlanPrice  = n => (gymPlans.find(p=>p.name===n)||{}).price  || 0;
const getPlanMonths = n => (gymPlans.find(p=>p.name===n)||{}).months || 1;

/* ── AVATAR ── */
const avClr = n => ['#5B4CFF','#0EA669','#E53E3E','#D97706','#0369A1','#7C3AED'][(n.charCodeAt(0)||0)%6];

function av(name) {
  const i = (name||'?').split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
  const bg = avClr(name);
  return `<div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,${bg},${bg}CC);display:inline-flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;color:#fff;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.13)">${esc(i)}</div>`;
}

function avImg(m) {
  if (m.photo?.startsWith('data:image')) return `<img src="${m.photo}" alt="${esc(m.name)}" style="width:52px;height:52px;border-radius:14px;object-fit:cover;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.13)">`;
  return av(m.name);
}

// Larger avatar for dashboard expiring-soon cards
function avImgDash(m) {
  const initials = (m.name||'?').split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
  const bg = avClr(m.name);
  if (m.photo?.startsWith('data:image')) {
    return `<img src="${m.photo}" alt="${esc(m.name)}" style="width:96px;height:96px;border-radius:18px;object-fit:cover;flex-shrink:0;box-shadow:0 4px 16px rgba(0,0,0,.22)">`;
  }
  return `<div style="width:96px;height:96px;border-radius:18px;background:linear-gradient(135deg,${bg},${bg}CC);display:inline-flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;color:#fff;flex-shrink:0;box-shadow:0 4px 16px rgba(0,0,0,.22)">${esc(initials)}</div>`;
}

function badge(status) {
  const m = {Active:'b-active',Trial:'b-trial',Inactive:'b-inactive',Expired:'b-expired'};
  return `<span class="badge ${m[status]||'b-inactive'}">${esc(status)}</span>`;
}

function sortByExpiry(members) {
  return [...members].sort((a,b) => {
    const aA = a.status==='Active'||a.status==='Trial';
    const bA = b.status==='Active'||b.status==='Trial';
    if (aA && !bA) return -1;
    if (!aA && bA) return 1;
    return new Date(a.expiryDate) - new Date(b.expiryDate);
  });
}

/* ── PROFILE SYNC ── */
async function loadServerProfile() {
  try {
    // Use /gym-profile so staff always get the GYM OWNER's settings (UPI, plans, etc.)
    const res = await fetch(`${BASE}/auth/gym-profile`, { headers: hdrs() });
    if (!res.ok) throw new Error('gym-profile failed');
    const data = await res.json();
    
    // --- CAPTURE TRUE GYM NAME FOR STAFF ---
    const realGymName = data.gymName || data.name || (data.gym && data.gym.name);
    if (realGymName) {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      u.gymName = realGymName;
      localStorage.setItem('user', JSON.stringify(u));
      // Force update the banner immediately if it's already rendered
      const bannerEl = document.getElementById('activeGymName');
      if (bannerEl && u.role !== 'superadmin') bannerEl.textContent = realGymName;
    }
    // ---------------------------------------

    if (data.gymData && data.gymData !== '{}') {
      const d = typeof data.gymData === 'string' ? JSON.parse(data.gymData) : data.gymData;
      if (d.plans && d.plans.length) gymPlans = d.plans;
      if (d.cfg)  gymCfg  = d.cfg;
      if (d.disc) gymDisc = d.disc;
    }
    localStorage.setItem('gymProfile_cache', JSON.stringify({ plans: gymPlans, cfg: gymCfg, disc: gymDisc }));
    populatePlanSelect();
    populatePlanSelect('ePlan');
    populatePlanSelect('payPlan');
  } catch(e) {
    const cached = localStorage.getItem('gymProfile_cache');
    if (cached) {
      try {
        const d = JSON.parse(cached);
        if (d.plans && d.plans.length) gymPlans = d.plans;
        if (d.cfg)  gymCfg  = d.cfg;
        if (d.disc) gymDisc = d.disc;
        populatePlanSelect();
        populatePlanSelect('ePlan');
        populatePlanSelect('payPlan');
      } catch(_) {}
    }
  }
}

async function saveServerProfile() {
  const body = { gymData: JSON.stringify({ plans: gymPlans, cfg: gymCfg, disc: gymDisc }) };
  try {
    const res = await fetch(PROFILE_API, { method:'PATCH', headers: hdrs(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('save failed');
    localStorage.setItem('gymProfile_cache', JSON.stringify({ plans: gymPlans, cfg: gymCfg, disc: gymDisc }));
  } catch(e) {
    localStorage.setItem('gymProfile_cache', JSON.stringify({ plans: gymPlans, cfg: gymCfg, disc: gymDisc }));
  }
}

/* ── SIDEBAR & NAV ── */
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if (!sb) return;
  const isOpen = sb.classList.contains('open');
  if (isOpen) {
    sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
  } else {
    sb.classList.add('open');
    if (ov) ov.classList.add('show');
  }
}

function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('show');
}

function updateBNav(id) {
  document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
  if (id !== 'none') {
    const el = document.getElementById(`bn-${id}`);
    if (el) el.classList.add('active');
  }
}

function showPage(page, btn) {
  // Hide all pages (remove active + reset any inline display:none)
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(l => l.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.classList.add('active');
    target.style.display = 'block';
  }
  if (btn) btn.classList.add('active');
  
  const titles = {
    dashboard:'Dashboard',
    members:'Members',
    attendance:'Attendance',
    trainers:'Trainers',
    ptblock:'PT Members',
    superadmin:'Control Panel',
    gymadmin:'Admin Panel',
    plans:'Plans',
    discounts:'Discounts',
    payments:'Payments',
    revenue:'Revenue',
    settings:'Settings'
  };
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titles[page] || page;
  
  closeSidebar();
  
  const loaders = {
    dashboard: loadDashboard,
    members: loadAllMembers,
    attendance: loadAttendance,
    trainers: loadTrainers,
    plans: loadPlans,
    discounts: renderDiscounts,
    payments: loadPayments,
    ptblock: loadPtBlock,
    superadmin: loadSuperAdminData,
    gymadmin: loadGymAdminData,
    revenue: loadRevenuePage,
    settings: loadSettings
  };
  if (loaders[page]) loaders[page]();
}

/* ── MODALS ── */
function _setModalHeight(modalEl) {
  const mbox = modalEl.querySelector('.mbox');
  if (!mbox) return;
  const vh   = window.innerHeight;
  const maxH = Math.floor(vh * 0.91);
  mbox.style.maxHeight = maxH + 'px';
  mbox.style.height    = 'auto';
}

const openModal = id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  _setModalHeight(el);
  if (id === 'addMemberModal') {
    const startInput = document.getElementById('mStart');
    if (startInput) { startInput.value = getLocalTodayStr(); onPlanChange(); }
    const payDate = document.getElementById('mPaymentDate');
    if (payDate) payDate.value = getLocalTodayStr();
  }
  const mbox = el.querySelector('.mbox');
  if (mbox) mbox.scrollTop = 0;
};

const closeModal = id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
};

window.addEventListener('resize', () => {
  document.querySelectorAll('.modal.open').forEach(m => _setModalHeight(m));
});

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal')) {
    closeModal(e.target.id);
    if (e.target.id === 'cameraModal' && curStream) curStream.getTracks().forEach(t => t.stop());
  }
});

/* ── PLAN SELECT ── */
function populatePlanSelect(selId='mPlan') {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = gymPlans.map(p => {
    let discPrice = p.price;
    for(const d of gymDisc){
      if(!d.validUntil || new Date(d.validUntil) >= new Date()){
        if(d.appliesTo === 'all' || d.planName === p.name){
          if(d.type === 'percentage') discPrice -= (p.price * d.value / 100);
          else discPrice -= d.value;
          break;
        }
      }
    }
    discPrice = Math.max(0, Math.round(discPrice));
    const txt = discPrice < p.price ? `₹${discPrice} (Sale!)` : `₹${p.price}`;
    return `<option value="${esc(p.name)}" data-price="${discPrice}" data-months="${p.months}">${esc(p.name)} — ${txt}</option>`;
  }).join('');
  if (cur) sel.value = cur;

  const dp = document.getElementById('discPlan');
  if (dp) dp.innerHTML = gymPlans.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  
  if (selId==='mPlan') recalcPrice();
  if (selId==='ePlan') recalcEditPrice();
}

function togglePT(detailId) {
  const chk = detailId === 'mPtDetails' ? document.getElementById('mPtEnabled') :
              detailId === 'ePtDetails' ? document.getElementById('ePtEnabled') :
              document.getElementById('payPtEnabled');
  const el = document.getElementById(detailId);
  if (el && chk) {
    el.style.display = chk.checked ? 'block' : 'none';
  }
}

function recalcPrice() {
  const sel = document.getElementById('mPlan');
  if (!sel || !sel.options[sel.selectedIndex]) return;
  const orig  = parseInt(sel.options[sel.selectedIndex].getAttribute('data-price')) || 0;
  const dType = document.querySelector('input[name="dType"]:checked')?.value || 'none';
  const raw   = (document.getElementById('dValue')?.value || '').replace(/,/g,'').trim();
  const dVal  = raw==='' ? 0 : (parseFloat(raw)||0);
  let final = orig;
  if (dType==='percentage' && dVal>0) final = Math.round(orig - orig*Math.min(dVal,100)/100);
  else if (dType==='fixed' && dVal>0)  final = Math.max(0, Math.round(orig-dVal));
  const origEl = document.getElementById('origPrice');
  const finalEl = document.getElementById('finalPrice');
  if (origEl) origEl.textContent = `₹${orig.toLocaleString('en-IN')}`;
  if (finalEl) finalEl.textContent = `₹${final.toLocaleString('en-IN')}`;
}

function recalcEditPrice() {
  const sel = document.getElementById('ePlan');
  if (!sel || !sel.options[sel.selectedIndex]) return;
  const orig  = parseInt(sel.options[sel.selectedIndex].getAttribute('data-price')) || 0;
  const dType = document.querySelector('input[name="edType"]:checked')?.value || 'none';
  const raw   = (document.getElementById('edValue')?.value || '').replace(/,/g,'').trim();
  const dVal  = raw==='' ? 0 : (parseFloat(raw)||0);
  let final = orig;
  if (dType==='percentage' && dVal>0) final = Math.round(orig - orig*Math.min(dVal,100)/100);
  else if (dType==='fixed' && dVal>0)  final = Math.max(0, Math.round(orig-dVal));
  const origEl = document.getElementById('eOrigPrice');
  const finalEl = document.getElementById('eFinalPrice');
  if (origEl) origEl.textContent = `₹${orig.toLocaleString('en-IN')}`;
  if (finalEl) finalEl.textContent = `₹${final.toLocaleString('en-IN')}`;
}

function onPlanChange() {
  const sel = document.getElementById('mPlan');
  if (!sel || !sel.options[sel.selectedIndex]) return;
  const months = parseInt(sel.options[sel.selectedIndex].getAttribute('data-months'))||1;

  const startInput = document.getElementById('mStart');
  let sd = new Date();
  if (startInput && startInput.value) {
    const p = startInput.value.split('-');
    sd = new Date(p[0], p[1]-1, p[2]);
  } else if (startInput) {
    startInput.value = getLocalTodayStr();
  }

  sd.setMonth(sd.getMonth() + months);
  const expiryEl = document.getElementById('mExpiry');
  if (expiryEl) {
    expiryEl.value = sd.getFullYear() + '-' + String(sd.getMonth()+1).padStart(2,'0') + '-' + String(sd.getDate()).padStart(2,'0');
  }
  recalcPrice();
}

function addCondition(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  const row = document.createElement('div');
  row.className = 'cond-row';
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center';
  row.innerHTML = `
    <select class="cType" style="flex:1;min-width:120px;background:var(--card);border:1.5px solid var(--border2);border-radius:10px;color:var(--tx);font-family:inherit;font-size:.82rem;padding:8px 10px;min-height:38px">
      <option value="">Condition</option><option>Diabetes</option><option>Asthma</option><option>High Blood Pressure</option><option>Heart Condition</option><option>Knee Injury</option><option>Other</option>
    </select>
    <select class="cSev" style="flex:1;min-width:90px;background:var(--card);border:1.5px solid var(--border2);border-radius:10px;color:var(--tx);font-family:inherit;font-size:.82rem;padding:8px 10px;min-height:38px">
      <option>Mild</option><option>Moderate</option><option>Severe</option>
    </select>
    <input type="text" class="cNote" placeholder="Notes" style="flex:2;min-width:100px;background:var(--card);border:1.5px solid var(--border2);border-radius:10px;color:var(--tx);font-family:inherit;font-size:.82rem;padding:8px 10px;min-height:38px">
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(row);
}

/* ── REVENUE CALCULATION ── */
function getMonthKey(date) {
  const d = new Date(date);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function calculateRevenue(members) {
  const revenue = {
    planTotal: 0,
    admissionTotal: 0,
    ptTotal: 0,
    onlineTotal: 0,
    cashTotal: 0,
    grandTotal: 0,
    months: {}
  };

  const today = new Date();
  const monthKeys = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthKeys.push(key);
    revenue.months[key] = {
      plan: 0, admission: 0, pt: 0, online: 0, cash: 0, total: 0
    };
  }

  members.forEach(m => {
    const history = m.paymentHistory || [];
    history.forEach(p => {
      if (!p.date) return;
      const key = getMonthKey(p.date);
      const amt = p.amount || 0;
      const method = p.method || 'cash';
      
      if (monthKeys.includes(key)) {
        revenue.months[key].total += amt;
        revenue.grandTotal += amt; // always counted toward total, even while still pending/uncleared
        if (method === 'cash') {
          revenue.months[key].cash += amt;
          revenue.cashTotal += amt;
        } else {
          revenue.months[key].online += amt;
          revenue.onlineTotal += amt;
        }
        // 'partial' = a partial payment on a balance that isn't fully
        // cleared yet — counts toward the total above, but NOT toward any
        // specific fee category until the balance is fully paid off (see
        // the due-collection logic, which replaces these with real
        // itemized entries once cleared).
        if (p.type === 'admission') {
          revenue.months[key].admission += amt;
          revenue.admissionTotal += amt;
        } else if (p.type === 'pt') {
          revenue.months[key].pt += amt;
          revenue.ptTotal += amt;
        } else if (p.type !== 'partial') {
          revenue.months[key].plan += amt;
          revenue.planTotal += amt;
        }
      }
    });
  });

  return revenue;
}

/* ── DASHBOARD ── */
/* Sums payments whose date falls on a given day (default: today). Used
   for the "Today's Collection" figures on the Home and Revenue pages. */
function getRevenueForDate(members, dateStr) {
  let total = 0, online = 0, cash = 0;
  members.forEach(m => {
    (m.paymentHistory || []).forEach(p => {
      if (!p.date) return;
      const d = new Date(p.date).toISOString().split('T')[0];
      if (d !== dateStr) return;
      const amt = p.amount || 0;
      total += amt;
      if ((p.method || 'cash') === 'cash') cash += amt; else online += amt;
    });
  });
  return { total, online, cash };
}

/* Sums payments within an inclusive date range (both 'YYYY-MM-DD' strings).
   Used by the Revenue page's From/To filter. */
function getRevenueInRange(members, fromStr, toStr) {
  const out = { total: 0, online: 0, cash: 0, plan: 0, admission: 0, pt: 0, entries: [] };
  members.forEach(m => {
    (m.paymentHistory || []).forEach(p => {
      if (!p.date) return;
      const d = new Date(p.date).toISOString().split('T')[0];
      if (fromStr && d < fromStr) return;
      if (toStr && d > toStr) return;
      const amt = p.amount || 0;
      out.total += amt;
      if ((p.method || 'cash') === 'cash') out.cash += amt; else out.online += amt;
      if (p.type === 'admission') out.admission += amt;
      else if (p.type === 'pt') out.pt += amt;
      else if (p.type !== 'partial') out.plan += amt;
      out.entries.push({ member: m, payment: p });
    });
  });
  return out;
}

function renderRevenueDashboard(revenue) {
  const today = new Date();
  const monthLabels = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthLabels.push(d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }));
  }
  const monthKeys = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthKeys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }

  // Fill the 3 month total boxes
  monthKeys.forEach((key, idx) => {
    const monthData = revenue.months[key] || { total: 0 };
    const labelEl = document.getElementById(`revMonth${idx+1}Label`);
    const amountEl = document.getElementById(`revMonth${idx+1}`);
    if (labelEl) labelEl.textContent = monthLabels[idx] || `Month ${idx+1}`;
    if (amountEl) amountEl.textContent = `₹${monthData.total.toLocaleString('en-IN')}`;
  });

  // Breakdown rows show CURRENT MONTH only (not all-time)
  const curKey = monthKeys[0]; // index 0 = current month
  const cur = revenue.months[curKey] || { plan:0, admission:0, pt:0, online:0, cash:0, total:0 };
  const els = ['revPlanTotal','revAdmissionTotal','revPTTotal','revOnlineTotal','revCashTotal','revGrandTotal'];
  const vals = [
    cur.plan, cur.admission, cur.pt,
    cur.online, cur.cash, cur.total
  ];
  els.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `₹${vals[i].toLocaleString('en-IN')}`;
  });
}

function renderDashTable(membersList) {
  const tbody = document.getElementById('dashBody');
  if (!tbody) return;
  if (!membersList.length) {
    tbody.innerHTML = '<div class="empty"><p>No members found in this timeframe.</p></div>';
    return;
  }
  tbody.innerHTML = membersList.map(m => {
    let expLabel = '\u2014', expColor = '#8AABAB', urgencyBg = '#F0F5F5', urgencyText = '';
    if (m.expiryDate) {
      const p = m.expiryDate.split('T')[0].split('-');
      const exp = new Date(+p[0], +p[1]-1, +p[2]);
      const today = new Date(); today.setHours(0,0,0,0);
      const days = Math.ceil((exp - today) / 86400000);
      expLabel = exp.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
      if (days <= 3) {
        expColor = '#E74C3C'; urgencyBg = '#FEECEB';
        urgencyText = days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `${days}d left`;
      } else if (days <= 7) {
        expColor = '#F39C12'; urgencyBg = '#FEF6E7';
        urgencyText = `${days}d left`;
      } else {
        expColor = '#27AE60'; urgencyBg = '#E8F8EF';
        urgencyText = `${days}d left`;
      }
    }
    const stClr = {Active:'#27AE60',Trial:'#2980B9',Inactive:'#95A5A6',Expired:'#E74C3C'};
    const stBg = {Active:'#E8F8EF',Trial:'#E3F2FD',Inactive:'#F3F4F6',Expired:'#FEECEB'};
    const sc = stClr[m.status] || '#95A5A6';
    const sb = stBg[m.status] || '#F3F4F6';
    const safePhone_d = esc(m.phone||'');
    const safeId_d = esc(m._id);
    const safeName_d = esc(m.name||'');
    const dueAmt = Number(m.pendingAmount) || 0;
    return `<div style="border-radius:16px;overflow:hidden;background:#fff;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);border-left:6px solid ${expColor};${dueAmt > 0 ? 'border-right:6px solid #E91E63;' : ''}">
      <!-- Top info row: full-width, photo + details + expiry -->
      <div style="display:flex;align-items:stretch;gap:0;padding:0">
        <!-- Photo -->
        <div style="padding:12px 10px 0 12px;flex-shrink:0" onclick="openEditMember('${safeId_d}')">
          ${avImgDash(m)}
        </div>
        <!-- Details -->
        <div style="flex:1;min-width:0;padding:10px 10px 8px 0;display:flex;flex-direction:column;justify-content:center;gap:3px" onclick="openEditMember('${safeId_d}')">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px">
            <span style="font-weight:800;font-size:1rem;color:#1A2E2E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeName_d}</span>
            <span style="font-size:.6rem;font-weight:800;color:#fff;background:#1A8C8C;padding:1px 6px;border-radius:7px;white-space:nowrap;flex-shrink:0">ID #${m.memberNo||''}</span>
          </div>
          <div style="font-size:.78rem;color:#4A6464;font-weight:600">📱 +91 ${safePhone_d}</div>
          <div style="font-size:.72rem;color:#8AABAB;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.plan||'')}</div>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px">
            <span style="background:${urgencyBg};color:${expColor};padding:2px 8px;border-radius:14px;font-size:.65rem;font-weight:800;white-space:nowrap">⏰ ${urgencyText || expLabel}</span>
            <span style="font-size:.7rem;font-weight:700;color:#4A6464">${expLabel}</span>
            <span style="background:${sb};color:${sc};padding:2px 8px;border-radius:14px;font-size:.62rem;font-weight:800">${esc(m.status||'')}</span>
            ${dueAmt > 0 ? `<span style="background:#FCE4EC;color:#E91E63;padding:3px 9px;border-radius:14px;font-size:.65rem;font-weight:800;border:1px solid #E91E63">💰 Due ₹${dueAmt.toLocaleString('en-IN')}</span>` : ''}
          </div>
        </div>
      </div>
      <!-- Action bar: 6 buttons full width -->
      <div style="display:grid;grid-template-columns:repeat(6,1fr);border-top:1px solid #F0F5F5">
        <button onclick="dialPhone('${safePhone_d}')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 2px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5">
          <span style="font-size:.95rem">📞</span><span style="font-size:.5rem;font-weight:700;color:#8AABAB">Call</span>
        </button>
        <button onclick="openWhatsApp('${safePhone_d}')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 2px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5">
          <span style="font-size:.95rem">💬</span><span style="font-size:.5rem;font-weight:700;color:#8AABAB">WhatsApp</span>
        </button>
        <button onclick="openPaymentForById('${safeId_d}')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 2px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5">
          <span style="font-size:.95rem">🔄</span><span style="font-size:.5rem;font-weight:700;color:#8AABAB">Renew</span>
        </button>
        <button onclick="sendPaymentReminder('${safeId_d}','${safePhone_d}','${safeName_d}')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 2px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5">
          <span style="font-size:.95rem">💰</span><span style="font-size:.5rem;font-weight:700;color:#8AABAB">Reminder</span>
        </button>
        <button onclick="openEditMember('${safeId_d}')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 2px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5">
          <span style="font-size:.95rem">✏️</span><span style="font-size:.5rem;font-weight:700;color:#8AABAB">Edit</span>
        </button>
        <button onclick="delMember('${safeId_d}','${safeName_d}')" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 2px;border:none;background:#FFF0F0;cursor:pointer">
          <span style="font-size:.95rem">🗑️</span><span style="font-size:.5rem;font-weight:700;color:#E74C3C">Delete</span>
        </button>
      </div>
    </div>`;
  }).join('');
}

function filterDash(days) {
  if (days === 'all') {
    renderDashTable(dashMembersCache.slice(0, 8));
    return;
  }
  const today = new Date();
  today.setHours(0,0,0,0);
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + days);
  targetDate.setHours(23,59,59,999);

  const filtered = dashMembersCache.filter(m => {
    if (m.status !== 'Active' && m.status !== 'Trial') return false;
    const p = m.expiryDate.split('T')[0].split('-');
    const exp = new Date(p[0], p[1]-1, p[2]);
    return exp >= today && exp <= targetDate;
  });
  renderDashTable(filtered);
}

function _fillExtraDashTiles(members) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const parseExp = m => {
    if (!m.expiryDate) return new Date(0);
    const [y, mo, d] = m.expiryDate.split('T')[0].split('-');
    return new Date(+y, +mo - 1, +d);
  };
  const daysLeft = m => Math.ceil((parseExp(m) - today) / 86400000);
  const active = members.filter(m => !m.isDeleted && (m.status === 'Active' || m.status === 'Trial'));

  const el = id => document.getElementById(id);
  if (el('statExpToday')) el('statExpToday').textContent = active.filter(m => daysLeft(m) === 0).length;
  if (el('statExp3')) el('statExp3').textContent = active.filter(m => { const d = daysLeft(m); return d >= 1 && d <= 3; }).length;
  if (el('statExp7')) el('statExp7').textContent = active.filter(m => { const d = daysLeft(m); return d >= 4 && d <= 7; }).length;
  if (el('statExp15')) el('statExp15').textContent = active.filter(m => { const d = daysLeft(m); return d >= 8 && d <= 15; }).length;
  const d = new Date();
  if (el('dashTodayLabel')) el('dashTodayLabel').textContent = `Today — ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

async function loadDashboard() {
  try {
    const res = await fetch(API, {headers:hdrs()});
    if (res.status===401) { logout(); return; }
    const members = await res.json();
    const activeMembers = members.filter(m => !m.isDeleted); // Exclude deleted from lists
    const sorted = sortByExpiry(activeMembers);
    allMembersCache = members; // Retain all (including deleted) for revenue calc

    const totalEl = document.getElementById('statTotal');
    const activeEl = document.getElementById('statActive');
    if (totalEl) totalEl.textContent = activeMembers.length;
    if (activeEl) activeEl.textContent = activeMembers.filter(m=>m.status==='Active').length;

    // NOTE: Passing 'members' (all) so deleted revenue counts
    const revenue = calculateRevenue(members);
    renderRevenueDashboard(revenue);

    const todayStr = getLocalTodayStr();
    const todayRev = getRevenueForDate(members, todayStr);
    const revTodayEl = document.getElementById('revTodayTotal');
    if (revTodayEl) revTodayEl.textContent = `₹${todayRev.total.toLocaleString('en-IN')}`;

    const today = new Date();
    today.setHours(0,0,0,0);
    const in7Days = new Date(today);
    in7Days.setDate(today.getDate() + 7);
    in7Days.setHours(23,59,59,999);

    const due = activeMembers.filter(m => { // Filter activeMembers instead
      if(m.status !== 'Active') return false;
      const p = m.expiryDate.split('T')[0].split('-');
      const exp = new Date(p[0], p[1]-1, p[2]);
      return exp <= in7Days;
    });

    const banner = document.getElementById('alertBanner');
    if (banner) {
      if (!due.length) {
        banner.className = 'banner green';
        banner.innerHTML = '<div class="banner-text"><h3>✅ All Good!</h3><p>No payments due this week</p></div>';
      } else {
        banner.className = 'banner amber';
        banner.innerHTML = `<div class="banner-text"><h3>⚠️ ${due.length} Payment${due.length>1?'s':''} Due</h3><p>Expiring within 7 days</p></div>
          <button class="btn btn-ghost btn-sm" onclick="showPage('payments',document.querySelector('[data-page=payments]'));updateBNav('none')">View →</button>`;
      }
    }

    dashMembersCache = sorted;
    // Default dashboard view: only members expiring within 7 days (or already
    // overdue) — the ones that actually need attention — instead of an
    // arbitrary "first 8" slice. The 3d/5d/7d/All buttons still work as before.
    const todayDT = new Date(); todayDT.setHours(0,0,0,0);
    const sevenDaysOut = new Date(todayDT); sevenDaysOut.setDate(todayDT.getDate() + 7); sevenDaysOut.setHours(23,59,59,999);
    const urgentDefault = sorted.filter(m => {
      if (m.status !== 'Active' && m.status !== 'Trial') return false;
      if (!m.expiryDate) return false;
      const p = m.expiryDate.split('T')[0].split('-');
      const exp = new Date(+p[0], +p[1]-1, +p[2]);
      return exp <= sevenDaysOut; // includes overdue/expired too — most urgent first
    });
    renderDashTable(urgentDefault);
    _fillExtraDashTiles(members);

  } catch(e) { 
    console.error('Dashboard error:', e);
    toast('Error loading dashboard','error'); 
  }
}

/* ── MEMBERS ── */
let _memberStatusFilter = 'all';
let _memberSearchQuery = '';

function _avColor(name) {
  const colors = ['#1A8C8C','#27AE60','#E74C3C','#F39C12','#8E44AD','#2980B9','#D35400','#16A085'];
  return colors[(name||'?').charCodeAt(0) % colors.length];
}

function _memberAvatar(m) {
  if (m.photo && m.photo.startsWith('data:image')) {
    return `<img src="${m.photo}" alt="${esc(m.name)}" style="width:90px;height:90px;border-radius:16px;object-fit:cover;border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.18);flex-shrink:0">`;
  }
  const initials = (m.name||'?').split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
  const bg = _avColor(m.name);
  return `<div style="width:90px;height:90px;border-radius:16px;background:linear-gradient(135deg,${bg},${bg}CC);display:flex;align-items:center;justify-content:center;font-size:1.9rem;font-weight:800;color:#fff;flex-shrink:0;border:3px solid rgba(255,255,255,.4);box-shadow:0 4px 14px rgba(0,0,0,.18)">${esc(initials)}</div>`;
}

function _renderMemberCard(m, idx) {
  let expiryStr = '—';
  if (m.expiryDate) {
    const p = m.expiryDate.split('T')[0].split('-');
    const exp = new Date(+p[0], +p[1]-1, +p[2]);
    expiryStr = exp.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'});
  }

  const stClr = {Active:'#27AE60',Trial:'#2980B9',Inactive:'#95A5A6',Expired:'#E74C3C'};
  const stripColor = stClr[m.status] || '#95A5A6';

  const safeName = esc(m.name);
  const safePhone = esc(m.phone || '—');
  const safePlan = esc(m.plan || '—');
  const safeId = esc(m._id);

  return `
  <div class="member-card-item" style="background:#fff; border-radius:14px; margin-bottom:10px; box-shadow:0 2px 10px rgba(0,0,0,.07), 0 1px 3px rgba(0,0,0,.04); overflow:hidden; border-left:4px solid ${stripColor}; animation:pageIn .2s ${idx*0.04}s both;">
    <div style="display:flex;align-items:stretch;gap:12px;padding:12px 12px 8px;position:relative">
      ${_memberAvatar(m)}
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:0">
            <span style="font-size:.85rem;font-weight:800;color:#1A2E2E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeName}</span>
            ${m.gender ? `<span style="font-size:.6rem;padding:2px 6px;border-radius:8px;font-weight:700;background:${m.gender==='Male'?'#EFF6FF':'#FDF2F8'};color:${m.gender==='Male'?'#2980B9':'#8E44AD'}">${m.gender}</span>` : ''}
          </div>
          <span style="font-size:.65rem;font-weight:800;color:#fff;background:#1A8C8C;padding:2px 8px;border-radius:8px;white-space:nowrap;flex-shrink:0">ID #${m.memberNo || (idx+1)}</span>
        </div>
        <div style="font-size:.78rem;color:#4A6464;margin-bottom:3px">
          <span style="font-weight:600">Mobile: </span>+91 - ${safePhone}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
          <div style="font-size:.75rem;color:#4A6464">
            <span style="font-weight:600">Plan Expiry: </span>
            <span style="font-weight:700;color:#1A2E2E">${expiryStr}</span>
          </div>
          <div style="font-size:.75rem;font-weight:800;color:#27AE60">Paid: ₹${(m.lastPaymentAmount||m.planPrice||0).toLocaleString('en-IN')}</div>
        </div>
        <div style="font-size:.72rem;color:#8AABAB;margin-top:2px">
          <span style="font-weight:600">Payment Date: </span>
          <span style="font-weight:700;color:#4A6464">${m.lastPaymentDate ? new Date(m.lastPaymentDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</span>
        </div>
      </div>
      
    </div>
    <div style="display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:6px 8px;border-top:1px solid #F0F5F5;background:linear-gradient(90deg,#E8F8EF 0%,#fff 70%);gap:0;">
      <button onclick="openEditMember('${safeId}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:54px;padding:5px 8px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5;flex-shrink:0"><span style="font-size:1rem">🪪</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">ID Card</span></button>
      <button onclick="dialPhone('${esc(m.phone)}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:54px;padding:5px 8px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5;flex-shrink:0"><span style="font-size:1rem">📞</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">Call</span></button>
      <button onclick="openWhatsApp('${esc(m.phone)}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:54px;padding:5px 8px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5;flex-shrink:0"><span style="font-size:1rem">💬</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">Whatsapp</span></button>
      <button onclick="openMemberAttendance('${safeId}','${safeName}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:58px;padding:5px 8px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5;flex-shrink:0"><span style="font-size:1rem">📅</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">Attendance</span></button>
      <button onclick="openPaymentFor({id:'${safeId}',name:'${safeName}',plan:'${safePlan}',expiryDate:'${m.expiryDate||''}',planPrice:${m.planPrice||0},ptEnabled:${!!m.ptEnabled},ptFee:${m.ptFee||0},admissionFee:${m.admissionFee||0},admissionWaived:${!!m.admissionWaived}})" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:62px;padding:5px 8px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5;flex-shrink:0"><span style="font-size:1rem">🔄</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">Renew Plan</span></button>
      <button onclick="sendAttendanceReport('${safeId}','${esc(m.phone||'')}','${safeName}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:54px;padding:5px 8px;border:none;background:transparent;cursor:pointer;border-right:1px solid #F0F5F5;flex-shrink:0"><span style="font-size:1rem">📊</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">Attend</span></button>
      <button onclick="sendPaymentReminder('${safeId}','${esc(m.phone||'')}','${safeName}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:54px;padding:5px 8px;border:none;background:transparent;cursor:pointer;flex-shrink:0"><span style="font-size:1rem">💰</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">Reminder</span></button>
      <button onclick="openEditMember('${safeId}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:48px;padding:5px 8px;border:none;background:transparent;cursor:pointer;border-left:1px solid #F0F5F5;flex-shrink:0"><span style="font-size:1rem">✏️</span><span style="font-size:.52rem;font-weight:700;color:#8AABAB">Edit</span></button>
      <button onclick="delMember('${safeId}','${safeName.replace(/'/g,"\\'")}')" style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:48px;padding:5px 8px;border:none;background:#FFF0F0;cursor:pointer;border-left:1px solid #FECDD5;flex-shrink:0"><span style="font-size:1rem">🗑️</span><span style="font-size:.52rem;font-weight:700;color:#E74C3C">Delete</span></button>
    </div>
  </div>`;
}

function _applyMembersFilters() {
  let list = allMembersCache.filter(m => !m.isDeleted);
  if (_memberStatusFilter !== 'all')
    list = list.filter(m => m.status === _memberStatusFilter);
  if (_memberSearchQuery)
    list = list.filter(m =>
      (m.name||'').toLowerCase().includes(_memberSearchQuery) ||
      (m.phone||'').includes(_memberSearchQuery) ||
      String(m.memberNo||'').includes(_memberSearchQuery)
    );
  const wrap = document.getElementById('membersListWrap');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<div class="empty"><div class="ei">😞</div><p>No members found</p></div>';
    return;
  }
  wrap.innerHTML = list.map((m,i) => _renderMemberCard(m, i)).join('');
}

function setMembersFilter(status, btn) {
  _memberStatusFilter = status;
  document.querySelectorAll('.member-filter-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _applyMembersFilters();
}

function searchMembers(q) {
  _memberSearchQuery = (q||'').toLowerCase().trim();
  _applyMembersFilters();
}

async function loadAllMembers() {
  const wrap = document.getElementById('membersListWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>Loading members…</p></div>';
  try {
    const res = await fetch(API, {headers:hdrs()});
    if (res.status===401) { logout(); return; }
    const members = await res.json();
    allMembersCache = sortByExpiry(members);
    _applyMembersFilters();
  } catch(e) {
    wrap.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error loading members</p></div>';
  }
}

async function delMember(id, name) {
  doubleConfirm(`Delete "${name}"? Cannot undo.`, async () => {
    try {
      const res = await fetch(`${API}/${id}`, {method:'DELETE',headers:hdrs()});
      if (res.ok) { toast(`${name} deleted`,'success'); loadAllMembers(); loadDashboard(); loadPayments(); }
      else toast('Error deleting','error');
    } catch(e) { toast('Network error','error'); }
  });
}
/* ── EDIT MEMBER ── */
async function openEditMember(id) {
  try {
    let member;
    try {
      const r = await fetch(`${API}/${id}`, {headers:hdrs()});
      if (r.ok) member = await r.json();
    } catch(_) {}
    if (!member) {
      const all = await fetch(API,{headers:hdrs()}).then(r=>r.json());
      member = all.find(m=>m._id===id);
    }
    if (!member) { toast('Member not found','error'); return; }

    document.getElementById('editMemberId').value = id;
    document.getElementById('eName').value   = member.name   || '';
    document.getElementById('ePhone').value  = member.phone  || '';
    document.getElementById('eEmail').value  = member.email  || '';
    document.getElementById('eAge').value    = member.age    || '';
    document.getElementById('eGender').value = member.gender || '';
    document.getElementById('eStatus').value = member.status || 'Active';

    populatePlanSelect('ePlan');
    document.getElementById('ePlan').value   = member.plan || '';
    recalcEditPrice();

    const dType = member.discountType || 'none';
    document.querySelectorAll('input[name="edType"]').forEach(r => r.checked = r.value===dType);
    document.getElementById('edValue').value  = member.discountValue  || '';
    document.getElementById('edReason').value = member.discountReason || '';
    recalcEditPrice();

    document.getElementById('eExpiry').value = member.expiryDate ? member.expiryDate.split('T')[0] : '';
    document.getElementById('eAdmFee').value  = member.admissionFee || '';
    document.getElementById('eWaive').value   = member.admissionWaived ? 'no' : 'yes';

    const ptEn = !!member.ptEnabled;
    document.getElementById('ePtEnabled').checked = ptEn;
    document.getElementById('ePtDetails').style.display = ptEn ? 'block' : 'none';
    document.getElementById('ePtFee').value  = member.ptFee   || '';
    document.getElementById('ePtNotes').value= member.ptNotes || '';

    const ePtSel = document.getElementById('ePtTrainer');
    ePtSel.innerHTML = '<option value="">Select Trainer</option>' +
      Object.entries(trainerMap).map(([tid,tname]) => `<option value="${esc(tid)}">${esc(tname)}</option>`).join('');
    ePtSel.value = member.ptTrainer || '';

    document.getElementById('eEcName').value = member.emergencyContact?.name || '';
    document.getElementById('eEcPhone').value = member.emergencyContact?.phone || '';
    document.getElementById('eEcRel').value = member.emergencyContact?.relationship || '';
    document.getElementById('eNotes').value = member.medicalNotes || '';

    const ePrev = document.getElementById('ePhotoPreview');
    const ePD = document.getElementById('ePhotoData');
    const eClr = document.getElementById('eClearPhotoBtn');
    if (member.photo && member.photo.startsWith('data:image')) {
      ePrev.src = member.photo;
      ePD.value = member.photo;
      eClr.style.display = 'inline-flex';
    } else {
      ePrev.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%231A8C8C22'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
      ePD.value = '';
      eClr.style.display = 'none';
    }

    renderMemberAttendanceStats(id);
    openModal('editMemberModal');
  } catch(e) { toast('Error loading member','error'); console.error(e); }
}

document.getElementById('editMemberForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('editMemberId').value;
  const phone = document.getElementById('ePhone').value.trim();
  if (!/^\d{10}$/.test(phone)) { toast('Enter valid 10-digit phone','error'); return; }

  const sel = document.getElementById('ePlan');
  const origPrice = parseInt(sel.options[sel.selectedIndex]?.getAttribute('data-price')) || getPlanPrice(sel.value);
  const dType = document.querySelector('input[name="edType"]:checked')?.value || 'none';
  const rawDVal = (document.getElementById('edValue').value||'').replace(/,/g,'').trim();
  const dVal = rawDVal==='' ? 0 : (parseFloat(rawDVal)||0);
  let finalPrice = origPrice;
  if (dType==='percentage' && dVal>0) finalPrice = Math.round(origPrice - origPrice*Math.min(dVal,100)/100);
  else if (dType==='fixed' && dVal>0) finalPrice = Math.max(0, Math.round(origPrice-dVal));

  const admFee = parseFloat(document.getElementById('eAdmFee').value||0) || 0;
  const admWaived = document.getElementById('eWaive').value==='no';
  const ptEnabled = document.getElementById('ePtEnabled').checked;
  const ptFee = parseFloat(document.getElementById('ePtFee').value||0) || 0;

  const data = {
    name: document.getElementById('eName').value.trim(),
    phone,
    email: document.getElementById('eEmail').value.trim(),
    age: document.getElementById('eAge').value !== '' ? parseInt(document.getElementById('eAge').value,10) : null,
    gender: document.getElementById('eGender').value,
    plan: sel.value,
    planPrice: finalPrice,
    discountType: dType,
    discountValue: dVal,
    discountReason: document.getElementById('edReason').value.trim(),
    admissionFee: admFee,
    admissionWaived: admWaived,
    ptEnabled,
    ptFee: ptEnabled ? ptFee : 0,
    ptTrainer: ptEnabled ? document.getElementById('ePtTrainer').value : '',
    ptNotes: ptEnabled ? document.getElementById('ePtNotes').value.trim() : '',
    expiryDate: document.getElementById('eExpiry').value,
    status: document.getElementById('eStatus').value,
    emergencyContact: {
      name: document.getElementById('eEcName').value.trim(),
      phone: document.getElementById('eEcPhone').value.trim(),
      relationship: document.getElementById('eEcRel').value.trim()
    },
    medicalNotes: document.getElementById('eNotes').value.trim(),
    photo: document.getElementById('ePhotoData').value || ''
  };

  const btn = e.submitter; 
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }
  try {
    const res = await fetch(`${API}/${id}`, {method:'PUT', headers:hdrs(), body:JSON.stringify(data)});
    if (res.ok) {
      closeModal('editMemberModal');
      toast(`${data.name} updated!`,'success');
      loadAllMembers(); loadDashboard();
    } else {
      const err = await res.json(); toast(err.error||'Could not update','error');
    }
  } catch(err) { toast('Network error','error'); }
  if (btn) { btn.disabled=false; btn.textContent='Save Changes'; }
});

/* ── ADD MEMBER SUBMIT ── */
document.getElementById('addMemberForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const phone=document.getElementById('mPhone').value.trim();
  if(!/^\d{10}$/.test(phone)){toast('Enter valid 10-digit phone','error');return;}
  const gender=document.getElementById('mGender').value;
  if(!gender){toast('Select gender','error');return;}

  const sel = document.getElementById('mPlan');
  const origPrice = parseInt(sel.options[sel.selectedIndex].getAttribute('data-price'))||0;
  const dType = document.querySelector('input[name="dType"]:checked')?.value||'none';
  const dVal = parseFloat(document.getElementById('dValue').value)||0;
  let finalPrice = origPrice;
  if(dType==='percentage'&&dVal>0) finalPrice=Math.round(origPrice-origPrice*Math.min(dVal,100)/100);
  else if(dType==='fixed'&&dVal>0) finalPrice=Math.max(0,Math.round(origPrice-dVal));

  const ageRaw = document.getElementById('mAge').value.trim();
  const age = ageRaw!=='' ? parseInt(ageRaw,10) : null;
  const admFee = parseFloat(document.getElementById('mAdmFee').value||0) || gymCfg.admissionFee || 0;
  const ptEnabled = document.getElementById('mPtEnabled').checked;
  const ptFee = parseFloat(document.getElementById('mPtFee').value||0) || gymCfg.ptFee || 0;

  const paymentDate = document.getElementById('mPaymentDate').value;
  if (!paymentDate) { toast('Please select a payment date','error'); return; }

  const conditions=[];
  document.querySelectorAll('#condContainer .cond-row').forEach(row=>{
    const cond=row.querySelector('.cType')?.value;
    if(cond) conditions.push({condition:cond,severity:row.querySelector('.cSev')?.value||'Mild',notes:row.querySelector('.cNote')?.value||''});
  });

  const data={
    name: document.getElementById('mName').value.trim(),
    phone, email: document.getElementById('mEmail').value.trim(),
    age, gender,
    photo: document.getElementById('photoData').value||'',
    plan: sel.value,
    planPrice: finalPrice,
    discountType: dType,
    discountValue: dVal,
    discountReason: document.getElementById('dReason').value.trim(),
    admissionFee: admFee,
    admissionWaived: document.getElementById('mWaive').value==='no',
    ptEnabled,
    ptFee: ptEnabled?ptFee:0,
    ptTrainer: ptEnabled?document.getElementById('mPtTrainer').value:'',
    ptNotes: ptEnabled?document.getElementById('mPtNotes').value.trim():'',
    joinDate: document.getElementById('mStart').value,
    expiryDate: document.getElementById('mExpiry').value,
    status: document.getElementById('mStatus').value,
    emergencyContact:{name:document.getElementById('mEcName').value.trim(),phone:document.getElementById('mEcPhone').value.trim(),relationship:document.getElementById('mEcRel').value.trim()},
    healthConditions:conditions,
    medicalNotes: document.getElementById('mNotes').value.trim(),
    paymentDate: paymentDate
  };

  const btn = e.submitter; 
  if (btn) { btn.disabled=true; btn.textContent='Adding…'; }
  try{
    const res=await fetch(API,{method:'POST',headers:hdrs(),body:JSON.stringify(data)});
    if(res.ok){
      const added=await res.json();
      closeModal('addMemberModal');
      e.target.reset();
      document.getElementById('condContainer').innerHTML='';
      document.getElementById('mPtEnabled').checked=false;
      document.getElementById('mPtDetails').style.display='none';
      resetPhoto();
      if(document.getElementById('mStart')) document.getElementById('mStart').value = getLocalTodayStr();
      onPlanChange();
      toast(`${added.name} added!`,'success');
      loadDashboard();
      loadAllMembers();

      // Trial members are added just for identification — no payment expected,
      // so skip forcing the payment modal open for them.
if (data.status === 'Trial') {
        // done — nothing further needed for a trial signup
      } else {
        openPaymentFor({
          id: added._id,
          name: added.name,
          plan: added.plan,
          expiryDate: added.expiryDate,
          planPrice: added.planPrice,
          ptEnabled: added.ptEnabled,
          ptFee: added.ptFee,
          admissionFee: added.admissionFee,
          admissionWaived: added.admissionWaived,
          paymentDate: paymentDate,
          _restoreData: data // Passes the exact submitted form data
        }, true);
      }
    }else{
      const err=await res.json(); toast(err.error||'Could not add member','error');
    }
  }catch(err){toast('Network error','error');}
  if (btn) { btn.disabled=false; btn.textContent='Add Member'; }
});

/* ── PHOTO COMPRESSION ──────────────────────────────────────────
   Every photo captured or uploaded is resized + re-encoded as a small
   JPEG before it's ever stored in photoData/ePhotoData. Target: ~20-24 KB. */
function compressPhotoDataUrl(dataUrl, maxDim = 320, targetBytes = 24000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width, height = img.height;
      if (width > height && width > maxDim) {
        height = Math.round(height * (maxDim / width)); width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round(width * (maxDim / height)); height = maxDim;
      }
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      let quality = 0.7;
      let out = c.toDataURL('image/jpeg', quality);
      let bytes = Math.round(out.length * 0.75);
      let attempts = 0;
      while (bytes > targetBytes && quality > 0.25 && attempts < 6) {
        quality -= 0.1;
        out = c.toDataURL('image/jpeg', quality);
        bytes = Math.round(out.length * 0.75);
        attempts++;
      }
      if (bytes > targetBytes && (width > 160 || height > 160)) {
        const c2 = document.createElement('canvas');
        c2.width = Math.round(width * 0.7);
        c2.height = Math.round(height * 0.7);
        c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height);
        out = c2.toDataURL('image/jpeg', 0.6);
      }
      resolve(out);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ── CAMERA ── */
function setupCamera() {
  const vid = document.getElementById('camVideo'),
        can = document.getElementById('camCanvas'),
        prev = document.getElementById('photoPreview'),
        pd = document.getElementById('photoData'),
        clr = document.getElementById('clearPhotoBtn');

  const openCamBtn = document.getElementById('openCamBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const photoFile = document.getElementById('photoFile');
  const captureBtn = document.getElementById('captureBtn');
  const closeCamBtn = document.getElementById('closeCamBtn');

  if (openCamBtn) {
    openCamBtn.onclick = async () => {
      photoFile.setAttribute('capture', 'environment');
      photoFile.setAttribute('accept', 'image/*');
      const openModalEl = document.querySelector('.modal.open');
      window._presCamModalId = openModalEl ? openModalEl.id : null;
      const isAndroid = /Android/i.test(navigator.userAgent);
      if (isAndroid || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        photoFile.click();
        return;
      }
      try {
        curStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
        vid.srcObject = curStream;
        openModal('cameraModal');
      } catch(e) {
        photoFile.click();
      }
    };
  }

  if (captureBtn) {
    captureBtn.onclick = async () => {
      can.width = vid.videoWidth; can.height = vid.videoHeight;
      can.getContext('2d').drawImage(vid,0,0);
      const raw = can.toDataURL('image/jpeg',.85);
      const d = await compressPhotoDataUrl(raw);
      prev.src = d; pd.value = d; 
      if (clr) clr.style.display = 'inline-flex';
      closeModal('cameraModal');
      if (curStream) curStream.getTracks().forEach(t => t.stop());
    };
  }

  if (closeCamBtn) {
    closeCamBtn.onclick = () => {
      closeModal('cameraModal');
      if (curStream) curStream.getTracks().forEach(t => t.stop());
    };
  }

  if (uploadBtn) {
    uploadBtn.onclick = () => photoFile.click();
  }

  if (photoFile) {
    photoFile.onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      prev.style.opacity = '0.5';
      const r = new FileReader();
      r.onload = async ev => {
        const raw = ev.target.result;
        if (!raw) { prev.style.opacity='1'; return; }
        const result = await compressPhotoDataUrl(raw);
        prev.src = result;
        prev.style.opacity = '1';
        pd.value = result;
        if (clr) clr.style.display = 'inline-flex';
        const modalId = window._presCamModalId ||
          (document.getElementById('editMemberModal') ? 'editMemberModal' : 'addMemberModal');
        const modal = document.getElementById(modalId);
        if (modal && !modal.classList.contains('open')) {
          modal.classList.add('open');
          _setModalHeight(modal);
          const mbox = modal.querySelector('.mbox');
          if (mbox) setTimeout(() => { mbox.scrollTop = 0; }, 50);
        }
        window._presCamModalId = null;
      };
      r.onerror = () => { prev.style.opacity = '1'; toast('Photo error — try Upload', 'error'); };
      r.readAsDataURL(f);
      setTimeout(() => { e.target.value = ''; }, 400);
    };
  }

  if (clr) {
    clr.onclick = resetPhoto;
  }
}

function resetPhoto() {
  const prev = document.getElementById('photoPreview');
  const pd = document.getElementById('photoData');
  const clr = document.getElementById('clearPhotoBtn');
  const file = document.getElementById('photoFile');
  if (prev) prev.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%235B4CFF33'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
  if (pd) pd.value = '';
  if (clr) clr.style.display = 'none';
  if (file) file.value = '';
}

function setupEditPhoto() {
  const ePrev = document.getElementById('ePhotoPreview');
  const ePD = document.getElementById('ePhotoData');
  const eClr = document.getElementById('eClearPhotoBtn');
  const eFile = document.getElementById('ePhotoFile');

  const eUploadBtn = document.getElementById('eUploadBtn');
  const eOpenCamBtn = document.getElementById('eOpenCamBtn');

  if (eUploadBtn) {
    eUploadBtn.onclick = () => eFile.click();
  }

  if (eOpenCamBtn) {
    eOpenCamBtn.onclick = async () => {
      eFile.setAttribute('capture', 'environment');
      eFile.setAttribute('accept', 'image/*');
      const isAndroid = /Android/i.test(navigator.userAgent);
      if (isAndroid || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        eFile.click(); return;
      }
      try {
        curStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
        document.getElementById('camVideo').srcObject = curStream;
        window._editPhotoMode = true;
        openModal('cameraModal');
      } catch(e) { eFile.click(); }
    };
  }

  if (eFile) {
    eFile.onchange = ev => {
      const f = ev.target.files[0];
      if (!f) return;
      ePrev.style.opacity = '0.5';
      const r = new FileReader();
      r.onload = async e2 => {
        const raw = e2.target.result;
        if (!raw) { ePrev.style.opacity='1'; return; }
        const result = await compressPhotoDataUrl(raw);
        ePrev.src = result;
        ePrev.style.opacity = '1';
        ePD.value = result;
        if (eClr) eClr.style.display = 'inline-flex';
        const modal = document.getElementById('editMemberModal');
        if (modal && !modal.classList.contains('open')) {
          modal.classList.add('open'); _setModalHeight(modal);
        }
      };
      r.onerror = () => { ePrev.style.opacity='1'; toast('Photo error','error'); };
      r.readAsDataURL(f);
      setTimeout(() => { ev.target.value=''; }, 400);
    };
  }

  if (eClr) {
    eClr.onclick = () => {
      ePrev.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%231A8C8C22'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
      ePD.value = ''; 
      if (eClr) eClr.style.display = 'none'; 
      eFile.value = '';
    };
  }
}

/* ── ATTENDANCE ── */
const _attCache = {};

function attKey(date) {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return `att_${u._id||u.email||'x'}_${date}`; }
  catch(e) { return `att_${date}`; }
}

let _attFetched = false;
let _attFetchPromise = null;

async function _ensureAttLoaded() {
  if (_attFetched) return;
  if (_attFetchPromise) return _attFetchPromise;
  _attFetchPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/attendance`, { headers: hdrs() });
      if (!res.ok) throw new Error('fetch failed');
      const all = await res.json();
      all.forEach(a => {
        const mid = typeof a.memberId === 'object' ? (a.memberId?._id || '') : (a.memberId || '');
        if (!mid || !a.date) return;
        if (!_attCache[a.date]) _attCache[a.date] = {};
        _attCache[a.date][mid] = a.status;
      });
      Object.keys(_attCache).forEach(d => {
        localStorage.setItem(attKey(d), JSON.stringify(_attCache[d]));
      });
      _attFetched = true;
    } catch(e) {
      console.warn('Offline — loading attendance from localStorage');
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('att_')) {
          const datePart = k.split('_').pop();
          try {
            const obj = JSON.parse(localStorage.getItem(k) || '{}');
            if (datePart && datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
              _attCache[datePart] = obj;
            }
          } catch(_) {}
        }
      }
      _attFetched = true;
    }
    _attFetchPromise = null;
  })();
  return _attFetchPromise;
}

async function loadAttendance() {
  const dateEl = document.getElementById('attDate');
  const date = dateEl?.value || getLocalTodayStr();
  if (dateEl) dateEl.value = date;
  const tbody = document.getElementById('attBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="2"><div class="empty"><div class="ei">⏳</div><p>Loading…</p></div></td></tr>';

  try {
    const [mRes] = await Promise.all([
      fetch(API, { headers: hdrs() }),
      _ensureAttLoaded()
    ]);
    if (mRes.status === 401) { logout(); return; }
    const members = await mRes.json();
   const active = members.filter(m => !m.isDeleted && (m.status === 'Active' || m.status === 'Trial'));
    const todayAtt = _attCache[date] || {};
    const pCount = Object.values(todayAtt).filter(s => s === 'Present').length;
    
    const totalEl = document.getElementById('attTotal');
    const presentEl = document.getElementById('attPresent');
    const pctEl = document.getElementById('attPct');
    if (totalEl) totalEl.textContent = active.length;
    if (presentEl) presentEl.textContent = pCount;
    if (pctEl) pctEl.textContent = active.length ? `${Math.min(100, Math.round(pCount / active.length * 100))}%` : '0%';

    if (!active.length) {
      tbody.innerHTML = '<tr><td colspan="2"><div class="empty"><p>No active members</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = active.map(m => {
      const st = todayAtt[m._id] || 'Absent';
      const isP = st === 'Present';
      return `<tr style="background:${isP ? '#F5FFFB' : '#fff'};border-bottom:1px solid #F0F5F5">
        <td style="padding:10px 6px 10px 12px;vertical-align:middle">
          <div style="display:flex;align-items:center;gap:12px">
            ${avImg(m)}
            <div style="min-width:0">
              <div style="font-weight:800;font-size:.9rem;color:#1A2E2E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}</div>
              <div style="font-size:.72rem;color:#8AABAB;margin-top:1px">${esc(m.phone || '')}</div>
              <div style="font-size:.7rem;color:#4A6464;margin-top:2px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.plan || '')}</div>
            </div>
          </div>
         </td>
        <td style="padding:10px 12px 10px 4px;vertical-align:middle;text-align:right">
          <div id="ab-${m._id}" style="display:inline-block;padding:4px 11px;border-radius:20px;font-size:.72rem;font-weight:800;margin-bottom:6px;background:${isP?'#E8F8EF':'#FEECEB'};color:${isP?'#27AE60':'#E74C3C'}">${st}</div>
          <div style="display:flex;gap:5px;justify-content:flex-end">
            <button onclick="markAtt('${m._id}','${date}','Present')" style="padding:6px 12px;border-radius:20px;border:none;background:#E8F8EF;color:#27AE60;font-family:inherit;font-size:.78rem;font-weight:800;cursor:pointer;min-height:36px;-webkit-tap-highlight-color:transparent">✓ P</button>
            <button onclick="markAtt('${m._id}','${date}','Absent')" style="padding:6px 12px;border-radius:20px;border:none;background:#FEECEB;color:#E74C3C;font-family:inherit;font-size:.78rem;font-weight:800;cursor:pointer;min-height:36px;-webkit-tap-highlight-color:transparent">✗ A</button>
          </div>
         </td>
       </tr>`;
    }).join('');

  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="2"><div class="empty"><p style="color:#E74C3C">Error loading. Check connection.</p></div></td></tr>';
    console.error('loadAttendance error:', e);
  }
}

async function markAtt(memberId, date, status) {
  const badge = document.getElementById(`ab-${memberId}`);
  if (badge) {
    badge.textContent = status;
    badge.style.background = status === 'Present' ? '#E8F8EF' : '#FEECEB';
    badge.style.color = status === 'Present' ? '#27AE60' : '#E74C3C';
    const row = badge.closest('tr');
    if (row) row.style.background = status === 'Present' ? '#F5FFFB' : '#fff';
  }
  if (!_attCache[date]) _attCache[date] = {};
  _attCache[date][memberId] = status;
  localStorage.setItem(attKey(date), JSON.stringify(_attCache[date]));
  
  const activeTotal = parseInt(document.getElementById('attTotal')?.textContent) || 0;
  const present = Object.values(_attCache[date]).filter(s => s === 'Present').length;
  const presentEl = document.getElementById('attPresent');
  const pctEl = document.getElementById('attPct');
  if (presentEl) presentEl.textContent = present;
  if (pctEl) pctEl.textContent = activeTotal ? `${Math.min(100, Math.round(present / activeTotal * 100))}%` : '0%';
  
  try {
    const res = await fetch(`${BASE}/attendance`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ memberId, date, status })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'DB save failed');
    }
  } catch (err) {
    console.error('Attendance DB Error:', err.message);
    toast('⚠️ Saved locally — sync pending', 'error');
  }
}

async function markAllPresent() {
  const dateEl = document.getElementById('attDate');
  const date = dateEl?.value || getLocalTodayStr();
  if (!confirm(`Mark ALL active members Present for ${fmt(date)}?`)) return;
  try {
    const members = await fetch(API, { headers: hdrs() }).then(r => r.json());
    const active = members.filter(m => m.status === 'Active' || m.status === 'Trial');
    for (const m of active) {
      await markAtt(m._id, date, 'Present');
    }
    toast(`✅ ${active.length} members marked Present`, 'success');
    loadAttendance();
  } catch(e) { toast('Error marking attendance', 'error'); }
}

/* ── MEMBER ATTENDANCE VIEW ── */
async function openMemberAttendance(memberId, memberName) {
  const titleEl = document.getElementById('memberAttTitle');
  const subtitleEl = document.getElementById('memberAttSubtitle');
  if (titleEl) titleEl.textContent = '📅 ' + memberName;
  if (subtitleEl) subtitleEl.textContent = 'Attendance Records & Analysis';
  openModal('memberAttModal');

  const calWrap = document.getElementById('memberAttCal');
  const statWrap = document.getElementById('memberAttStat');
  if (calWrap) calWrap.innerHTML = '<div style="text-align:center;padding:20px;color:#8AABAB;font-size:.84rem">⏳ Loading…</div>';
  if (statWrap) statWrap.innerHTML = '';

  await _ensureAttLoaded();

  const records = {};
  Object.keys(_attCache).forEach(date => {
    const dayData = _attCache[date];
    if (dayData && dayData[memberId]) {
      records[date] = dayData[memberId];
    }
  });

  const allDates = Object.keys(records).sort();
  const totalPresent = allDates.filter(d => records[d] === 'Present').length;
  const totalMarked = allDates.length;

  const months = {};
  allDates.forEach(d => {
    const key = d.slice(0,7);
    if (!months[key]) months[key] = [];
    months[key].push(d);
  });

  const today3 = new Date(); today3.setHours(0,0,0,0);
  const threeMonthsAgo = new Date(today3);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const threeMonthsAgoKey = threeMonthsAgo.getFullYear() + '-' + String(threeMonthsAgo.getMonth()+1).padStart(2,'0');

  const monthKeys = Object.keys(months)
    .filter(k => k >= threeMonthsAgoKey)
    .sort().reverse();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().split('T')[0];
  const daysInMonth = (y,m) => new Date(y, m, 0).getDate();

  if (!calWrap) return;
  if (monthKeys.length === 0) {
    calWrap.innerHTML = `
      <div style="text-align:center;padding:28px 16px;background:#F0F5F5;border-radius:16px">
        <div style="font-size:2.5rem;margin-bottom:10px">📅</div>
        <div style="font-size:.92rem;font-weight:800;color:#4A6464">No records yet</div>
        <div style="font-size:.78rem;color:#8AABAB;margin-top:6px">Go to Attendance page → mark this member</div>
      </div>`;
    return;
  }

  const overallPct = totalMarked > 0 ? Math.round(totalPresent/totalMarked*100) : 0;
  calWrap.innerHTML = `
    <div style="background:#1A8C8C;border-radius:16px;padding:16px;margin-bottom:16px;color:#fff;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:.7rem;opacity:.75;text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px">Overall Attendance</div>
        <div style="font-size:1.8rem;font-weight:800;line-height:1">${totalPresent}<span style="font-size:.9rem;opacity:.7"> days</span></div>
        <div style="font-size:.75rem;opacity:.65;margin-top:4px">${monthKeys.length} month${monthKeys.length>1?'s':''} tracked</div>
      </div>
      <div style="text-align:center">
        <div style="width:64px;height:64px;border-radius:50%;border:4px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(255,255,255,.12)">
          <div style="font-size:1.1rem;font-weight:800">${overallPct}%</div>
          <div style="font-size:.55rem;opacity:.7">RATE</div>
        </div>
      </div>
    </div>`;

  let calHTML = calWrap.innerHTML;
  monthKeys.forEach(key => {
    const [y, m] = key.split('-');
    const label = monthNames[parseInt(m)-1] + ' ' + y;
    const total = daysInMonth(parseInt(y), parseInt(m));
    const presentDays = months[key].filter(d => records[d]==='Present').length;
    const absentDays = months[key].filter(d => records[d]==='Absent').length;
    const isCurrent = key === todayStr.slice(0,7);
    const elapsed = isCurrent ? today.getDate() : total;
    const pct = elapsed > 0 ? Math.round(presentDays/elapsed*100) : 0;
    const clr = pct >= 70 ? '#27AE60' : pct >= 40 ? '#F39C12' : '#E74C3C';

    const firstDay = new Date(parseInt(y), parseInt(m)-1, 1).getDay();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    let cells = '';
    ['M','T','W','T','F','S','S'].forEach(d => {
      cells += `<div style="font-size:.58rem;font-weight:800;color:#8AABAB;text-align:center;padding:2px 0">${d}</div>`;
    });
    for (let i = 0; i < startOffset; i++) cells += '<div></div>';
    for (let day = 1; day <= total; day++) {
      const dStr = y+'-'+m+'-'+String(day).padStart(2,'0');
      const st = records[dStr];
      let bg = '#F0F5F5', clrD = '#C0C0C0';
      if (st === 'Present') { bg = '#D4EDDA'; clrD = '#27AE60'; }
      else if (st === 'Absent') { bg = '#FEECEB'; clrD = '#E74C3C'; }
      const isToday = dStr === todayStr;
      cells += `<div style="aspect-ratio:1;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:${isToday?'800':'600'};color:${clrD};border:${isToday?'2px solid #1A8C8C':'1px solid transparent'};cursor:default">${day}</div>`;
    }

    calHTML += `
      <div style="background:#fff;border:1px solid #E0ECEC;border-radius:16px;padding:14px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div>
            <span style="font-size:.9rem;font-weight:800;color:#1A2E2E">${label}</span>
            ${isCurrent?'<span style="font-size:.65rem;background:#1A8C8C;color:#fff;padding:2px 7px;border-radius:10px;margin-left:6px">Current</span>':''}
          </div>
          <span style="font-size:.82rem;font-weight:800;color:${clr}">${pct}%</span>
        </div>
        <div style="height:6px;background:#E0ECEC;border-radius:10px;overflow:hidden;margin-bottom:10px">
          <div style="height:100%;width:${pct}%;background:${clr};border-radius:10px;transition:width .5s ease"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:10px">${cells}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span style="font-size:.7rem;font-weight:700;color:#27AE60;background:#E8F8EF;padding:3px 10px;border-radius:20px">✓ ${presentDays} Present</span>
          <span style="font-size:.7rem;font-weight:700;color:#E74C3C;background:#FEECEB;padding:3px 10px;border-radius:20px">✗ ${absentDays} Absent</span>
          <span style="font-size:.7rem;font-weight:700;color:#8AABAB;background:#F0F5F5;padding:3px 10px;border-radius:20px">○ ${total-presentDays-absentDays} Unmarked</span>
        </div>
      </div>`;
  });

  calWrap.innerHTML = calHTML;
}

async function renderMemberAttendanceStats(memberId) {
  const container = document.getElementById('eAttStats');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:16px;color:#8AABAB;font-size:.84rem;font-weight:600">⏳ Loading attendance data…</div>';

  try {
    await _ensureAttLoaded();
    const monthlyStats = {};
    let totalPresent = 0;

    Object.keys(_attCache).forEach(date => {
      const dayData = _attCache[date];
      if (!dayData) return;
      const status = dayData[memberId];
      if (status === 'Present') {
        const [y, m] = date.split('-');
        const key = `${y}-${m}`;
        monthlyStats[key] = (monthlyStats[key] || 0) + 1;
        totalPresent++;
      }
    });

    const today = new Date();
    const curY = today.getFullYear();
    const curM = String(today.getMonth() + 1).padStart(2, '0');
    const curKey = `${curY}-${curM}`;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
    const keys = Object.keys(monthlyStats).sort().reverse();

    if (keys.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:20px;background:#F0F5F5;border-radius:14px">
          <div style="font-size:2rem;margin-bottom:8px">📅</div>
          <div style="font-size:.85rem;font-weight:700;color:#8AABAB">No attendance records yet</div>
          <div style="font-size:.75rem;color:#8AABAB;margin-top:4px">Mark them present in the Attendance page to track performance</div>
        </div>`;
      return;
    }

    let html = `
      <div style="background:#1A8C8C;border-radius:14px;padding:14px 16px;margin-bottom:12px;color:#fff">
        <div style="font-size:.72rem;font-weight:700;opacity:.75;text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px">Total Attendance</div>
        <div style="font-size:1.6rem;font-weight:800;line-height:1">${totalPresent} <span style="font-size:.85rem;opacity:.75">days present</span></div>
        <div style="font-size:.75rem;opacity:.65;margin-top:4px">Across ${keys.length} month${keys.length>1?'s':''}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">`;

    keys.forEach(key => {
      const [y, m] = key.split('-');
      const label = `${monthNames[parseInt(m)-1]} ${y}`;
      const present = monthlyStats[key];
      const isCurrent = key === curKey;
      if (isCurrent) {
        const daysInCur = today.getDate();
        const pct = daysInCur > 0 ? Math.round(present / daysInCur * 100) : 0;
        const clr = pct >= 70 ? '#27AE60' : pct >= 40 ? '#F39C12' : '#E74C3C';
        html += `
          <div style="background:#E8F7F7;border:1.5px solid #C8DEDE;border-radius:14px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:.85rem;font-weight:800;color:#1A8C8C">${label} <span style="font-size:.7rem;background:#1A8C8C;color:#fff;padding:2px 8px;border-radius:12px;margin-left:4px">Current</span></span>
              <span style="font-size:.82rem;font-weight:800;color:${clr}">${pct}%</span>
            </div>
            <div style="height:8px;background:#C8DEDE;border-radius:10px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${clr};border-radius:10px;transition:width .5s ease"></div>
            </div>
            <div style="font-size:.7rem;color:#4A6464;margin-top:6px;display:flex;justify-content:space-between">
              <span>${present} days present (of ${daysInCur} elapsed)</span>
              <span style="font-weight:700;color:${clr}">${pct>=70?'🟢 Great':pct>=40?'🟡 Average':'🔴 Needs Work'}</span>
            </div>
          </div>`;
      } else {
        const total = daysInMonth(parseInt(y), parseInt(m));
        const pct = Math.round(present / total * 100);
        const clr = pct >= 70 ? '#27AE60' : pct >= 40 ? '#F39C12' : '#E74C3C';
        html += `
          <div style="background:#F0F5F5;border:1px solid #E0ECEC;border-radius:14px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:.82rem;font-weight:700;color:#4A6464">${label}</span>
              <span style="font-size:.82rem;font-weight:800;color:${clr}">${pct}%</span>
            </div>
            <div style="height:7px;background:#E0ECEC;border-radius:10px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${clr};border-radius:10px;transition:width .5s ease"></div>
            </div>
            <div style="font-size:.68rem;color:#8AABAB;margin-top:5px;display:flex;justify-content:space-between">
              <span>${present} of ${total} days</span>
              <span style="font-weight:700;color:${clr}">${pct>=70?'🟢 Great':pct>=40?'🟡 Average':'🔴 Needs Work'}</span>
            </div>
          </div>`;
      }
    });

    html += '</div>';
    container.innerHTML = html;

  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:#E74C3C;font-size:.84rem;font-weight:600">Failed to load stats. Check connection.</div>';
    console.error('renderMemberAttendanceStats error:', e);
  }
}

/* ── TRAINERS ── */
async function loadTrainers() {
  const wrap = document.getElementById('trainersListWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>Loading trainers…</p></div>';
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(TAPI, {headers:hdrs(), signal: controller.signal});
    clearTimeout(tid);
    if (res.status===401) { logout(); return; }
    const trainers = await res.json();
    trainerMap = {};
    trainers.forEach(t => { trainerMap[t._id] = t.name; });
    const opts = '<option value="">Select Trainer</option>' +
      trainers.filter(t=>t.status==='Active')
        .map(t=>`<option value="${esc(t._id)}">${esc(t.name)} — ${esc(t.specialty)}</option>`).join('');
    ['mPtTrainer','ePtTrainer','payPtTrainer'].forEach(id => {
      const el = document.getElementById(id); if (el) el.innerHTML = opts;
    });
    if (!trainers.length) {
      wrap.innerHTML = '<div class="empty"><div class="ei">💪</div><p>No trainers yet. Add your first trainer!</p></div>';
      return;
    }
    wrap.innerHTML = trainers.map((t, idx) => {
      const initials = (t.name||'?').split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
      const bg = ['#1A8C8C','#27AE60','#E74C3C','#F39C12','#8E44AD','#2980B9'][(t.name||'A').charCodeAt(0)%6];
      const isActive = t.status === 'Active';
      return `
      <div style="background:#fff;border-radius:16px;margin-bottom:10px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden;border-left:4px solid ${isActive?'#27AE60':'#95A5A6'};animation:pageIn .2s ${idx*0.05}s both">
        <div style="display:flex;align-items:center;gap:12px;padding:14px 14px 10px">
          <div style="width:50px;height:50px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;color:#fff;flex-shrink:0">${esc(initials)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.9rem;font-weight:800;color:#1A2E2E;margin-bottom:2px">${esc(t.name)}</div>
            <div style="font-size:.75rem;color:#1A8C8C;font-weight:700;margin-bottom:3px">💪 ${esc(t.specialty)}</div>
            <div style="font-size:.72rem;color:#8AABAB">📱 ${esc(t.phone)}</div>
          </div>
          <span style="background:${isActive?'#E8F8EF':'#F3F4F6'};color:${isActive?'#27AE60':'#6B7280'};padding:3px 10px;border-radius:20px;font-size:.65rem;font-weight:800;flex-shrink:0">${esc(t.status)}</span>
        </div>
        <div style="display:flex;border-top:1px solid #F0F5F5;background:#F8FFFE">
          <button onclick="openEditTrainerModal('${esc(t._id)}')" style="flex:1;padding:10px;border:none;background:transparent;font-family:inherit;font-size:.78rem;font-weight:700;color:#1A8C8C;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;border-right:1px solid #F0F5F5;min-height:42px">✏️ Edit</button>
          <button onclick="dialPhone('${esc(t.phone)}')" style="flex:1;padding:10px;border:none;background:transparent;font-family:inherit;font-size:.78rem;font-weight:700;color:#27AE60;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;border-right:1px solid #F0F5F5;min-height:42px">📞 Call</button>
          <button onclick="delTrainer('${esc(t._id)}','${esc(t.name.replace(/'/g,"\'"))}')" style="flex:1;padding:10px;border:none;background:transparent;font-family:inherit;font-size:.78rem;font-weight:700;color:#E74C3C;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;min-height:42px">🗑 Delete</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('loadTrainers error:', e);
    wrap.innerHTML = `<div class="empty"><div class="ei">⚠️</div><p style="color:#E74C3C;font-size:.82rem">Error loading trainers</p><p style="color:#8AABAB;font-size:.72rem;margin-top:6px">${e.message||'Check connection'}</p><button onclick="loadTrainers()" style="margin-top:12px;padding:10px 20px;background:#1A8C8C;color:#fff;border:none;border-radius:12px;font-family:inherit;font-size:.82rem;font-weight:700;cursor:pointer">🔄 Retry</button></div>`;
  }
}

async function openEditTrainerModal(id) {
  try {
    const t = await fetch(`${TAPI}/${id}`,{headers:hdrs()}).then(r=>r.json());
    document.getElementById('etId').value = id;
    document.getElementById('etName').value = t.name;
    document.getElementById('etPhone').value = t.phone;
    document.getElementById('etSpecialty').value = t.specialty;
    document.getElementById('etStatus').value = t.status;
    openModal('editTrainerModal');
  } catch(e) { toast('Error loading trainer','error'); }
}

async function saveEditTrainer() {
  const id = document.getElementById('etId').value;
  const name = document.getElementById('etName').value.trim();
  const phone = document.getElementById('etPhone').value.trim();
  const spec = document.getElementById('etSpecialty').value.trim();
  const stat = document.getElementById('etStatus').value;
  if (!name||!phone||!spec) { toast('Fill all fields','error'); return; }
  if (!/^\d{10}$/.test(phone)) { toast('Enter valid 10-digit phone','error'); return; }
  try {
    const res = await fetch(`${TAPI}/${id}`,{method:'PUT',headers:hdrs(),body:JSON.stringify({name,phone,specialty:spec,status:stat})});
    if (res.ok) { closeModal('editTrainerModal'); toast('Trainer updated ✅','success'); loadTrainers(); }
    else { const err=await res.json(); toast(err.error||'Update failed','error'); }
  } catch(e) { toast('Network error','error'); }
}

async function delTrainer(id, name) {
  doubleConfirm(`Delete trainer "${name}"?`, async () => {
    try {
      const res = await fetch(`${TAPI}/${id}`,{method:'DELETE',headers:hdrs()});
      if (res.ok) { toast('Deleted','success'); loadTrainers(); }
      else toast('Error','error');
    } catch(e) { toast('Error','error'); }
  });
}
document.getElementById('addTrainerForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const phone = document.getElementById('tPhone').value.trim();
  if(!/^\d{10}$/.test(phone)){toast('Enter valid 10-digit phone','error');return;}
  const data = {
    name: document.getElementById('tName').value.trim(),
    phone,
    specialty: document.getElementById('tSpecialty').value.trim(),
    status: document.getElementById('tStatus').value
  };
  const btn = e.submitter; 
  if (btn) { btn.disabled=true; btn.textContent='Adding…'; }
  try{
    const res = await fetch(TAPI,{method:'POST',headers:hdrs(),body:JSON.stringify(data)});
    if(res.ok){
      closeModal('addTrainerModal');
      e.target.reset();
      toast('Trainer added!','success');
      loadTrainers();
    } else {
      const err=await res.json();
      toast(err.error||'Could not add trainer','error');
    }
  } catch(e){ toast('Network error','error'); }
  if (btn) { btn.disabled=false; btn.textContent='Add Trainer'; }
});

/* ── PLANS ── */
function loadPlans() {
  const wrap = document.getElementById('plansListWrap');
  if (!wrap) return;
  if (!gymPlans.length) gymPlans = [...DEFAULT_PLANS];
  if (!gymPlans.length) {
    wrap.innerHTML = '<div class="empty"><div class="ei">💎</div><p>No plans yet.</p></div>';
    return;
  }
  const plans = gymPlans.map(p => {
    let disc = p.price, discInfo = null;
    for (const d of gymDisc) {
      if (!d.validUntil || new Date(d.validUntil) >= new Date()) {
        if (d.appliesTo === 'all' || d.planName === p.name) {
          if (d.type === 'percentage') { disc = p.price - p.price * d.value / 100; discInfo = `${d.value}% OFF`; }
          else { disc = Math.max(0, p.price - d.value); discInfo = `₹${d.value} OFF`; }
          break;
        }
      }
    }
    return { ...p, disc: Math.round(disc), discInfo };
  });
  const durClr = m => m <= 1 ? '#1A8C8C' : m <= 3 ? '#27AE60' : m <= 6 ? '#F39C12' : '#8E44AD';
  wrap.innerHTML = plans.map((p, idx) => `
    <div style="background:#fff;border-radius:16px;margin-bottom:10px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden;border-left:4px solid ${durClr(p.months)};animation:pageIn .2s ${idx*0.05}s both">
      <div style="padding:14px 14px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:.88rem;font-weight:800;color:#1A2E2E;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="background:${durClr(p.months)}22;color:${durClr(p.months)};padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:800">⏱ ${p.months} month${p.months>1?'s':''}</span>
            ${p.discInfo ? `<span style="background:#FEF9E7;color:#F39C12;padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:800">🏷️ ${p.discInfo}</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${p.discInfo ? `<div style="font-size:.72rem;text-decoration:line-through;color:#8AABAB;font-weight:600">₹${p.price.toLocaleString('en-IN')}</div>` : ''}
          <div style="font-size:1.4rem;font-weight:800;color:${durClr(p.months)};line-height:1">₹${p.disc.toLocaleString('en-IN')}</div>
          <div style="font-size:.6rem;color:#8AABAB;margin-top:2px">per plan</div>
        </div>
      </div>
      <div style="display:flex;border-top:1px solid #F0F5F5;background:#FAFFFE">
        <button onclick="selectPlan('${esc(p.name)}')" style="flex:1;padding:10px;border:none;background:transparent;font-family:inherit;font-size:.78rem;font-weight:700;color:#1A8C8C;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;border-right:1px solid #F0F5F5;min-height:42px">➕ Select</button>
        <button onclick="openEditPlan('${esc(p.name)}')" style="flex:1;padding:10px;border:none;background:transparent;font-family:inherit;font-size:.78rem;font-weight:700;color:#4A6464;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;border-right:1px solid #F0F5F5;min-height:42px">✏️ Edit</button>
        <button onclick="removePlan('${esc(p.name)}')" style="flex:1;padding:10px;border:none;background:transparent;font-family:inherit;font-size:.78rem;font-weight:700;color:#E74C3C;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;min-height:42px">🗑 Remove</button>
      </div>
    </div>`).join('');
}

function selectPlan(name) {
  populatePlanSelect('mPlan');
  document.getElementById('mPlan').value = name;
  recalcPrice(); onPlanChange();
  openModal('addMemberModal');
}

function addGymPlan() {
  const name = document.getElementById('newPlanName').value.trim();
  const price = parseFloat(document.getElementById('newPlanPrice').value);
  const months = parseInt(document.getElementById('newPlanMonths').value);
  if(!name||!price||!months){toast('Fill all fields','error');return;}
  if(gymPlans.find(p=>p.name===name)){toast('Plan already exists','error');return;}
  gymPlans.push({name,price,months});
  saveServerProfile();
  closeModal('addPlanModal');
  ['newPlanName','newPlanPrice','newPlanMonths'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  populatePlanSelect(); loadPlans(); toast('Plan added!','success');
}

function openEditPlan(name) {
  const plan = gymPlans.find(p=>p.name===name);
  if (!plan) return;
  document.getElementById('editPlanOrigName').value = name;
  document.getElementById('editPlanName').value = plan.name;
  document.getElementById('editPlanPrice').value = plan.price;
  document.getElementById('editPlanMonths').value = plan.months;
  openModal('editPlanModal');
}

function saveEditPlan() {
  const origName = document.getElementById('editPlanOrigName').value;
  const newName = document.getElementById('editPlanName').value.trim();
  const price = parseFloat(document.getElementById('editPlanPrice').value);
  const months = parseInt(document.getElementById('editPlanMonths').value);
  if (!newName||!price||!months) { toast('Fill all fields','error'); return; }
  const idx = gymPlans.findIndex(p=>p.name===origName);
  if (newName!==origName && gymPlans.find(p=>p.name===newName)) { toast('Another plan with this name exists','error'); return; }
  gymPlans[idx] = {name:newName, price, months};
  saveServerProfile();
  closeModal('editPlanModal');
  populatePlanSelect(); loadPlans(); toast('Plan updated!','success');
}

function removePlan(name) {
  if(!confirm(`Remove plan "${name}"?`))return;
  gymPlans = gymPlans.filter(p=>p.name!==name);
  saveServerProfile(); populatePlanSelect(); loadPlans(); toast('Plan removed');
}

/* ── DISCOUNTS ── */
function renderDiscounts() {
  const wrap = document.getElementById('discTable');
  if (!wrap) return;
  if (!gymDisc.length) {
    wrap.innerHTML = '<div class="empty"><div class="ei">🏷️</div><p>No discounts yet. Add one!</p></div>';
    return;
  }
  wrap.innerHTML = gymDisc.map((d, i) => {
    const expired = d.validUntil && new Date(d.validUntil) < new Date();
    const valStr = d.type === 'percentage' ? `${d.value}% OFF` : `₹${d.value.toLocaleString('en-IN')} OFF`;
    return `
    <div style="background:#fff;border-radius:16px;margin-bottom:10px;box-shadow:0 2px 10px rgba(0,0,0,.06);overflow:hidden;border-left:4px solid ${expired ? '#95A5A6' : '#F39C12'}">
      <div style="padding:14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:.88rem;font-weight:800;color:#1A2E2E;margin-bottom:5px">${esc(d.name)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span style="background:#FEF9E7;color:#F39C12;padding:3px 10px;border-radius:20px;font-size:.7rem;font-weight:800">${valStr}</span>
            <span style="background:#F0F5F5;color:#4A6464;padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:700">${d.appliesTo === 'all' ? 'All Plans' : esc(d.planName || '')}</span>
            ${d.validUntil ? `<span style="background:${expired ? '#FEECEB' : '#E8F8EF'};color:${expired ? '#E74C3C' : '#27AE60'};padding:3px 10px;border-radius:20px;font-size:.68rem;font-weight:700">${expired ? 'Expired' : 'Until'}: ${fmt(d.validUntil)}</span>` : ''}
          </div>
        </div>
        <button onclick="removeDiscount(${i})" style="width:36px;height:36px;border-radius:50%;background:#FEECEB;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.85rem;color:#E74C3C;flex-shrink:0">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function toggleDiscPlan() {
  const group = document.getElementById('discPlanGroup');
  const applies = document.getElementById('discApplies');
  if (group && applies) {
    group.style.display = applies.value === 'specific' ? 'block' : 'none';
  }
}

function addDiscount() {
  const name = document.getElementById('discName').value.trim();
  const val = parseFloat(document.getElementById('discVal').value);
  if(!name||!val||val<=0){toast('Fill all required fields','error');return;}
  const type = document.getElementById('discType').value;
  if(type==='percentage'&&val>100){toast('Percentage cannot exceed 100%','error');return;}
  const appliesTo = document.getElementById('discApplies').value;
  gymDisc.push({
    name, type, value: val, appliesTo,
    planName: appliesTo === 'specific' ? document.getElementById('discPlan').value : null,
    validUntil: document.getElementById('discExpiry').value || null
  });
  saveServerProfile();
  closeModal('addDiscountModal');
  renderDiscounts();
  toast('Discount added','success');
}

function removeDiscount(i) {
  if(!confirm('Remove this discount?'))return;
  gymDisc.splice(i,1);
  saveServerProfile();
  renderDiscounts();
  toast('Discount removed');
}

/* ── PAYMENTS ── */
let _paymentSearchQuery = '';

function filterPayments() {
  _paymentSearchQuery = (document.getElementById('paymentSearch')?.value || '').toLowerCase().trim();
  _renderPaymentsList();
}

function _renderPaymentsList() {
  const container = document.getElementById('payList');
  if (!container) return;
  
  let members = allMembersCache.filter(m => !m.isDeleted);
  
  // Apply Search Filter
  if (_paymentSearchQuery) {
    members = members.filter(m => 
      (m.name || '').toLowerCase().includes(_paymentSearchQuery) || 
      (m.phone || '').includes(_paymentSearchQuery) || 
      String(m.memberNo || '').includes(_paymentSearchQuery)
    );
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const in14Days = new Date(today);
  in14Days.setDate(today.getDate() + 14);
  in14Days.setHours(23,59,59,999);

  // ── Pending balances: members who paid less than the full amount ──
  const pendingMembers = members.filter(m => Number(m.pendingAmount) > 0);
  let pendingHtml = '';
  if (pendingMembers.length) {
    pendingHtml = `
    <div style="margin-bottom:18px">
      <div style="font-size:.72rem;font-weight:800;color:#E74C3C;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">⚠️ Pending Payments (${pendingMembers.length})</div>
      ${pendingMembers.map(m => {
        const safePhone_p = esc(m.phone||'');
        const safeId_p = esc(String(m._id||''));
        const safeName_p = esc(m.name||'');
        return `
        <div class="pay-row" style="border:1.5px solid #FEECEB;background:#FFFBFB;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:12px">${avImg(m)}<div><div style="font-weight:700;font-size:.85rem">${safeName_p}</div><div style="font-size:.72rem;color:var(--tx3)">${esc(m.plan||'')}</div></div></div>
          <span class="badge" style="background:#FEECEB;color:#E74C3C;font-weight:800">Due ₹${Number(m.pendingAmount).toLocaleString('en-IN')}</span>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-sm" style="background:#E3F2FD;color:#2980B9" onclick="dialPhone('${safePhone_p}')" title="Call">📞</button>
            <button class="btn btn-sm" style="background:#FEF6E7;color:#F39C12" onclick="sendPaymentReminder('${safeId_p}','${safePhone_p}','${safeName_p}')" title="Send reminder">🔔</button>
            <button class="btn btn-sm" style="background:#F0F5F5;color:#6B7280;border:1px solid #E0ECEC" onclick="markMemberInactive('${safeId_p}','${safeName_p.replace(/'/g,"\\'")}')" title="Mark Inactive">⏸️ Inactive</button>
            <button class="btn btn-success btn-sm" onclick="openCollectDue('${safeId_p}')">💰 Receive</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  const due = members.filter(m => {
    if(m.status !== 'Active') return false;
    const p = m.expiryDate.split('T')[0].split('-');
    const exp = new Date(p[0], p[1]-1, p[2]);
    return exp <= in14Days;
  });

  due.sort((a,b) => new Date(a.expiryDate) - new Date(b.expiryDate));

  if(!due.length && !pendingMembers.length){
    container.innerHTML = '<div class="empty"><div class="ei">✅</div><p>' + (_paymentSearchQuery ? 'No matching due payments found.' : 'No payments due in 14 days!') + '</p></div>';
    return;
  }
  if (!due.length) {
    container.innerHTML = pendingHtml + '<div class="empty"><div class="ei">✅</div><p>' + (_paymentSearchQuery ? 'No matching renewals found.' : 'No renewals due in 14 days!') + '</p></div>';
    return;
  }
  
  container.innerHTML = pendingHtml + due.map(m => {
    const p = m.expiryDate.split('T')[0].split('-');
    const expDate = new Date(p[0], p[1]-1, p[2]);
    const d = Math.ceil((expDate - today)/86400000);
    const safePhone_r = esc(m.phone||'');
    const safeId_r = esc(String(m._id||''));
    const safeName_r = esc(String(m.name||''));
    return `<div class="pay-row" style="flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:12px">${avImg(m)}<div><div style="font-weight:700;font-size:.85rem">${esc(m.name)}</div><div style="font-size:.72rem;color:var(--tx3)">${esc(m.plan)}</div><div style="font-size:.7rem;color:var(--tx3)">Exp: ${fmt(m.expiryDate)}</div></div></div>
      <span class="badge ${d<0?'b-inactive':'b-trial'}">${d<0?'Overdue':d+'d'}</span>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-sm" style="background:#E3F2FD;color:#2980B9" onclick="dialPhone('${safePhone_r}')" title="Call">📞</button>
        <button class="btn btn-sm" style="background:#FEF6E7;color:#F39C12" onclick="sendPaymentReminder('${safeId_r}','${safePhone_r}','${safeName_r}')" title="Send reminder">🔔</button>
        <button class="btn btn-sm" style="background:#F0F5F5;color:#6B7280;border:1px solid #E0ECEC" onclick="markMemberInactive('${safeId_r}','${safeName_r.replace(/'/g,"\\'")}')" title="Mark Inactive">⏸️ Inactive</button>
        <button class="btn btn-success btn-sm" onclick="openPaymentForById('${safeId_r}')">Renew</button>
        <button class="btn btn-sm" style="background:#FFF0F0;color:#E74C3C" onclick="delMember('${safeId_r}','${safeName_r.replace(/'/g,"\\'")}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function loadPayments() {
  const container = document.getElementById('payList');
  if (!container) return;
  container.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>Loading…</p></div>';
  try {
    const res = await fetch(API,{headers:hdrs()});
    if(res.status===401){logout();return;}
    const members = await res.json();
    allMembersCache = members; // keep cache fresh for openPaymentForById
    _renderPaymentsList(); // Route to the renderer
  } catch(e) {
    container.innerHTML = '<div class="empty"><p style="color:var(--gr)">Error fetching payments data</p></div>';
  }
}

/* ── REVENUE PAGE ── */
let _revenueSearchQuery = '';
let _revenueFromDate = '';
let _revenueToDate = '';

function filterRevenue() {
  _revenueSearchQuery = (document.getElementById('revenueSearch')?.value || '').toLowerCase().trim();
  loadRevenuePage();
}

function applyRevenueDateFilter() {
  _revenueFromDate = document.getElementById('revenueFromDate')?.value || '';
  _revenueToDate = document.getElementById('revenueToDate')?.value || '';
  loadRevenuePage();
}

function clearRevenueDateFilter() {
  _revenueFromDate = '';
  _revenueToDate = '';
  const f = document.getElementById('revenueFromDate'); if (f) f.value = '';
  const t = document.getElementById('revenueToDate'); if (t) t.value = '';
  loadRevenuePage();
}

async function loadRevenuePage() {
  const container = document.getElementById('revenueDetailed');
  if (!container) return;
  try {
    const res = await fetch(API, {headers:hdrs()});
    if (res.status===401) { logout(); return; }
    const allMembers = await res.json();
    const members = _revenueSearchQuery
      ? allMembers.filter(m => (m.name||'').toLowerCase().includes(_revenueSearchQuery) || String(m.memberNo||'').includes(_revenueSearchQuery))
      : allMembers;
    const revenue = calculateRevenue(members);

    // Custom date-range filter (From/To), independent of the fixed 3-month view below
    let rangeHtml = '';
    if (_revenueFromDate || _revenueToDate) {
      const range = getRevenueInRange(members, _revenueFromDate, _revenueToDate);
      const label = _revenueFromDate && _revenueToDate
        ? `${new Date(_revenueFromDate).toLocaleDateString('en-IN')} — ${new Date(_revenueToDate).toLocaleDateString('en-IN')}`
        : _revenueFromDate ? `From ${new Date(_revenueFromDate).toLocaleDateString('en-IN')}`
        : `Up to ${new Date(_revenueToDate).toLocaleDateString('en-IN')}`;
      rangeHtml = `
      <div style="background:#F0F5F5;border:2px solid #1A8C8C;border-radius:14px;padding:14px;margin-bottom:16px">
        <div style="font-size:.65rem;font-weight:800;color:#1A8C8C;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📅 ${label}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center">
          <div>
            <div style="font-size:.6rem;color:#8AABAB;font-weight:700">Total</div>
            <div style="font-size:1.15rem;font-weight:800;color:#1A2E2E">₹${range.total.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style="font-size:.6rem;color:#8AABAB;font-weight:700">📱 Online</div>
            <div style="font-size:1rem;font-weight:800;color:#1A2E2E">₹${range.online.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style="font-size:.6rem;color:#8AABAB;font-weight:700">💵 Cash</div>
            <div style="font-size:1rem;font-weight:800;color:#1A2E2E">₹${range.cash.toLocaleString('en-IN')}</div>
          </div>
        </div>
        <div style="font-size:.62rem;color:#4A6464;font-weight:600;margin-top:8px;text-align:center">
          Plan: ₹${range.plan.toLocaleString('en-IN')} | PT: ₹${range.pt.toLocaleString('en-IN')} | Admission: ₹${range.admission.toLocaleString('en-IN')} · ${range.entries.length} payment${range.entries.length===1?'':'s'}
        </div>
      </div>`;
    }

    const today = new Date();
    const monthLabels = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      monthLabels.push(d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));
    }
    const monthKeys = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      monthKeys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }

    let html = `
      ${rangeHtml}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        ${monthKeys.map((key, idx) => {
          const data = revenue.months[key] || { total: 0, plan: 0, admission: 0, pt: 0, online: 0, cash: 0 };
          return `
            <div style="background:#F8FFFE;border:1px solid #E0ECEC;border-radius:14px;padding:12px;text-align:center">
              <div style="font-size:.7rem;font-weight:800;color:#8AABAB;text-transform:uppercase;letter-spacing:.4px">${monthLabels[idx]}</div>
              <div style="font-size:1.2rem;font-weight:800;color:#1A8C8C;margin:6px 0">₹${data.total.toLocaleString('en-IN')}</div>
              <div style="font-size:.6rem;color:#4A6464;font-weight:600">
                Plan: ₹${data.plan.toLocaleString('en-IN')} | PT: ₹${data.pt.toLocaleString('en-IN')} | Adm: ₹${data.admission.toLocaleString('en-IN')}
              </div>
              <div style="font-size:.6rem;color:#4A6464;font-weight:600;margin-top:3px">
                📱 ₹${data.online.toLocaleString('en-IN')} | 💵 ₹${data.cash.toLocaleString('en-IN')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
      
      <div style="background:#1A8C8C;border-radius:14px;padding:16px;color:#fff">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
          <div>
            <div style="font-size:.6rem;opacity:.7;text-transform:uppercase;letter-spacing:.5px">Total Revenue</div>
            <div style="font-size:1.4rem;font-weight:800">₹${revenue.grandTotal.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style="font-size:.6rem;opacity:.7;text-transform:uppercase;letter-spacing:.5px">Online</div>
            <div style="font-size:1.1rem;font-weight:800">₹${revenue.onlineTotal.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style="font-size:.6rem;opacity:.7;text-transform:uppercase;letter-spacing:.5px">Cash</div>
            <div style="font-size:1.1rem;font-weight:800">₹${revenue.cashTotal.toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>
      
<div style="background:#fff;border:1px solid #E0ECEC;border-radius:14px;padding:14px;margin-top:12px">
        <div style="font-size:.7rem;font-weight:800;color:#8AABAB;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Payment History (All Time)</div>
        ${members.filter(m => (m.paymentHistory || []).length > 0 || (!m.isDeleted && Number(m.pendingAmount) > 0)).map(m => {
          const history = m.paymentHistory || [];
          const pendingBreakdown = getPendingBreakdown(m);
          const hasPending = Number(m.pendingAmount) > 0;
          return `
            <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #F0F5F5">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
                <span style="font-weight:700;font-size:.82rem;color:#1A2E2E">${esc(m.name)} ${m.isDeleted ? '<span style="color:#E74C3C;font-size:0.65rem">(Deleted)</span>' : ''}</span>
                <span style="font-size:.65rem;font-weight:800;background:#1A8C8C;color:#fff;padding:1px 7px;border-radius:8px">ID #${m.memberNo||'-'}</span>
              </div>
              ${groupPaymentEntries(history).map(tx => `
                <div style="padding:4px 0;padding-left:12px;border-bottom:1px dashed #F0F5F5;position:relative;">
                  ${tx.categories.map(c => `
                    <div style="display:flex;justify-content:space-between;font-size:.7rem;color:#4A6464;padding:1px 0;padding-right:85px;">
                      <span>₹${c.amount.toLocaleString('en-IN')}</span>
                      <span style="font-size:.6rem;color:#8AABAB;text-transform:capitalize">${c.type}</span>
                      <span style="color:#27AE60;font-weight:600">Paid</span>
                    </div>
                  `).join('')}
                  <div style="display:flex;justify-content:space-between;font-size:.65rem;color:#8AABAB;padding-top:2px;padding-right:85px;">
                    <span>${tx.date ? new Date(tx.date).toLocaleDateString('en-IN') : '—'}</span>
                    <span style="font-weight:700;color:#1A8C8C">${tx.methodSummary}</span>
                  </div>
                  <div style="position:absolute; right:0; top:50%; transform:translateY(-50%); display:flex; gap:6px;">
                    <button onclick="showReceiptOptions('${m._id}', '${esc(m.name.replace(/'/g, "\\'"))}', ${history.reduce((s,p)=>s+(p.amount||0),0)}, ${m.pendingAmount}, 'Partial Paid', '')" style="background:#FFF9C4; color:#D97706; border:1px solid #FDE68A; border-radius:8px; padding:6px 10px; cursor:pointer; font-size:0.7rem;" title="Print Due Slip">📄</button>
                    <button onclick="clearPendingAmount('${m._id}')" style="background:#FFF0F0; color:#E74C3C; border:1px solid #FECDD5; border-radius:8px; padding:6px 10px; cursor:pointer; font-size:0.7rem;" title="Clear Pending Balance">🗑️</button>
                  </div>
                </div>
              `).join('')}
${pendingBreakdown ? (() => {
  const totalPaid = history.reduce((s,p) => s + (Number(p.amount) || 0), 0);
  const pendingAmt = Number(m.pendingAmount) || 0;
  
  // Safely grab the receipt number, or generate a fallback if the old history didn't record one
  let latestReceipt = 'REC-' + (m.memberNo || Date.now().toString().slice(-6));
  if (history.length > 0 && history[history.length - 1].receiptNo) {
    latestReceipt = history[history.length - 1].receiptNo;
  }
  
  return `
  <div style="background:#FEECEB;border-radius:8px;padding:6px 10px;margin:6px 0 2px 12px;position:relative;">
    ${history.length ? `<div style="font-size:.65rem;font-weight:700;color:#27AE60;margin-bottom:3px">✅ ₹${totalPaid.toLocaleString('en-IN')} paid so far</div>` : ''}
    <div style="font-size:.65rem;font-weight:800;color:#E74C3C;padding-right:85px;">
      ⚠️ ₹${pendingAmt.toLocaleString('en-IN')} pending
      ${[pendingBreakdown.plan > 0 ? 'Plan' : '', pendingBreakdown.admission > 0 ? 'Admission' : '', pendingBreakdown.pt > 0 ? 'PT' : ''].filter(Boolean).length
        ? ` (${[pendingBreakdown.plan > 0 ? 'Plan' : '', pendingBreakdown.admission > 0 ? 'Admission' : '', pendingBreakdown.pt > 0 ? 'PT' : ''].filter(Boolean).join(', ')})`
        : ''}
    </div>
    <div style="position:absolute; right:0; top:50%; transform:translateY(-50%); display:flex; gap:6px;">
      <button onclick="showReceiptOptions('${m._id}', '${esc(m.name.replace(/'/g, "\\'"))}', ${totalPaid}, ${pendingAmt}, 'Partial Payment', '${latestReceipt}')" style="background:#FFF9C4; color:#D97706; border:1px solid #FDE68A; border-radius:8px; padding:6px 10px; cursor:pointer; font-size:0.7rem;" title="Print Due Slip">📄</button>
      <button onclick="clearPendingAmount('${m._id}')" style="background:#FFF0F0; color:#E74C3C; border:1px solid #FECDD5; border-radius:8px; padding:6px 10px; cursor:pointer; font-size:0.7rem;" title="Clear Pending Balance">🗑️</button>
    </div>
  </div>
  `})() : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
    
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error loading revenue data</p></div>';
  }
}

/* Combines payment-history entries that came from the same "confirm
   payment" action (matched by groupId + fee type) into one display row.
   A normal single-method payment just shows "Paid" — no need to call out
   which method for the common case. A split payment shows both amounts
   together, e.g. "UPI ₹426 + Cash ₹425", instead of two separate rows. */
/* Mirrors the proportional attribution logic in buildAttributedEntries,
   but for DISPLAY of a member's currently outstanding balance — breaks
   their pendingAmount down into how much of it is Plan vs Admission vs
   PT, based on their current stored fees. Returns null if nothing pending. */
function getPendingBreakdown(m) {
  const pending = Math.round(Number(m.pendingAmount) || 0);
  if (pending <= 0) return null;

  const planFull = Number(m.planPrice) || 0;
  const admFull = (m.admissionWaived ? 0 : (Number(m.admissionFee) || 0));
  const ptFull = (m.ptEnabled ? (Number(m.ptFee) || 0) : 0);
  const totalFull = planFull + admFull + ptFull;

  if (totalFull <= 0) return { plan: pending, admission: 0, pt: 0 };

  const ratio = Math.min(1, pending / totalFull);
  let plan = Math.round(planFull * ratio);
  let admission = Math.round(admFull * ratio);
  let pt = Math.round(ptFull * ratio);
  plan += pending - (plan + admission + pt); // fix rounding drift
  return { plan, admission, pt };
}

/* Groups payment-history entries by whole transaction (groupId), not by
   fee category. Returns one row per transaction with:
   - categories: [{type, amount}] — e.g. Plan ₹1667, Admission ₹500 — each
     always just "paid", no method shown per line
   - methodSummary: the payment method for the WHOLE transaction — 'UPI',
     'Cash', or 'UPI ₹X + Cash ₹Y' if it was split — shown once, separately */
function groupPaymentEntries(history) {
  const tx = {};
  const order = [];
  history.forEach((p, i) => {
    const key = p.groupId || `single-${i}`;
    if (!tx[key]) { tx[key] = { date: p.date, categories: {}, upiTotal: 0, cashTotal: 0, otherTotal: 0, receiptNo: p.receiptNo }; order.push(key); }
    const g = tx[key];
    const type = p.type || 'plan';
    g.categories[type] = (g.categories[type] || 0) + (p.amount || 0);
    if (p.method === 'upi') g.upiTotal += p.amount || 0;
    else if (p.method === 'cash') g.cashTotal += p.amount || 0;
    else g.otherTotal += p.amount || 0; // card, etc.
  });

  return order.map(key => {
    const g = tx[key];
    const parts = [];
    if (g.upiTotal > 0) parts.push(`UPI ₹${g.upiTotal.toLocaleString('en-IN')}`);
    if (g.cashTotal > 0) parts.push(`Cash ₹${g.cashTotal.toLocaleString('en-IN')}`);
    if (g.otherTotal > 0) parts.push(`Card ₹${g.otherTotal.toLocaleString('en-IN')}`);
    
    // Determine the raw method to pass into the receipt system
    let rawMethod = 'cash';
    if (g.upiTotal > 0 && g.cashTotal > 0) rawMethod = 'split';
    else if (g.upiTotal > 0) rawMethod = 'upi';
    else if (g.otherTotal > 0) rawMethod = 'card';
    
    const totalAmount = g.upiTotal + g.cashTotal + g.otherTotal;

    return {
      groupId: key, 
      date: g.date,
      categories: Object.entries(g.categories).map(([type, amount]) => ({ type, amount })),
      methodSummary: parts.join(' + ') || 'Paid',
      rawMethod: rawMethod,
      receiptNo: g.receiptNo,
      totalAmount: totalAmount
    };
  });
}

/* ── PAYMENT MODAL ── */
// Look up full member from cache by ID then open payment modal
function openPaymentForById(id) {
  const m = allMembersCache.find(x => (x._id||x.id) === id);
  if (!m) { toast('Member not found - please refresh','error'); return; }
  openPaymentFor(m, false);
}

/* "💰 Receive" — collects some or all of a member's outstanding pending
   balance. Reuses the payment modal in a minimal mode (no plan/PT/discount
   fields), fixed total = their current pendingAmount. */
function openCollectDue(id) {
  const m = allMembersCache.find(x => (x._id||x.id) === id);
  if (!m) { toast('Member not found - please refresh','error'); return; }
  const due = Number(m.pendingAmount) || 0;
  if (due <= 0) { toast('This member has no pending balance','error'); return; }

  curPayMember = { id: m._id || m.id, name: m.name, expiryDate: m.expiryDate, isNew: false, mode: 'due', originalData: m };

  const mhdr = document.querySelector('#paymentModal .mhdr .mtitle');
  if (mhdr) mhdr.textContent = '💰 Collect Pending Payment';

  const planRow = document.getElementById('payPlanRow');
  const ptBox = document.getElementById('payPtEnabled')?.closest('.pt-box');
  const datesRow = document.getElementById('payDatesRow');
  const payDiscBox = document.getElementById('payDiscBox');
  if (planRow) planRow.style.display = 'none';
  if (ptBox) ptBox.style.display = 'none';
  if (datesRow) datesRow.style.display = 'none';
  if (payDiscBox) payDiscBox.style.display = 'none';

  const payDateEl = document.getElementById('payRenewalPayDate');
  if (payDateEl) payDateEl.value = getLocalTodayStr();

  curPayTotal = due;
  updatePaymentQR(due);
  const infoEl = document.getElementById('payInfo');
  if (infoEl) {
    infoEl.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--r3);padding:12px;margin-bottom:.6rem">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="color:var(--tx2);font-size:.82rem">Member</span>
        <strong style="font-size:.82rem">${esc(m.name)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1.5px solid var(--border);margin-top:6px">
        <span style="font-weight:800;font-size:.88rem">Pending Balance</span>
        <strong style="color:#E74C3C;font-size:1.05rem">₹${due.toLocaleString('en-IN')}</strong>
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
        <label style="font-size:.7rem;font-weight:800;color:#1A8C8C;display:block;margin-bottom:5px">💰 Amount Received Now</label>
        <input type="number" id="payAmountReceived" value="${due}" min="0" max="${due}" step="1"
          oninput="updatePendingDisplay(${due})"
          style="width:100%;padding:9px 10px;border:2px solid #E0ECEC;border-radius:10px;font-family:inherit;font-size:.9rem;font-weight:700">
        <div id="pendingDisplayRow" style="font-size:.75rem;font-weight:700;color:#27AE60;margin-top:5px">✅ Fully paid — no pending balance</div>
      </div>
    </div>`;
  }

  curPayMethod = null;
  ['Upi','Cash','Card','Split'].forEach(n => {
    const btn = document.getElementById(`pm${n}`);
    if (!btn) return;
    btn.style.borderColor = '#E0ECEC'; btn.style.background = '#fff'; btn.style.color = '#4A6464';
  });
  ['payUpiPanel','payCashPanel','payCardPanel','paySplitPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const confirmBtn = document.getElementById('confirmPayBtn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.style.opacity = '.5'; confirmBtn.textContent = 'Select a payment method above'; }

  openModal('paymentModal');
}

function openPaymentFor(m, isNew = false) {
  curPayMember = {id: m._id || m.id, name: m.name, expiryDate: m.expiryDate, isNew: isNew, originalData: m};

  const mhdr = document.querySelector('#paymentModal .mhdr .mtitle');
  if(mhdr) mhdr.textContent = isNew ? '💳 Complete Payment' : '💳 Renew Plan';

  // Show the "Back to Edit" button ONLY for brand new members
  const payBackBtn = document.getElementById('payBackBtn');
  if (payBackBtn) payBackBtn.style.display = isNew ? 'block' : 'none';

  const payDiscBox = document.getElementById('payDiscBox');

  if (isNew) {
    const planRow = document.getElementById('payPlanRow');
    const ptBox = document.getElementById('payPtEnabled')?.closest('.pt-box');
    const datesRow = document.getElementById('payDatesRow');
    if (planRow) planRow.style.display = 'none';
    if (ptBox) ptBox.style.display = 'none';
    if (datesRow) datesRow.style.display = 'none';
    if (payDiscBox) payDiscBox.style.display = 'none';
    
    const payDateEl = document.getElementById('payRenewalPayDate');
    if (payDateEl) payDateEl.value = m.paymentDate || getLocalTodayStr();
  } else {
    const planRow = document.getElementById('payPlanRow');
    const ptBox = document.getElementById('payPtEnabled')?.closest('.pt-box');
    const datesRow = document.getElementById('payDatesRow');
    if (planRow) planRow.style.display = 'block';
    if (ptBox) ptBox.style.display = 'block';
    if (datesRow) datesRow.style.display = 'block';
    if (payDiscBox) payDiscBox.style.display = 'block';

    const payDateEl = document.getElementById('payRenewalPayDate');
    if (payDateEl) payDateEl.value = getLocalTodayStr();

    populatePlanSelect('payPlan');
    const planSel = document.getElementById('payPlan');
    if (planSel) planSel.value = m.plan || gymPlans[0]?.name || '';

    const ptEn = !!m.ptEnabled;
    const ptCheck = document.getElementById('payPtEnabled');
    if (ptCheck) ptCheck.checked = ptEn;
    const ptDetails = document.getElementById('payPtDetails');
    if (ptDetails) ptDetails.style.display = ptEn ? 'block' : 'none';
    const ptFeeEl = document.getElementById('payPtFee');
    if (ptFeeEl) ptFeeEl.value = m.ptFee || gymCfg.ptFee || 0;

    const ptTrainerEl = document.getElementById('payPtTrainer');
    if (ptTrainerEl) {
      ptTrainerEl.innerHTML = document.getElementById('ePtTrainer')?.innerHTML || '<option value="">Select Trainer</option>';
      ptTrainerEl.value = m.ptTrainer || '';
    }

    const payDV = document.getElementById('payDiscValue');
    const payDR = document.getElementById('payDiscReason');
    if (payDV) payDV.value = '';
    if (payDR) payDR.value = '';
    document.querySelectorAll('input[name="payDType"]').forEach(r => r.checked = r.value === 'none');

    const startEl = document.getElementById('payStartDate');
    const expiryEl = document.getElementById('payExpiryDate');
    if (startEl) startEl.value = '';
    if (expiryEl) expiryEl.value = '';

    updateRenewalDates();
  }

  recalcPayment();

  // Reset payment method UI
  curPayMethod = null;
  ['Upi','Cash','Card','Split'].forEach(n => {
    const btn = document.getElementById(`pm${n}`);
    if (!btn) return;
    btn.style.borderColor = '#E0ECEC';
    btn.style.background = '#fff';
    btn.style.color = '#4A6464';
  });
  ['payUpiPanel','payCashPanel','payCardPanel','paySplitPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const confirmBtn = document.getElementById('confirmPayBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '.5';
    confirmBtn.textContent = 'Select a payment method above';
  }

  openModal('paymentModal');
}

function updateRenewalDates() {
  const startEl = document.getElementById('payStartDate');
  const expiryEl = document.getElementById('payExpiryDate');
  if (!startEl || !expiryEl) return;
  if (!startEl.value) {
    const today = new Date(); today.setHours(0,0,0,0);
    let startDefault = today;
    if (curPayMember && curPayMember.expiryDate) {
      const p = curPayMember.expiryDate.split('T')[0].split('-');
      const d = new Date(+p[0], +p[1]-1, +p[2]);
      if (d > today) startDefault = d;
    }
    startEl.value = startDefault.toISOString().split('T')[0];
  }
  updateRenewalExpiry();
}

function updateRenewalExpiry() {
  const startEl = document.getElementById('payStartDate');
  const expiryEl = document.getElementById('payExpiryDate');
  if (!startEl || !expiryEl || !startEl.value) return;
  const planSel = document.getElementById('payPlan');
  const planName = planSel ? planSel.value : '';
  const months = getPlanMonths(planName);
  const p = startEl.value.split('-');
  const d = new Date(+p[0], +p[1]-1, +p[2]);
  d.setMonth(d.getMonth() + months);
  expiryEl.value = d.toISOString().split('T')[0];
}

function selectPayMethod(method) {
  curPayMethod = method;
  ['upi','cash','card','split'].forEach(m => {
    const btn = document.getElementById(`pm${m.charAt(0).toUpperCase()+m.slice(1)}`);
    if (!btn) return;
    if (m === method) {
      btn.style.borderColor = '#1A8C8C';
      btn.style.background = '#F0FAFA';
      btn.style.color = '#1A8C8C';
    } else {
      btn.style.borderColor = '#E0ECEC';
      btn.style.background = '#fff';
      btn.style.color = '#4A6464';
    }
  });
  const upiPanel = document.getElementById('payUpiPanel');
  const cashPanel = document.getElementById('payCashPanel');
  const cardPanel = document.getElementById('payCardPanel');
  const splitPanel = document.getElementById('paySplitPanel');
  if (upiPanel) upiPanel.style.display = (method === 'upi' || method === 'split') ? 'block' : 'none';
  if (cashPanel) cashPanel.style.display = method === 'cash' ? 'block' : 'none';
  if (cardPanel) cardPanel.style.display = method === 'card' ? 'block' : 'none';
  if (splitPanel) splitPanel.style.display = method === 'split' ? 'block' : 'none';
  if (method === 'split') updateSplitDisplay();

  const btn = document.getElementById('confirmPayBtn');
  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '1';
    const labels = { upi:'✅ Confirm UPI Payment', cash:'✅ Confirm Cash Received', card:'✅ Confirm Card Payment', split:'✅ Confirm Split Payment' };
    btn.textContent = labels[method] || '✅ Confirm Payment';
  }
}

// Shows "₹X via UPI, ₹Y via Cash" as the split amount is typed
function updateSplitDisplay() {
  const row = document.getElementById('splitDisplayRow');
  if (!row) return;
  const receivedInput = document.getElementById('payAmountReceived');
  const total = receivedInput ? (parseFloat(receivedInput.value) || curPayTotal || 0) : (curPayTotal || 0);
  const upiAmt = Math.max(0, Math.min(total, parseFloat(document.getElementById('splitUpiAmt')?.value) || 0));
  const cashAmt = Math.max(0, total - upiAmt);
  row.innerHTML = `📱 ₹${upiAmt.toLocaleString('en-IN')} via UPI &nbsp;+&nbsp; 💵 ₹${cashAmt.toLocaleString('en-IN')} via Cash`;
  updatePaymentQR(upiAmt); // QR should only ever reflect the UPI portion, not the full/split total
}

/* For a payment that does NOT fully clear the charge (something stays
   pending) — logs the amount as an undifferentiated 'partial' entry, not
   split across plan/admission/pt. It still counts toward total/online/cash
   revenue immediately, but the fee-category attribution is deliberately
   deferred until the balance is fully paid off (see
   finalizeFullBreakdownEntries below) — splitting a partial amount into
   guessed category portions, and then splitting AGAIN when the rest is
   collected later, produced confusing double-divided numbers. */
function buildPartialEntries(amount, method, dateVal, receiptPrefix) {
  amount = Math.max(0, Math.round(amount));
  const groupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (method === 'split') {
    const upiAmt = Math.max(0, Math.min(amount, parseFloat(document.getElementById('splitUpiAmt')?.value) || 0));
    const cashAmt = Math.max(0, amount - upiAmt);
    const entries = [];
    if (upiAmt > 0) entries.push({ amount: upiAmt, date: dateVal, method: 'upi', receiptNo: `${receiptPrefix}-UPI-${Date.now()}`, type: 'partial', groupId });
    if (cashAmt > 0) entries.push({ amount: cashAmt, date: dateVal, method: 'cash', receiptNo: `${receiptPrefix}-CASH-${Date.now()}`, type: 'partial', groupId });
    if (entries.length) return entries;
  }
  return [{ amount, date: dateVal, method: method === 'split' ? 'cash' : method, receiptNo: `${receiptPrefix}-${Date.now()}`, type: 'partial', groupId }];
}

/* Called once a charge is FULLY paid — either immediately (a normal full
   payment) or the moment a "Receive" collection finally clears a pending
   balance. Produces clean, one-time itemized entries using the member's
   REAL fee amounts (`breakdown` = {plan, admission, pt}), split across
   UPI/Cash proportionally to `methodTotals` = {upi, cash} — the combined
   totals across every payment that went toward this charge (both the
   original partial payment(s) and this final collection), so the split
   reflects how the money actually came in overall, not just this last step. */
function finalizeFullBreakdownEntries(breakdown, methodTotals, dateVal, receiptPrefix) {
  const groupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-final`;
  const combinedTotal = (methodTotals.upi || 0) + (methodTotals.cash || 0);
  const upiRatio = combinedTotal > 0 ? (methodTotals.upi || 0) / combinedTotal : 0;

  const categories = [
    { amt: Math.round(breakdown.plan || 0), type: 'plan' },
    { amt: Math.round(breakdown.admission || 0), type: 'admission' },
    { amt: Math.round(breakdown.pt || 0), type: 'pt' }
  ].filter(c => c.amt > 0);

  let entries = [];
  categories.forEach(cat => {
    const catUpi = Math.round(cat.amt * upiRatio);
    const catCash = cat.amt - catUpi;
    if (catUpi > 0) entries.push({ amount: catUpi, date: dateVal, method: 'upi', receiptNo: `${receiptPrefix}-${cat.type.toUpperCase()}-UPI-${Date.now()}`, type: cat.type, groupId });
    if (catCash > 0) entries.push({ amount: catCash, date: dateVal, method: 'cash', receiptNo: `${receiptPrefix}-${cat.type.toUpperCase()}-CASH-${Date.now()}`, type: cat.type, groupId });
  });

  if (!entries.length && combinedTotal > 0) {
    entries.push({ amount: combinedTotal, date: dateVal, method: methodTotals.cash >= methodTotals.upi ? 'cash' : 'upi', receiptNo: `${receiptPrefix}-${Date.now()}`, type: 'plan', groupId });
  }
  return entries;
}

function updatePendingDisplay(total) {
  const input = document.getElementById('payAmountReceived');
  const row = document.getElementById('pendingDisplayRow');
  if (!input || !row) return;
  const received = Math.max(0, Math.min(total, parseFloat(input.value) || 0));
  const pending = Math.max(0, total - received);
  if (pending > 0) {
    row.innerHTML = `⚠️ <strong>₹${pending.toLocaleString('en-IN')} pending</strong> — will be tracked as a due balance on this member`;
    row.style.color = '#E74C3C';
  } else {
    row.textContent = '✅ Fully paid — no pending balance';
    row.style.color = '#27AE60';
  }
  updateSplitDisplay();
  updatePaymentQR(received); // QR always reflects the actual amount being collected now
}

function recalcPayment() {
  if (!curPayMember) return;
  const isNew = curPayMember.isNew;
  const m = curPayMember.originalData;

  let planName, planAmt, ptAmt, admAmt;

  if (isNew) {
    planName = m.plan;
    planAmt = m.planPrice || 0;
    ptAmt = m.ptEnabled ? (m.ptFee || 0) : 0;
    admAmt = m.admissionWaived ? 0 : (m.admissionFee || 0);
  } else {
    const planSel = document.getElementById('payPlan');
    planName = planSel.value;
    const baseAmt = parseInt(planSel.options[planSel.selectedIndex]?.getAttribute('data-price')) || getPlanPrice(planName);

    const dType = document.querySelector('input[name="payDType"]:checked')?.value || 'none';
    const rawDV = (document.getElementById('payDiscValue')?.value || '').replace(/,/g,'').trim();
    const dVal = rawDV === '' ? 0 : (parseFloat(rawDV) || 0);
    planAmt = baseAmt;
    if (dType === 'percentage' && dVal > 0)
      planAmt = Math.max(0, Math.round(baseAmt - baseAmt * Math.min(dVal, 100) / 100));
    else if (dType === 'fixed' && dVal > 0)
      planAmt = Math.max(0, Math.round(baseAmt - dVal));

    const isPt = document.getElementById('payPtEnabled')?.checked || false;
    ptAmt = isPt ? (parseFloat(document.getElementById('payPtFee')?.value) || 0) : 0;
    admAmt = 0;
  }

  const total = planAmt + ptAmt + admAmt;

  let discRow = '';
  if (!isNew) {
    const dType = document.querySelector('input[name="payDType"]:checked')?.value || 'none';
    const rawDV = (document.getElementById('payDiscValue')?.value || '').replace(/,/g,'').trim();
    const dVal = rawDV === '' ? 0 : (parseFloat(rawDV) || 0);
    const planSel = document.getElementById('payPlan');
    const baseAmt = parseInt(planSel?.options[planSel?.selectedIndex]?.getAttribute('data-price')) || getPlanPrice(planName);
    if (dType !== 'none' && dVal > 0) {
      const saved = baseAmt - planAmt;
      discRow = `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="color:#27AE60;font-size:.82rem">🏷️ Discount</span>
        <span style="font-size:.85rem;font-weight:700;color:#27AE60">-₹${Math.round(saved).toLocaleString('en-IN')}</span>
      </div>`;
    }
  }

  let rows = `
    <div style="display:flex;justify-content:space-between;margin-bottom:5px">
      <span style="color:var(--tx2);font-size:.82rem">Member</span>
      <strong style="font-size:.82rem">${esc(curPayMember.name)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span style="color:var(--tx2);font-size:.82rem">Plan Fee (${esc(planName)})</span>
      <span style="font-size:.85rem;font-weight:700">₹${Math.round(planAmt).toLocaleString('en-IN')}</span>
    </div>
    ${discRow}`;

  if (admAmt > 0) rows += `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--tx2);font-size:.82rem">🎟️ Admission</span><span style="font-size:.85rem;font-weight:700">₹${Math.round(admAmt).toLocaleString('en-IN')}</span></div>`;
  if (ptAmt > 0) rows += `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--tx2);font-size:.82rem">💪 PT Fee</span><span style="font-size:.85rem;font-weight:700">₹${Math.round(ptAmt).toLocaleString('en-IN')}</span></div>`;

  rows += `<div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1.5px solid var(--border);margin-top:6px">
    <span style="font-weight:800;font-size:.88rem">Total</span>
    <strong style="color:var(--g);font-size:1.05rem">₹${total.toLocaleString('en-IN')}</strong>
  </div>`;

  // Amount actually received now — lets staff record a partial/half payment.
  // Anything less than "Total" becomes a tracked pending balance on the member.
  rows += `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
    <label style="font-size:.7rem;font-weight:800;color:#1A8C8C;display:block;margin-bottom:5px">💰 Amount Received Now</label>
    <input type="number" id="payAmountReceived" value="${total}" min="0" max="${total}" step="1"
      oninput="updatePendingDisplay(${total})"
      style="width:100%;padding:9px 10px;border:2px solid #E0ECEC;border-radius:10px;font-family:inherit;font-size:.9rem;font-weight:700">
    <div id="pendingDisplayRow" style="font-size:.75rem;font-weight:700;color:#27AE60;margin-top:5px">✅ Fully paid — no pending balance</div>
  </div>`;

  const infoEl = document.getElementById('payInfo');
  if (infoEl) {
    infoEl.innerHTML = `<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--r3);padding:12px;margin-bottom:.6rem">${rows}</div>`;
  }

  // UPI QR
  updatePaymentQR(total);
  curPayTotal = total;
}

/* Generates/refreshes the UPI QR code for whatever amount is currently
   being collected. Shared by the normal payment flow, the due-collection
   flow, and re-run live as "Amount Received" is edited — previously this
   only ran inside recalcPayment(), so openCollectDue() never showed a QR
   at all. */
function updatePaymentQR(amount) {
  const upiId = gymCfg.upiId || 'your-upi@bank';
  const upiName = gymCfg.upiName || 'GymPro';
  const dispUpi = document.getElementById('dispUpi');
  const payQR = document.getElementById('payQR');
  if (dispUpi) dispUpi.textContent = upiId;
  if (payQR) {
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${Math.max(0, Math.round(amount))}&cu=INR`;
    payQR.src = `https://api.qrserver.com/v1/create-qr-code/?size=158x158&data=${encodeURIComponent(upiUrl)}`;
  }
}

async function cancelPayment() {
  if (curPayMember && curPayMember.isNew) {
    const id = curPayMember.id;
    const name = curPayMember.name;
    try {
      await fetch(`${API}/${id}`, { method: 'DELETE', headers: hdrs() });
      toast(`❌ Cancelled — ${name} not added`, 'error');
      loadAllMembers();
      loadDashboard();
    } catch(e) {
      toast('Could not remove member — please delete manually', 'error');
    }
  }
  curPayMember = null;
  curPayMethod = null;
  closeModal('paymentModal');
}
async function deletePayment(memberId, groupId) {
  doubleConfirm('Delete this payment record? This will update your revenue calculations permanently.', async () => {
    try {
      const res = await fetch(`${API}/${memberId}/payment/${groupId}`, {
        method: 'DELETE', headers: hdrs()
      });
      if (res.ok) {
        toast('Payment removed', 'success');
        loadRevenuePage();
        loadDashboard(); // Refreshes stats
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to delete payment', 'error');
      }
    } catch(e) { toast('Network error', 'error'); }
  });
}
async function clearPendingAmount(memberId) {
  doubleConfirm('Clear this pending balance? This will set the due amount to ₹0.', async () => {
    try {
      const res = await fetch(`${API}/${memberId}/pending`, { 
        method: 'DELETE', 
        headers: hdrs() 
      });
      
      if (res.ok) {
        toast('Pending balance cleared', 'success');
        loadRevenuePage();
        loadPayments();
      } else {
        const data = await res.json();
        toast(data.error || 'Failed to clear balance', 'error');
      }
    } catch(e) { toast('Network error', 'error'); }
  });
}
async function markMemberInactive(id, name) {
  if (!confirm(`Mark ${name} as Inactive?\nThis will immediately hide them from the Dashboard and Due Payments lists.`)) return;
  
  try {
    // Sending a PUT request with only the status field to safely perform a partial update
    const res = await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: hdrs(),
      body: JSON.stringify({ status: 'Inactive' })
    });
    
    if (res.ok) {
      toast(`${name} marked as Inactive`, 'success');
      loadDashboard();
      loadPayments();
      loadAllMembers();
    } else {
      const err = await res.json();
      toast(err.error || 'Failed to update status', 'error');
    }
  } catch (err) {
    toast('Network error', 'error');
  }
}
async function goBackFromPayment() {
  if (!curPayMember || !curPayMember.isNew) return;
  
  const id = curPayMember.id;
  const m = curPayMember.originalData._restoreData;
  
  // 1. Delete the pre-saved member silently in the background
  try {
    await fetch(`${API}/${id}`, { method: 'DELETE', headers: hdrs() });
    allMembersCache = allMembersCache.filter(x => (x._id || x.id) !== id);
  } catch(e) {
    console.error("Failed to safely rollback member on back", e);
  }

  // 2. Close payment modal
  closeModal('paymentModal');

  if (!m) return; 

  // 3. Repopulate the Add Member form precisely as it was
  document.getElementById('mName').value = m.name || '';
  document.getElementById('mPhone').value = m.phone || '';
  document.getElementById('mEmail').value = m.email || '';
  document.getElementById('mAge').value = m.age || '';
  document.getElementById('mGender').value = m.gender || '';
  
  populatePlanSelect('mPlan');
  if (m.plan) document.getElementById('mPlan').value = m.plan;
  
  document.querySelectorAll('input[name="dType"]').forEach(r => r.checked = r.value === (m.discountType || 'none'));
  document.getElementById('dValue').value = m.discountValue || '';
  document.getElementById('dReason').value = m.discountReason || '';
  
  document.getElementById('mAdmFee').value = m.admissionFee || '';
  document.getElementById('mWaive').value = m.admissionWaived ? 'no' : 'yes';
  
  document.getElementById('mPtEnabled').checked = !!m.ptEnabled;
  document.getElementById('mPtFee').value = m.ptFee || '';
  if (m.ptTrainer) document.getElementById('mPtTrainer').value = m.ptTrainer;
  document.getElementById('mPtNotes').value = m.ptNotes || '';
  togglePT('mPtDetails');
  
  document.getElementById('mStart').value = m.joinDate || '';
  document.getElementById('mExpiry').value = m.expiryDate || '';
  document.getElementById('mPaymentDate').value = m.paymentDate || '';
  document.getElementById('mStatus').value = m.status || 'Active';
  
  document.getElementById('mEcName').value = m.emergencyContact?.name || '';
  document.getElementById('mEcPhone').value = m.emergencyContact?.phone || '';
  document.getElementById('mEcRel').value = m.emergencyContact?.relationship || '';
  
  document.getElementById('mNotes').value = m.medicalNotes || '';
  
  // Re-inject photo if taken
  if (m.photo && m.photo.startsWith('data:image')) {
    document.getElementById('photoPreview').src = m.photo;
    document.getElementById('photoData').value = m.photo;
    document.getElementById('clearPhotoBtn').style.display = 'inline-flex';
  }
  
  recalcPrice();

  // Re-inject health conditions blocks dynamically
  const condContainer = document.getElementById('condContainer');
  condContainer.innerHTML = '';
  if (m.healthConditions && m.healthConditions.length) {
    m.healthConditions.forEach(cond => {
      addCondition('condContainer');
      const rows = condContainer.querySelectorAll('.cond-row');
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        lastRow.querySelector('.cType').value = cond.condition || '';
        lastRow.querySelector('.cSev').value = cond.severity || 'Mild';
        lastRow.querySelector('.cNote').value = cond.notes || '';
      }
    });
  }

  // 4. Re-open Add modal so the user can edit
  openModal('addMemberModal');
}

async function confirmPayment() {
  if (!curPayMember) return;
  if (!curPayMethod) { toast('Please select a payment method','error'); return; }

  const method = curPayMethod;
  const total = curPayTotal || 0;
  const paymentDate = document.getElementById('payRenewalPayDate')?.value || getLocalTodayStr();

  // ── Collecting a pending/due balance (not a new payment or renewal) ──
  if (curPayMember.mode === 'due') {
    const received = Math.max(0, Math.min(total, parseFloat(document.getElementById('payAmountReceived')?.value) || total));
    const dateVal = new Date(paymentDate);

    const btn = document.getElementById('confirmPayBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
    try {
      const cached = allMembersCache.find(x => (x._id||x.id) === curPayMember.id) || {};
      const remainingBefore = Number(cached.pendingAmount) || total;
      const remainingDue = Math.max(0, remainingBefore - received);
      const history = cached.paymentHistory || [];

      let updatedHistory, receiptForShare;

      if (remainingDue === 0) {
        // Fully cleared now — collapse every prior undifferentiated
        // 'partial' entry PLUS this final collection into one clean,
        // one-time itemized breakdown using the member's real fee
        // amounts. This is what stops the "divided twice" confusion:
        // nothing gets attributed to Plan/Admission/PT until this exact
        // moment, and it only happens once.
        const partialEntries = history.filter(p => p.type === 'partial');
        const keptEntries = history.filter(p => p.type !== 'partial');

        let combinedUpi = 0, combinedCash = 0;
        partialEntries.forEach(p => {
          if (p.method === 'upi') combinedUpi += p.amount || 0; else combinedCash += p.amount || 0;
        });
        if (method === 'split') {
          const upiNow = Math.max(0, Math.min(received, parseFloat(document.getElementById('splitUpiAmt')?.value) || 0));
          combinedUpi += upiNow; combinedCash += (received - upiNow);
        } else if (method === 'upi') {
          combinedUpi += received;
        } else {
          combinedCash += received;
        }

        const breakdown = {
          plan: Number(cached.planPrice) || 0,
          admission: (cached.admissionWaived ? 0 : (Number(cached.admissionFee) || 0)),
          pt: (cached.ptEnabled ? (Number(cached.ptFee) || 0) : 0)
        };
        const finalEntries = finalizeFullBreakdownEntries(breakdown, { upi: combinedUpi, cash: combinedCash }, dateVal, 'REC-DUE');
        updatedHistory = [...keptEntries, ...finalEntries];
        receiptForShare = finalEntries[0]?.receiptNo;
      } else {
        // Still not fully paid — just log this collection as another
        // undifferentiated partial entry, same as the original payment.
        const partialNew = buildPartialEntries(received, method, dateVal, 'REC-DUE');
        updatedHistory = [...history, ...partialNew];
        receiptForShare = partialNew[0]?.receiptNo;
      }

      const res = await fetch(`${API}/${curPayMember.id}`, {
        method: 'PUT', headers: hdrs(),
        body: JSON.stringify({
          pendingAmount: remainingDue,
          lastPaymentDate: dateVal,
          lastPaymentMethod: method,
          lastPaymentAmount: received,
          paymentHistory: updatedHistory
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const methodLabel = { upi:'📱 UPI', cash:'💵 Cash', card:'💳 Card' }[method] || method;
      toast(remainingDue > 0
        ? `✅ ${methodLabel} ₹${received.toLocaleString('en-IN')} received — ₹${remainingDue.toLocaleString('en-IN')} still pending`
        : `✅ ${methodLabel} ₹${received.toLocaleString('en-IN')} received — fully paid!`, 'success');

      closeModal('paymentModal');
      const dueName = curPayMember.name, dueId = curPayMember.id;
      curPayMember = null; curPayMethod = null;
      loadDashboard(); loadAllMembers(); loadPayments();
      showReceiptOptions(dueId, dueName, received, remainingDue, method, receiptForShare);
    } catch (e) {
      toast(`❌ ${e.message || 'Network error — check connection'}`, 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirm Payment'; }
    return;
  }

  if (curPayMember.isNew) {
    const m = curPayMember.originalData;
    // FIX: Use explicit stored field values (not derived from total) to guarantee
    // correct split - avoids planAmt absorbing admission/PT when fields are undefined.
    const admAmt  = (m.admissionWaived === true || !m.admissionFee) ? 0 : (Number(m.admissionFee) || 0);
    const ptAmt   = (m.ptEnabled && m.ptFee > 0) ? (Number(m.ptFee) || 0) : 0;
    const planAmt = (Number(m.planPrice) > 0) ? Number(m.planPrice) : Math.max(0, total - admAmt - ptAmt);

    const receivedNew = Math.max(0, Math.min(total, parseFloat(document.getElementById('payAmountReceived')?.value) || total));
    const pendingNew = Math.max(0, total - receivedNew);

    // IMPORTANT: a partial payment is logged as one undifferentiated entry
    // (counts toward revenue immediately, but not attributed to any fee
    // category yet) — only once the FULL amount is in do we itemize into
    // real Plan/Admission/PT amounts. Splitting a partial amount into
    // guessed proportions, then splitting AGAIN when the rest is collected
    // later, produced confusing double-divided numbers in the history.
    let entries;
    if (pendingNew > 0) {
      entries = buildPartialEntries(receivedNew, method, new Date(paymentDate), 'REC');
    } else {
      const methodTotals = method === 'split'
        ? (() => {
            const upiAmt = Math.max(0, Math.min(receivedNew, parseFloat(document.getElementById('splitUpiAmt')?.value) || 0));
            return { upi: upiAmt, cash: receivedNew - upiAmt };
          })()
        : (method === 'upi' ? { upi: receivedNew, cash: 0 } : { upi: 0, cash: receivedNew });
      entries = finalizeFullBreakdownEntries(
        { plan: planAmt, admission: admAmt, pt: ptAmt },
        methodTotals, new Date(paymentDate), 'REC'
      );
    }

    const btn = document.getElementById('confirmPayBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }
    let addedMemberForReceipt = null;
    try {
      await fetch(`${API}/${curPayMember.id}`, {
        method: 'PUT', headers: hdrs(),
        body: JSON.stringify({
          paymentHistory: entries,
          lastPaymentDate: new Date(paymentDate),
          lastPaymentMethod: method,
          lastPaymentAmount: receivedNew,
          pendingAmount: pendingNew
        })
      });
      const methodLabel = { upi:'📱 UPI', cash:'💵 Cash', card:'💳 Card' }[method] || method;
      toast(pendingNew > 0
        ? `✅ Member added — ${methodLabel} ₹${receivedNew.toLocaleString('en-IN')} received, ₹${pendingNew.toLocaleString('en-IN')} pending`
        : `✅ Member added — ${methodLabel} payment confirmed!`, 'success');
      addedMemberForReceipt = { name: curPayMember.name, id: curPayMember.id };
    } catch(e) {
      toast('Member added but payment record failed', 'error');
    }
    closeModal('paymentModal');
    curPayMember = null; curPayMethod = null;
    loadDashboard(); loadAllMembers();
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirm Payment'; }
    if (addedMemberForReceipt) showReceiptOptions(addedMemberForReceipt.id, addedMemberForReceipt.name, receivedNew, pendingNew, method, entries[0]?.receiptNo);
    return;
  }

  // Renewal
  const planSel = document.getElementById('payPlan');
  const planName = planSel.value;
  const isPt = document.getElementById('payPtEnabled')?.checked || false;
  const ptAmt = isPt ? (parseFloat(document.getElementById('payPtFee')?.value) || 0) : 0;
  const ptTrainer = isPt ? document.getElementById('payPtTrainer')?.value || '' : '';

  const renewDType = document.querySelector('input[name="payDType"]:checked')?.value || 'none';
  const renewDVal = parseFloat((document.getElementById('payDiscValue')?.value||'').replace(/,/g,'')) || 0;
  const renewDReason = document.getElementById('payDiscReason')?.value?.trim() || '';

  const expiryDateEl = document.getElementById('payExpiryDate');
  const chosenPayDate = paymentDate ? new Date(paymentDate) : new Date();

  const newExpiry = expiryDateEl && expiryDateEl.value ? expiryDateEl.value : (() => {
    let baseDate = new Date(); baseDate.setHours(0,0,0,0);
    if (curPayMember.expiryDate) {
      const p = curPayMember.expiryDate.split('T')[0].split('-');
      const d = new Date(+p[0], +p[1]-1, +p[2]);
      if (d > new Date()) baseDate = d;
    }
    baseDate.setMonth(baseDate.getMonth() + getPlanMonths(planName));
    return baseDate.toISOString().split('T')[0];
  })();

  // FIX: split `total` so the plan entry doesn't also contain the PT fee
  // that gets pushed separately below (previously double-counted PT).
  const planAmt = Math.max(0, total - (isPt ? ptAmt : 0));

  const btn = document.getElementById('confirmPayBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  const receivedRenew = Math.max(0, Math.min(total, parseFloat(document.getElementById('payAmountReceived')?.value) || total));
  const pendingRenew = Math.max(0, total - receivedRenew);

  // Same fix as the new-member flow: partial payments stay
  // undifferentiated until fully cleared; renewals never charge
  // admission, so that share is always 0.
  let renewEntries;
  if (pendingRenew > 0) {
    renewEntries = buildPartialEntries(receivedRenew, method, chosenPayDate, 'REC');
  } else {
    const methodTotals = method === 'split'
      ? (() => {
          const upiAmt = Math.max(0, Math.min(receivedRenew, parseFloat(document.getElementById('splitUpiAmt')?.value) || 0));
          return { upi: upiAmt, cash: receivedRenew - upiAmt };
        })()
      : (method === 'upi' ? { upi: receivedRenew, cash: 0 } : { upi: 0, cash: receivedRenew });
    renewEntries = finalizeFullBreakdownEntries(
      { plan: planAmt, admission: 0, pt: (isPt ? ptAmt : 0) },
      methodTotals, chosenPayDate, 'REC'
    );
  }

  try {
    // Use cache for existing history - avoids extra network round-trip and the
    // HTML-response bug that occurred because GET /api/members/:id did not exist.
    const cached = allMembersCache.find(x => (x._id||x.id) === curPayMember.id) || {};
    const renewHistory = [...(cached.paymentHistory || []), ...renewEntries];

    const res = await fetch(`${API}/${curPayMember.id}`, {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({
        plan: planName,
        planPrice: planAmt,
        discountType: renewDType,
        discountValue: renewDVal,
        discountReason: renewDReason,
        ptEnabled: isPt,
        ptFee: ptAmt,
        ptTrainer: ptTrainer,
        expiryDate: newExpiry,
        status: 'Active',
        lastPaymentDate: chosenPayDate,
        lastPaymentMethod: method,
        lastPaymentAmount: receivedRenew,
        pendingAmount: pendingRenew,
        paymentHistory: renewHistory
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || err.message || `Server error ${res.status}`);
    }


    const methodLabel = { upi:'📱 UPI', cash:'💵 Cash', card:'💳 Card' }[method] || method;
    const expiryDisplay = new Date(newExpiry).toLocaleDateString('en-IN');
    toast(pendingRenew > 0
      ? `✅ Renewed until ${expiryDisplay} — ₹${pendingRenew.toLocaleString('en-IN')} still pending`
      : `✅ ${methodLabel} — Renewed until ${expiryDisplay}`, 'success');
    closeModal('paymentModal');
    const renewedName = curPayMember.name, renewedId = curPayMember.id;
    curPayMember = null; curPayMethod = null;
    loadDashboard(); loadPayments(); loadAllMembers();
    showReceiptOptions(renewedId, renewedName, receivedRenew, pendingRenew, method, renewEntries[0]?.receiptNo);
  } catch(e) {
    toast(`❌ ${e.message || 'Network error — check connection'}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirm Payment'; }
  }
}

/* ── SETTINGS ── */
function loadSettings() {
  const upiIdEl = document.getElementById('sUpiId');
  const upiNameEl = document.getElementById('sUpiName');
  const admFeeEl = document.getElementById('sAdmFee');
  const ptFeeEl = document.getElementById('sPtFee');
  if (upiIdEl) upiIdEl.value = gymCfg.upiId || '';
  if (upiNameEl) upiNameEl.value = gymCfg.upiName || '';
  if (admFeeEl) admFeeEl.value = gymCfg.admissionFee != null ? gymCfg.admissionFee : '';
  if (ptFeeEl) ptFeeEl.value = gymCfg.ptFee != null ? gymCfg.ptFee : '';
}

async function saveSettings() {
  const upiId = document.getElementById('sUpiId')?.value.trim() || '';
  const upiName = document.getElementById('sUpiName')?.value.trim() || '';
  const admissionFee = parseFloat(document.getElementById('sAdmFee')?.value) || 0;
  const ptFee = parseFloat(document.getElementById('sPtFee')?.value) || 0;
  gymCfg.upiId = upiId; 
  gymCfg.upiName = upiName;
  gymCfg.admissionFee = admissionFee; 
  gymCfg.ptFee = ptFee;
  await saveServerProfile();
  toast('Settings saved & synced!', 'success');
}

/* ── EXTERNAL ACTIONS ── */
function dialPhone(phone) {
  window.location.href = 'tel:' + String(phone).replace(/[^0-9+]/g,'');
}

function openWhatsApp(phone) {
  const clean = String(phone).replace(/[^0-9]/g, '');
  const num = clean.startsWith('91') ? clean : '91' + clean;
  const url = 'https://wa.me/' + num;
  const isAndroidWebView = /wv/.test(navigator.userAgent) ||
    (/Android/i.test(navigator.userAgent) && /Version\//.test(navigator.userAgent));
  if (isAndroidWebView) {
    window.location.href = url;
  } else {
    window.open(url, '_blank');
  }
}

/* ── INIT ── */

/* ══════════════════════════════════════════════════════════════
   PT BLOCK  -  members grouped by their assigned trainer
══════════════════════════════════════════════════════════════ */
async function loadPtBlock() {
  const wrap = document.getElementById('ptBlockWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty"><div class="ei">⏳</div><p>Loading PT members…</p></div>';
  try {
    const [mRes, tRes] = await Promise.all([
      fetch(API, { headers: hdrs() }),
      fetch(TAPI, { headers: hdrs() })
    ]);
    if (mRes.status === 401) { logout(); return; }
    const members = await mRes.json();
    const trainers = tRes.ok ? await tRes.json() : [];

    // Refresh trainerMap
    trainers.forEach(t => { trainerMap[t._id] = t.name; });

    // Group PT members by trainer
    const groups = {};
    members.filter(m => !m.isDeleted).forEach(m => {
      if (!m.ptEnabled || !m.ptTrainer) return;
      const tid = m.ptTrainer;
      if (!groups[tid]) groups[tid] = { tname: trainerMap[tid] || 'Unknown Trainer', members: [] };
      groups[tid].members.push(m);
    });

    // Update cache
    allMembersCache = members;

    const trainerKeys = Object.keys(groups);
    if (!trainerKeys.length) {
      wrap.innerHTML = '<div class="empty"><div class="ei">🏋️</div><p>No members enrolled in Personal Training yet.</p></div>';
      return;
    }

    const colors = ['#1A8C8C','#27AE60','#E74C3C','#F39C12','#8E44AD','#2980B9'];

    wrap.innerHTML = trainerKeys.map((tid, idx) => {
      const grp = groups[tid];
      const tname = grp.tname;
      const initials = tname.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2);
      const bg = colors[tname.charCodeAt(0) % colors.length];

      const mRows = grp.members.map(m => {
        const expDate = m.expiryDate ? new Date(m.expiryDate).toLocaleDateString('en-IN') : '-';
        const today = new Date(); today.setHours(0,0,0,0);
        const exp = m.expiryDate ? new Date(m.expiryDate) : null;
        const daysLeft = exp ? Math.ceil((exp - today) / (1000*60*60*24)) : null;
        const isActive = m.status === 'Active';
        const expWarning = daysLeft !== null && daysLeft <= 7
          ? `<span style="background:#FEF9E7;color:#F39C12;padding:2px 7px;border-radius:10px;font-size:.6rem;font-weight:800;margin-left:4px">${daysLeft<=0?'Expired':`${daysLeft}d left`}</span>` : '';

        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #F0F5F5">
          ${avImg(m)}
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.92rem;color:#1A2E2E;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}${expWarning}</div>
            <div style="font-size:.72rem;color:#4A6464;margin-top:1px">📱 ${esc(m.phone||'')} • PT ₹${m.ptFee||0}/mo</div>
            <div style="font-size:.68rem;color:#8AABAB;margin-top:1px">${esc(m.plan||'')} • Exp: ${expDate}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
            <span style="background:${isActive?'#E8F8EF':'#F3F4F6'};color:${isActive?'#27AE60':'#6B7280'};padding:2px 9px;border-radius:12px;font-size:.62rem;font-weight:800">${esc(m.status||'')}</span>
            <div style="display:flex;gap:4px">
              <button onclick="dialPhone('${esc(m.phone||'')}')" title="Call" style="width:30px;height:30px;border:none;border-radius:8px;background:#E8F8EF;cursor:pointer;font-size:.85rem">📞</button>
              <button onclick="sendAttendanceReport('${esc(m._id||'')}','${esc(m.phone||'')}','${esc(m.name||'').replace(/'/g,'')}')" title="Send Attendance Report" style="width:30px;height:30px;border:none;border-radius:8px;background:#E3F2FD;cursor:pointer;font-size:.85rem">📊</button>
              <button onclick="sendPaymentReminder('${esc(m._id||'')}','${esc(m.phone||'')}','${esc(m.name||'').replace(/'/g,'')}')" title="Payment Reminder" style="width:30px;height:30px;border:none;border-radius:8px;background:#FEF9E7;cursor:pointer;font-size:.85rem">💰</button>
            </div>
          </div>
        </div>`;
      }).join('');

      return `<div style="background:#fff;border-radius:18px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06);border:1px solid #E0ECEC">
        <div style="background:linear-gradient(135deg,${bg},${bg}CC);padding:14px 16px;display:flex;align-items:center;gap:12px">
          <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800;color:#fff;flex-shrink:0">${esc(initials)}</div>
          <div style="flex:1">
            <div style="font-size:1rem;font-weight:800;color:#fff">${esc(tname)}</div>
            <div style="font-size:.72rem;color:rgba(255,255,255,.75);margin-top:2px">👥 ${grp.members.length} PT Member${grp.members.length>1?'s':''}</div>
          </div>
          <button onclick="sendBulkAttendance('${esc(tid)}','${esc(tname)}')"
            style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:10px;padding:6px 12px;font-family:inherit;font-size:.72rem;font-weight:800;cursor:pointer;white-space:nowrap">
            📤 Report All
          </button>
        </div>
        ${mRows}
      </div>`;
    }).join('');

  } catch(e) {
    wrap.innerHTML = `<div class="empty"><div class="ei">⚠️</div><p style="color:#E74C3C">Error loading PT data</p></div>`;
    console.error(e);
  }
}

/* ══════════════════════════════════════════════════════════════
   ATTENDANCE REPORT  -  builds this month's report via WhatsApp
══════════════════════════════════════════════════════════════ */
async function sendAttendanceReport(memberId, phone, name) {
  toast('Building report…', '');
  try {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = String(now.getMonth()+1).padStart(2,'0');
    const monthKey = `${yr}-${mo}`;
    const monthName = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    // Fetch attendance for the member for this month
    const res = await fetch(`${API}`, { headers: hdrs() });
    let presentDays = [], totalDays = 0;

    if (res.ok) {
      // Use local attendance cache which is date-keyed
      const allDays = Object.keys(_attCache || {}).filter(d => d.startsWith(monthKey));
      totalDays = allDays.length;
      allDays.forEach(d => {
        if (_attCache[d] && _attCache[d][memberId] === 'Present') {
          presentDays.push(new Date(d).getDate());
        }
      });
    }

    const totalPresent = presentDays.length;
    const absent = totalDays - totalPresent;
    const daysStr = presentDays.sort((a,b)=>a-b).join(', ') || 'No records yet';

    const msg =
`*🏋️ ${getGymName()} Attendance Report*
Member: *${name}*
Month: *${monthName}*

✅ Present: *${totalPresent} day${totalPresent!==1?'s':''}*
📅 Dates: ${daysStr}
❌ Absent: *${absent >= 0 ? absent : 0} day${absent!==1?'s':''}*

Keep pushing! 💪
- ${getGymName()} Management`;

    const clean = String(phone).replace(/[^0-9]/g, '');
    const num = clean.startsWith('91') ? clean : '91' + clean;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
    toast(`Report sent to ${name}`, 'success');
  } catch(e) {
    toast('Failed to build report', 'error');
    console.error(e);
  }
}

/* ══════════════════════════════════════════════════════════════
   PAYMENT REMINDER  -  renewal reminder via WhatsApp
══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   RECEIPT SHARING  -  sends a payment receipt to the member via WhatsApp
══════════════════════════════════════════════════════════════ */
function shareReceiptFor(memberId, name, amountReceived, pendingAmount, method, receiptNo) {
  try {
    const m = allMembersCache.find(x => (x._id||x.id) === memberId);
    const phone = m?.phone;
    if (!phone) return; // no phone on file, skip silently
    const methodLabel = { upi:'📱 UPI', cash:'💵 Cash', card:'💳 Card' }[method] || (method || 'Cash');
    const dateStr = new Date().toLocaleDateString('en-IN');

    let msg =
`🧾 *${getGymName()} — Payment Receipt*

Hi *${name}*,
Thank you for your payment!

Receipt No: *${receiptNo || 'REC-' + Date.now()}*
Date: *${dateStr}*
Amount Received: *₹${Number(amountReceived).toLocaleString('en-IN')}*
Method: *${methodLabel}*`;

    if (pendingAmount > 0) {
      msg += `\n\n⚠️ *Pending Balance: ₹${Number(pendingAmount).toLocaleString('en-IN')}*\nPlease clear this at your earliest convenience.`;
    } else {
      msg += `\n\n✅ *Fully Paid*`;
    }

    msg += `\n\n- ${getGymName()} Management`;

    const clean = String(phone).replace(/[^0-9]/g, '');
    const num = clean.startsWith('91') ? clean : '91' + clean;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  } catch (e) {
    console.error('Receipt share failed', e);
  }
}
/* Show the Success Modal to choose between Print or WhatsApp */
function showReceiptOptions(memberId, name, amountReceived, pendingAmount, method, receiptNo) {
  const modal = document.getElementById('receiptModal');
  if (!modal) return;
  
  document.getElementById('receiptMemberName').textContent = name;
  document.getElementById('receiptDetails').innerHTML = `Amount Paid: ₹${Number(amountReceived).toLocaleString('en-IN')}<br>Receipt: ${receiptNo || 'N/A'}`;
  
  const btnShare = document.getElementById('btnShareWa');
  const btnPrint = document.getElementById('btnPrintReceipt');
  
  btnShare.onclick = () => {
    shareReceiptFor(memberId, name, amountReceived, pendingAmount, method, receiptNo);
    closeModal('receiptModal');
  };
  
  btnPrint.onclick = () => {
    printReceipt(name, amountReceived, pendingAmount, method, receiptNo);
    closeModal('receiptModal');
  };
  
  openModal('receiptModal');
}

/* Generates a thermal-printer friendly receipt and opens print dialog */
function printReceipt(name, amountReceived, pendingAmount, method, receiptNo) {
  const gymName = getGymName();
  const dateStr = new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN', {hour: '2-digit', minute:'2-digit'});
  const methodLabel = { upi:'UPI', cash:'Cash', card:'Card', split:'Split' }[method] || method;
  
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) {
    toast('Pop-up blocked! Please allow pop-ups to print.', 'error');
    return;
  }
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt - ${receiptNo || 'GymPro'}</title>
      <style>
        body { font-family: 'Courier New', Courier, monospace; padding: 20px; max-width: 300px; margin: 0 auto; color: #000; }
        .center { text-align: center; }
        h2 { margin: 0 0 5px 0; font-size: 1.3rem; }
        .divider { border-bottom: 1px dashed #000; margin: 12px 0; }
        .row { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 6px; }
        .bold { font-weight: bold; }
        @media print {
          @page { margin: 0; }
          body { padding: 10px; }
        }
      </style>
    </head>
    <body>
      <div class="center">
        <h2>${esc(gymName)}</h2>
        <div style="font-size:0.8rem; margin-bottom:10px">${dateStr}</div>
      </div>
      <div class="divider"></div>
      <div class="row"><span>Receipt No:</span> <span class="bold">${esc(receiptNo || 'N/A')}</span></div>
      <div class="row"><span>Member:</span> <span class="bold">${esc(name)}</span></div>
      <div class="divider"></div>
      <div class="row"><span>Amount Paid:</span> <span class="bold">Rs. ${Number(amountReceived).toLocaleString('en-IN')}</span></div>
      <div class="row"><span>Method:</span> <span>${esc(methodLabel)}</span></div>
      ${pendingAmount > 0 
        ? `<div class="row" style="margin-top:10px"><span>Pending Due:</span> <span class="bold">Rs. ${Number(pendingAmount).toLocaleString('en-IN')}</span></div>` 
        : `<div class="row" style="margin-top:10px"><span>Status:</span> <span class="bold">Fully Paid</span></div>`}
      <div class="divider"></div>
      <div class="center" style="font-size:0.8rem; margin-top:20px">Thank you!</div>
      
      <script>
        window.onload = () => { 
          window.print(); 
          setTimeout(() => window.close(), 500); 
        }
      </script>
    </body>
    </html>
  `;
  
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

/* Manually re-share the receipt for a member's most recent payment
   (e.g. from a "📄 Receipt" button on their card). */
function shareLastReceipt(memberId) {
  const m = allMembersCache.find(x => (x._id||x.id) === memberId);
  if (!m || !m.paymentHistory || !m.paymentHistory.length) {
    toast('No payment history to share yet', 'error');
    return;
  }
  const last = [...m.paymentHistory].sort((a,b) => new Date(b.date) - new Date(a.date))[0];
  showReceiptOptions(memberId, m.name, last.amount, m.pendingAmount || 0, last.method, last.receiptNo);
}

async function sendPaymentReminder(memberId, phone, name) {
  try {
    const m = allMembersCache.find(x => (x._id||x.id) === memberId) || {};
    const expDate = m.expiryDate ? new Date(m.expiryDate).toLocaleDateString('en-IN') : 'soon';
    const plan = m.plan || 'your plan';
    const today = new Date(); today.setHours(0,0,0,0);
    const exp = m.expiryDate ? new Date(m.expiryDate) : null;
    exp && exp.setHours(0,0,0,0);
    const daysLeft = exp ? Math.ceil((exp - today) / (1000*60*60*24)) : null;

    let urgencyLine = '';
    if (daysLeft !== null) {
      if (daysLeft < 0) urgencyLine = `⚠️ *Membership expired ${Math.abs(daysLeft)} days ago!*`;
      else if (daysLeft === 0) urgencyLine = `⚠️ *Membership expires TODAY!*`;
      else urgencyLine = `⏰ *${daysLeft} day${daysLeft>1?'s':''} remaining*`;
    }

    const msg =
`🏋️ *${getGymName()} Membership Reminder*

Hi *${name}*,
${urgencyLine}

📋 Plan: *${plan}*
📅 Expiry: *${expDate}*

Please renew your membership to continue your fitness journey without interruption. 💪

Contact us to renew today!
- ${getGymName()} Management`;

    const clean = String(phone).replace(/[^0-9]/g, '');
    const num = clean.startsWith('91') ? clean : '91' + clean;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
    toast(`Reminder sent to ${name}`, 'success');
  } catch(e) {
    toast('Error sending reminder', 'error');
  }
}

/* Send attendance report to all PT members of a trainer */
async function sendBulkAttendance(trainerId, trainerName) {
  const ptMembers = allMembersCache.filter(m => m.ptEnabled && m.ptTrainer === trainerId);
  if (!ptMembers.length) { toast('No PT members for this trainer', 'error'); return; }
  toast(`Sending reports to ${ptMembers.length} members…`, '');
  for (const m of ptMembers) {
    await sendAttendanceReport(m._id||m.id, m.phone, m.name);
    await new Promise(r => setTimeout(r, 800));
  }
  toast('All reports sent!', 'success');
}

/* Send payment reminder to member from member card (also usable from dashboard) */
async function sendReminderFromCard(memberId) {
  const m = allMembersCache.find(x => (x._id||x.id) === memberId);
  if (!m) { toast('Member not found', 'error'); return; }
  await sendPaymentReminder(m._id||m.id, m.phone, m.name);
}




/* ================================================================
   SUPERADMIN FUNCTIONS
================================================================ */
let _saRejectId = null;
let _saRejectKind = 'admin';

async function loadSuperAdminData() {
  await Promise.all([loadSaPending(), loadSaPendingGyms(), loadSaGyms()]);
}

async function loadSaPending() {
  const el = document.getElementById('saPendingList');
  try {
    const res = await fetch(`${BASE}/auth/pending-approvals`, { headers: hdrs() });
    if (res.status === 401) { logout(); return; }
    const list = await res.json();
    document.getElementById('saPending').textContent = list.length;
    document.getElementById('saPendingBadge').textContent = list.length;
    if (!list.length) {
      el.innerHTML = '<div class="empty"><div class="ei">&#x2705;</div><p>No pending approvals</p></div>';
      return;
    }
    el.innerHTML = list.map(u => `
      <div style="padding:14px 16px;border-bottom:1px solid #F0F5F5">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#1A8C8C,#27AE60);
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;font-weight:800;flex-shrink:0">
            ${esc((u.gymName||u.name||'G')[0].toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.95rem;color:#1A2E2E">${esc(u.gymName||'Unnamed Gym')}</div>
            <div style="font-size:.75rem;color:#4A6464;margin-top:1px">&#x1F464; ${esc(u.name)} &nbsp;|&nbsp; &#x2709;&#xFE0F; ${esc(u.email)}</div>
            <div style="font-size:.68rem;color:#8AABAB;margin-top:2px">&#x1F4C5; ${new Date(u.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:#F0F5F5;border-radius:10px;padding:6px 10px;margin-bottom:8px">
          <label style="font-size:.68rem;font-weight:700;color:#4A6464;white-space:nowrap">&#x1F465; Member Limit</label>
          <input type="number" id="sa-limit-${esc(u._id)}" placeholder="&#x221E; (unlimited)" min="0" style="flex:1;padding:6px 8px;border:1.5px solid #E0ECEC;border-radius:7px;font-family:inherit;font-size:.78rem">
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="saApprove('${esc(u._id)}','${esc(u.gymName||u.name)}')"
            style="flex:1;padding:9px;background:#27AE60;color:#fff;border:none;border-radius:10px;font-family:inherit;font-weight:700;font-size:.82rem;cursor:pointer">
            &#x2705; Approve Gym
          </button>
          <button onclick="saOpenReject('admin','${esc(u._id)}')"
            style="flex:1;padding:9px;background:#E74C3C;color:#fff;border:none;border-radius:10px;font-family:inherit;font-weight:700;font-size:.82rem;cursor:pointer">
            &#x274C; Reject
          </button>
        </div>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error loading</p></div>';
  }
}

/* Manage Gym — additional gyms an EXISTING admin added (via + Add Gym in
   their own Manage Gym modal), sitting in the Gym table awaiting this
   superadmin's approval before the owner can switch to them. */
async function loadSaPendingGyms() {
  const el = document.getElementById('saPendingGymsList');
  try {
    const res = await fetch(`${BASE}/admin/pending-gyms`, { headers: hdrs() });
    if (res.status === 401) { logout(); return; }
    const list = await res.json();
    document.getElementById('saPendingGymsCount').textContent = list.length;
    document.getElementById('saPendingGymsBadge').textContent = list.length;
    if (!list.length) {
      el.innerHTML = '<div class="empty"><div class="ei">&#x2705;</div><p>No pending gym requests</p></div>';
      return;
    }
    el.innerHTML = list.map(g => `
      <div style="padding:14px 16px;border-bottom:1px solid #F0F5F5">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#D97706,#F39C12);
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;font-weight:800;flex-shrink:0">
            ${esc((g.name||'G')[0].toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.95rem;color:#1A2E2E">${esc(g.name)}</div>
            <div style="font-size:.75rem;color:#4A6464;margin-top:1px">&#x1F464; ${esc(g.User?.name||'')} &nbsp;|&nbsp; &#x2709;&#xFE0F; ${esc(g.User?.email||'')}</div>
            <div style="font-size:.7rem;color:#8AABAB;margin-top:2px">Already owns: ${esc(g.User?.gymName||'')}</div>
            <div style="font-size:.68rem;color:#8AABAB;margin-top:2px">&#x1F4C5; Requested: ${new Date(g.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:#F0F5F5;border-radius:10px;padding:6px 10px;margin-bottom:8px">
          <label style="font-size:.68rem;font-weight:700;color:#4A6464;white-space:nowrap">&#x1F465; Member Limit</label>
          <input type="number" id="sa-limit-gym-${esc(String(g.id))}" placeholder="&#x221E; (unlimited)" min="0" style="flex:1;padding:6px 8px;border:1.5px solid #E0ECEC;border-radius:7px;font-family:inherit;font-size:.78rem">
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="saApproveGym('${esc(String(g.id))}','${esc(g.name)}')"
            style="flex:1;padding:9px;background:#27AE60;color:#fff;border:none;border-radius:10px;font-family:inherit;font-weight:700;font-size:.82rem;cursor:pointer">
            &#x2705; Approve Gym
          </button>
          <button onclick="saOpenReject('gym','${esc(String(g.id))}')"
            style="flex:1;padding:9px;background:#E74C3C;color:#fff;border:none;border-radius:10px;font-family:inherit;font-weight:700;font-size:.82rem;cursor:pointer">
            &#x274C; Reject
          </button>
        </div>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error loading</p></div>';
  }
}

async function loadSaGyms() {
  const el = document.getElementById('saGymsList');
  try {
    const res = await fetch(`${BASE}/admin/all-gyms`, { headers: hdrs() });
    if (!res.ok) throw new Error();
    const gyms = await res.json();
    const active = gyms.filter(g => g.isActive && g.isApproved).length;
    document.getElementById('saActiveCount').textContent = active;
    document.getElementById('saTotal').textContent = gyms.length;
    document.getElementById('saGymsBadge').textContent = gyms.length;
    if (!gyms.length) {
      el.innerHTML = '<div class="empty"><div class="ei">&#x1F3CB;&#xFE0F;</div><p>No gyms registered yet</p></div>';
      return;
    }
    el.innerHTML = gyms.map(u => {
      const active = u.isApproved && u.isActive;
      const statusBg  = active ? '#E8F8EF' : '#FEE2E2';
      const statusClr = active ? '#27AE60' : '#E74C3C';
      const statusLbl = active ? '&#x2705; Active' : '&#x26A0;&#xFE0F; Inactive';
      return `<div style="padding:14px 16px;border-bottom:1px solid #F0F5F5">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#1A8C8C,#2980B9);
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;font-weight:800;flex-shrink:0">
            ${esc((u.gymName||u.name||'G')[0].toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.92rem;color:#1A2E2E">${esc(u.gymName||'Unnamed Gym')}</div>
            <div style="font-size:.72rem;color:#4A6464;margin-top:1px">${esc(u.name)} &mdash; ${esc(u.email)}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
              <span style="background:${statusBg};color:${statusClr};padding:2px 9px;border-radius:12px;font-size:.65rem;font-weight:800">${statusLbl}</span>
              <span style="font-size:.65rem;color:#8AABAB">Last login: ${u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('en-IN') : 'Never'}</span>
            </div>
          </div>
          <button onclick="saToggleGym('${esc(u._id)}')"
            style="padding:7px 11px;border-radius:9px;border:1px solid #E0ECEC;background:#F0F5F5;
            font-family:inherit;font-size:.7rem;font-weight:700;cursor:pointer;flex-shrink:0">
            ${active ? '&#x1F534; Block' : '&#x1F7E2; Enable'}
          </button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:#F0F5F5;border-radius:10px;padding:6px 10px;margin-top:10px">
          <label style="font-size:.68rem;font-weight:700;color:#4A6464;white-space:nowrap">&#x1F465; Member Limit</label>
          <input type="number" id="sa-editlimit-${esc(u._id)}" value="${u.memberLimit != null ? u.memberLimit : ''}" placeholder="&#x221E; (unlimited)" min="0" style="flex:1;padding:6px 8px;border:1.5px solid #E0ECEC;border-radius:7px;font-family:inherit;font-size:.78rem">
          <button onclick="saSetLimit('${esc(u._id)}','${esc(u.gymName||u.name)}')"
            style="padding:6px 12px;border-radius:7px;border:none;background:#1A8C8C;color:#fff;font-family:inherit;font-size:.7rem;font-weight:700;cursor:pointer;flex-shrink:0">Save</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error loading gyms</p></div>';
  }
}

async function saSetLimit(userId, name) {
  const input = document.getElementById(`sa-editlimit-${userId}`);
  const limitVal = input && input.value.trim() !== '' ? Number(input.value) : null;
  try {
    const res = await fetch(`${BASE}/admin/gym/${userId}/member-limit`, {
      method: 'PATCH', headers: hdrs(),
      body: JSON.stringify({ limit: limitVal })
    });
    const data = await res.json();
    if (res.ok) { toast(data.message || `${name} limit updated`, 'success'); }
    else toast(data.error || 'Failed to update limit', 'error');
  } catch(e) { toast('Network error', 'error'); }
}

async function saApprove(userId, name) {
  const limitInput = document.getElementById(`sa-limit-${userId}`);
  const limitVal = limitInput && limitInput.value.trim() !== '' ? Number(limitInput.value) : null;
  try {
    const res = await fetch(`${BASE}/auth/approve/${userId}`, {
      method:'POST', headers:hdrs(),
      body: JSON.stringify({ memberLimit: limitVal })
    });
    const data = await res.json();
    if (res.ok) { toast(`&#x2705; ${name} approved${limitVal ? ` &mdash; limit: ${limitVal} members` : ''}!`, 'success'); loadSuperAdminData(); }
    else toast(data.error||'Failed', 'error');
  } catch(e) { toast('Network error','error'); }
}

/* Manage Gym — approve/reject an additional gym an existing admin added */
async function saApproveGym(gymId, name) {
  const limitInput = document.getElementById(`sa-limit-gym-${gymId}`);
  const limitVal = limitInput && limitInput.value.trim() !== '' ? Number(limitInput.value) : null;
  try {
    const res = await fetch(`${BASE}/admin/approve-gym/${gymId}`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ memberLimit: limitVal })
    });
    const data = await res.json();
    if (res.ok) { toast(data.message || `${name} approved${limitVal ? ` &mdash; limit: ${limitVal} members` : ''}`, 'success'); loadSuperAdminData(); }
    else toast(data.error || 'Failed to approve', 'error');
  } catch(e) { toast('Network error', 'error'); }
}

function saOpenReject(kind, id) {
  _saRejectKind = kind; // 'admin' (new gym owner registration) or 'gym' (additional gym request)
  _saRejectId = id;
  const titleEl = document.getElementById('saRejectModalTitle');
  if (titleEl) titleEl.textContent = kind === 'gym' ? '\u274C Reject Additional Gym Request' : '\u274C Reject Registration';
  document.getElementById('saRejectReason').value = '';
  document.getElementById('saRejectModal').style.display = 'flex';
}

async function confirmSaReject() {
  const reason = document.getElementById('saRejectReason').value.trim() || 'Not approved.';
  const url = _saRejectKind === 'gym'
    ? `${BASE}/admin/reject-gym/${_saRejectId}`
    : `${BASE}/auth/reject/${_saRejectId}`;
  try {
    const res = await fetch(url, {
      method:'POST', headers:hdrs(), body:JSON.stringify({ reason })
    });
    const data = await res.json();
    if (res.ok) {
      toast('Rejected', 'success');
      document.getElementById('saRejectModal').style.display = 'none';
      loadSuperAdminData();
    } else toast(data.error||'Failed','error');
  } catch(e) { toast('Network error','error'); }
}

async function saToggleGym(userId) {
  try {
    const res = await fetch(`${BASE}/admin/user/${userId}/toggle`, { method:'PATCH', headers:hdrs() });
    const data = await res.json();
    if (res.ok) { toast(data.message,'success'); loadSaGyms(); }
    else toast('Failed','error');
  } catch(e) { toast('Network error','error'); }
}

/* ================================================================
   GYM ADMIN FUNCTIONS
================================================================ */
async function loadGymAdminData() {
  await Promise.all([loadGaPending(), loadGaStaff(), loadGaResets()]);
}

async function loadGaResets() {
  const el = document.getElementById('gaResetList');
  if (!el) return;
  try {
    const res = await fetch(`${BASE}/admin/pending-staff-password-resets`, { headers: hdrs() });
    if (!res.ok) throw new Error();
    const list = await res.json();
    const badge = document.getElementById('gaResetBadge');
    if (badge) badge.textContent = list.length;
    if (!list.length) {
      el.innerHTML = '<div class="empty"><div class="ei">&#x2705;</div><p>No pending requests</p></div>';
      return;
    }
    el.innerHTML = list.map(s => `
      <div style="padding:12px 16px;border-bottom:1px solid #F0F5F5">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#E74C3C,#C0392B);
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:.9rem;font-weight:800;flex-shrink:0">
            ${esc((s.name||'?')[0].toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.9rem;color:#1A2E2E">${esc(s.name)}</div>
            <div style="font-size:.72rem;color:#8AABAB">${esc(s.email)}</div>
            <div style="font-size:.65rem;color:#B0C4C4;margin-top:1px">&#x1F4C5; ${s.resetRequestedAt ? new Date(s.resetRequestedAt).toLocaleDateString('en-IN') : ''}</div>
          </div>
        </div>
        <input type="text" id="staffnewpwd-${esc(s._id)}" placeholder="New password (6+ chars)"
          style="width:100%;padding:9px 11px;border:2px solid #E0ECEC;border-radius:9px;font-family:inherit;font-size:.82rem;margin-bottom:8px">
        <div style="display:flex;gap:7px">
          <button onclick="gaApproveReset('${esc(s._id)}','${esc(s.name)}')"
            style="flex:1;padding:8px;background:#27AE60;color:#fff;border:none;border-radius:9px;font-family:inherit;font-weight:700;font-size:.8rem;cursor:pointer">
            &#x2705; Set & Approve
          </button>
          <button onclick="gaRejectReset('${esc(s._id)}','${esc(s.name)}')"
            style="flex:1;padding:8px;background:#E74C3C;color:#fff;border:none;border-radius:9px;font-family:inherit;font-weight:700;font-size:.8rem;cursor:pointer">
            &#x274C; Dismiss
          </button>
        </div>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error</p></div>';
  }
}

async function gaApproveReset(staffId, name) {
  const pwdInput = document.getElementById(`staffnewpwd-${staffId}`);
  const newPassword = pwdInput ? pwdInput.value.trim() : '';
  if (!newPassword || newPassword.length < 6) { toast('Enter a password (6+ characters) first', 'error'); return; }
  try {
    const res = await fetch(`${BASE}/admin/approve-staff-password-reset/${staffId}`, {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ newPassword })
    });
    const data = await res.json();
    if (res.ok) { toast(data.message || `Password reset for ${name}`, 'success'); loadGaResets(); }
    else toast(data.error || 'Failed', 'error');
  } catch(e) { toast('Network error', 'error'); }
}

async function gaRejectReset(staffId, name) {
  try {
    const res = await fetch(`${BASE}/admin/reject-staff-password-reset/${staffId}`, { method: 'POST', headers: hdrs() });
    const data = await res.json();
    if (res.ok) { toast(data.message || 'Dismissed', 'success'); loadGaResets(); }
    else toast(data.error || 'Failed', 'error');
  } catch(e) { toast('Network error', 'error'); }
}

async function loadGaPending() {
  const el = document.getElementById('gaPendingList');
  try {
    const res = await fetch(`${BASE}/auth/pending-staff`, { headers: hdrs() });
    if (!res.ok) throw new Error();
    const list = await res.json();
    document.getElementById('gaPendingCount').textContent = list.length;
    document.getElementById('gaStaffBadge').textContent = list.length;
    if (!list.length) {
      el.innerHTML = '<div class="empty"><div class="ei">&#x2705;</div><p>No pending staff requests</p></div>';
      return;
    }
    el.innerHTML = list.map(s => `
      <div style="padding:12px 16px;border-bottom:1px solid #F0F5F5">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#8E44AD,#9B59B6);
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:.9rem;font-weight:800;flex-shrink:0">
            ${esc((s.name||'?')[0].toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.9rem;color:#1A2E2E">${esc(s.name)}</div>
            <div style="font-size:.72rem;color:#8AABAB">${esc(s.email)}</div>
            <div style="font-size:.65rem;color:#B0C4C4;margin-top:1px">&#x1F4C5; ${new Date(s.createdAt).toLocaleDateString('en-IN')}</div>
          </div>
        </div>
        <div style="display:flex;gap:7px">
          <button onclick="gaApproveStaff('${esc(s._id)}','${esc(s.name)}')"
            style="flex:1;padding:8px;background:#27AE60;color:#fff;border:none;border-radius:9px;font-family:inherit;font-weight:700;font-size:.8rem;cursor:pointer">
            &#x2705; Approve
          </button>
          <button onclick="gaRejectStaff('${esc(s._id)}','${esc(s.name)}')"
            style="flex:1;padding:8px;background:#E74C3C;color:#fff;border:none;border-radius:9px;font-family:inherit;font-weight:700;font-size:.8rem;cursor:pointer">
            &#x274C; Reject
          </button>
        </div>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error</p></div>';
  }
}

async function gaApproveStaff(staffId, name) {
  try {
    const res = await fetch(`${BASE}/auth/approve-staff/${staffId}`, { method:'POST', headers:hdrs() });
    const data = await res.json();
    if (res.ok) { toast(`&#x2705; ${name} approved!`, 'success'); loadGymAdminData(); }
    else toast(data.error||'Failed','error');
  } catch(e) { toast('Network error','error'); }
}

async function gaRejectStaff(staffId, name) {
  if (!confirm(`Reject ${name}'s request?`)) return;
  try {
    const res = await fetch(`${BASE}/auth/reject-staff/${staffId}`, {
      method:'POST', headers:hdrs(), body:JSON.stringify({ reason:'Not approved by admin.' })
    });
    const data = await res.json();
    if (res.ok) { toast(`${name} rejected`,'success'); loadGymAdminData(); }
    else toast(data.error||'Failed','error');
  } catch(e) { toast('Network error','error'); }
}

async function loadGaStaff() {
  const el = document.getElementById('gaStaffList');
  try {
    const res = await fetch(`${BASE}/admin/staff`, { headers: hdrs() });
    if (!res.ok) throw new Error();
    const staff = await res.json();
    document.getElementById('gaActiveCount').textContent = staff.filter(s=>s.isActive).length;
    document.getElementById('gaStaffCount').textContent  = staff.length;
    if (!staff.length) {
      el.innerHTML = '<div class="empty"><div class="ei">&#x1F465;</div><p>No staff yet</p></div>';
      return;
    }
    const permsMap = [
      {key:'viewMembers',icon:'&#x1F465;',label:'Members'},
      {key:'viewAttendance',icon:'&#x1F4C5;',label:'Attendance'},
      {key:'viewPayments',icon:'&#x1F4B3;',label:'Payments'},
      {key:'viewTrainers',icon:'&#x1F4AA;',label:'Trainers'},
      {key:'viewRevenue',icon:'&#x1F4C8;',label:'Revenue'},
      {key:'deleteMembers',icon:'&#x1F5D1;&#xFE0F;',label:'Delete'},
    ];
    el.innerHTML = staff.map(s => {
      const p = s.staffPermissions || {};
      const initials = (s.name||'?').split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
      const toggles = permsMap.map(pm=>`
        <label style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:#fff;border:1px solid #E0ECEC;border-radius:8px;cursor:pointer;font-size:.74rem;font-weight:600">
          <input type="checkbox" ${p[pm.key]?'checked':''} style="accent-color:#1A8C8C;width:14px;height:14px"
            onchange="gaUpdatePerm('${esc(s._id)}','${pm.key}',this.checked)">
          ${pm.icon} ${pm.label}
        </label>`).join('');
      return `<div style="padding:13px 16px;border-bottom:1px solid #F0F5F5">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#1A8C8C,#27AE60);
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:.9rem;font-weight:800;flex-shrink:0">${esc(initials)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:.9rem;color:#1A2E2E">${esc(s.name)}</div>
            <div style="font-size:.7rem;color:#8AABAB">${esc(s.email)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <span style="background:${s.isActive?'#E8F8EF':'#F3F4F6'};color:${s.isActive?'#27AE60':'#6B7280'};padding:2px 8px;border-radius:10px;font-size:.62rem;font-weight:800">${s.isActive?'Active':'Inactive'}</span>
            <div style="display:flex;gap:4px">
              <button onclick="gaToggleStaff('${esc(s._id)}','${esc(s.name)}')"
                style="padding:4px 9px;border-radius:7px;border:1px solid #E0ECEC;background:#F0F5F5;font-family:inherit;font-size:.68rem;font-weight:700;cursor:pointer">
                ${s.isActive?'&#x1F534; Block':'&#x1F7E2; Enable'}
              </button>
              <button onclick="gaDeleteStaff('${esc(s._id)}','${esc(s.name)}')"
                style="padding:4px 9px;border-radius:7px;border:1px solid #FECDD5;background:#FEE2E2;color:#E74C3C;font-family:inherit;font-size:.68rem;font-weight:700;cursor:pointer">
                &#x1F5D1;&#xFE0F;
              </button>
            </div>
          </div>
        </div>
        <div style="background:#F8FFFE;border:1px solid #E0ECEC;border-radius:10px;padding:9px">
          <div style="font-size:.62rem;font-weight:800;color:#1A8C8C;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">&#x1F512; Access — toggle to update</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">${toggles}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty"><p style="color:#E74C3C">Error loading staff</p></div>';
  }
}

async function gaCreateStaff() {
  const name  = document.getElementById('gaSName').value.trim();
  const email = document.getElementById('gaSEmail').value.trim();
  const pass  = document.getElementById('gaSPass').value.trim();
  if (!name||!email||!pass) { toast('Fill all fields','error'); return; }
  if (pass.length<6) { toast('Password min 6 chars','error'); return; }
  const permissions = {
    viewMembers:document.getElementById('gp_members').checked, addMembers:document.getElementById('gp_members').checked,
    editMembers:document.getElementById('gp_members').checked, deleteMembers:document.getElementById('gp_delete').checked,
    viewAttendance:document.getElementById('gp_attendance').checked, markAttendance:document.getElementById('gp_attendance').checked,
    viewTrainers:document.getElementById('gp_trainers').checked, viewPayments:document.getElementById('gp_payments').checked,
    viewRevenue:document.getElementById('gp_revenue').checked, viewSettings:false
  };
  try {
    const res = await fetch(`${BASE}/admin/create-staff`, {
      method:'POST', headers:hdrs(), body:JSON.stringify({ name, email, password:pass, permissions })
    });
    const data = await res.json();
    if (res.ok) {
      toast(`&#x2705; ${name} created`, 'success');
      ['gaSName','gaSEmail','gaSPass'].forEach(id=>document.getElementById(id).value='');
      ['gp_members','gp_attendance','gp_payments','gp_trainers'].forEach(id=>document.getElementById(id).checked=true);
      ['gp_revenue','gp_delete'].forEach(id=>document.getElementById(id).checked=false);
      loadGaStaff();
    } else toast(data.error||'Failed','error');
  } catch(e) { toast('Network error','error'); }
}

async function gaUpdatePerm(staffId, perm, value) {
  try {
    const res = await fetch(`${BASE}/admin/staff/${staffId}/permissions`, {
      method:'PATCH', headers:hdrs(), body:JSON.stringify({ [perm]:value })
    });
    if (res.ok) toast('Updated','success');
    else toast('Failed','error');
  } catch(e) { toast('Network error','error'); }
}

async function gaToggleStaff(staffId, name) {
  try {
    const res = await fetch(`${BASE}/admin/user/${staffId}/toggle`, { method:'PATCH', headers:hdrs() });
    const data = await res.json();
    if (res.ok) { toast(data.message,'success'); loadGaStaff(); }
    else toast('Failed','error');
  } catch(e) { toast('Network error','error'); }
}

async function gaDeleteStaff(staffId, name) {
  if (!confirm(`Remove staff "${name}"? They will lose access immediately.`)) return;
  try {
    const res = await fetch(`${BASE}/admin/user/${staffId}`, { method:'DELETE', headers:hdrs() });
    const data = await res.json();
    if (res.ok) { toast(`${name} removed`,'success'); loadGaStaff(); }
    else toast(data.error||'Failed','error');
  } catch(e) { toast('Network error','error'); }
}
/* ── DOUBLE CONFIRMATION CONTROLLER ── */
let _dcCallback = null;

function doubleConfirm(msg, cb) {
  document.getElementById('dcMessage').textContent = msg;
  _dcCallback = cb;
  const input = document.getElementById('dcInput');
  const btn = document.getElementById('dcYesBtn');
  input.value = '';
  btn.disabled = true;
  btn.style.opacity = '.5';
  btn.style.cursor = 'not-allowed';
  document.getElementById('doubleConfirmModal').style.display = 'flex';
  
  input.oninput = (e) => {
    if (e.target.value.trim().toUpperCase() === 'DELETE') {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    } else {
      btn.disabled = true;
      btn.style.opacity = '.5';
      btn.style.cursor = 'not-allowed';
    }
  };
}

function closeDoubleConfirm() {
  document.getElementById('doubleConfirmModal').style.display = 'none';
  _dcCallback = null;
}

document.getElementById('dcYesBtn')?.addEventListener('click', () => {
  if (_dcCallback) _dcCallback();
  closeDoubleConfirm();
});


window.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;
  setupCamera();
  setupEditPhoto();

  ['dValue', 'mPlan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', recalcPrice);
  });
  const startEl = document.getElementById('mStart');
  if (startEl) startEl.addEventListener('input', onPlanChange);
  ['edValue', 'ePlan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', recalcEditPrice);
  });

  const dateEl = document.getElementById('topDate');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
  }

  const attDate = document.getElementById('attDate');
  if (attDate) attDate.value = getLocalTodayStr();
  
  const mStart = document.getElementById('mStart');
  if (mStart) mStart.value = getLocalTodayStr();
  
  const mPaymentDate = document.getElementById('mPaymentDate');
  if (mPaymentDate) mPaymentDate.value = getLocalTodayStr();

  await loadServerProfile();

  const admFeeEl = document.getElementById('mAdmFee');
  if (admFeeEl && gymCfg.admissionFee) admFeeEl.value = gymCfg.admissionFee;

  // Role-based init
  let _isSuperAdmin = false;
  try {
    const u = JSON.parse(localStorage.getItem('user')||'{}');
    window._userRole  = u.role;
    window._userPerms = u.permissions || {};

    // Sidebar user label
    const sbUser = document.getElementById('sbUser');
    if (sbUser && u.name) {
      const roleLabel = u.role==='superadmin' ? 'GymPro Creator' : u.role==='admin' ? 'Gym Admin' : 'Staff Member';
      sbUser.innerHTML = `<div class="u-name">&#x1F464; ${esc(u.name)}</div><div class="u-role">${roleLabel}</div>`;
    }

    // Show which gym is currently active — important once an owner has
    // more than one gym via Manage Gym, so it's always clear which gym's
    // data you're looking at.
if (u.role !== 'superadmin') {
      const gymBanner = document.getElementById('activeGymBanner');
      const gymNameEl = document.getElementById('activeGymName');
      if (gymBanner && gymNameEl) {
        gymNameEl.textContent = getGymName(); // <--- Uses getter instead of hardcoded 'My Gym'
        gymBanner.style.display = 'block';
      }
    }
    if (u.role === 'superadmin') {
      // Superadmin has its own dedicated page (superadmin.html) with the
      // real Manage Gym / approval logic — index.html never had a working
      // implementation of it (the page-superadmin div here was dead,
      // incomplete markup). Redirect immediately instead of showing a
      // broken partial dashboard.
      window.location.href = '/superadmin.html';
      return;

    } else if (u.role === 'admin') {
      // Show Staff Mgmt in sidebar
      const navGA = document.getElementById('navGymAdmin');
      if (navGA) navGA.style.display = '';
      const navMG = document.getElementById('navManageGym');
      if (navMG) navMG.style.display = '';
      const gaLabel = document.getElementById('gaAdminLabel');
      if (gaLabel) gaLabel.textContent = (u.gymName ? u.gymName + ' - ' : '') + (u.name || '');
      // Load pending staff count immediately and show banner
      (async () => {
        try {
          const r = await fetch(`${BASE}/auth/pending-staff`, { headers: hdrs() });
          if (r.ok) {
            const list = await r.json();
            if (list.length) {
              const badge = document.getElementById('gaStaffBadge');
              if (badge) badge.textContent = list.length;
              const banner = document.getElementById('staffPendingBanner');
              if (banner) {
                banner.style.display = 'flex';
                const sp = banner.querySelector('span');
                if (sp) sp.textContent = list.length + ' staff request' + (list.length>1?'s':'') + ' pending approval';
              }
            }
          }
        } catch(e) {}
      })();

    } else {
      // Staff: hide sections based on permissions
      const p = u.permissions || {};
      const hideEl = (id) => { const el=document.getElementById(id); if(el) el.style.display='none'; };
      if (!p.viewRevenue)         { hideEl('navRevenue'); hideEl('page-revenue'); hideEl('dashRevenueSummary'); }
      if (!p.viewSettings)        { document.querySelectorAll('[data-page="settings"]').forEach(e=>e.style.display='none'); }
      if (p.viewPayments===false) { document.querySelectorAll('[data-page="payments"]').forEach(e=>e.style.display='none'); }
      hideEl('navGymAdmin');
    }
  } catch(e) { console.error('Role init error:', e); }

  // Stop here for superadmin - never load gym data
  if (_isSuperAdmin) return;

  // Ensure dashboard page is visible (showPage sets all to display:none)
  const _dash = document.getElementById('page-dashboard');
  if (_dash) _dash.style.display = 'block';

  populatePlanSelect();
  populatePlanSelect('ePlan');
  recalcPrice();
  loadDashboard();



  loadPlans();

  fetch(`${BASE}/health`, {headers:hdrs()}).catch(()=>{});

  (async () => {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(TAPI, {headers:hdrs(), signal:ctrl.signal});
      clearTimeout(tid);
      if (!res.ok) return;
      const trainers = await res.json();
      trainerMap = {};
      trainers.forEach(t => { trainerMap[t._id] = t.name; });
      const opts = '<option value="">Select Trainer</option>' +
        trainers.filter(t=>t.status==='Active')
          .map(t=>`<option value="${esc(t._id)}">${esc(t.name)} — ${esc(t.specialty)}</option>`).join('');
      ['mPtTrainer','ePtTrainer','payPtTrainer'].forEach(id=>{
        const el = document.getElementById(id); 
        if (el) el.innerHTML = opts;
      });
    } catch(e) { console.log('Trainer pre-load:', e.message); }
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.log('ServiceWorker registration failed: ', err);
      });
    });
  }
});

window.addEventListener('online', () => {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = 'none';
  loadDashboard();
  loadAllMembers();
});

window.addEventListener('offline', () => {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = 'block';
});

if (!navigator.onLine) {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = 'block';
}
