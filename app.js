// ===== Baby Roadmap - メインアプリ =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  getFirestore, doc, setDoc, deleteDoc, collection, onSnapshot,
  query, orderBy, serverTimestamp, addDoc
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

import {
  TASKS, NG_FOODS, SHOPPING, EMERGENCY_TEMPLATE,
  CAT_ICONS, PHASE_INFO, MEMBERS, DUE_DATE, LMP_DATE
} from './data.js?v=20260427a';

// ===== Firebase 初期化 =====
const firebaseConfig = {
  apiKey: "AIzaSyBRx7SGOohiTVr2FtNO33ayIajAWSddb-o",
  authDomain: "baby-roadmap.firebaseapp.com",
  projectId: "baby-roadmap",
  storageBucket: "baby-roadmap.firebasestorage.app",
  messagingSenderId: "928595760719",
  appId: "1:928595760719:web:a04437a762173c02157c3a",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const SHARED_EMAIL = 'baby@dusedo.local';

// ===== グローバル状態 =====
const state = {
  currentUser: localStorage.getItem('currentUser') || null, // 'ken' | 'tomoko'
  activeTab: 'tasks',
  activeFilter: 'all',
  taskStates: {},     // { taskId: { done, doneBy, doneAt, note } }
  shopStates: {},     // { 'カテゴリ::品名': { done, doneBy } }
  healthRecords: [],  // 健診記録
  diaryEntries: [],   // 日記
  emergency: {},      // 緊急連絡先
  unsubs: [],
};

// ===== ユーティリティ =====
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const todayStr = () => new Date().toISOString().slice(0, 10);

function calcWeek(date = new Date()) {
  const lmp = new Date(LMP_DATE);
  const diffDays = Math.floor((date - lmp) / 86400000);
  const w = Math.floor(diffDays / 7);
  const d = diffDays % 7;
  return { week: w, day: d, totalDays: diffDays };
}

// 週数 → カレンダー期間ラベル ("5月上旬" / "5月上旬〜6月上旬")
function weekToDate(week) {
  const d = new Date(LMP_DATE);
  d.setDate(d.getDate() + week * 7);
  return d;
}
function monthPeriod(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const period = d <= 10 ? '上旬' : d <= 20 ? '中旬' : '下旬';
  return `${m}月${period}`;
}
function weekRangeToCalLabel(weekStr) {
  if (!weekStr) return '';
  const parts = String(weekStr).split('-').map(s => parseInt(s, 10));
  const start = parts[0];
  const end = parts[1] != null ? parts[1] : start;
  if (isNaN(start)) return '';
  const startDate = weekToDate(start);
  const endDate = weekToDate(end + 1); endDate.setDate(endDate.getDate() - 1);
  const span = end - start;
  // 長期 (8週以上) は月だけ表示
  if (span >= 8) {
    const m1 = startDate.getMonth() + 1;
    const m2 = endDate.getMonth() + 1;
    return m1 === m2 ? `${m1}月` : `${m1}月〜${m2}月`;
  }
  const startLabel = monthPeriod(startDate);
  const endLabel = monthPeriod(endDate);
  return startLabel === endLabel ? startLabel : `${startLabel}〜${endLabel}`;
}
function daysUntilDue() {
  const due = new Date(DUE_DATE);
  return Math.ceil((due - new Date()) / 86400000);
}
function formatDate(d) {
  if (!d) return '';
  const dt = (d.toDate ? d.toDate() : new Date(d));
  return `${dt.getMonth()+1}/${dt.getDate()}`;
}
function formatDateLong(d) {
  if (!d) return '';
  const dt = (d.toDate ? d.toDate() : new Date(d));
  return `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()}`;
}

// ===== ログイン =====
$('#login-btn').addEventListener('click', doLogin);
$('#password-input').addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const pw = $('#password-input').value;
  const errEl = $('#login-error');
  errEl.textContent = '';
  if (!pw) { errEl.textContent = 'パスワードを入力してください'; return; }
  try {
    await signInWithEmailAndPassword(auth, SHARED_EMAIL, pw);
  } catch (e) {
    errEl.textContent = 'パスワードが違います';
    console.error(e);
  }
}

let authedUser = null;

