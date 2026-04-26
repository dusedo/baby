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
  CAT_ICONS, PHASE_INFO, MEMBERS, DUE_DATE, LMP_DATE, WEEKLY_COMMENTS,
  AI_SYSTEM_PROMPT, FAQ
} from './data.js?v=20260427g';

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
  // 今週の一言
  const comment = WEEKLY_COMMENTS[week] || WEEKLY_COMMENTS[Math.max(4, Math.min(42, week))] || '';
  const wkLbl = $('#weekly-comment-week');
  const txtEl = $('#weekly-comment-text');
  if (wkLbl) wkLbl.textContent = `${week}週の一言`;
  if (txtEl) txtEl.textContent = comment || '今週も一日一日を大切に。';
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
  // AI APIキー (Firestoreから読み込み)
  state.unsubs.push(onSnapshot(doc(db, 'config', 'ai'), snap => {
    state.aiApiKey = snap.exists() ? snap.data().claudeApiKey : null;
  }, onErr('ai-config')));
  // AIチャット履歴
  state.unsubs.push(onSnapshot(query(collection(db, 'chat'), orderBy('createdAt', 'asc')), snap => {
    state.chatMessages = [];
    snap.forEach(d => state.chatMessages.push({ id: d.id, ...d.data() }));
    if (state.activeTab === 'ai' && state.aiSubTab === 'chat') renderChatMessages();
  }, onErr('chat')));
  // ブックマーク
  state.unsubs.push(onSnapshot(query(collection(db, 'bookmarks'), orderBy('savedAt', 'desc')), snap => {
    state.bookmarks = [];
    snap.forEach(d => state.bookmarks.push({ id: d.id, ...d.data() }));
    if (state.activeTab === 'ai' && state.aiSubTab === 'bookmarks') {
      renderBookmarks($('#ai-content'));
    }
  }, onErr('bookmarks')));
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
  const renderers = {
    tasks: renderTasks,
    ai: renderAiTab,
    health: renderHealth,
    shopping: renderShopping,
    diary: renderDiary,
    more: renderMore,
  };
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
              <span class="task-tag who-${t.who}">${t.who === 'tomoko' ? 'Tomoko' : t.who === 'ken' ? 'Ken' : '二人で'}</span>
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
    const m = MEMBERS[e.author] || { name: e.author, emoji: '' };
    const w = e.createdAt ? calcWeek(e.createdAt.toDate()) : null;
    const wkLabel = w ? (w.day > 0 ? `${w.week}週+${w.day}日` : `${w.week}週`) : '';
    html += `
      <div class="diary-entry diary-${e.author}">
        <div class="diary-head">
          <div class="diary-author ${e.author}">${m.name}</div>
          <div class="diary-date">${formatDateLong(e.createdAt)}${wkLabel ? ` (${wkLabel})` : ''}</div>
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
      <button class="more-card" data-more="faq"><span class="icon">📚</span>よくある不安</button>
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
  state.activeMore = kind;
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
  } else if (kind === 'chat') {
    renderChat(out);
  } else if (kind === 'ai-settings') {
    renderAiSettings(out);
  } else if (kind === 'bookmarks') {
    renderBookmarks(out);
  } else if (kind === 'faq') {
    renderFaq(out);
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
            <span class="task-tag who-${t.who}">${t.who === 'tomoko' ? 'Tomoko' : t.who === 'ken' ? 'Ken' : '二人で'}</span>
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

// ===== AI 質問タブ (3サブタブ: チャット / 保存 / 設定) =====
function renderAiTab() {
  const root = $('#main-content');
  state.aiSubTab = state.aiSubTab || 'chat';
  root.innerHTML = `
    <div class="tab-title"><span class="icon">🤖</span>AIに質問</div>
    <div class="ai-subtabs">
      <button class="ai-subtab ${state.aiSubTab === 'chat' ? 'active' : ''}" data-sub="chat">💬 チャット</button>
      <button class="ai-subtab ${state.aiSubTab === 'bookmarks' ? 'active' : ''}" data-sub="bookmarks">📌 保存</button>
      <button class="ai-subtab ${state.aiSubTab === 'settings' ? 'active' : ''}" data-sub="settings">⚙️ 設定</button>
    </div>
    <div id="ai-content"></div>`;
  root.querySelectorAll('.ai-subtab').forEach(b => {
    b.addEventListener('click', () => { state.aiSubTab = b.dataset.sub; renderAiTab(); });
  });
  const out = $('#ai-content');
  if (state.aiSubTab === 'chat') renderChat(out);
  else if (state.aiSubTab === 'bookmarks') renderBookmarks(out);
  else if (state.aiSubTab === 'settings') renderAiSettings(out);
}

function renderChat(out) {
  if (!state.aiApiKey) {
    out.innerHTML = `
      <div class="empty">
        <span class="empty-emoji">🔑</span>
        APIキーが未設定です。<br>
        上の「⚙️ 設定」で Claude APIキーを登録してください。
      </div>`;
    return;
  }
  out.innerHTML = `
    <div class="chat-info">
      💡 妊娠・出産・育児について何でも聞いてください。<br>
      <small>※ 医学的な判断は必ず医師・助産師に相談してください</small>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-area">
      <textarea id="chat-input" placeholder="質問を入力…" rows="2"></textarea>
      <button id="chat-send-btn" class="btn-primary">送信</button>
    </div>
    <div style="text-align:right;margin-top:8px;">
      <button class="btn-danger" id="chat-clear-btn">履歴クリア</button>
    </div>`;
  renderChatMessages();
  $('#chat-send-btn').addEventListener('click', sendChat);
  $('#chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendChat();
  });
  $('#chat-clear-btn').addEventListener('click', clearChat);
}

function renderChatMessages() {
  const wrap = $('#chat-messages');
  if (!wrap) return;
  if (!state.chatMessages.length) {
    wrap.innerHTML = `<div class="chat-empty">最初の質問を入力してみてください</div>`;
    return;
  }
  wrap.innerHTML = state.chatMessages.map((m, idx) => {
    const text = renderSimpleMarkdown(m.content);
    const isAssistant = m.role === 'assistant';
    const isStreaming = m.id === '__streaming__';
    return `
      <div class="chat-msg chat-msg-${m.role}">
        <div class="chat-msg-wrap">
          <div class="chat-msg-bubble">${text}</div>
          ${isAssistant && !isStreaming ? `
            <div class="chat-msg-actions">
              <button class="chat-bookmark-btn" data-idx="${idx}" title="この回答を保存">📌 保存</button>
            </div>` : ''}
        </div>
      </div>`;
  }).join('');
  wrap.scrollTop = wrap.scrollHeight;
  wrap.querySelectorAll('.chat-bookmark-btn').forEach(b => {
    b.addEventListener('click', () => bookmarkAnswer(parseInt(b.dataset.idx, 10)));
  });
}

async function bookmarkAnswer(idx) {
  const ans = state.chatMessages[idx];
  if (!ans || ans.role !== 'assistant') return;
  // 直前のuser質問を探す
  let q = '';
  for (let i = idx - 1; i >= 0; i--) {
    if (state.chatMessages[i].role === 'user') { q = state.chatMessages[i].content; break; }
  }
  // 任意でタグ付け
  const tag = prompt('タグ (任意・例: つわり、手続き、食事…):', '') || '';
  await addDoc(collection(db, 'bookmarks'), {
    question: q,
    answer: ans.content,
    tag: tag.trim(),
    savedBy: state.currentUser,
    savedAt: serverTimestamp(),
  });
  alert('📌 保存しました');
}

function renderFaq(out) {
  const phases = ['全て', '初期', '中期', '後期', '出産前', '産後'];
  state.faqFilter = state.faqFilter || '全て';
  let html = `<div class="tab-title"><span class="icon">📚</span>よくある不安・質問</div>`;
  html += `<div class="filter-bar">`;
  phases.forEach(p => {
    const active = state.faqFilter === p ? 'active' : '';
    html += `<button class="filter-chip ${active}" data-faq-phase="${p}">${p}</button>`;
  });
  html += `</div>`;
  const filtered = state.faqFilter === '全て' ? FAQ : FAQ.filter(f => f.phase === state.faqFilter);
  html += `<div class="bookmark-list">`;
  filtered.forEach(f => {
    html += `
      <details class="bookmark-card">
        <summary>
          <div class="bookmark-q">❓ ${escapeHtml(f.q)}</div>
          <div class="bookmark-meta">
            <span class="bookmark-tag">${f.phase}</span>
          </div>
        </summary>
        <div class="bookmark-a">${escapeHtml(f.a).replace(/\n/g, '<br>')}</div>
      </details>`;
  });
  html += `</div>`;
  out.innerHTML = html;
  out.querySelectorAll('[data-faq-phase]').forEach(b => {
    b.addEventListener('click', () => { state.faqFilter = b.dataset.faqPhase; renderFaq(out); });
  });
}

function renderBookmarks(out) {
  let html = '';
  if (!state.bookmarks || !state.bookmarks.length) {
    html += `<div class="empty"><span class="empty-emoji">📭</span>まだ保存した回答がありません<br><small>「💬 チャット」タブの回答下の「📌 保存」ボタンから保存できます</small></div>`;
    out.innerHTML = html;
    return;
  }
  html += `<div class="bookmark-hint">タップで開閉、🗑️で削除</div>`;
  // タグ一覧
  const tags = ['全て', ...new Set(state.bookmarks.map(b => b.tag).filter(t => t))];
  state.bookmarkFilter = state.bookmarkFilter || '全て';
  html += `<div class="filter-bar">`;
  tags.forEach(t => {
    const active = state.bookmarkFilter === t ? 'active' : '';
    html += `<button class="filter-chip ${active}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
  });
  html += `</div>`;
  const filtered = state.bookmarkFilter === '全て'
    ? state.bookmarks
    : state.bookmarks.filter(b => b.tag === state.bookmarkFilter);
  html += `<div class="bookmark-list">`;
  filtered.forEach(b => {
    html += `
      <div class="bookmark-card-wrap">
        <details class="bookmark-card">
          <summary>
            <div class="bookmark-q">❓ ${escapeHtml(b.question || '(質問なし)')}</div>
            <div class="bookmark-meta">
              ${b.tag ? `<span class="bookmark-tag">${escapeHtml(b.tag)}</span>` : ''}
              <span class="bookmark-date">${formatDateLong(b.savedAt)}</span>
            </div>
          </summary>
          <div class="bookmark-a">${renderSimpleMarkdown(b.answer)}</div>
        </details>
        <button class="bookmark-del-btn" data-del-bm="${b.id}" title="削除">🗑️</button>
      </div>`;
  });
  html += `</div>`;
  out.innerHTML = html;
  out.querySelectorAll('[data-tag]').forEach(b => {
    b.addEventListener('click', () => { state.bookmarkFilter = b.dataset.tag; renderBookmarks(out); });
  });
  out.querySelectorAll('[data-del-bm]').forEach(b => {
    b.addEventListener('click', async () => {
      if (confirm('このブックマークを削除しますか？')) {
        await deleteDoc(doc(db, 'bookmarks', b.dataset.delBm));
      }
    });
  });
}

