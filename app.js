// ===== ИМПОРТЫ FIREBASE =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, push, onValue, query, limitToLast, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAzECJLmOTnu0JQKCQaV73CakFo-TdZqCQ",
  authDomain: "coinshop-178c5.firebaseapp.com",
  databaseURL: "https://coinshop-178c5-default-rtdb.firebaseio.com",
  projectId: "coinshop-178c5",
  storageBucket: "coinshop-178c5.firebasestorage.app",
  messagingSenderId: "249337954535",
  appId: "1:249337954535:web:ed66675f6f8643df65e242"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ===== КОНСТАНТЫ =====
const ADMIN_PASSWORD = 'admin123';
const DOMAIN = '@coinshop.local';
const MIN_USERNAME = 5;
const MAX_USERNAME = 12;
const SELL_PERCENT = 60;
const MIN_COOLDOWN = 150;
const COOLDOWN_STEP = 50;

const UPGRADES_LIST = [
  { key: 'perClick', name: 'Усиление клика', desc: '+1 монета за клик', icon: '⚔️', basePrice: 100, maxLevel: 50 },
  { key: 'cooldown', name: 'Скорость клика', desc: '-0.05с к кулдауну', icon: '⚡', basePrice: 150, maxLevel: 13 },
];

const DEFAULT_PRODUCTS = [
  { id: 1, name: 'NFT-аватарка', desc: 'Уникальный стиль', price: 500, img: '' },
  { id: 2, name: 'Премиум-статус', desc: 'Особый значок', price: 1500, img: '' },
  { id: 3, name: 'Кастомный эмодзи', desc: 'Свой набор эмодзи', price: 3000, img: '' },
];

const FALLBACK_IMG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="%2316161f"/><text x="50%" y="55%" font-size="80" text-anchor="middle" dominant-baseline="middle">🛍️</text></svg>';

// ===== СОСТОЯНИЕ =====
let state = {
  uid: null,
  username: '',
  coins: 0,
  perClick: 1,
  cooldown: 800,
  totalClicks: 0,
  products: [...DEFAULT_PRODUCTS],
  upgrades: { perClick: 0, cooldown: 0 },
  inventory: [],
  registeredAt: Date.now(),
};

let lastClickTime = 0;
let cooldownInterval = null;
let ugSelectedItem = null;
let ugSelectedTarget = null;
let sellingItem = null;
let unsubscribeUser = null;
let unsubscribeChat = null;
let unsubscribeProducts = null;
let lastChatCount = 0;
let currentUserProfile = null;
let isOwnProfile = true;
let isInitialLoad = true;

// ===== УТИЛИТЫ =====
function fmt(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = 'toast ' + type, 2500);
}
function getCooldown() { return Math.max(MIN_COOLDOWN, state.cooldown - state.upgrades.cooldown * COOLDOWN_STEP); }
function getPerClick() { return state.perClick + state.upgrades.perClick; }
function getUpgradePrice(upg, level) { return Math.floor(upg.basePrice * Math.pow(1.6, level)); }
function getImg(p) { return p.img || FALLBACK_IMG; }

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

function usernameToEmail(u) { return u.toLowerCase() + DOMAIN; }

function validUsername(u) {
  return /^[a-zA-Zа-яА-Я0-9_]{5,12}$/.test(u);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== АВТОРИЗАЦИЯ =====
document.querySelectorAll('.auth-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('form-' + t.dataset.auth).classList.add('active');
  });
});

// Валидация регистрации
document.getElementById('regUsername').addEventListener('input', e => {
  const v = e.target.value.trim();
  const hint = document.getElementById('regUsernameHint');
  if (v.length === 0) { hint.textContent = '5–12 символов, буквы и цифры'; hint.className = 'field-hint'; }
  else if (!validUsername(v)) { hint.textContent = '❌ 5–12 символов, буквы/цифры/подчёркивание'; hint.className = 'field-hint err'; }
  else { hint.textContent = '✅ Отлично'; hint.className = 'field-hint ok'; }
});

document.getElementById('regPassword').addEventListener('input', e => {
  const hint = document.getElementById('regPasswordHint');
  if (e.target.value.length === 0) { hint.textContent = 'Минимум 6 символов'; hint.className = 'field-hint'; }
  else if (e.target.value.length < 6) { hint.textContent = '❌ Мало символов'; hint.className = 'field-hint err'; }
  else { hint.textContent = '✅ Хорошо'; hint.className = 'field-hint ok'; }
});