onAuthStateChanged(auth, async user => {
  console.log('[auth] state changed. user:', user ? user.email : 'null');
  authedUser = user;
  if (user) {
    $('#login-screen').hidden = true;
    if (!state.currentUser) {
      $('#user-select-screen').hidden = false;
      $('#app').hidden = true;
    } else {
      $('#user-select-screen').hidden = true;
      await showApp();
    }
  } else {
    $('#login-screen').hidden = false;
    $('#user-select-screen').hidden = true;
    $('#app').hidden = true;
    state.unsubs.forEach(u => u());
    state.unsubs = [];
  }
});

// ===== ユーザー選択 =====
$$('.user-select-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!authedUser) {
      alert('セッション切れ。再ログインしてください');
      $('#user-select-screen').hidden = true;
      $('#login-screen').hidden = false;
      return;
    }
    state.currentUser = btn.dataset.user;
    localStorage.setItem('currentUser', state.currentUser);
    $('#user-select-screen').hidden = true;
    await showApp();
  });
});

// ===== アプリ起動 =====
let appStarted = false;
async function showApp() {
  if (!authedUser) {
    console.error('[auth] showApp aborted: no authed user');
    return;
  }
  $('#app').hidden = false;
  updateHeader();
  updateUserToggle();
  switchTab('tasks');
  if (!appStarted) {
    appStarted = true;
    setInterval(updateHeader, 60_000);
  }
  try {
    const token = await authedUser.getIdToken(true);
    console.log('[auth] token ready, uid:', authedUser.uid, 'email:', authedUser.email, 'token len:', token.length);
  } catch (e) {
    console.error('[auth] getIdToken failed:', e);
  }
  subscribeAll();
}

function updateHeader() {
  $('#days-left').textContent = daysUntilDue();
  const { week, day } = calcWeek();
  $('#current-week').textContent = day > 0 ? `${week}週+${day}日` : `${week}週`;
  // 予定日表示
  const due = new Date(DUE_DATE);
  $('#due-date-label').textContent = `${due.getFullYear()}/${due.getMonth()+1}/${due.getDate()}`;
  // ダッシュボード
  let phase = '初期';
  if (week >= 36) phase = '出産前';
  else if (week >= 28) phase = '後期';
  else if (week >= 16) phase = '中期';
  if (daysUntilDue() < 0) phase = '産後';
  $('#dash-phase').innerHTML = `${PHASE_INFO[phase]?.emoji || '🌸'} ${phase}`;
  updateDashCounts();
}

function updateDashCounts() {
  const total = TASKS.length;
  const done = TASKS.filter(t => state.taskStates[t.id]?.done).length;
  $('#dash-total').textContent = total;
  $('#dash-done').textContent = done;
}

// ===== ユーザー切替 (その他メニューから) =====
function updateUserToggle() { /* no-op: header icon removed */ }
function switchUser() {
  state.currentUser = state.currentUser === 'ken' ? 'tomoko' : 'ken';
  localStorage.setItem('currentUser', state.currentUser);
  if (state.activeTab === 'more') renderMore();
}

// ===== Firestore 購読 =====
function subscribeAll() {
  const onErr = label => err => {
    console.error(`[${label}] Firestore error:`, err.code, err.message);
    if (err.code === 'permission-denied') showFirestoreRuleError();
  };
  // タスク状態
  state.unsubs.push(onSnapshot(collection(db, 'tasks'), snap => {
    state.taskStates = {};
    snap.forEach(doc => state.taskStates[doc.id] = doc.data());
    if (state.activeTab === 'tasks') renderTasks();
    updateDashCounts();
  }, onErr('tasks')));
  // 買い物 (doc id は base64 だが state は key で索引)
  state.unsubs.push(onSnapshot(collection(db, 'shopping'), snap => {
    state.shopStates = {};
    snap.forEach(d => {
      const data = d.data();
      if (data.key) state.shopStates[data.key] = { ...data, _docId: d.id };
    });
    if (state.activeTab === 'shopping') renderShopping();
  }, onErr('shopping')));
  // 健診
  state.unsubs.push(onSnapshot(query(collection(db, 'health'), orderBy('date', 'desc')), snap => {
    state.healthRecords = [];
    snap.forEach(doc => state.healthRecords.push({ id: doc.id, ...doc.data() }));
    if (state.activeTab === 'health') renderHealth();
  }, onErr('health')));
  // 日記
  state.unsubs.push(onSnapshot(query(collection(db, 'diary'), orderBy('createdAt', 'desc')), snap => {
    state.diaryEntries = [];
    snap.forEach(doc => state.diaryEntries.push({ id: doc.id, ...doc.data() }));
    if (state.activeTab === 'diary') renderDiary();
  }, onErr('diary')));
  // 緊急連絡先
  state.unsubs.push(onSnapshot(doc(db, 'config', 'emergency'), snap => {
    state.emergency = snap.exists() ? snap.data() : {};
    if (state.activeTab === 'more') renderMore();
  }, onErr('emergency')));
}