let chatBusy = false;
async function sendChat() {
  if (chatBusy) return;
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!state.aiApiKey) { alert('APIキー未設定'); return; }
  chatBusy = true;
  input.value = '';
  $('#chat-send-btn').textContent = '送信中…';
  $('#chat-send-btn').disabled = true;

  // ユーザーメッセージを保存
  await addDoc(collection(db, 'chat'), {
    role: 'user', content: text, by: state.currentUser, createdAt: serverTimestamp(),
  });

  // 直近10往復だけ送信 (コスト節約)
  const recent = state.chatMessages.slice(-20);
  const apiMessages = recent.map(m => ({ role: m.role, content: m.content }));
  apiMessages.push({ role: 'user', content: text });

  // 現在の状況を user メッセージの先頭に注入 (system promptはキャッシュ維持のため不変)
  const { week, day } = calcWeek();
  const wkLabel = day > 0 ? `${week}週+${day}日` : `${week}週`;
  const today = new Date().toLocaleDateString('ja-JP');
  apiMessages[apiMessages.length - 1].content =
    `[現在: ${today} / 妊娠 ${wkLabel} / 予定日まで${daysUntilDue()}日]\n\n${text}`;

  try {
    const Anthropic = (await import('https://esm.sh/@anthropic-ai/sdk@0.32.1')).default;
    const client = new Anthropic({
      apiKey: state.aiApiKey,
      dangerouslyAllowBrowser: true,
    });
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [{
        type: 'text',
        text: AI_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      }],
      messages: apiMessages,
    });
    let fullText = '';
    // 仮メッセージ表示用
    const tempId = '__streaming__';
    state.chatMessages.push({ id: tempId, role: 'assistant', content: '考え中…' });
    renderChatMessages();
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        const idx = state.chatMessages.findIndex(m => m.id === tempId);
        if (idx >= 0) state.chatMessages[idx].content = fullText;
        renderChatMessages();
      }
    }
    // 一時を取り除いて Firestore に保存 (購読でリアル更新)
    state.chatMessages = state.chatMessages.filter(m => m.id !== tempId);
    await addDoc(collection(db, 'chat'), {
      role: 'assistant', content: fullText, createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('Chat error:', e);
    state.chatMessages = state.chatMessages.filter(m => m.id !== '__streaming__');
    await addDoc(collection(db, 'chat'), {
      role: 'assistant',
      content: `❌ エラー: ${e.message || '不明'}\nAPIキーや残高を確認してください。`,
      createdAt: serverTimestamp(),
    });
  } finally {
    chatBusy = false;
    $('#chat-send-btn').textContent = '送信';
    $('#chat-send-btn').disabled = false;
  }
}