// РЕГИСТРАЦИЯ
document.getElementById('registerBtn').addEventListener('click', async () => {
  const username = document.getElementById('regUsername').value.trim();
  const pass = document.getElementById('regPassword').value;
  const pass2 = document.getElementById('regPassword2').value;
  const err = document.getElementById('regError');
  const btn = document.getElementById('registerBtn');

  err.textContent = '';
  if (!validUsername(username)) { err.textContent = 'Имя должно быть 5–12 символов'; return; }
  if (pass.length < 6) { err.textContent = 'Пароль минимум 6 символов'; return; }
  if (pass !== pass2) { err.textContent = 'Пароли не совпадают'; return; }

  btn.disabled = true; btn.textContent = 'Создание...';
  try {
    // Проверка что имя не занято
    const unameSnap = await get(ref(db, 'usernames/' + username.toLowerCase()));
    if (unameSnap.exists()) {
      err.textContent = 'Это имя уже занято';
      btn.disabled = false; btn.textContent = 'Создать аккаунт';
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), pass);
    const uid = cred.user.uid;

    await set(ref(db, 'users/' + uid), {
      username, uid,
      coins: 0,
      perClick: 1,
      cooldown: 800,
      totalClicks: 0,
      upgrades: { perClick: 0, cooldown: 0 },
      inventory: [],
      registeredAt: Date.now(),
    });
    await set(ref(db, 'usernames/' + username.toLowerCase()), uid);

    toast('Аккаунт создан! 🎉', 'success');
  } catch(e) {
    console.error(e);
    if (e.code === 'auth/email-already-in-use') err.textContent = 'Имя уже занято';
    else if (e.code === 'auth/invalid-email') err.textContent = 'Имя содержит недопустимые символы';
    else err.textContent = 'Ошибка: ' + (e.message || e.code);
  }
  btn.disabled = false; btn.textContent = 'Создать аккаунт';
});

// ВХОД
document.getElementById('loginBtn').addEventListener('click', async () => {
  const username = document.getElementById('loginUsername').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  err.textContent = '';
  if (!username || !pass) { err.textContent = 'Заполни все поля'; return; }

  btn.disabled = true; btn.textContent = 'Вход...';
  try {
    await signInWithEmailAndPassword(auth, usernameToEmail(username), pass);
    toast('Добро пожаловать!', 'success');
  } catch(e) {
    console.error(e);
    err.textContent = 'Неверное имя или пароль';
  }
  btn.disabled = false; btn.textContent = 'Войти';
});

// Enter на полях
['loginPassword', 'loginUsername'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
});
['regPassword2', 'regPassword', 'regUsername'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('registerBtn').click();
  });
});

// ===== СЛЕЖЕНИЕ ЗА СОСТОЯНИЕМ =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.uid = user.uid;
    await loadUserData();
    await loadProducts();
    showMainApp();
    subscribeChat();
  } else {
    state.uid = null;
    if (unsubscribeUser) unsubscribeUser();
    if (unsubscribeChat) unsubscribeChat();
    if (unsubscribeProducts) unsubscribeProducts();
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hide');
  document.getElementById('mainApp').classList.remove('visible');
}

function showMainApp() {
  document.getElementById('authScreen').classList.add('hide');
  document.getElementById('mainApp').classList.add('visible');
  updateBalance(false);
  updateInventoryBadge();
  renderProducts();
  renderInventory();
  initClicker();
  renderUpgrades();
  renderUpgradeGame();
  initTabs();
}

// ===== ЗАГРУЗКА ДАННЫХ ПОЛЬЗОВАТЕЛЯ =====
async function loadUserData() {
  const userRef = ref(db, 'users/' + state.uid);
  unsubscribeUser = onValue(userRef, (snap) => {
    const data = snap.val();
    if (!data) return;
    state.username = data.username || 'User';
    state.coins = data.coins || 0;
    state.perClick = data.perClick || 1;
    state.cooldown = data.cooldown || 800;
    state.totalClicks = data.totalClicks || 0;
    state.upgrades = data.upgrades || { perClick: 0, cooldown: 0 };
    state.inventory = data.inventory || [];
    state.registeredAt = data.registeredAt || Date.now();
    if (!isInitialLoad) updateBalance(true);
    else { updateBalance(false); isInitialLoad = false; }
    updateInventoryBadge();
    renderInventory();
    renderUpgrades();
    renderUpgradeGame();
    updateClickerStats();
    renderProducts();
  });
}

// ===== СОХРАНЕНИЕ =====
async function saveUser() {
  if (!state.uid) return;
  await update(ref(db, 'users/' + state.uid), {
    coins: state.coins,
    perClick: state.perClick,
    cooldown: state.cooldown,
    totalClicks: state.totalClicks,
    upgrades: state.upgrades,
    inventory: state.inventory,
    username: state.username,
  });
}