let ruleErrorShown = false;
function showFirestoreRuleError() {
  if (ruleErrorShown) return;
  ruleErrorShown = true;
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#FFE4E4;color:#A03040;padding:12px;text-align:center;font-size:13px;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,.1);';
  banner.innerHTML = `⚠️ Firestoreルール未公開です。<br>Firebase Console → Firestore → ルール で <code>allow read, write: if request.auth != null;</code> を設定して「公開」してください。`;
  document.body.appendChild(banner);
}

// ===== タブ切替 =====
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  state.activeTab = tab;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const renderers = { tasks: renderTasks, health: renderHealth, shopping: renderShopping, diary: renderDiary, more: renderMore };
  (renderers[tab] || renderTasks)();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== タスク描画 =====
function renderTasks() {
  const root = $('#main-content');
  const cats = ['all', ...new Set(TASKS.map(t => t.cat))];
  const phases = ['初期', '中期', '後期', '出産前', '産後'];

  let html = `<div class="tab-title"><span class="icon">✅</span>やること</div>`;
  // カテゴリフィルタ
  html += `<div class="filter-bar">`;
  cats.forEach(c => {
    const active = state.activeFilter === c ? 'active' : '';
    const label = c === 'all' ? '全て' : `${CAT_ICONS[c] || ''} ${c}`;
    html += `<button class="filter-chip ${active}" data-cat="${c}">${label}</button>`;
  });
  html += `</div>`;

  // フェーズごと
  phases.forEach(phase => {
    const tasks = TASKS.filter(t =>
      t.phase === phase &&
      (state.activeFilter === 'all' || t.cat === state.activeFilter)
    );
    if (!tasks.length) return;
    const info = PHASE_INFO[phase];
    const doneCount = tasks.filter(t => state.taskStates[t.id]?.done).length;
    html += `
      <div class="phase-header">
        <span class="phase-emoji">${info.emoji}</span>
        <div>${info.label} <small>${info.weeks}</small></div>
        <span class="phase-count">${doneCount}/${tasks.length}</span>
      </div>`;
    tasks.forEach(t => {
      const st = state.taskStates[t.id] || {};
      const doneClass = st.done ? 'done' : '';
      const doneByName = st.doneBy ? MEMBERS[st.doneBy]?.name : '';
      const calLabel = weekRangeToCalLabel(t.week);
      html += `
        <div class="task-card ${doneClass}" data-id="${t.id}">
          <button class="task-checkbox">${st.done ? '✓' : ''}</button>
          <div class="task-body">
            <div class="task-title">${escapeHtml(t.title)}</div>
            <div class="task-meta">
              ${t.week ? `<span class="task-tag">${t.week}週</span>` : ''}
              ${calLabel ? `<span class="task-tag tag-cal">📅 ${calLabel}</span>` : ''}
              <span class="task-tag">${CAT_ICONS[t.cat] || ''} ${t.cat}</span>
              <span class="task-tag who-${t.who}">${
                t.who === 'tomoko' ? '🤰 Tomoko' : t.who === 'ken' ? '👨 Ken' : '👫 二人で'
              }</span>
            </div>
            ${t.tip ? `<div class="task-tip">💡 ${escapeHtml(t.tip)}</div>` : ''}
            ${st.done && doneByName ? `<div class="task-done-by">✓ ${doneByName}が完了 (${formatDate(st.doneAt)})</div>` : ''}
          </div>
        </div>`;
    });
  });

  root.innerHTML = html;

  // イベント
  root.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => { state.activeFilter = chip.dataset.cat; renderTasks(); });
  });
  root.querySelectorAll('.task-card').forEach(card => {
    card.querySelector('.task-checkbox').addEventListener('click', () => toggleTask(card.dataset.id));
  });
}

async function toggleTask(id) {
  const cur = state.taskStates[id] || {};
  const newDone = !cur.done;
  await setDoc(doc(db, 'tasks', id), {
    done: newDone,
    doneBy: newDone ? state.currentUser : null,
    doneAt: newDone ? serverTimestamp() : null,
  });
}