async function clearChat() {
  if (!confirm('チャット履歴を全て削除しますか？')) return;
  for (const m of state.chatMessages) {
    if (m.id && m.id !== '__streaming__') await deleteDoc(doc(db, 'chat', m.id));
  }
}

function renderAiSettings(out) {
  const masked = state.aiApiKey
    ? state.aiApiKey.slice(0, 12) + '…' + state.aiApiKey.slice(-4)
    : '未設定';
  out.innerHTML = `
    <div class="tab-title"><span class="icon">⚙️</span>AI設定</div>
    <div class="ai-settings-card">
      <label>Claude API キー</label>
      <input class="input" type="password" id="ai-key-input" placeholder="sk-ant-api03-..." autocomplete="new-password">
      <div class="ai-current">現在: <code>${masked}</code></div>
      <div class="ai-help">
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Claude API コンソール</a> で発行<br>
        <strong>必ず</strong> <a href="https://console.anthropic.com/settings/limits" target="_blank" rel="noopener">月額上限を$5</a> 等に設定してください
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn-primary" id="ai-key-save">保存</button>
        <button class="btn-danger" id="ai-key-clear">削除</button>
      </div>
    </div>`;
  $('#ai-key-save').addEventListener('click', async () => {
    const v = $('#ai-key-input').value.trim();
    if (!v.startsWith('sk-ant-')) { alert('正しいClaude APIキー形式ではありません'); return; }
    await setDoc(doc(db, 'config', 'ai'), { claudeApiKey: v });
    alert('保存しました');
    renderAiSettings(out);
  });
  $('#ai-key-clear').addEventListener('click', async () => {
    if (!confirm('APIキーを削除しますか？')) return;
    await deleteDoc(doc(db, 'config', 'ai'));
    alert('削除しました');
    renderAiSettings(out);
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

// ===== 簡易マークダウンレンダリング =====
function renderSimpleMarkdown(s) {
  if (s == null) return '';
  let txt = String(s);
  // --- (水平線) を完全削除
  txt = txt.replace(/^[ \t]*-{3,}[ \t]*$/gm, '');
  // 連続する空行を1つに
  txt = txt.replace(/\n{3,}/g, '\n\n');
  // HTMLエスケープ
  txt = escapeHtml(txt);
  // **bold** → <strong>
  txt = txt.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 行頭の - を • に置換 (リスト風)
  txt = txt.replace(/^- /gm, '• ');
  // 改行を <br>
  txt = txt.replace(/\n/g, '<br>');
  return txt;
}

// ===== HTML エスケープ =====
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