// ===== ПРОДУКТЫ =====
async function loadProducts() {
  const productsRef = ref(db, 'products');
  unsubscribeProducts = onValue(productsRef, (snap) => {
    const data = snap.val();
    if (!data) {
      // Инициализация дефолтными
      const obj = {};
      DEFAULT_PRODUCTS.forEach(p => obj[p.id] = p);
      set(productsRef, obj);
      return;
    }
    state.products = Object.values(data).sort((a,b) => a.price - b.price);
    renderProducts();
    renderUpgradeGame();
  });
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!state.products.length) {
    grid.innerHTML = `<div class="empty-state"><div class="big">📦</div><div>Товаров пока нет</div></div>`;
    return;
  }
  state.products.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    const canBuy = state.coins >= p.price;
    card.innerHTML = `
      <div class="product-img-wrap">
        <img class="product-img" src="${getImg(p)}" onerror="this.src='${FALLBACK_IMG}'">
      </div>
      <div class="product-body">
        <div class="product-name">${esc(p.name)}</div>
        <div class="product-desc">${esc(p.desc)}</div>
        <div class="product-footer">
          <div class="product-price">🪙${fmt(p.price)}</div>
          <button class="buy-btn" ${canBuy ? '' : 'disabled'} data-id="${p.id}">
            ${canBuy ? 'Купить' : 'Мало 🪙'}
          </button>
        </div>
      </div>`;
    grid.appendChild(card);
    setTimeout(() => card.classList.add('visible'), i * 60);
  });
  grid.querySelectorAll('.buy-btn').forEach(b => {
    b.addEventListener('click', (e) => buyProduct(e, +b.dataset.id));
  });
}

async function buyProduct(e, id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (state.coins < p.price) { toast('Недостаточно монет', 'error'); return; }

  state.coins -= p.price;
  state.inventory.push({
    uniqueId: Date.now() + Math.random(),
    productId: p.id,
    name: p.name,
    desc: p.desc,
    price: p.price,
    img: p.img,
    date: Date.now(),
  });
  await saveUser();
  updateBalance(true);
  updateInventoryBadge();
  renderProducts();

  createConfetti(e.clientX, e.clientY);
  document.getElementById('buyModalContent').innerHTML = `
    ${p.img ? `<img src="${p.img}" style="width:100px;height:100px;border-radius:14px;object-fit:cover;margin-bottom:10px;">` : '<div style="font-size:56px;">🎉</div>'}
    <div style="font-weight:800;font-size:16px;">${esc(p.name)}</div>
    <div style="color:var(--muted);font-size:12px;">за ${fmt(p.price)} 🪙</div>`;
  document.getElementById('buyModal').classList.add('active');
}

// ===== ИНВЕНТАРЬ =====
function renderInventory() {
  const grid = document.getElementById('inventoryGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!state.inventory.length) {
    grid.innerHTML = `<div class="empty-state"><div class="big">🎒</div><div>Инвентарь пуст</div></div>`;
    return;
  }
  [...state.inventory].sort((a,b) => b.price - a.price).forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'inv-card';
    card.style.animation = `heroText 0.4s ease ${i * 0.04}s both`;
    card.innerHTML = `
      <div class="inv-img-wrap">
        <img class="inv-img" src="${getImg(item)}" onerror="this.src='${FALLBACK_IMG}'">
      </div>
      <div class="inv-body">
        <div class="inv-name">${esc(item.name)}</div>
        <div class="inv-price">🪙${fmt(item.price)}</div>
      </div>`;
    card.addEventListener('click', () => openSellModal(item));
    grid.appendChild(card);
  });
}

function updateInventoryBadge() {
  const b = document.getElementById('invBadge');
  if (b) b.textContent = state.inventory.length;
}

function openSellModal(item) {
  sellingItem = item;
  const price = Math.floor(item.price * SELL_PERCENT / 100);
  document.getElementById('sellModalContent').innerHTML = `
    <img src="${getImg(item)}" style="width:80px;height:80px;border-radius:12px;object-fit:cover;margin-bottom:10px;" onerror="this.src='${FALLBACK_IMG}'">
    <div style="font-weight:800;font-size:16px;">${esc(item.name)}</div>
    <div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Купил за ${fmt(item.price)} 🪙</div>
    <div style="color:var(--green);font-weight:900;font-size:20px;">+${fmt(price)} 🪙</div>`;
  document.getElementById('sellModal').classList.add('active');
}

document.getElementById('confirmSellBtn').addEventListener('click', async () => {
  if (!sellingItem) return;
  const idx = state.inventory.findIndex(i => i.uniqueId === sellingItem.uniqueId);
  if (idx === -1) return;
  const amount = Math.floor(sellingItem.price * SELL_PERCENT / 100);
  state.inventory.splice(idx, 1);
  state.coins += amount;
  await saveUser();
  updateBalance(true);
  updateInventoryBadge();
  renderInventory();
  document.getElementById('sellModal').classList.remove('active');
  toast(`Продано за ${fmt(amount)} 🪙`, 'success');
  sellingItem = null;
});