// ===== 買い物 =====
function renderShopping() {
  const root = $('#main-content');
  let html = `<div class="tab-title"><span class="icon">🛒</span>買い物リスト</div>`;
  for (const [cat, items] of Object.entries(SHOPPING)) {
    const doneCount = items.filter(item => state.shopStates[`${cat}::${item}`]?.done).length;
    html += `
      <div class="shop-section">
        <div class="shop-section-title">${cat} <span class="count">${doneCount}/${items.length}</span></div>`;
    items.forEach(item => {
      const key = `${cat}::${item}`;
      const st = state.shopStates[key] || {};
      const doneClass = st.done ? 'done' : '';
      const doneByName = st.doneBy ? MEMBERS[st.doneBy]?.name : '';
      html += `
        <div class="shop-item ${doneClass}" data-key="${key}">
          <button class="task-checkbox">${st.done ? '✓' : ''}</button>
          <div class="shop-name">${escapeHtml(item)}${doneByName ? ` <span class="task-done-by">✓ ${doneByName}</span>` : ''}</div>
        </div>`;
    });
    html += `</div>`;
  }
  root.innerHTML = html;
  root.querySelectorAll('.shop-item').forEach(item => {
    item.querySelector('.task-checkbox').addEventListener('click', () => toggleShop(item.dataset.key));
  });
}

async function toggleShop(key) {
  const cur = state.shopStates[key] || {};
  const newDone = !cur.done;
  // documentIDに :: が使えないのでエンコード
  const encodedKey = key.replace(/[^a-zA-Z0-9_]/g, c => `_${c.charCodeAt(0).toString(16)}_`);
  // ただしkeyとして保持するためdoc id用は別管理 → keyフィールドで検索
  // シンプル化: doc idは btoa で安全化
  const docId = btoa(unescape(encodeURIComponent(key))).replace(/[+/=]/g, '_');
  await setDoc(doc(db, 'shopping', docId), {
    key,
    done: newDone,
    doneBy: newDone ? state.currentUser : null,
    doneAt: newDone ? serverTimestamp() : null,
  });
}

// ===== 健診記録 =====
function renderHealth() {
  const root = $('#main-content');
  let html = `
    <div class="tab-title"><span class="icon">🏥</span>健診記録</div>
    <button class="btn-add" id="add-health-btn">＋ 健診記録を追加</button>
    <div class="health-list">`;
  if (!state.healthRecords.length) {
    html += `<div class="empty"><span class="empty-emoji">🌸</span>まだ記録がありません</div>`;
  }
  state.healthRecords.forEach(r => {
    const w = calcWeek(new Date(r.date));
    const wkLabel = w.day > 0 ? `${w.week}週+${w.day}日` : `${w.week}週`;
    html += `
      <div class="health-card" data-id="${r.id}">
        <div class="health-card-head">
          <div class="health-date">${formatDateLong(r.date)}</div>
          <div class="health-week">${wkLabel}</div>
        </div>
        <div class="health-grid">
          <div class="health-item"><label>体重</label><span>${r.weight || '-'} kg</span></div>
          <div class="health-item"><label>血圧</label><span>${r.bp || '-'}</span></div>
          <div class="health-item"><label>腹囲</label><span>${r.belly || '-'} cm</span></div>
        </div>
        ${r.note ? `<div class="health-note">📝 ${escapeHtml(r.note)}</div>` : ''}
        <div style="margin-top:10px;display:flex;justify-content:flex-end;">
          <button class="btn-danger" data-del="${r.id}">削除</button>
        </div>
      </div>`;
  });
  html += `</div>`;
  root.innerHTML = html;
  $('#add-health-btn').addEventListener('click', () => openHealthModal());
  root.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (confirm('この記録を削除しますか？')) {
        await deleteDoc(doc(db, 'health', b.dataset.del));
      }
    });
  });
}