// ===== КЛИКЕР =====
function initClicker() {
  const coin = document.getElementById('mainCoin');
  if (coin && !coin._bound) {
    coin.addEventListener('click', handleCoinClick);
    coin._bound = true;
  }
}

async function handleCoinClick(e) {
  const now = Date.now();
  const cd = getCooldown();
  if (now - lastClickTime < cd) {
    const coin = document.getElementById('mainCoin');
    coin.classList.remove('cooldown'); void coin.offsetWidth; coin.classList.add('cooldown');
    return;
  }
  lastClickTime = now;
  const gain = getPerClick();
  state.coins += gain;
  state.totalClicks++;

  updateBalance(true);
  updateClickerStats();

  const rect = e.currentTarget.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  spawnFloatCoin(cx, cy, gain);
  for (let i = 0; i < 8; i++) spawnParticle(cx, cy);
  startCooldown(cd);

  // Сохраняем раз в 5 кликов или каждые 2 сек
  if (state.totalClicks % 5 === 0) saveUser();
  clearTimeout(window._saveTimeout);
  window._saveTimeout = setTimeout(saveUser, 2000);
}

function spawnFloatCoin(x, y, gain) {
  const el = document.createElement('div');
  el.className = 'float-coin';
  el.textContent = '+' + gain + ' 🪙';
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.fontSize = (18 + Math.min(gain, 30)) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function spawnParticle(x, y) {
  const p = document.createElement('div');
  p.className = 'particle';
  const a = Math.random() * Math.PI * 2;
  const d = 50 + Math.random() * 80;
  p.style.left = x + 'px'; p.style.top = y + 'px';
  p.style.animation = 'particleOut 0.8s ease-out forwards';
  p.style.setProperty('--tx', Math.cos(a) * d + 'px');
  p.style.setProperty('--ty', Math.sin(a) * d + 'px');
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 800);
}
function startCooldown(cd) {
  const fill = document.getElementById('cooldownFill');
  if (!fill) return;
  const start = Date.now();
  clearInterval(cooldownInterval);
  cooldownInterval = setInterval(() => {
    const pr = Math.min((Date.now() - start) / cd, 1);
    fill.style.width = (pr * 100) + '%';
    if (pr >= 1) { clearInterval(cooldownInterval); fill.style.width = '0%'; }
  }, 16);
}
function updateClickerStats() {
  const a = document.getElementById('statPerClick');
  if (a) a.textContent = fmt(getPerClick());
  const b = document.getElementById('statCooldown');
  if (b) b.textContent = (getCooldown() / 1000).toFixed(2) + 'с';
  const c = document.getElementById('statTotal');
  if (c) c.textContent = fmt(state.totalClicks);
}