function openHealthModal() {
  showModal(`
    <h3>🏥 健診記録を追加</h3>
    <label>日付</label>
    <input class="input" type="date" id="m-date" value="${todayStr()}">
    <label>体重 (kg)</label>
    <input class="input" type="number" step="0.1" id="m-weight" placeholder="例: 55.2">
    <label>血圧 (上/下)</label>
    <input class="input" type="text" id="m-bp" placeholder="例: 110/68">
    <label>腹囲 (cm・任意)</label>
    <input class="input" type="number" id="m-belly" placeholder="例: 85">
    <label>メモ・先生からの一言</label>
    <textarea class="input" id="m-note" rows="3"></textarea>
    <div class="modal-actions">
      <button class="btn-secondary" data-close>キャンセル</button>
      <button class="btn-primary" id="m-save">保存</button>
    </div>
  `);
  $('#m-save').addEventListener('click', async () => {
    await addDoc(collection(db, 'health'), {
      date: $('#m-date').value,
      weight: parseFloat($('#m-weight').value) || null,
      bp: $('#m-bp').value || null,
      belly: parseFloat($('#m-belly').value) || null,
      note: $('#m-note').value || null,
      createdBy: state.currentUser,
      createdAt: serverTimestamp(),
    });
    closeModal();
  });
}

// ===== 日記 =====
function renderDiary() {
  const root = $('#main-content');
  let html = `
    <div class="tab-title">
      <span class="icon">📝</span>共有日記
      <button class="btn-csv" id="diary-csv-btn">📥 CSVダウンロード</button>
    </div>
    <div class="diary-input-card">
      <textarea id="diary-input" placeholder="今日の体調や思ったこと…"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px;">
        <button class="btn-primary" id="diary-post-btn">投稿</button>
      </div>
    </div>
    <div class="diary-list">`;
  if (!state.diaryEntries.length) {
    html += `<div class="empty"><span class="empty-emoji">🌸</span>夫婦の最初の一言を残そう</div>`;
  }
  state.diaryEntries.forEach(e => {
    const m = MEMBERS[e.author] || { name: e.author, emoji: '👤' };
    const w = e.createdAt ? calcWeek(e.createdAt.toDate()) : null;
    html += `
      <div class="diary-entry">
        <div class="diary-head">
          <div class="diary-author ${e.author}">${m.emoji} ${m.name}</div>
          <div class="diary-date">${formatDateLong(e.createdAt)}${w ? ` (${w.week}w${w.day}d)` : ''}</div>
        </div>
        <div class="diary-text">${escapeHtml(e.text)}</div>
        <div style="margin-top:8px;display:flex;justify-content:flex-end;">
          <button class="btn-danger" data-del="${e.id}">削除</button>
        </div>
      </div>`;
  });
  html += `</div>`;
  root.innerHTML = html;
  $('#diary-post-btn').addEventListener('click', async () => {
    const text = $('#diary-input').value.trim();
    if (!text) return;
    await addDoc(collection(db, 'diary'), {
      text, author: state.currentUser, createdAt: serverTimestamp(),
    });
    $('#diary-input').value = '';
  });
  root.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (confirm('この日記を削除しますか？')) {
        await deleteDoc(doc(db, 'diary', b.dataset.del));
      }
    });
  });
  $('#diary-csv-btn').addEventListener('click', downloadDiaryCsv);
}