// ===== УЛУЧШЕНИЯ =====
function renderUpgrades() {
  const grid = document.getElementById('upgradesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  UPGRADES_LIST.forEach(upg => {
    const level = state.upgrades[upg.key] || 0;
    const price = getUpgradePrice(upg, level);
    const maxed = level >= upg.maxLevel;
    const canAfford = state.coins >= price && !maxed;
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="upgrade-icon">${upg.icon}</div>
      <div class="upgrade-info">
        <div class="upgrade-name">${upg.name}</div>
        <div class="upgrade-desc">${upg.desc}</div>
        <div class="upgrade-level">Ур. ${level} / ${upg.maxLevel}</div>
      </div>
      <button class="upgrade-buy" ${canAfford ? '' : 'disabled'} data-key="${upg.key}">
        ${maxed ? '✓ MAX' : '🪙' + fmt(price)}
      </button>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll('.upgrade-buy').forEach(b => {
    b.addEventListener('click', (e) => buyUpgrade(e, b.dataset.key));
  });
}

async function buyUpgrade(e, key) {
  const upg = UPGRADES_LIST.find(u => u.key === key);
  if (!upg) return;
  const level = state.upgrades[key] || 0;
  if (level >= upg.maxLevel) return;
  const price = getUpgradePrice(upg, level);
  if (state.coins < price) { toast('Недостаточно монет', 'error'); return; }
  state.coins -= price;
  state.upgrades[key] = level + 1;
  await saveUser();
  updateBalance(true);
  updateClickerStats();
  renderUpgrades();
  renderProducts();
  toast(`${upg.icon} ${upg.name} → ур. ${state.upgrades[key]}`, 'success');
  createConfetti(e.clientX, e.clientY);
}

// ===== ИГРА УЛУЧШЕНИЕ =====
function renderUpgradeGame() {
  renderUgItemsPicker();
  renderUgTargets();
  updateUgPlayBtn();
}
function renderUgItemsPicker() {
  const picker = document.getElementById('ugItemsPicker');
  if (!picker) return;
  picker.innerHTML = '';
  if (!state.inventory.length) {
    picker.innerHTML = `<div style="color:var(--muted);font-size:12px;grid-column:1/-1;padding:14px;">Инвентарь пуст</div>`;
    ugSelectedItem = null;
    return;
  }
  if (ugSelectedItem && !state.inventory.find(i => i.uniqueId === ugSelectedItem)) ugSelectedItem = null;
  state.inventory.forEach(item => {
    const el = document.createElement('div');
    el.className = 'ug-picker-item' + (ugSelectedItem === item.uniqueId ? ' selected' : '');
    el.innerHTML = `
      <div class="ug-picker-img"><img src="${getImg(item)}" onerror="this.src='${FALLBACK_IMG}'"></div>
      <div class="ug-picker-name">${esc(item.name)}</div>
      <div class="ug-picker-price">🪙${fmt(item.price)}</div>`;
    el.addEventListener('click', () => {
      ugSelectedItem = item.uniqueId;
      ugSelectedTarget = null;
      renderUpgradeGame();
    });
    picker.appendChild(el);
  });
}
function renderUgTargets() {
  const targets = document.getElementById('ugTargets');
  if (!targets) return;
  targets.innerHTML = '';
  if (!ugSelectedItem) {
    targets.innerHTML = `<div style="color:var(--muted);font-size:12px;grid-column:1/-1;padding:14px;">Выбери предмет слева</div>`;
    return;
  }
  const myItem = state.inventory.find(i => i.uniqueId === ugSelectedItem);
  if (!myItem) { targets.innerHTML = ''; return; }
  const possible = state.products.filter(p => p.price > myItem.price);
  if (!possible.length) {
    targets.innerHTML = `<div style="color:var(--muted);font-size:12px;grid-column:1/-1;padding:14px;">Нет товаров дороже</div>`;
    return;
  }
  possible.sort((a,b) => a.price - b.price).forEach(p => {
    const chance = calcChance(myItem.price, p.price);
    const el = document.createElement('div');
    el.className = 'ug-target' + (ugSelectedTarget === p.id ? ' selected' : '');
    el.innerHTML = `
      <div class="ug-target-header">
        <div class="ug-target-img"><img src="${getImg(p)}" onerror="this.src='${FALLBACK_IMG}'"></div>
        <div>
          <div class="ug-target-name">${esc(p.name)}</div>
          <div class="ug-target-price">🪙${fmt(p.price)}</div>
        </div>
      </div>
      <div class="ug-chance"><span class="label">🎯 Шанс</span><span class="value win">${chance.toFixed(1)}%</span></div>
      <div class="ug-chance"><span class="label">💀 Потеря</span><span class="value lose">${(100-chance).toFixed(1)}%</span></div>`;
    el.addEventListener('click', () => {
      ugSelectedTarget = p.id;
      renderUpgradeGame();
    });
    targets.appendChild(el);
  });
}
function calcChance(myPrice, targetPrice) {
  const mult = targetPrice / myPrice;
  let c = 90 * Math.exp(-1.3 * (mult - 1));
  return Math.max(1, Math.min(90, c));
}
function updateUgPlayBtn() {
  const btn = document.getElementById('ugPlayBtn');
  if (!btn) return;
  const ready = ugSelectedItem && ugSelectedTarget;
  btn.disabled = !ready;
  btn.textContent = ready ? '🎲 Испытать удачу' : '🎲 Выбери предмет и цель';
}

document.getElementById('ugPlayBtn').addEventListener('click', playUpgrade);

async function playUpgrade() {
  const btn = document.getElementById('ugPlayBtn');
  const msg = document.getElementById('ugMessage');
  msg.textContent = '';
  const myItem = state.inventory.find(i => i.uniqueId === ugSelectedItem);
  const target = state.products.find(p => p.id === ugSelectedTarget);
  if (!myItem || !target) return;
  const chance = calcChance(myItem.price, target.price);
  const win = Math.random() * 100 < chance;
  btn.disabled = true;

  const result = document.getElementById('ugResult');
  result.innerHTML = '<div class="ug-roulette" style="display:flex;justify-content:center;gap:6px;margin:20px 0;"></div>';
  const roulette = result.firstChild;
  const imgs = [myItem, target];
  for (let i = 0; i < 7; i++) {
    const d = document.createElement('div');
    d.className = 'ug-roulette-item';
    d.style.cssText = 'width:50px;height:50px;border-radius:10px;overflow:hidden;border:2px solid var(--border);flex-shrink:0;';
    const it = imgs[Math.floor(Math.random() * imgs.length)];
    d.innerHTML = `<img src="${getImg(it)}" style="width:100%;height:100%;object-fit:cover;">`;
    roulette.appendChild(d);
  }
  let ticks = 0;
  const iv = setInterval(() => {
    ticks++;
    roulette.querySelectorAll('.ug-roulette-item').forEach(el => {
      const it = imgs[Math.floor(Math.random() * imgs.length)];
      el.innerHTML = `<img src="${getImg(it)}" style="width:100%;height:100%;object-fit:cover;">`;
    });
    if (ticks >= 20) { clearInterval(iv); finishUpgrade(win, myItem, target, chance); }
  }, 80);
}

async function finishUpgrade(win, myItem, target, chance) {
  const msg = document.getElementById('ugMessage');
  const idx = state.inventory.findIndex(i => i.uniqueId === myItem.uniqueId);
  if (idx === -1) return;

  if (win) {
    state.inventory.splice(idx, 1);
    state.inventory.push({
      uniqueId: Date.now() + Math.random(),
      productId: target.id,
      name: target.name,
      desc: target.desc,
      price: target.price,
      img: target.img,
      date: Date.now(),
    });
    msg.textContent = `🎉 УСПЕХ! Ты получил "${target.name}" (шанс ${chance.toFixed(1)}%)`;
    msg.className = 'ug-message win';
    toast('Улучшение успешно!', 'success');
    createConfetti(window.innerWidth / 2, window.innerHeight / 2);
  } else {
    state.inventory.splice(idx, 1);
    msg.textContent = `💀 ПРОВАЛ! "${myItem.name}" потерян (шанс ${chance.toFixed(1)}%)`;
    msg.className = 'ug-message lose';
    toast('Предмет потерян...', 'error');
  }
  await saveUser();
  updateInventoryBadge();
  renderInventory();
  ugSelectedItem = null;
  ugSelectedTarget = null;
  renderUpgradeGame();
}

// ===== ЧАТ =====
function subscribeChat() {
  const chatRef = query(ref(db, 'chat'), limitToLast(100));
  unsubscribeChat = onValue(chatRef, (snap) => {
    const data = snap.val();
    const messages = data ? Object.entries(data).map(([k,v]) => ({...v, _id: k})).sort((a,b) => a.timestamp - b.timestamp) : [];
    renderChat(messages);
    // Счётчик непрочитанных
    if (document.getElementById('page-chat').classList.contains('active')) {
      lastChatCount = messages.length;
      document.getElementById('chatBadge').textContent = '0';
    } else {
      const newCount = messages.length - lastChatCount;
      if (newCount > 0) {
        document.getElementById('chatBadge').textContent = newCount;
      }
    }
  });
}

function renderChat(messages) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
  box.innerHTML = '';
  messages.forEach(m => {
    const isOwn = m.uid === state.uid;
    const div = document.createElement('div');
    div.className = 'msg' + (isOwn ? ' own' : '');
    const color = hashColor(m.username);
    const initial = (m.username || '?')[0].toUpperCase();
    const time = new Date(m.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="msg-avatar" style="background:${color}" data-uid="${m.uid}">${initial}</div>
      <div class="msg-body">
        <div class="msg-author" data-uid="${m.uid}">${esc(m.username)}</div>
        <div class="msg-text">${esc(m.text)}</div>
        <div class="msg-time">${time}</div>
      </div>`;
    box.appendChild(div);
  });
  box.querySelectorAll('[data-uid]').forEach(el => {
    el.addEventListener('click', () => openProfile(el.dataset.uid));
  });
  if (wasAtBottom) box.scrollTop = box.scrollHeight;
}

document.getElementById('chatSend').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});

async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  if (text.length > 500) { toast('Максимум 500 символов', 'error'); return; }
  input.value = '';
  await push(ref(db, 'chat'), {
    uid: state.uid,
    username: state.username,
    text,
    timestamp: Date.now(),
  });
}

// ===== ПРОФИЛЬ =====
async function openProfile(uid) {
  isOwnProfile = uid === state.uid;
  let profile;
  if (isOwnProfile) {
    profile = {
      username: state.username,
      coins: state.coins,
      inventory: state.inventory,
      registeredAt: state.registeredAt,
      totalClicks: state.totalClicks,
    };
  } else {
    const snap = await get(ref(db, 'users/' + uid));
    if (!snap.exists()) { toast('Профиль не найден', 'error'); return; }
    profile = snap.val();
  }
  currentUserProfile = profile;
  renderProfile(profile, isOwnProfile);
  // Переключаем на страницу профиля
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-profile').classList.add('active');
}

function renderProfile(p, own) {
  const el = document.getElementById('profileContent');
  const color = hashColor(p.username);
  const initial = p.username[0].toUpperCase();
  const since = new Date(p.registeredAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const inv = p.inventory || [];
  el.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar" style="background:${color}">${initial}</div>
      <div class="profile-info">
        <div class="profile-name">${esc(p.username)}</div>
        <div class="profile-since">С ${since}</div>
        <div class="profile-stats">
          <div class="profile-stat">
            <div class="profile-stat-val">🪙 ${fmt(p.coins || 0)}</div>
            <div class="profile-stat-label">Баланс</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-val">${inv.length}</div>
            <div class="profile-stat-label">Предметов</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-val">${fmt(p.totalClicks || 0)}</div>
            <div class="profile-stat-label">Кликов</div>
          </div>
        </div>
      </div>
    </div>
    ${own ? `<button class="modal-btn modal-btn-outline" onclick="document.getElementById('settingsNavBtn').click()" style="margin-bottom:16px;">⚙️ Настройки аккаунта</button>` : ''}
    <h3 class="ug-targets-title">🎒 Инвентарь (${inv.length})</h3>
    <div class="inventory-grid" id="profileInvGrid"></div>`;

  const invGrid = document.getElementById('profileInvGrid');
  if (!inv.length) {
    invGrid.innerHTML = `<div class="empty-state"><div class="big">📦</div><div>Пусто</div></div>`;
  } else {
    [...inv].sort((a,b) => b.price - a.price).forEach(item => {
      const c = document.createElement('div');
      c.className = 'inv-card';
      c.innerHTML = `
        <div class="inv-img-wrap"><img class="inv-img" src="${getImg(item)}" onerror="this.src='${FALLBACK_IMG}'"></div>
        <div class="inv-body"><div class="inv-name">${esc(item.name)}</div><div class="inv-price">🪙${fmt(item.price)}</div></div>`;
      invGrid.appendChild(c);
    });
  }
}

// ===== НАСТРОЙКИ =====
document.getElementById('saveUsernameBtn').addEventListener('click', async () => {
  const newName = document.getElementById('setUsername').value.trim();
  if (!validUsername(newName)) { toast('Имя должно быть 5–12 символов', 'error'); return; }
  if (newName.toLowerCase() === state.username.toLowerCase()) { toast('Это твоё текущее имя', 'error'); return; }

  try {
    const check = await get(ref(db, 'usernames/' + newName.toLowerCase()));
    if (check.exists()) { toast('Это имя уже занято', 'error'); return; }
    // Удаляем старое имя из индекса
    await remove(ref(db, 'usernames/' + state.username.toLowerCase()));
    // Устанавливаем новое
    await set(ref(db, 'usernames/' + newName.toLowerCase()), state.uid);
    state.username = newName;
    await saveUser();
    document.getElementById('setUsername').value = '';
    toast('Имя изменено ✅', 'success');
  } catch(e) {
    console.error(e);
    toast('Ошибка: ' + e.message, 'error');
  }
});

document.getElementById('savePasswordBtn').addEventListener('click', async () => {
  const oldPass = document.getElementById('setOldPass').value;
  const newPass = document.getElementById('setNewPass').value;
  if (newPass.length < 6) { toast('Новый пароль минимум 6 символов', 'error'); return; }
  if (!oldPass) { toast('Введи текущий пароль', 'error'); return; }
  try {
    const user = auth.currentUser;
    const cred = EmailAuthProvider.credential(user.email, oldPass);
    await reauthenticateWithCredential(user, cred);
    await updatePassword(user, newPass);
    document.getElementById('setOldPass').value = '';
    document.getElementById('setNewPass').value = '';
    toast('Пароль изменён ✅', 'success');
  } catch(e) {
    console.error(e);
    if (e.code === 'auth/wrong-password') toast('Неверный текущий пароль', 'error');
    else toast('Ошибка: ' + e.code, 'error');
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!confirm('Выйти из аккаунта?')) return;
  await signOut(auth);
  toast('Вы вышли');
});

// ===== НАВИГАЦИЯ =====
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn._bound) return; btn._bound = true;
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });
  const profileBtn = document.getElementById('profileNavBtn');
  if (profileBtn && !profileBtn._bound) {
    profileBtn._bound = true;
    profileBtn.addEventListener('click', () => openProfile(state.uid));
  }
  const settingsBtn = document.getElementById('settingsNavBtn');
  if (settingsBtn && !settingsBtn._bound) {
    settingsBtn._bound = true;
    settingsBtn.addEventListener('click', () => switchPage('settings'));
  }
  const chatNavBtn = document.getElementById('chatNavBtn');
  if (chatNavBtn && !chatNavBtn._bound) {
    chatNavBtn._bound = true;
    chatNavBtn.addEventListener('click', () => switchPage('chat'));
  }
  // Переключение игр
  document.querySelectorAll('[data-game]').forEach(t => {
    if (t._bound) return; t._bound = true;
    t.addEventListener('click', () => {
      document.querySelectorAll('[data-game]').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.game-panel').forEach(x => x.style.display = 'none');
      t.classList.add('active');
      document.getElementById('game-' + t.dataset.game).style.display = 'block';
      if (t.dataset.game === 'upgrade') renderUpgradeGame();
    });
  });
  // Админ-кнопка через долгий тап на баланс
  const bp = document.getElementById('balancePill');
  if (bp && !bp._bound) {
    bp._bound = true;
    let pressTimer;
    bp.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openAdmin(), 800); });
    bp.addEventListener('touchend', () => clearTimeout(pressTimer));
    bp.addEventListener('mousedown', () => { pressTimer = setTimeout(() => openAdmin(), 800); });
    bp.addEventListener('mouseup', () => clearTimeout(pressTimer));
  }
}