function downloadDiaryCsv() {
  if (!state.diaryEntries.length) {
    alert('日記がまだありません');
    return;
  }
  // 古い順 (時系列) でDL
  const sorted = [...state.diaryEntries].sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return ta - tb;
  });
  const escape = s => `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, '\\n')}"`;
  const rows = [['日付', '時刻', '週数', '投稿者', '本文']];
  sorted.forEach(e => {
    const dt = e.createdAt?.toDate?.() || new Date();
    const date = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
    const time = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    const w = calcWeek(dt);
    const wkLabel = w.day > 0 ? `${w.week}週+${w.day}日` : `${w.week}週`;
    const author = MEMBERS[e.author]?.name || e.author;
    rows.push([date, time, wkLabel, author, e.text]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(escape).join(',')).join('\r\n'); // BOM付きでExcel文字化け対策
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `baby-diary-${today}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== その他 (NG食品・緊急連絡先・手続き・夫タスク・ログアウト) =====
function renderMore() {
  const root = $('#main-content');
  let html = `
    <div class="tab-title"><span class="icon">⋯</span>その他</div>
    <div class="more-grid">
      <button class="more-card" data-more="ng"><span class="icon">🍽️</span>NG食品リスト</button>
      <button class="more-card" data-more="emergency"><span class="icon">🆘</span>緊急連絡先</button>
      <button class="more-card" data-more="procedures"><span class="icon">📄</span>手続き一覧</button>
      <button class="more-card" data-more="logout"><span class="icon">🚪</span>ログアウト</button>
    </div>
    <div id="more-content" style="margin-top:20px;"></div>`;
  root.innerHTML = html;

  root.querySelectorAll('[data-more]').forEach(btn => {
    btn.addEventListener('click', () => renderMoreContent(btn.dataset.more));
  });
}

function renderMoreContent(kind) {
  const out = $('#more-content');
  if (kind === 'ng') {
    let h = `<div class="tab-title"><span class="icon">🍽️</span>妊娠中NG・注意食品</div>`;
    NG_FOODS.forEach(g => {
      h += `<div class="ngfood-cat"><div class="ngfood-cat-title">${g.cat}</div><ul>`;
      g.items.forEach(i => h += `<li>${escapeHtml(i)}</li>`);
      h += `</ul></div>`;
    });
    out.innerHTML = h;
  } else if (kind === 'procedures') {
    out.innerHTML = renderTaskFilter('手続き', '📄 手続き一覧');
    bindTaskCards(out);
  } else if (kind === 'emergency') {
    renderEmergency(out);
  } else if (kind === 'logout') {
    if (confirm('ログアウトしますか？')) {
      signOut(auth);
      localStorage.removeItem('currentUser');
      state.currentUser = null;
    }
  }
}

function renderTaskFilter(cat, title) {
  const tasks = TASKS.filter(t => t.cat === cat);
  return renderTaskListHtml(tasks, title);
}
function renderTaskByWho(who, title) {
  const tasks = TASKS.filter(t => t.who === who || t.who === 'both');
  return renderTaskListHtml(tasks, title);
}
function renderTaskListHtml(tasks, title) {
  let html = `<div class="tab-title">${title}</div>`;
  tasks.forEach(t => {
    const st = state.taskStates[t.id] || {};
    const doneClass = st.done ? 'done' : '';
    const doneByName = st.doneBy ? MEMBERS[st.doneBy]?.name : '';
    const calLabel = weekRangeToCalLabel(t.week);
    html += `
      <div class="task-card ${doneClass}" data-id="${t.id}">
        <button class="task-checkbox">${st.done ? '✓' : ''}</button>
        <div class="task-body">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-meta">
            ${t.week ? `<span class="task-tag">${t.week}週</span>` : ''}
            ${calLabel ? `<span class="task-tag tag-cal">📅 ${calLabel}</span>` : ''}
            <span class="task-tag">${t.phase}</span>
            <span class="task-tag who-${t.who}">${t.who === 'tomoko' ? '🤰' : t.who === 'ken' ? '👨' : '👫'}</span>
          </div>
          ${t.tip ? `<div class="task-tip">💡 ${escapeHtml(t.tip)}</div>` : ''}
          ${st.done && doneByName ? `<div class="task-done-by">✓ ${doneByName}が完了 (${formatDate(st.doneAt)})</div>` : ''}
        </div>
      </div>`;
  });
  return html;
}
function bindTaskCards(scope) {
  scope.querySelectorAll('.task-card').forEach(card => {
    card.querySelector('.task-checkbox').addEventListener('click', () => toggleTask(card.dataset.id));
  });
}

function renderEmergency(out) {
  let html = `<div class="tab-title"><span class="icon">🆘</span>緊急連絡先</div><div class="emergency-list">`;
  EMERGENCY_TEMPLATE.forEach(item => {
    const value = state.emergency[item.label] || '';
    const isTel = item.type === 'tel' && value;
    html += `
      <div class="emergency-item">
        <div style="flex:1;min-width:0;">
          <div class="emergency-label">${item.label}</div>
          <div class="emergency-value">${value || '<span style="color:#bbb">未登録</span>'}</div>
        </div>
        ${isTel ? `<a class="emergency-tel-btn" href="tel:${value.replace(/[^0-9+]/g, '')}">📞 発信</a>` : ''}
        <button class="btn-secondary" data-edit="${item.label}">編集</button>
      </div>`;
  });
  html += `</div>`;
  out.innerHTML = html;
  out.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', () => {
      const label = b.dataset.edit;
      const cur = state.emergency[label] || '';
      const v = prompt(label + ':', cur);
      if (v !== null) {
        setDoc(doc(db, 'config', 'emergency'), { ...state.emergency, [label]: v });
      }
    });
  });
}

// ===== モーダル =====
function showModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal-overlay').hidden = false;
  $('#modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });
  $$('[data-close]').forEach(b => b.addEventListener('click', closeModal));
}
function closeModal() { $('#modal-overlay').hidden = true; }

// ===== HTML エスケープ =====
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