function switchPage(page) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');

  if (page === 'inventory') renderInventory();
  if (page === 'games') { renderUpgradeGame(); renderUpgrades(); }
  if (page === 'chat') {
    document.getElementById('chatBadge').textContent = '0';
    lastChatCount = document.querySelectorAll('#chatMessages .msg').length;
    setTimeout(() => {
      const box = document.getElementById('chatMessages');
      if (box) box.scrollTop = box.scrollHeight;
    }, 100);
  }
  if (page === 'shop') renderProducts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== АДМИН =====
function openAdmin() {
  document.getElementById('adminModal').classList.add('active');
  document.getElementById('adminLogin').style.display = 'block';
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('adminPassInput').value = '';
}

document.getElementById('adminLoginBtn').addEventListener('click', () => {
  const p = document.getElementById('adminPassInput').value;
  if (p === ADMIN_PASSWORD) {
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    renderAdminList();
  } else toast('Неверный пароль', 'error');
});

document.getElementById('adminPassInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('adminLoginBtn').click();
});

document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ['add','list','coins'].forEach(n => {
      document.getElementById('adminTab-' + n).style.display = (n === tab.dataset.tab) ? 'block' : 'none';
    });
    if (tab.dataset.tab === 'list') renderAdminList();
  });
});

document.getElementById('addProductBtn').addEventListener('click', async () => {
  const name = document.getElementById('pName').value.trim();
  const desc = document.getElementById('pDesc').value.trim();
  const price = parseInt(document.getElementById('pPrice').value);
  const img = document.getElementById('pImg').value.trim();
  if (!name || !desc || isNaN(price) || price < 0) { toast('Заполни все поля', 'error'); return; }
  const id = Date.now();
  await set(ref(db, 'products/' + id), { id, name, desc, price, img });
  document.getElementById('pName').value = '';
  document.getElementById('pDesc').value = '';
  document.getElementById('pPrice').value = '';
  document.getElementById('pImg').value = '';
  toast('Товар добавлен ✅', 'success');
});

function renderAdminList() {
  const list = document.getElementById('adminProductsList');
  list.innerHTML = '';
  if (!state.products.length) { list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:14px;">Нет товаров</div>'; return; }
  state.products.forEach(p => {
    const item = document.createElement('div');
    item.className = 'admin-product-item';
    item.innerHTML = `
      <img src="${getImg(p)}" onerror="this.src='${FALLBACK_IMG}'">
      <div class="info"><div class="name">${esc(p.name)}</div><div class="price">🪙${fmt(p.price)}</div></div>
      <button class="del-btn" data-id="${p.id}">🗑️</button>`;
    list.appendChild(item);
  });
  list.querySelectorAll('.del-btn').forEach(b => {
    b.addEventListener('click', async () => {
      await remove(ref(db, 'products/' + b.dataset.id));
      toast('Удалено', 'error');
    });
  });
}

document.getElementById('giveCoinsBtn').addEventListener('click', async () => {
  const amount = parseInt(document.getElementById('coinsAmount').value);
  if (isNaN(amount) || amount <= 0) { toast('Введи сумму', 'error'); return; }
  state.coins += amount;
  await saveUser();
  updateBalance(true);
  document.getElementById('coinsAmount').value = '';
  toast(`Выдано ${fmt(amount)} 🪙`, 'success');
});

document.getElementById('resetCoinsBtn').addEventListener('click', async () => {
  state.coins = 0;
  await saveUser();
  updateBalance(false);
  toast('Баланс сброшен', 'error');
});

// ===== КОНФЕТТИ =====
function createConfetti(x, y) {
  const colors = ['#ffb800','#ff6b35','#6c5ce7','#00ff88','#ff6b9d'];
  for (let i = 0; i < 25; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = x + 'px'; c.style.top = y + 'px';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    const a = Math.random() * Math.PI * 2;
    const d = 80 + Math.random() * 150;
    c.style.setProperty('--tx', Math.cos(a) * d + 'px');
    c.style.setProperty('--ty', Math.sin(a) * d + 400 + 'px');
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2000);
  }
}

// ===== ЗАКРЫТИЕ МОДАЛОК =====
document.querySelectorAll('[data-close]').forEach(el => {
  el.addEventListener('click', e => {
    const ov = e.target.closest('.modal-overlay');
    if (ov) ov.classList.remove('active');
  });
});
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', e => {
    if (e.target === ov) ov.classList.remove('active');
  });
});

console.log('✅ app.js loaded');
