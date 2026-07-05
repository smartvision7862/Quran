/**
 * Islam360 Web Application Logic
 */

// Application State
const state = {
  activeView: 'dashboard',
  currentLessonType: 'lessonA', // lessonA or lessonB
  selectedBook: null,
  selectedKitab: null,
  selectedKitabName: '',
  hadithLang: 1, // 1 = Urdu, 2 = English
  arabicFontSize: 28,
  translationFontSize: 16,
  hadithPage: 0,
  hadithLimit: 10,
  hadithTotal: 0,
  bookmarks: [],
  voiceEnabled: true,
  chatbotKey: atob('c2stb3ItdjEtODE3OWNkZGNiYjFiNTQ5NWUwODY0OWEyMmU0MTUyNTlkZmU1OGY0N2FmMjFiZGY1OWZjNGIzZGY0OGUwMDUwOQ==')
};

// Hadith Books list mapping
const hadithBooks = [
  { id: 'bukhari', name: 'Sahih al-Bukhari', file: 'bukhari.db', icon: '📖', chaptersCount: 97 },
  { id: 'muslim', name: 'Sahih Muslim', file: 'muslim.db', icon: '📚', chaptersCount: 56 },
  { id: 'abu_dawood', name: 'Sunan Abi Dawud', file: 'abu_dawood.db', icon: '📜', chaptersCount: 43 },
  { id: 'nasai', name: 'Sunan an-Nasa\'i', file: 'nasai.db', icon: '🕌', chaptersCount: 51 },
  { id: 'tirmazi', name: 'Jami\' at-Tirmidhi', file: 'tirmazi.db', icon: '✨', chaptersCount: 49 },
  { id: 'maja', name: 'Sunan Ibn Majah', file: 'maja.db', icon: '📖', chaptersCount: 37 },
  { id: 'mishkat', name: 'Mishkat al-Masabih', file: 'mishkat.db', icon: '📘', chaptersCount: 26 },
  { id: 'musnad', name: 'Musnad Ahmad', file: 'musnad.db', icon: '📚', chaptersCount: 1 },
  { id: 'silsila', name: 'Silsilat ad-Da\'ifah', file: 'silsila.db', icon: '📜', chaptersCount: 1 }
];

// Urdu Character Decryption Function (Character code point shift -3)
function decryptUrdu(scrambledText) {
  if (!scrambledText) return "";
  let result = [];
  for (let i = 0; i < scrambledText.length; i++) {
    let c = scrambledText.charCodeAt(i);
    // 1571 is the code point for 'أ'
    if (c === 1571) {
      result.push(' ');
    } else {
      result.push(String.fromCharCode(c - 3));
    }
  }
  return result.join('');
}

// Check if running in Android app via bridge
const isAndroid = typeof QuranAndroidBridge !== 'undefined';

// Client-side WebAssembly SQLite (SQL.js) fallback support
let sqlDbInstances = {}; // Cache of opened SQL.js database instances
let sqlJsEngine = null;  // SQL.js library instance

// Helper to update loading indicator text dynamically during database fetch/parsing
function updateLoadingIndicators(text) {
  document.querySelectorAll('.loading-indicator').forEach(el => {
    el.textContent = text;
  });
}

// Dynamically load SQL.js via WebAssembly from CDN
async function getSqlJsEngine() {
  if (sqlJsEngine) return sqlJsEngine;
  if (typeof initSqlJs === 'undefined') {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/sql-wasm.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load SQL.js library from CDN"));
      document.head.appendChild(script);
    });
  }
  sqlJsEngine = await initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${file}`
  });
  return sqlJsEngine;
}

// Fetch database file, trying multiple common paths and caching using Cache API
async function loadDatabaseFile(dbFile) {
  const cacheName = 'quran-db-cache';
  let cache = null;
  try {
    cache = await caches.open(cacheName);
  } catch (e) {
    console.warn("Cache API not supported or blocked:", e);
  }

  const urlsToTry = [
    dbFile,
    `databases/${dbFile}`,
    `extracted_assets/${dbFile}`,
    `extracted_assets/databases/${dbFile}`
  ];

  if (cache) {
    for (const relativeUrl of urlsToTry) {
      const absUrl = new URL(relativeUrl, window.location.href).href;
      try {
        const cachedResponse = await cache.match(absUrl);
        if (cachedResponse) {
          const buffer = await cachedResponse.arrayBuffer();
          // Verify if it is a valid SQLite DB file (size > 1000 bytes)
          if (buffer.byteLength > 1000) {
            console.log(`Loading database ${dbFile} from cache: ${relativeUrl} (${buffer.byteLength} bytes)`);
            return new Uint8Array(buffer);
          } else {
            console.warn(`Cached database ${dbFile} is too small (${buffer.byteLength} bytes). Deleting from cache.`);
            await cache.delete(absUrl);
          }
        }
      } catch (e) {
        console.warn(`Error reading cache for ${relativeUrl}:`, e);
      }
    }
  }

  let lastError = null;
  for (const relativeUrl of urlsToTry) {
    try {
      const absUrl = new URL(relativeUrl, window.location.href).href;
      console.log(`Trying to fetch database ${dbFile} from: ${absUrl}`);
      // Force fetching from network to bypass potential browser LFS pointer caching
      const response = await fetch(absUrl, { cache: 'reload' });
      if (response.ok) {
        const responseClone = response.clone();
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 1000) {
          if (cache) {
            try {
              await cache.put(absUrl, responseClone);
              console.log(`Saved database ${dbFile} from ${relativeUrl} into Cache API (${buffer.byteLength} bytes)`);
            } catch (e) {
              console.warn("Failed to write to Cache API:", e);
            }
          }
          return new Uint8Array(buffer);
        } else {
          console.warn(`Fetched database ${dbFile} from ${relativeUrl} is too small (${buffer.byteLength} bytes). Not caching or using.`);
        }
      }
    } catch (err) {
      lastError = err;
      console.warn(`Failed to fetch from ${relativeUrl}:`, err);
    }
  }
  throw lastError || new Error(`Database file ${dbFile} not found at any of the attempted paths.`);
}

// Query client-side SQLite using loaded SQL.js database
async function queryDatabaseClientSide(dbFile, sql, argsArray = []) {
  try {
    if (!sqlDbInstances[dbFile]) {
      console.log(`Initializing client-side database: ${dbFile}`);
      updateLoadingIndicators(`Downloading database ${dbFile} (first time may take a moment)...`);
      const SQL = await getSqlJsEngine();
      const dbData = await loadDatabaseFile(dbFile);
      updateLoadingIndicators(`Parsing database ${dbFile}...`);
      sqlDbInstances[dbFile] = new SQL.Database(dbData);
      console.log(`Database ${dbFile} initialized successfully`);
    }

    const db = sqlDbInstances[dbFile];
    const stmt = db.prepare(sql);
    stmt.bind(argsArray);
    
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    
    return rows;
  } catch (err) {
    console.error(`Client-side SQL error for ${dbFile}:`, err);
    throw err;
  }
}

// Database query router
async function queryDatabase(dbFile, sql, argsArray = []) {
  if (isAndroid) {
    try {
      const argsJson = JSON.stringify(argsArray);
      const jsonResult = QuranAndroidBridge.executeQuery(dbFile, sql, argsJson);
      return JSON.parse(jsonResult);
    } catch (e) {
      console.error("Android database error:", e);
      return [];
    }
  } else {
    // Use real server-side SQLite API (available when running via server.js)
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbFile, sql, args: argsArray })
      });
      if (response.ok) {
        const data = await response.json();
        // If server returned an error object (no DB available), fall through to client-side
        if (!Array.isArray(data)) {
          console.warn("API returned non-array, attempting client-side query:", data);
          try {
            return await queryDatabaseClientSide(dbFile, sql, argsArray);
          } catch (clientErr) {
            console.warn("Client-side query failed, returning mock:", clientErr);
            return getMockData(dbFile, sql, argsArray);
          }
        }
        return data;
      }
    } catch (e) {
      console.warn("API query failed, attempting client-side query:", e.message);
    }

    // Try client-side SQL.js query
    try {
      return await queryDatabaseClientSide(dbFile, sql, argsArray);
    } catch (clientErr) {
      console.warn("Client-side query failed, falling back to mock data:", clientErr.message);
      // Fallback: mock data when server API and SQL.js are both unavailable/failed
      return getMockData(dbFile, sql, argsArray);
    }
  }
}

// Local JSON loader that handles WebView file:/// restrictions
async function fetchLocalJson(path) {
  // Normalize path to key format (e.g. "understandQuranData/lessonA/1A.json" -> "lessonA/1A")
  const key = path.replace('understandQuranData/', '').replace('.json', '').replace('.txt', '');
  
  if (window.QURAN_LESSONS_DATA && typeof window.QURAN_LESSONS_DATA[key] !== 'undefined') {
    return window.QURAN_LESSONS_DATA[key];
  }

  if (isAndroid) {
    try {
      const fileContent = QuranAndroidBridge.readAssetFile("www/" + path);
      if (!fileContent) {
        throw new Error("Local asset file is empty or not found: " + path);
      }
      return JSON.parse(fileContent);
    } catch (e) {
      console.error("Android bridge asset read error:", e);
      throw e;
    }
  } else {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch local JSON [${response.status}]: ${path}`);
    }
    return await response.json();
  }
}


// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initTheme();
  loadBookmarks();
  loadSettings();
  setupSettingsListeners();
  
  // Load Default Views
  updateHijriDate();
  loadDailyInspiration();
  loadLessonsGrid();
  loadHadithBooks();
  loadAllahNames();
  initChatbot();
  initWbwQuran();
  initQuranReader();
  loadFahmVocabulary();
  loadSupplications();
  loadQuranTopics();
  
  // Listen for hash changes
  window.addEventListener('hashchange', handleRouting);
  handleRouting();
});

// Sidebar & Page Navigation Router
function initNavigation() {
  const sidebar = document.getElementById('sidebar');
  const menuBtn = document.getElementById('menuBtn');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  
  const toggleSidebar = () => {
    sidebar.classList.toggle('open');
  };
  
  menuBtn.addEventListener('click', toggleSidebar);
  sidebarToggleBtn.addEventListener('click', toggleSidebar);
}

function handleRouting() {
  const hash = window.location.hash || '#dashboard';
  const viewId = 'view-' + hash.substring(1);
  const activeNavId = 'nav-' + hash.substring(1);
  
  // Close sidebar on mobile after navigating
  document.getElementById('sidebar').classList.remove('open');

  // Activate view
  const views = document.querySelectorAll('.app-view');
  views.forEach(view => {
    if (view.id === viewId) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  // Activate navigation sidebar item
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.id === activeNavId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update Topbar Title with i18n
  const titles = {
    '#dashboard': 'Dashboard',
    '#sabaq': 'Learn Quran',
    '#hadith': 'Hadith Library',
    '#names': '99 Names of Allah',
    '#bookmarks': 'My Bookmarks',
    '#chatbot': 'Talkbot AI',
    '#settings': 'Settings',
    '#seerat': 'Seerat un Nabi (S.A.W)',
    '#quran-read': 'Quran Reader (Mushaf)',
    '#fahm': 'Fahm-ul-Quran Vocabulary',
    '#duas': 'Islamic Supplications',
    '#book': 'Momin Ka Hathyar',
    '#topics': 'Quran Subject Index'
  };
  const titleKey = {
    '#dashboard': 'nav.dashboard',
    '#sabaq': 'nav.sabaq',
    '#hadith': 'nav.hadith',
    '#names': 'nav.names',
    '#bookmarks': 'nav.bookmarks',
    '#chatbot': 'nav.chatbot',
    '#settings': 'nav.settings',
    '#seerat': 'nav.seerat',
    '#quran-read': 'nav.quran_read',
    '#fahm': 'nav.fahm',
    '#duas': 'nav.duas',
    '#book': 'nav.book',
    '#topics': 'nav.topics'
  }[hash] || 'nav.dashboard';

  const translatedTitle = (window.i18n && window.i18n[titleKey] && window.i18n[titleKey][window.currentLang || 'en']) || titles[hash] || 'Quran360 AI';
  document.getElementById('pageTitle').textContent = translatedTitle;
  document.title = `${translatedTitle} - Quran360 AI`;
  state.activeView = hash.substring(1);

  // Stop Qari audio recitation if playing and user changes pages
  if (typeof activeQariAudio !== 'undefined' && activeQariAudio) {
    if (isAndroid) {
      try {
        QuranAndroidBridge.stopAudio();
      } catch (e) {
        console.error("Bridge stop audio error:", e);
      }
    } else {
      activeQariAudio.pause();
    }
    activeQariAudio = null;
    activeQariId = null;
    document.querySelectorAll('.qari-play-btn').forEach(btn => {
      btn.classList.remove('playing');
      btn.textContent = '▶ Play Sample';
    });
  }

  // Stop active verse recitation if playing and user changes pages
  if (typeof stopActiveVerseAudio === 'function') {
    stopActiveVerseAudio();
  }

  // Load view content dynamically if needed
  if (hash === '#word-by-word') {
    loadWbwVerses();
  } else if (hash === '#quran-read') {
    loadQuranReaderVerses();
  } else if (hash === '#fahm') {
    loadFahmVocabulary();
  } else if (hash === '#duas') {
    loadSupplications();
  } else if (hash === '#topics') {
    loadQuranTopics();
  }
}

// Themes setup
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.body.className = savedTheme + '-theme';
  document.getElementById('themeSelect').value = savedTheme;
  
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.body.className.replace('-theme', '');
    const nextTheme = currentTheme === 'dark' ? 'light' : currentTheme === 'light' ? 'emerald' : 'dark';
    document.body.className = nextTheme + '-theme';
    document.getElementById('themeSelect').value = nextTheme;
    saveSettings();
  });

  document.getElementById('themeSelect').addEventListener('change', (e) => {
    document.body.className = e.target.value + '-theme';
    saveSettings();
  });
}

// Bookmarks Cache Logic
function loadBookmarks() {
  const saved = localStorage.getItem('bookmarks');
  if (saved) {
    state.bookmarks = JSON.parse(saved);
  }
  renderBookmarks();
}

function loadSettings() {
  const savedTheme = localStorage.getItem('theme');
  const savedArabicSize = parseInt(localStorage.getItem('arabicFontSize'), 10);
  const savedTranslationSize = parseInt(localStorage.getItem('translationFontSize'), 10);
  const savedHadithLang = parseInt(localStorage.getItem('hadithLang'), 10);
  const savedApiKey = localStorage.getItem('chatbot_api_key');
  const savedVoice = localStorage.getItem('voice_enabled');

  if (savedTheme) {
    document.body.className = savedTheme + '-theme';
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = savedTheme;
  }

  if (!Number.isNaN(savedArabicSize)) {
    state.arabicFontSize = savedArabicSize;
    const arabicRange = document.getElementById('arabicFontSize');
    if (arabicRange) arabicRange.value = savedArabicSize;
    const arabicSizeVal = document.getElementById('arabicSizeVal');
    if (arabicSizeVal) arabicSizeVal.textContent = `${savedArabicSize}px`;
  }

  if (!Number.isNaN(savedTranslationSize)) {
    state.translationFontSize = savedTranslationSize;
    const translationRange = document.getElementById('translationFontSize');
    if (translationRange) translationRange.value = savedTranslationSize;
    const translationSizeVal = document.getElementById('translationSizeVal');
    if (translationSizeVal) translationSizeVal.textContent = `${savedTranslationSize}px`;
  }

  if (!Number.isNaN(savedHadithLang)) {
    state.hadithLang = savedHadithLang;
    const langSelect = document.getElementById('defaultHadithLang');
    if (langSelect) langSelect.value = savedHadithLang;
  }

  if (savedApiKey) {
    state.chatbotKey = savedApiKey;
    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput) apiKeyInput.value = savedApiKey;
  } else {
    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput) apiKeyInput.value = state.chatbotKey;
  }

  if (savedVoice !== null) {
    state.voiceEnabled = (savedVoice === 'true');
    const speakToggleBtn = document.getElementById('speakToggleBtn');
    if (speakToggleBtn) {
      speakToggleBtn.classList.toggle('active', state.voiceEnabled);
      speakToggleBtn.textContent = state.voiceEnabled ? "🔊" : "🔇";
    }
  }

  const savedLogoStyle = localStorage.getItem('logoStyle') || 'badge';
  applyLogoStyle(savedLogoStyle);
}

function saveSettings() {
  localStorage.setItem('theme', document.body.className.replace('-theme', ''));
  localStorage.setItem('arabicFontSize', state.arabicFontSize.toString());
  localStorage.setItem('translationFontSize', state.translationFontSize.toString());
  localStorage.setItem('hadithLang', state.hadithLang.toString());
  localStorage.setItem('chatbot_api_key', state.chatbotKey || '');
  localStorage.setItem('voice_enabled', state.voiceEnabled.toString());
  
  const logoSelect = document.getElementById('logoSelect');
  if (logoSelect) {
    localStorage.setItem('logoStyle', logoSelect.value);
  }
}

function applyLogoStyle(style) {
  const sidebarLogoImg = document.getElementById('sidebarLogoImg');
  const heroLogoImg = document.getElementById('heroLogoImg');
  const logoSelect = document.getElementById('logoSelect');
  
  if (logoSelect) {
    logoSelect.value = style;
  }
  
  let markSrc = 'images/icon_badge_transparent.png';
  let fullSrc = 'images/logo_badge_transparent.png';
  
  if (style === 'dome') {
    markSrc = 'images/icon_dome_transparent.png';
    fullSrc = 'images/logo_dome_transparent.png';
  } else if (style === 'typo') {
    markSrc = 'images/logo_typo_transparent.png';
    fullSrc = 'images/logo_typo_transparent.png';
  } else if (style === 'shield') {
    markSrc = 'images/icon_shield_transparent.png';
    fullSrc = 'images/logo_shield_transparent.png';
  }
  
  if (sidebarLogoImg) sidebarLogoImg.src = markSrc;
  if (heroLogoImg) heroLogoImg.src = fullSrc;
  
  const chatbotAvatarImg = document.getElementById('chatbotAvatarImg');
  if (chatbotAvatarImg) chatbotAvatarImg.src = fullSrc;
}


function saveBookmark(item) {
  // Check if already bookmarked
  const idx = state.bookmarks.findIndex(b => b.id === item.id && b.book === item.book);
  if (idx > -1) {
    // Remove it
    state.bookmarks.splice(idx, 1);
  } else {
    // Add it
    state.bookmarks.push(item);
  }
  localStorage.setItem('bookmarks', JSON.stringify(state.bookmarks));
  renderBookmarks();
}

function renderBookmarks() {
  const container = document.getElementById('bookmarks-list');
  if (state.bookmarks.length === 0) {
    container.innerHTML = `<p class="empty-state">No bookmarks saved yet. Click the bookmark icon on any Hadith to save it here.</p>`;
    return;
  }
  
  container.innerHTML = '';
  state.bookmarks.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card hadith-card';
    card.style.marginBottom = '20px';
    
    // Decrypt if Urdu
    const textToShow = item.lang == 1 ? decryptUrdu(item.translation) : item.translation;
    
    card.innerHTML = `
      <div class="hadith-card-header">
        <span class="hadith-number">${item.bookTitle} - Hadith ${item.number}</span>
        <div class="hadith-meta-actions">
          <button class="bookmark-btn bookmarked" onclick="toggleBookmark('${item.book}', ${item.number}, ${item.id}, 1, '${escapeHtml(item.ravi)}', '${escapeHtml(item.translation)}', '${escapeHtml(item.arabic)}', '${escapeHtml(item.bookTitle)}')">🔖 Remove</button>
        </div>
      </div>
      ${item.ravi ? `<div class="hadith-ravi">${item.ravi}</div>` : ''}
      ${item.arabic ? `<div class="hadith-arabic" style="font-size: ${state.arabicFontSize}px">${item.arabic}</div>` : ''}
      <div class="hadith-translation ${item.lang == 1 ? 'ur' : 'en'}" style="font-size: ${state.translationFontSize}px">${textToShow}</div>
    `;
    container.appendChild(card);
  });
}

function toggleBookmark(book, number, id, lang, ravi, translation, arabic, bookTitle) {
  const item = { book, number, id, lang, ravi, translation, arabic, bookTitle };
  saveBookmark(item);
  // Re-render current page hadiths to show correct bookmark icon
  if (state.activeView === 'hadith') {
    renderHadithsPage();
  }
}

// Settings Setup
function setupSettingsListeners() {
  const arabicRange = document.getElementById('arabicFontSize');
  const transRange = document.getElementById('translationFontSize');
  const langSelect = document.getElementById('defaultHadithLang');
  const clearBookmarksBtn = document.getElementById('clearAllBookmarksBtn');
  const apiKeyInput = document.getElementById('apiKey');
  
  arabicRange.addEventListener('input', (e) => {
    state.arabicFontSize = parseInt(e.target.value);
    document.getElementById('arabicSizeVal').textContent = e.target.value + 'px';
    document.querySelectorAll('.hadith-arabic, .word-arabic').forEach(el => {
      el.style.fontSize = e.target.value + 'px';
    });
    saveSettings();
  });
   
  transRange.addEventListener('input', (e) => {
    state.translationFontSize = parseInt(e.target.value);
    document.getElementById('translationSizeVal').textContent = e.target.value + 'px';
    document.querySelectorAll('.hadith-translation, .word-translation').forEach(el => {
      el.style.fontSize = e.target.value + 'px';
    });
    saveSettings();
  });
   
  langSelect.addEventListener('change', (e) => {
    state.hadithLang = parseInt(e.target.value);
    saveSettings();
    if (state.selectedKitab !== null) {
      loadHadiths(state.selectedKitab);
    }
  });

  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.chatbotKey = e.target.value;
      saveSettings();
    });
  }
  
  clearBookmarksBtn.addEventListener('click', () => {
    if (confirm("Are you sure you want to delete all bookmarks?")) {
      state.bookmarks = [];
      localStorage.removeItem('bookmarks');
      renderBookmarks();
      if (state.activeView === 'hadith') {
        renderHadithsPage();
      }
    }
  });

  const logoSelect = document.getElementById('logoSelect');
  if (logoSelect) {
    logoSelect.addEventListener('change', (e) => {
      applyLogoStyle(e.target.value);
      saveSettings();
    });
  }
}

// Dynamic Dates Info
function updateHijriDate() {
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const gregDate = now.toLocaleDateString('en-US', options);

  let hijriDate = '';
  try {
    hijriDate = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(now);
  } catch (e) {
    const approximateYear = Math.floor((now.getFullYear() - 622) * (365.25 / 354.36));
    hijriDate = `${approximateYear} AH`;
  }

  document.getElementById('hijri-date').textContent = `${gregDate} | ${hijriDate}`;
}

// Deterministic Daily Verse & Hadith Inspirations
function loadDailyInspiration() {
  const dailyVerses = [
    {
      arabic: "إِنَّ مَعَ الْعُسْرِ يُسْرًا",
      translation: "Indeed, with hardship [will be] ease.",
      ref: "Surah Ash-Sharh 94:6"
    },
    {
      arabic: "رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا",
      translation: "Our Lord, let not our hearts deviate after You have guided us.",
      ref: "Surah Ali 'Imran 3:8"
    },
    {
      arabic: "وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ",
      translation: "And when My servants ask you concerning Me, indeed I am near.",
      ref: "Surah Al-Baqarah 2:186"
    },
    {
      arabic: "فَاذْكُرُونِي أَذْكُرْكُمْ",
      translation: "So remember Me; I will remember you.",
      ref: "Surah Al-Baqarah 2:152"
    },
    {
      arabic: "وَتَوَكَّلْ عَلَى الْحَيِّ الَّذِي لَا يَمُوتُ",
      translation: "And trust in the Ever-Living who does not die.",
      ref: "Surah Al-Furqan 25:58"
    },
    {
      arabic: "إِنَّ اللَّهَ لَا يُغَيِّرُ مَا بِقَوْمٍ حَتَّىٰ يُغَيِّرُوا مَا بِأَنفُسِهِمْ",
      translation: "Indeed, Allah will not change the condition of a people until they change what is in themselves.",
      ref: "Surah Ar-Ra'd 13:11"
    },
    {
      arabic: "إِنَّ اللَّهَ مَعَ الصَّابِرِينَ",
      translation: "Indeed, Allah is with the patient.",
      ref: "Surah Al-Baqarah 2:153"
    },
    {
      arabic: "ادْعُونِي أَسْتَجِبْ لَكُمْ",
      translation: "Call upon Me; I will respond to you.",
      ref: "Surah Ghafir 40:60"
    }
  ];

  const dailyHadiths = [
    {
      text: "The Prophet (ﷺ) said: 'The best among you are those who learn the Qur'an and teach it.'",
      ref: "Sahih al-Bukhari 5027"
    },
    {
      text: "The Prophet (ﷺ) said: 'Verily, actions are judged by intentions, and every person will have only what they intended.'",
      ref: "Sahih al-Bukhari 1"
    },
    {
      text: "The Prophet (ﷺ) said: 'Cleanliness is half of faith.'",
      ref: "Sahih Muslim 223"
    },
    {
      text: "The Prophet (ﷺ) said: 'Make things easy for people and do not make them difficult, and give good tidings and do not pull people away.'",
      ref: "Sahih al-Bukhari 6125"
    },
    {
      text: "The Prophet (ﷺ) said: 'A good word is charity.'",
      ref: "Sahih al-Bukhari 2989"
    },
    {
      text: "The Prophet (ﷺ) said: 'None of you truly believes until he loves for his brother what he loves for himself.'",
      ref: "Sahih al-Bukhari 13"
    },
    {
      text: "The Prophet (ﷺ) said: 'The most beloved of deeds to Allah are those that are most consistent, even if they are small.'",
      ref: "Sahih al-Bukhari 6464"
    },
    {
      text: "The Prophet (ﷺ) said: 'Avoid jealousy, for indeed jealousy consumes good deeds just as fire consumes wood.'",
      ref: "Sunan Abi Dawood 4903"
    }
  ];

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const diff = now - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);

  const verse = dailyVerses[dayOfYear % dailyVerses.length];
  const hadith = dailyHadiths[dayOfYear % dailyHadiths.length];

  const arEl = document.getElementById('daily-verse-arabic');
  const transEl = document.getElementById('daily-verse-translation');
  const refEl = document.getElementById('daily-verse-ref');
  const hTextEl = document.getElementById('daily-hadith-text');
  const hRefEl = document.getElementById('daily-hadith-ref');

  if (arEl) arEl.textContent = verse.arabic;
  if (transEl) transEl.textContent = verse.translation;
  if (refEl) refEl.textContent = verse.ref;
  if (hTextEl) hTextEl.textContent = hadith.text;
  if (hRefEl) hRefEl.textContent = hadith.ref;
}

// Learn Quran - Course Cards Populating
function loadLessonsGrid() {
  const container = document.getElementById('lessons-grid');
  
  const tabA = document.getElementById('tab-lessonA');
  const tabB = document.getElementById('tab-lessonB');
  const tabTests = document.getElementById('tab-tests');
  
  const clearActiveTabs = () => {
    tabA.classList.remove('active');
    tabB.classList.remove('active');
    tabTests.classList.remove('active');
  };
  
  tabA.addEventListener('click', () => {
    clearActiveTabs();
    tabA.classList.add('active');
    state.currentLessonType = 'lessonA';
    renderLessons();
  });
  
  tabB.addEventListener('click', () => {
    clearActiveTabs();
    tabB.classList.add('active');
    state.currentLessonType = 'lessonB';
    renderLessons();
  });
  
  tabTests.addEventListener('click', () => {
    clearActiveTabs();
    tabTests.classList.add('active');
    state.currentLessonType = 'tests';
    renderLessons();
  });
  
  renderLessons();
}

function renderLessons() {
  const container = document.getElementById('lessons-grid');
  container.innerHTML = '';
  
  if (state.currentLessonType === 'tests') {
    // Render the 2 Quran Tests
    for (let i = 1; i <= 2; i++) {
      const card = document.createElement('div');
      card.className = 'card lesson-card';
      card.innerHTML = `
        <div>
          <div class="lesson-number">Test ${i}</div>
          <h3 class="lesson-title">Quran Vocabulary Test ${i}</h3>
        </div>
        <p style="font-size: 13px; color: var(--text-secondary)">Test your knowledge with multiple-choice questions.</p>
      `;
      card.addEventListener('click', () => startTest(i));
      container.appendChild(card);
    }
    return;
  }

  const lessonCodes = getAvailableLessonCodes(state.currentLessonType);
  lessonCodes.forEach(lessonCode => {
    const card = document.createElement('div');
    card.className = 'card lesson-card';
    const lessonNumber = lessonCode.replace(/[AB]$/, '');
    const lessonTitle = state.currentLessonType === 'lessonA'
      ? `Lesson ${lessonNumber} - Grammar`
      : `Lesson ${lessonNumber} - Quran Translation`;
    
    card.innerHTML = `
      <div>
        <div class="lesson-number">Lesson ${lessonCode}</div>
        <h3 class="lesson-title">${lessonTitle}</h3>
      </div>
        <p style="font-size: 13px; color: var(--text-secondary)">Click to start interactive sabaq study</p>
    `;
    card.addEventListener('click', () => startLesson(lessonCode, state.currentLessonType));
    container.appendChild(card);
  });
}

function getAvailableLessonCodes(type) {
  const suffix = type === 'lessonA' ? 'A' : 'B';
  const prefix = `${type}/`;
  const fallbackCodes = Array.from({ length: 20 }, (_, index) => `${index + 1}${suffix}`);
  const bundledCodes = window.QURAN_LESSONS_DATA
    ? Object.keys(window.QURAN_LESSONS_DATA)
        .filter(key => key.startsWith(prefix))
        .map(key => key.substring(prefix.length))
    : [];

  return (bundledCodes.length ? bundledCodes : fallbackCodes).sort(compareLessonCodes);
}

function compareLessonCodes(a, b) {
  const lessonA = parseFloat(a);
  const lessonB = parseFloat(b);

  if (lessonA !== lessonB) {
    return lessonA - lessonB;
  }

  return a.localeCompare(b, undefined, { numeric: true });
}

// Interactive Test Player Variables
let currentTestData = null;
let currentQuestionIndex = 0;
let testScore = 0;

// Fetch Test JSON and Open Interactive Player
async function startTest(num) {
  const grid = document.getElementById('lessons-grid');
  const player = document.getElementById('test-player');
  const selector = document.querySelector('.course-selector');
  
  // File path: understandQuranData/test[num]/Test[num].json
  const path = `understandQuranData/test${num}/Test${num}.json`;
  
  try {
    const data = await fetchLocalJson(path);
    currentTestData = data.items;
    currentQuestionIndex = 0;
    testScore = 0;
    
    grid.classList.add('hidden');
    selector.classList.add('hidden');
    player.classList.remove('hidden');
    
    document.getElementById('player-test-title').textContent = `Vocabulary Test ${num}`;
    
    // Setup back button listener
    document.getElementById('closeTestBtn').onclick = () => {
      grid.classList.remove('hidden');
      selector.classList.remove('hidden');
      player.classList.add('hidden');
    };
    
    renderTestQuestion();
    
  } catch (err) {
    alert("Could not load test: " + err.message);
  }
}

function renderTestQuestion() {
  const q = currentTestData[currentQuestionIndex];
  
  document.getElementById('test-q-num').textContent = q.header.questionNumber || `Question ${currentQuestionIndex + 1}`;
  document.getElementById('test-q-text').textContent = q.header.text;
  
  const optionsGrid = document.getElementById('test-options-grid');
  optionsGrid.innerHTML = '';
  
  const controls = document.getElementById('test-controls');
  controls.classList.add('hidden');
  
  let answered = false;
  
  q.images.forEach((imgObj, idx) => {
    const card = document.createElement('div');
    card.className = 'option-card';
    
    // Resolve image path to local images/ folder
    const filename = imgObj.imagePath + ".png";
    const src = "images/" + filename;
    
    card.innerHTML = `<img src="${src}" alt="Option ${idx + 1}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'50\'><rect width=\'100%\' height=\'100%\' fill=\'%23333\'/><text x=\'50%\' y=\'50%\' dominant-baseline=\'middle\' text-anchor=\'middle\' fill=\'%23fff\'>${imgObj.imagePath}</text></svg>'">`;
    
    card.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      
      const correctIdx = q.correctImage; // 0-indexed correct image
      const cards = optionsGrid.querySelectorAll('.option-card');
      
      if (idx === correctIdx) {
        card.classList.add('correct');
        testScore++;
        document.getElementById('test-feedback-text').innerHTML = `<span class="feedback-correct">✓ Correct!</span>`;
      } else {
        card.classList.add('incorrect');
        cards[correctIdx].classList.add('correct');
        document.getElementById('test-feedback-text').innerHTML = `<span class="feedback-incorrect">✗ Incorrect</span>`;
      }
      
      controls.classList.remove('hidden');
      
      // Setup Next button
      const nextBtn = document.getElementById('nextQuestionBtn');
      if (currentQuestionIndex < currentTestData.length - 1) {
        nextBtn.textContent = "Next Question";
        nextBtn.onclick = () => {
          currentQuestionIndex++;
          renderTestQuestion();
        };
      } else {
        nextBtn.textContent = "See Results";
        nextBtn.onclick = () => {
          showTestResults();
        };
      }
    });
    
    optionsGrid.appendChild(card);
  });
}

function showTestResults() {
  const optionsGrid = document.getElementById('test-options-grid');
  optionsGrid.innerHTML = '';
  
  document.getElementById('test-q-num').textContent = "Test Completed";
  
  const percentage = Math.round((testScore / currentTestData.length) * 100);
  let msg = '';
  if (percentage >= 80) msg = "Masha Allah! Excellent job!";
  else if (percentage >= 50) msg = "Good effort! Keep practicing.";
  else msg = "Keep studying and try again.";
  
  document.getElementById('test-q-text').innerHTML = `
    <div style="font-size: 24px; font-weight: normal; font-family: var(--font-sans);">
      Your Score: <strong style="color: var(--accent-gold);">${testScore}</strong> / ${currentTestData.length} (${percentage}%)
      <p style="font-size: 16px; color: var(--text-secondary); margin-top: 16px;">${msg}</p>
    </div>
  `;
  
  const controls = document.getElementById('test-controls');
  controls.classList.remove('hidden');
  document.getElementById('test-feedback-text').textContent = '';
  
  const nextBtn = document.getElementById('nextQuestionBtn');
  nextBtn.textContent = "Retry Test";
  nextBtn.onclick = () => {
    currentQuestionIndex = 0;
    testScore = 0;
    renderTestQuestion();
  };
}


// Fetch Lesson JSON and Open Interactive Player
// Fetch Lesson JSON and Open Interactive Player
async function startLesson(lessonCode, type) {
  const grid = document.getElementById('lessons-grid');
  const player = document.getElementById('lesson-player');
  const selector = document.querySelector('.course-selector');
  const code = lessonCode;
  const path = `understandQuranData/${type}/${lessonCode}.json`;
  
  try {
    const data = await fetchLocalJson(path);
    
    // Hide lessons selector and show player
    grid.classList.add('hidden');
    selector.classList.add('hidden');
    player.classList.remove('hidden');
    
    const headerTitleEl = document.getElementById('player-lesson-title');
    headerTitleEl.textContent = `Lesson ${code}`;
    
    const wordGrid = document.getElementById('player-word-grid');
    wordGrid.innerHTML = '';
    wordGrid.className = 'lesson-workbook';

    const oldPlayBtn = document.getElementById('header-play-btn');
    if (oldPlayBtn) oldPlayBtn.remove();

    const tables = Array.isArray(data.tables) ? data.tables : [];
    document.getElementById('player-header-text').innerHTML = `
      <span class="lesson-kicker">Understand Quran</span>
      <span>${type === 'lessonA' ? 'Quran Words and Translation' : 'Grammar Practice'}</span>
    `;
    document.getElementById('player-footer-text').innerHTML = '';

    tables.forEach((table, tableIndex) => {
      wordGrid.appendChild(createLessonSection(table, tableIndex, code));
    });
    
  } catch (err) {
    alert("Could not load lesson: " + err.message);
  }
}

function createLessonSection(table, tableIndex, lessonCode) {
  const section = document.createElement('section');
  section.className = 'lesson-section';

  const headerText = table.headerText || table.header?.text || '';
  const footerText = table.footerText || table.footer?.text || '';
  const headerAudioFile = table.header?.audioPath || table.headerAudio || '';
  const items = table.columns || table.rows || [];

  const header = document.createElement('div');
  header.className = 'lesson-section-header';
  header.innerHTML = `
    <div>
      <span class="lesson-section-number">${String(tableIndex + 1).padStart(2, '0')}</span>
      ${headerText ? `<div class="lesson-section-text">${formatLessonText(headerText)}</div>` : ''}
    </div>
  `;

  if (headerAudioFile) {
    const playBtn = document.createElement('button');
    playBtn.className = 'lesson-audio-btn';
    playBtn.type = 'button';
    playBtn.textContent = 'Listen';
    playBtn.addEventListener('click', () => playWordAudio(headerAudioFile, lessonCode));
    header.appendChild(playBtn);
  }

  section.appendChild(header);

  const tableEl = document.createElement('div');
  tableEl.className = 'lesson-table';

  items.forEach(item => {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'lesson-word-card word-block';

    const cleanArabic = formatLessonText(item.arabic || '');
    const cleanTrans = item.translation || item.secondaryText || '';
    const cleanDetail = item.detail ? formatLessonText(item.detail) : '';
    const audioFile = item.audioName || item.audioPath || '';
    const count = item.count ? `<span class="lesson-count">${item.count}</span>` : '';

    block.innerHTML = `
      <div class="word-arabic" style="font-size: ${state.arabicFontSize}px">${cleanArabic}</div>
      <div class="word-translation" style="font-size: ${state.translationFontSize}px">${cleanTrans}</div>
      ${cleanDetail ? `<div class="word-detail">${cleanDetail}</div>` : ''}
      ${count}
    `;

    block.addEventListener('click', () => {
      document.querySelectorAll('.word-block').forEach(w => w.classList.remove('playing'));
      block.classList.add('playing');
      playWordAudio(audioFile, lessonCode);
    });

    tableEl.appendChild(block);
  });

  section.appendChild(tableEl);

  if (footerText) {
    const footer = document.createElement('div');
    footer.className = 'lesson-section-footer';
    footer.innerHTML = formatLessonText(footerText);
    section.appendChild(footer);
  }

  return section;
}

// Clean brackets in Quran Sabaq texts like _a_اَعُوْذُ_/a_ into styling span
function formatLessonText(text) {
  return text
    .replace(/_a_/g, '<span class="arabic-highlight">')
    .replace(/_\\?\/a_/g, '</span>')
    .replace(/\n/g, '<br>');
}

// Play sabaq audio file
function playWordAudio(audioName, lessonCode) {
  if (!audioName) return;
  
  if (isAndroid) {
    try {
      QuranAndroidBridge.playAudio(audioName);
    } catch (e) {
      console.error("Bridge audio play error:", e);
    }
  } else {
    // Web fallback using public understandquran URL if audio isn't local
    // Audios usually hosted at: https://understandquran.com/...
    // Let's print out what is playing for mock feedback
    console.log(`Playing audio: ${audioName} for lesson ${lessonCode}`);
    const audio = document.getElementById('sabaqAudio');
    // Fallback URL (approximated online endpoint)
    audio.src = `https://understandquran.com/assets/audios/${audioName}`;
    audio.play().catch(e => {
      console.warn("Browser audio fallback blocked/failed. Sound: " + audioName);
    });
  }
}

// Player close back button
document.getElementById('closePlayerBtn').addEventListener('click', () => {
  document.getElementById('lessons-grid').classList.remove('hidden');
  document.querySelector('.course-selector').classList.remove('hidden');
  document.getElementById('lesson-player').classList.add('hidden');
  
  // Stop audio if playing
  const audio = document.getElementById('sabaqAudio');
  audio.pause();
});

// Hadith Books list
function loadHadithBooks() {
  const container = document.getElementById('books-grid');
  container.innerHTML = '';
  
  hadithBooks.forEach(book => {
    const card = document.createElement('div');
    card.className = 'card book-card';
    card.innerHTML = `
      <div class="book-icon">${book.icon}</div>
      <h3>${book.name}</h3>
      <p>${book.chaptersCount} Chapters available offline</p>
    `;
    card.addEventListener('click', () => selectHadithBook(book));
    container.appendChild(card);
  });
  
  // Setup Hadith back buttons
  document.getElementById('backToBooksBtn').addEventListener('click', () => {
    document.getElementById('hadith-books-screen').classList.remove('hidden');
    document.getElementById('hadith-chapters-screen').classList.add('hidden');
    state.selectedBook = null;
  });

  document.getElementById('backToChaptersBtn').addEventListener('click', () => {
    document.getElementById('hadith-chapters-screen').classList.remove('hidden');
    document.getElementById('hadith-list-screen').classList.add('hidden');
    state.selectedKitab = null;
  });
  
  // Setup pagination clicks
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (state.hadithPage > 0) {
      state.hadithPage--;
      renderHadithsPage();
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    if ((state.hadithPage + 1) * state.hadithLimit < state.hadithTotal) {
      state.hadithPage++;
      renderHadithsPage();
    }
  });

  // Search logic
  document.getElementById('hadithSearchBtn').addEventListener('click', runHadithSearch);
  document.getElementById('hadithGlobalSearch').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') runHadithSearch();
  });
}

// Select a book and load chapters
async function selectHadithBook(book) {
  state.selectedBook = book;
  
  document.getElementById('hadith-books-screen').classList.add('hidden');
  document.getElementById('hadith-chapters-screen').classList.remove('hidden');
  document.getElementById('selected-book-title').textContent = book.name;
  
  const container = document.getElementById('chapters-list');
  container.innerHTML = '<p class="empty-state">Loading chapters...</p>';
  
  const chapters = await queryDatabase(book.file, "SELECT Kitab_ID, Kitab, Kitab_Eng FROM tbl_Kitab ORDER BY Kitab_ID");
  
  container.innerHTML = '';
  if (chapters.length === 0) {
    container.innerHTML = '<p class="empty-state">No chapters found in this database.</p>';
    return;
  }
  
  chapters.forEach(ch => {
    const row = document.createElement('div');
    row.className = 'chapter-row';
    row.innerHTML = `
      <span class="chapter-number">${ch.Kitab_ID || ch.BookNo}</span>
      <span class="chapter-title-en">${ch.Kitab_Eng || 'Chapter Details'}</span>
      <span class="chapter-title-ur" dir="rtl">${ch.Kitab || ''}</span>
    `;
    row.addEventListener('click', () => selectChapter(ch));
    container.appendChild(row);
  });
}

// Select a chapter and open Hadith cards page
function selectChapter(chapter) {
  state.selectedKitab = chapter.Kitab_ID;
  state.selectedKitabName = chapter.Kitab_Eng || chapter.Kitab;
  state.hadithPage = 0;
  
  document.getElementById('hadith-chapters-screen').classList.add('hidden');
  document.getElementById('hadith-list-screen').classList.remove('hidden');
  document.getElementById('selected-chapter-title').textContent = state.selectedKitabName;
  
  loadHadiths(state.selectedKitab);
}

// Load Hadiths list for chapter
async function loadHadiths(kitabId) {
  const container = document.getElementById('hadith-cards-container');
  container.innerHTML = '<p class="empty-state">Loading Hadiths...</p>';
  
  // Get count first
  const countRes = await queryDatabase(
    state.selectedBook.file, 
    "SELECT COUNT(*) as total FROM hadees WHERE kitab_id = ?",
    [kitabId]
  );
  state.hadithTotal = countRes[0]?.total || 0;
  
  renderHadithsPage();
}

// Render paginated Hadiths list
async function renderHadithsPage() {
  const container = document.getElementById('hadith-cards-container');
  container.innerHTML = '';
  
  const offset = state.hadithPage * state.hadithLimit;
  
  // Select columns. Urdu (lang=1) is scrambled so we decrypt on load
  const hadiths = await queryDatabase(
    state.selectedBook.file,
    `SELECT h.record_id, h.hadees_number, h.arabic, hl.ravi, hl.hadees AS translation
     FROM hadees h 
     JOIN hadees_languages hl ON h.record_id = hl.hadees_record_id 
     WHERE h.kitab_id = ? AND hl.language_id = ? 
     ORDER BY h.record_id LIMIT ? OFFSET ?`,
    [state.selectedKitab, state.hadithLang, state.hadithLimit, offset]
  );
  
  if (hadiths.length === 0) {
    container.innerHTML = '<p class="empty-state">No Hadiths found on this page.</p>';
    return;
  }
  
  hadiths.forEach(h => {
    const card = document.createElement('div');
    card.className = 'card hadith-card';
    
    // Decrypt if Urdu
    const isUrdu = state.hadithLang === 1;
    const textToShow = isUrdu ? decryptUrdu(h.translation) : h.translation;
    
    // Check if bookmarked
    const isSaved = state.bookmarks.some(b => b.id === h.record_id && b.book === state.selectedBook.id);
    const bookmarkLabel = isSaved ? '🔖 Saved' : '🔖 Bookmark';
    const bookmarkClass = isSaved ? 'bookmark-btn bookmarked' : 'bookmark-btn';
    
    card.innerHTML = `
      <div class="hadith-card-header">
        <span class="hadith-number">Hadith ${h.hadees_number}</span>
        <div class="hadith-meta-actions">
          <button class="${bookmarkClass}" onclick="toggleBookmark('${state.selectedBook.id}', ${h.hadees_number}, ${h.record_id}, ${state.hadithLang}, '${escapeHtml(h.ravi || '')}', '${escapeHtml(h.translation)}', '${escapeHtml(h.arabic)}', '${escapeHtml(state.selectedBook.name)}')">${bookmarkLabel}</button>
        </div>
      </div>
      ${h.ravi ? `<div class="hadith-ravi">${h.ravi}</div>` : ''}
      <div class="hadith-arabic" style="font-size: ${state.arabicFontSize}px" dir="rtl">${h.arabic}</div>
      <div class="hadith-translation ${isUrdu ? 'ur' : 'en'}" style="font-size: ${state.translationFontSize}px">${textToShow}</div>
    `;
    container.appendChild(card);
  });
  
  // Update pagination info
  const totalPages = Math.max(1, Math.ceil(state.hadithTotal / state.hadithLimit));
  document.getElementById('pageInfo').textContent = `Page ${state.hadithPage + 1} of ${totalPages}`;
  document.getElementById('prevPageBtn').disabled = state.hadithPage === 0;
  document.getElementById('nextPageBtn').disabled = (state.hadithPage + 1) >= totalPages;
}

// Hadith search logic
async function runHadithSearch() {
  const query = document.getElementById('hadithGlobalSearch').value.trim();
  if (!query) return;
  
  // Find which book is selected or search across all books (default to first active or bukhari if none selected)
  const book = state.selectedBook || hadithBooks[0];
  
  const container = document.getElementById('hadith-cards-container');
  
  // Transition views to show list screen
  document.getElementById('hadith-books-screen').classList.add('hidden');
  document.getElementById('hadith-chapters-screen').classList.add('hidden');
  document.getElementById('hadith-list-screen').classList.remove('hidden');
  document.getElementById('selected-chapter-title').textContent = `Search Results for "${query}"`;
  
  container.innerHTML = '<p class="empty-state">Searching database...</p>';
  
  // Check if search query is a number
  let hadiths = [];
  if (/^\d+$/.test(query)) {
    hadiths = await queryDatabase(
      book.file,
      `SELECT h.record_id, h.hadees_number, h.arabic, hl.ravi, hl.hadees AS translation
       FROM hadees h
       JOIN hadees_languages hl ON h.record_id = hl.hadees_record_id
       WHERE h.hadees_number = ? AND hl.language_id = ?
       LIMIT 10`,
      [parseInt(query), state.hadithLang]
    );
  } else {
    const translationWildcard = state.hadithLang === 1 ? `%${scrambleUrdu(query)}%` : `%${query}%`;
    const raviWildcard = state.hadithLang === 1 ? `%${scrambleUrdu(query)}%` : `%${query}%`;
    const arabicWildcard = `%${query}%`;
    hadiths = await queryDatabase(
      book.file,
      `SELECT h.record_id, h.hadees_number, h.arabic, hl.ravi, hl.hadees AS translation
       FROM hadees h
       JOIN hadees_languages hl ON h.record_id = hl.hadees_record_id
       WHERE (hl.hadees LIKE ? OR hl.ravi LIKE ? OR h.arabic LIKE ?) AND hl.language_id = ?
       LIMIT 20`,
      [translationWildcard, raviWildcard, arabicWildcard, state.hadithLang]
    );
  }
  
  container.innerHTML = '';
  state.hadithTotal = hadiths.length;
  document.getElementById('pageInfo').textContent = `Found ${hadiths.length} matches`;
  document.getElementById('prevPageBtn').disabled = true;
  document.getElementById('nextPageBtn').disabled = true;
  
  if (hadiths.length === 0) {
    container.innerHTML = '<p class="empty-state">No matching Hadiths found.</p>';
    return;
  }
  
  hadiths.forEach(h => {
    const card = document.createElement('div');
    card.className = 'card hadith-card';
    
    // Decrypt if Urdu
    const isUrdu = state.hadithLang === 1;
    let textToShow = h.translation;
    if (isUrdu) {
      textToShow = decryptUrdu(h.translation);
    }
    
    const isSaved = state.bookmarks.some(b => b.id === h.record_id && b.book === book.id);
    const bookmarkLabel = isSaved ? '🔖 Saved' : '🔖 Bookmark';
    const bookmarkClass = isSaved ? 'bookmark-btn bookmarked' : 'bookmark-btn';
    
    card.innerHTML = `
      <div class="hadith-card-header">
        <span class="hadith-number">${book.name} - Hadith ${h.hadees_number}</span>
        <div class="hadith-meta-actions">
          <button class="${bookmarkClass}" onclick="toggleBookmark('${book.id}', ${h.hadees_number}, ${h.record_id}, ${state.hadithLang}, '${escapeHtml(h.ravi || '')}', '${escapeHtml(h.translation)}', '${escapeHtml(h.arabic)}', '${escapeHtml(book.name)}')">${bookmarkLabel}</button>
        </div>
      </div>
      ${h.ravi ? `<div class="hadith-ravi">${h.ravi}</div>` : ''}
      <div class="hadith-arabic" style="font-size: ${state.arabicFontSize}px" dir="rtl">${h.arabic}</div>
      <div class="hadith-translation ${isUrdu ? 'ur' : 'en'}" style="font-size: ${state.translationFontSize}px">${textToShow}</div>
    `;
    container.appendChild(card);
  });
}

// Function to scramble query (Shift +3) to match scrambled database values
function scrambleUrdu(clearText) {
  if (!clearText) return "";
  let result = [];
  for (let i = 0; i < clearText.length; i++) {
    let c = clearText.charCodeAt(i);
    if (c === 32) { // space
      result.push(String.fromCharCode(1571)); // 'أ'
    } else if ((c >= 0x0600 - 3 && c <= 0x06FF - 3) ||
               (c >= 0x0750 - 3 && c <= 0x077F - 3) ||
               (c >= 0xFB50 - 3 && c <= 0xFDFF - 3) ||
               (c >= 0xFE70 - 3 && c <= 0xFEFF - 3)) {
      result.push(String.fromCharCode(c + 3));
    } else {
      result.push(clearText.charAt(i));
    }
  }
  return result.join('');
}

// 99 Names of Allah loader
async function loadAllahNames() {
  const container = document.getElementById('names-grid');
  container.innerHTML = '<p class="empty-state">Loading Names...</p>';
  
  try {
    const data = await fetchLocalJson('99names/allah_names.txt');
    
    container.innerHTML = '';
    data.AllNames.forEach((n, idx) => {
      const card = document.createElement('div');
      card.className = 'name-card';
      card.innerHTML = `
        <div class="name-card-inner">
          <div class="name-front">
            <span class="name-front-num" style="font-size: 11px; color: var(--text-muted); position: absolute; top: 12px; left: 12px;">${idx + 1}</span>
            <span class="play-icon" style="position: absolute; top: 12px; right: 12px; font-size: 12px; opacity: 0.6;">🔊</span>
            <div class="arabic">${n.urdu}</div>
            <div class="translit">${n.english}</div>
          </div>
          <div class="name-back">
            <span class="play-icon" style="position: absolute; top: 12px; right: 12px; font-size: 12px; opacity: 0.6;">🔊</span>
            <div class="meaning">${n.englishMeaning}</div>
            <div class="meaning-ur" dir="rtl">${n.urduMeaning}</div>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        playNameAudio(n.urdu);
      });
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Failed to load names: ' + err.message + '</p>';
  }
}

function playNameAudio(arabicText) {
  if (!arabicText) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(arabicText.trim());
  utterance.lang = 'ar-SA';
  utterance.rate = 0.75;
  if (window.speechSynthesis.getVoices) {
    const voices = window.speechSynthesis.getVoices();
    const arVoice = voices.find(v => v.lang.startsWith('ar'));
    if (arVoice) utterance.voice = arVoice;
  }
  window.speechSynthesis.speak(utterance);
}

// Helper: Escape HTML
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Browser Fallback Mock Database Engine
function getMockData(dbFile, sql, args) {
  console.log(`Mocking DB [${dbFile}] SQL: ${sql} Args:`, args);
  
  // 1. Kitab chapters count mock
  if (sql.includes("SELECT Kitab_ID")) {
    return [
      { Kitab_ID: 1, Kitab: "کتاب: طہارت کے احکام و مسائل", Kitab_Eng: "The Book on Purification", BookNo: 1 },
      { Kitab_ID: 2, Kitab: "کتاب: نماز کے احکام و مسائل", Kitab_Eng: "The Book on Salat (Prayer)", BookNo: 2 },
      { Kitab_ID: 3, Kitab: "کتاب: زکاۃ کے احکام و مسائل", Kitab_Eng: "The Book on Zakat", BookNo: 3 }
    ];
  }
  
  // 2. Count count mock
  if (sql.includes("COUNT(*)") && sql.includes("hadees")) {
    return [{ total: 2 }];
  }
  
  // 3. Hadith mock list
  if (sql.includes("SELECT h.record_id")) {
    // Return sample Hadith 1 scrambled/clear depending on language
    const scrambledUrdu = "أإځأ﷽ألشوتأشۄەأحہەأڬۄأ““أحوتوأتؼوتهأڬتأزتشًوزتشأىۏحأځشأۄەأتًشأۄشأؼوهأڬتأىحۏدۄأۄشأتىضتىأڬًأتضأڬۏأىۏحأڬەأوغتثمأۄۏأوهەأڲتأۗأځضأدضأڬۏأۄدشحأ+أحشڬأًغىأ,أزًهحأزىۏتأذتظهأڬشىەأڬەأهۏەأۄًأۏتأڬضۏأؼًشحأضەأطتزۏأڬۏأؽشعأضەأۄًأۗأځضأتضأڬۏأۄدشحأتىأۄۏأډۏصًڽأڬەأهۏەأۄًأڲۏأدىأڬەأذتظهأڬشىەأڬۏأىۏحأضەأتضأىەأۄدشحأڬۏأۄەأۗ‛‛";
    const englishText = "Narrated 'Umar bin Al-Khattab: I heard Allah's Apostle saying, 'The reward of deeds depends upon the intentions and every person will get the reward according to what he has intended...'";
    
    const isUrdu = args[1] === 1 || (sql.includes("language_id") && !args.length) || state.hadithLang === 1;
    
    return [
      {
        record_id: 1,
        hadees_number: 1,
        arabic: "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ ؕ وَ إِنَّمَا لِكُلِّ امۡرِیِٴٍ مَّا نَوٰی ؕ",
        ravi: "ہم سے حمیدی نے حدیث بیان کی، کہا ہم سے سفیان نے...",
        translation: isUrdu ? scrambledUrdu : englishText
      },
      {
        record_id: 2,
        hadees_number: 2,
        arabic: "يَا رَسُولَ اللَّهِ كَيْفَ يَأْتِيكَ الْوَحْيُ ؟",
        ravi: "ہم سے عبداللہ بن یوسف نے حدیث بیان کی، کہا...",
        translation: isUrdu ? "أشضًهأتههأ﷽أىەأۏۄألشوتۏتأحہتأۗ" : "Narrated 'Aisha: Al-Harith bin Hisham asked Allah's Apostle: 'O Allah's Apostle! How is the Divine Inspiration revealed to you?'..."
      }
    ];
  }

  // 4. Quran database count mock
  if (sql.includes("COUNT(*) as total FROM tbl_QuranComplete")) {
    return [{ total: 7 }];
  }

  // 5. Quran verses database mock
  if (sql.includes("FROM tbl_QuranComplete")) {
    return [
      { id: 1, ayat_number: 1, arabic: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ", translation_urdu: "شروع اللہ کے نام سے جو بڑا مہربان نہایت رحم والا ہے۔", translation_english: "In the name of Allah, the Entirely Merciful, the Especially Merciful." },
      { id: 2, ayat_number: 2, arabic: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ", translation_urdu: "سب تعریفیں اللہ ہی کے لیے ہیں جو تمام جہانوں کا پالنے والا ہے۔", translation_english: "All praise is due to Allah, Lord of the worlds." }
    ];
  }

  // 6. Quran word by word database mock
  if (sql.includes("FROM tbl_word_by_word_new")) {
    return [
      { ayat_number: 1, translation: "بِسْمِ& نام سے@اللَّهِ& اللہ کے@الرَّحْمَٰنِ& جو بڑا مہربان@الرَّحِيمِ& نہایت رحم والا ہے" },
      { ayat_number: 2, translation: "الْحَمْدُ& سب تعریف@لِلَّهِ& اللہ کے لیے ہے@رَبِّ& جو رب ہے@الْعَالَمِينَ& تمام جہانوں کا" }
    ];
  }

  // 7. Fahm-ul-Quran database mock
  if (sql.includes("FROM faham_quran")) {
    return [
      { id: 1, ayat: "حم", urdu: "حا۔میم۔", english: "Ha, Meem." },
      { id: 2, ayat: "الر", urdu: "الف۔ لام۔را۔", english: "Alif.Lam.Ra." },
      { id: 3, ayat: "یٰۤاَبَتِ", urdu: "اے میرے ابا۔", english: "O my father." }
    ];
  }

  // 8. Supplications database mock
  if (sql.includes("FROM tbl_dua_Urdu")) {
    return [
      { category: "حمد و ثنا اور توبہ و استغفار", serial_no: 1, virtues: "رسول اللہ صلی اللہ علیہ وآلہ وسلم نے فرمایا: جو شخص سو مرتبہ کہے اس کے تمام گناہ معاف کر دیے جاتے ہیں چاہے وہ سمندر کی جھاگ کے برابر ہی کیوں نہ ہوں۔", dua: "سُبْحَانَ اللّٰہِ وَبِحَمْدِہٖ", translation: "پاک ہے اللہ اپنی خوبیوں سمیت۔", reference: "صحیح البخاری: 6405" },
      { category: "صبح و شام کی مسنون دعائیں", serial_no: 2, virtues: "رسول اللہ صلی اللہ علیہ وآلہ وسلم نے فرمایا: جو شخص صبح اور شام تین تین مرتبہ یہ دعا پڑھے، اسے کوئی چیز نقصان نہیں پہنچا سکتی۔", dua: "بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ", translation: "اللہ کے نام کے ساتھ جس کے نام کی برکت سے زمین اور آسمان میں کوئی چیز نقصان نہیں پہنچا سکتی، اور وہی سب کچھ سننے والا اور جاننے والا ہے۔", reference: "سنن ابی داود: 5088" },
      { category: "صبح و شام کی مسنون دعائیں", serial_no: 3, virtues: "سید الاستغفار (بخشش کی سب سے بڑی دعا)۔ رسول اللہ صلی اللہ علیہ وآلہ وسلم نے فرمایا: جو شخص یقین کے ساتھ دن میں اسے پڑھے اور اسی دن شام سے پہلے فوت ہو جائے تو وہ اہل جنت میں سے ہے۔ اور جو رات کو پڑھے اور صبح سے پہلے فوت ہو جائے تو وہ اہل جنت میں سے ہے۔", dua: "اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ خَلَقْتَنِي وَأَنَا عَبْدُكَ وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ وَأَبُوءُ لَکَ بِذَنْبِي فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ", translation: "اے اللہ! تو ہی میرا رب ہے، تیرے سوا کوئی معبود نہیں، تو نے ہی مجھے پیدا کیا اور میں تیرا بندہ ہوں اور میں اپنی طاقت کے مطابق تیرے عہد اور وعدے پر قائم ہوں، میں اپنے اعمال کے شر سے تیری پناہ مانگتا ہوں، میں اعتراف کرتا ہوں تیرے احسانات کا جو مجھ پر ہیں اور اعتراف کرتا ہوں اپنے گناہوں کا، پس مجھے بخش دے کیونکہ تیرے سوا کوئی گناہوں کو نہیں بخش سکتا۔", reference: "صحیح البخاری: 6306" },
      { category: "صبح و شام کی مسنون دعائیں", serial_no: 4, virtues: "رسول اللہ صلی اللہ علیہ وآلہ وسلم نے فرمایا: جو شخص شام کے وقت تین مرتبہ یہ دعا پڑھے، اسے رات کو کوئی زہریلی چیز نقصان نہیں پہنچائے گی۔", dua: "أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ", translation: "میں اللہ کے کامل کلمات کی پناہ مانگتا ہوں اس کی پیدا کی ہوئی چیزوں کے شر سے۔", reference: "صحیح مسلم: 2708" },
      { category: "سونے اور بیدار ہونے کی دعائیں", serial_no: 5, virtues: "سونے سے پہلے کی دعا", dua: "بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا", translation: "اے اللہ! میں تیرے ہی نام کے ساتھ مرتا ہوں (سوتا ہوں) اور جیتا ہوں (جاگتا ہوں)۔", reference: "صحیح البخاری: 6314" },
      { category: "سونے اور بیدار ہونے کی دعائیں", serial_no: 6, virtues: "صبح بیدار ہونے کی دعا", dua: "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ", translation: "تمام تعریفیں اللہ ہی کے لیے ہیں جس نے ہمیں مارنے کے بعد زندہ کیا اور اسی کی طرف اٹھ کر جانا ہے۔", reference: "صحیح البخاری: 6312" },
      { category: "کھانے پینے کی دعائیں", serial_no: 7, virtues: "کھانا کھانے سے پہلے کی دعا", dua: "بِسْمِ اللَّهِ وَعَلَى بَرَكَةِ اللَّهِ", translation: "اللہ کے نام کے ساتھ اور اللہ کی برکت پر (ہم نے کھانا شروع کیا)۔", reference: "مستدرک حاکم" },
      { category: "کھانے پینے کی دعائیں", serial_no: 8, virtues: "کھانا کھانے بعد کی دعا", dua: "الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنَا وَسَقَانَا وَجَعَلَنَا مُسْلِمِينَ", translation: "شکر ہے اس اللہ کا جس نے ہمیں کھلایا اور پلایا اور ہمیں مسلمان بنایا۔", reference: "سنن ابی داود: 3850" },
      { category: "سفر کی دعائیں", serial_no: 9, virtues: "سفر شروع کرتے وقت کی دعا", dua: "سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ وَإِنَّا إِلَى رَبِّنَا لَمُنْقَلِبُونَ", translation: "پاک ہے وہ ذات جس نے ہمارے لیے اسے مسخر کیا حالانکہ ہم اسے قابو کرنے والے نہ تھے، اور بے شک ہم اپنے رب کی طرف لوٹنے والے ہیں۔", reference: "صحیح مسلم: 1342" },
      { category: "سفر کی دعائیں", serial_no: 10, virtues: "سفر سے واپسی پر پڑھنے کی دعا", dua: "آيِبُونَ تَائِبُونَ عَابِدُونَ لِرَبِّنَا حَامِدُونَ", translation: "ہم واپس لوٹنے والے ہیں، توبہ کرنے والے ہیں، اپنے رب کی عبادت کرنے والے ہیں اور اسی کی تعریف کرنے والے ہیں۔", reference: "صحیح مسلم: 1342" }
    ];
  }
  if (sql.includes("FROM tbl_roza")) {
    return [
      { category: "روزہ افطار کی دعا", serial_no: 1, virtues: "افطاری کے وقت کی دعا", dua: "ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ وَثَبَتَ الأَجْرُ إِنْ شَاءَ اللَّهُ", translation: "پیاس چلی گئی، رگیں تر ہو گئیں اور اللہ نے چاہا تو اجر ثابت ہو گیا۔", reference: "سنن ابی داود: 2357" },
      { category: "سحری کی نیت", serial_no: 2, virtues: "روزہ رکھنے کی نیت", dua: "وَبِصَوْمِ غَدٍ نَّوَيْتُ مِنْ شَهْرِ رَمَضَانَ", translation: "اور میں نے رمضان کے کل کے روزے کی نیت کی۔", reference: "عام فقہی روایت" },
      { category: "روزہ افطار کی دعا", serial_no: 3, virtues: "افطاری کی متبادل دعا", dua: "اَللّٰهُمَّ إِنِّی لَکَ صُمْتُ وَبِکَ آمَنْتُ وَعَلَی رِزْکِکَ أَفْطَرْتُ", translation: "اے اللہ! میں نے تیرے ہی لیے روزہ رکھا، تجھ پر ایمان لایا اور تیرے ہی دیے ہوئے رزق سے افطار کیا۔", reference: "سنن ابی داود: 2358" },
      { category: "شبِ قدر کی دعا", serial_no: 4, virtues: "رمضان المبارک کے آخری عشرے کی دعا", dua: "اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي", translation: "اے اللہ! بے شک تو معاف کرنے والا ہے اور معافی کو پسند کرتا ہے، پس مجھے معاف فرما۔", reference: "سنن ترمذی: 3513" }
    ];
  }
  if (sql.includes("FROM tbl_namaz_e_janaza")) {
    return [
      { category: "نمازِ جنازہ", serial_no: 1, virtues: "میت کی مغفرت اور بخشش کے لیے دعا (عام میت)", dua: "اَللّٰهُمَّ اغْفِرْ لَهٗ وَارْحَمْهُ وَعَافِهٖ وَاعْفُ عَنْهُ", translation: "اے اللہ! اسے بخش دے اور اس پر رحم فرما، اسے عافیت دے اور اسے معاف فرما۔", reference: "صحیح مسلم: 963" },
      { category: "نمازِ جنازہ", serial_no: 2, virtues: "بالغ مرد اور عورت کے لیے جامع دعا", dua: "اَللّٰهُمَّ اغْفِرْ لِحَيِّنَا وَمَيِّتِنَا وَشَاهِدِنَا وَغَائِبِنَا وَصَغِيْرِنَا وَكَبِيْرِنَا وَذَكَرِنَا وَأُنْثَانَا", translation: "اے اللہ! بخش دے ہمارے زندوں کو، ہمارے فوت شدگان کو، ہمارے حاضرین کو، ہمارے غائبین کو، ہمارے چھوٹوں کو، ہمارے بڑوں کو، ہمارے مردوں کو اور ہماری عورتوں کو۔", reference: "سنن ترمذی: 1024" },
      { category: "نمازِ جنازہ", serial_no: 3, virtues: "نابالغ لڑکے کے لیے دعا", dua: "اَللّٰهُمَّ اجْعَلْهُ لَنَا فَرَطًا وَاجْعَلْهُ لَنَا أَجْرًا وَذُخْرًا وَاجْعَلْهُ لَنَا شَافِعًا وَمُشَفَّعًا", translation: "اے اللہ! اس بچے کو ہمارے لیے آگے بھیجا ہوا (ذخیرہ) بنا، اور ہمارے لیے اجر و ثواب کا باعث بنا، اور اسے ہمارے حق میں شفیع بنا جس کی شفاعت قبول ہو۔", reference: "البخاری معلقاً" },
      { category: "نمازِ جنازہ", serial_no: 4, virtues: "نابالغ لڑکی کے لیے دعا", dua: "اَللّٰهُمَّ اجْعَلْهَا لَنَا فَرَطًا وَاجْعَلْهَا لَنَا أَجْرًا وَذُخْرًا وَاجْعَلْهَا لَنَا شَافِعَةً وَمُشَفَّعَةً", translation: "اے اللہ! اس بچی کو ہمارے لیے آگے بھیجی ہوئی (ذخیرہ) بنا، اور ہمارے لیے اجر و ثواب کا باعث بنا، اور اسے ہمارے حق میں شفیعہ بنا جس کی شفاعت قبول ہو۔", reference: "البخاری معلقاً" }
    ];
  }
  if (sql.includes("FROM tbl_sunnah")) {
    return [
      { category: "کھانے پینے کی سنتیں", serial_no: 1, virtues: "کھانے سے پہلے دونوں ہاتھ گٹوں تک دھونا، دائیں ہاتھ سے کھانا، اور بسم اللہ پڑھنا سنتِ نبوی ہے۔", dua: "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ", translation: "شروع اللہ کے نام سے جو بڑا مہربان نہایت رحم والا ہے۔", reference: "صحیح البخاری: 5376" },
      { category: "لباس پہننے کی سنتیں", serial_no: 2, virtues: "کپڑے پہنتے وقت دائیں طرف سے شروع کرنا سنت ہے۔ نیا کپڑا پہنتے وقت اللہ کا شکر ادا کرنا اور یہ دعا پڑھنا سنت ہے۔", dua: "اَلْحَمْدُ لِلّٰهِ الَّذِیْ كَسَانِیْ هٰذَا وَرَزَقَنِیْهِ مِنْ غَیْرِ حَوْلٍ مِّنِّیْ وَلَا قُوَّةٍ", translation: "تمام تعریفیں اللہ ہی کے لیے ہیں جس نے مجھے یہ لباس پہنایا اور میری کسی طاقت اور قوت کے بغیر مجھے یہ رزق عطا فرمایا۔", reference: "سنن ابی داود: 4023" },
      { category: "وضو کی سنتیں", serial_no: 3, virtues: "وضو سے پہلے بسم اللہ پڑھنا، مسواک کرنا، اور وضو کے بعد کلمہ شہادت اور یہ دعا پڑھنا سنتِ موکدہ ہے۔", dua: "اَللّٰهُمَّ اجْعَلْنِي مِنَ التَّوَّابِينَ وَاجْعَلْنِي مِنَ الْمُتَطَهِّرِينَ", translation: "اے اللہ! مجھے توبہ کرنے والوں میں بنا دے اور مجھے پاک صاف رہنے والوں میں بنا دے۔", reference: "سنن ترمذی: 55" },
      { category: "گھر میں داخل ہونے کی سنتیں", serial_no: 4, virtues: "گھر میں داخل ہوتے وقت سلام کرنا، مسواک کرنا، اور یہ دعا پڑھنا سنت ہے۔", dua: "بِسْمِ اللَّهِ وَلَجْنَا، وَبِسْمِ اللَّهِ خَرَجْنَا، وَعَلَى اللَّهِ رَبِّنَا تَوَكَّلْنَا", translation: "ہم اللہ کے نام کے ساتھ داخل ہوئے اور اللہ ہی کے نام کے ساتھ باہر نکلے، اور ہم نے اپنے رب اللہ ہی پر بھروسہ کیا۔", reference: "سنن ابی داود: 5096" },
      { category: "سونے کی سنتیں", serial_no: 5, virtues: "سونے سے پہلے باوضو ہونا، بستر جھاڑنا، دائیں کروٹ پر لیٹنا، اور یہ دعا پڑھنا پیارے نبی کی سنت ہے۔", dua: "اَللّٰهُمَّ قِنِیْ عَذَابَکَ یَوْمَ تَبْعَثُ عِبَادَکَ", translation: "اے اللہ! مجھے اپنے عذاب سے بچا جس دن تو اپنے بندوں کو دوبارہ اٹھائے گا۔", reference: "سنن ترمذی: 3398" }
    ];
  }

  // 9. Quran Topics database mock
  if (sql.includes("FROM tbl_QuranTopics")) {
    return [
      { id: 1, surah_id: 1, surah_name: "سورۃالفاتحہ", start_ayah: 1, end_ayah: 7, topic_urdu: "فطرتِ انسانی کی ترجمان", topic_english: "Representative of human nature" },
      { id: 2, surah_id: 2, surah_name: "سورۃ البقرہ", start_ayah: 1, end_ayah: 5, topic_urdu: "قرآن حکیم کن کے لیے ہدایت ہے؟", topic_english: "For whom is the Qur'an a guide?" }
    ];
  }
  
  return [];
}

// --------------------------------------------------------------------------
// TALKBOT AI CHATBOT LOGIC & OFFLINE INTELLIGENCE ENGINE
// --------------------------------------------------------------------------

const quranFAQ = [
  {
    keywords: ["lesson", "sabaq", "learn", "study", "grammar", "translation", "سبق", "گرامر", "ترجمہ", "سیکھیں"],
    reply: {
      en: "You can start learning Quran vocabulary and grammar by navigating to the **Learn Quran** section. We currently have Lessons 1 to 22 (A & B) with interactive word tables, explanations, and audio pronunciations.",
      ur: "آپ **قرآن سیکھیں** سیکشن میں جا کر قرآنی الفاظ اور گرامر سیکھنا شروع کر سکتے ہیں۔ ہمارے پاس فی الحال اسباق 1 سے 22 (A اور B) ہیں جن میں الفاظ کے چارٹس، تشریحات اور آڈیو تلفظ شامل ہیں۔",
      ar: "يمكنك البدء في تعلم مفردات وقواعد القرآن بالانتقال إلى قسم **تعلم القرآن**. لدينا حاليًا الدروس من ١ إلى ٢٢ (أ وب) مع جداول الكلمات التفاعلية والشروح والنطق الصوتي.",
      tr: "Kur'an kelime dağarcığını ve dilbilgisini öğrenmeye **Kuran Öğren** bölümüne giderek başlayabilirsiniz. Şu anda etkileşimli kelime tabloları, açıklamalar ve sesli telaffuzlar içeren 1 ila 22 (A ve B) Derslerimiz bulunmaktadır.",
      id: "Anda dapat mulai mempelajari kosa kata dan tata bahasa Al-Quran dengan membuka bagian **Belajar Al-Quran**. Saat ini kami memiliki Pelajaran 1 hingga 22 (A & B) dengan tabel kata interaktif, penjelasan, dan pengucapan audio.",
      fr: "Vous pouvez commencer à apprendre le vocabulaire et la grammaire du Coran en accédant à la section **Apprendre le Coran**. Nous avons actuellement les leçons 1 à 22 (A & B) avec des tableaux de mots interactifs, des explications et des prononciations audio."
    }
  },
  {
    keywords: ["hadith", "bukhari", "muslim", "hadiths", "prophet", "حديث", "احادیث", "بخاری", "مسلم"],
    reply: {
      en: "Explore our offline **Hadith Library** which includes 9 core Hadith compilations (Sahih al-Bukhari, Sahih Muslim, Sunan Abi Dawud, etc.). You can search by keywords or hadith numbers in Urdu or English.",
      ur: "ہماری آف لائن **حدیث لائبریری** کو دریافت کریں جس میں حدیث کی 9 بنیادی کتابیں (صحیح البخاری، صحیح مسلم، سنن ابی داؤد، وغیرہ) شامل ہیں۔ آپ اردو یا انگریزی میں الفاظ یا حدیث نمبر کے ذریعے تلاش کر سکتے ہیں۔",
      ar: "استكشف **مكتبة الحديث** غير المتصلة بالإنترنت والتي تضم ٩ تجميعات حديث رئيسية (صحيح البخاري، صحيح مسلم، سنن أبي داود، إلخ). يمكنك البحث بالكلمات المفتاحية أو أرقام الحديث باللغتين الأردية أو الإنجليزية.",
      tr: "9 temel Hadis derlemesini (Sahih-i Buhari, Sahih-i Müslim, Sünen-i Ebi Davud vb.) içeren çevrimdışı **Hadis Kütüphanemizi** keşfedin. Urduca veya İngilizce anahtar kelimelere veya hadis numaralarına göre arama yapabilirsiniz.",
      id: "Jelajahi **Perpustakaan Hadits** luring kami yang mencakup 9 kompilasi Hadits inti (Shahih Bukhari, Shahih Muslim, Sunan Abu Dawud, dll.). Anda dapat mencari berdasarkan kata kunci atau nomor hadits dalam bahasa Urdu atau Inggris.",
      fr: "Explorez notre **Bibliothèque de Hadiths** hors ligne qui comprend 9 compilations de Hadiths principales (Sahih al-Bukhari, Sahih Muslim, Sunan Abi Dawud, etc.). Vous pouvez rechercher par mots-clés ou numéros de hadiths en ourdou ou en anglais."
    }
  },
  {
    keywords: ["99 names", "allah names", "asma", "names", "اللہ", "نام", "اسم", "حسنی"],
    reply: {
      en: "The **99 Names of Allah** section displays all the beautiful names of Allah. Tap any name card to view its translation, transliteration, and spiritual explanation.",
      ur: "**99 اسمائے حسنیٰ** کا سیکشن اللہ کے تمام خوبصورت ناموں کو ظاہر کرتا ہے۔ کسی بھی نام کے کارڈ پر ٹیپ کر کے اس کا ترجمہ، تلفظ اور روحانی وضاحت دیکھیں۔",
      ar: "يعرض قسم **أسماء الله الحسنى ٩٩** جميع أسماء الله الجميلة. اضغط على أي بطاقة اسم لعرض ترجمتها وكتابتها الصوتية وشرحها الروحي.",
      tr: "**Allah'ın 99 İsmi** bölümü, Allah'ın tüm güzel isimlerini görüntüler. Çevirisini, harf çevirisini ve manevi açıklamasını görmek için herhangi bir isim kartına dokunun.",
      id: "Bagian **99 Nama Allah** menampilkan semua nama Allah yang indah. Ketuk kartu nama apa saja untuk melihat terjemahan, transliterasi, dan penjelasan spiritualnya.",
      fr: "La section **99 Noms d'Allah** affiche tous les beaux noms d'Allah. Appuyez sur n'importe quel nom pour afficher sa traduction, sa translittération et son explication spirituelle."
    }
  },
  {
    keywords: ["bookmark", "save", "favorite", "بک مارک", "محفوظ"],
    reply: {
      en: "You can bookmark any Hadith by tapping the 'Bookmark' button. All saved Hadiths will be instantly accessible under the **Bookmarks** tab for easy offline reading.",
      ur: "آپ کسی بھی حدیث کو 'بک مارک' بٹن پر ٹیپ کر کے محفوظ کر سکتے ہیں۔ تمام محفوظ شدہ احادیث کو آف لائن مطالعہ کے لیے **بک مارکس** ٹیب کے تحت دیکھا جا سکتا ہے۔",
      ar: "يمكنك حفظ أي حديث بالضغط على زر 'إضافة إشارة مرجعية'. ستكون جميع الأحاديث المحفوظة قابلة للوصول الفوري تحت علامة تبويب **الإشارات المرجعية** لقراءة سهلة دون اتصال بالإنترنت.",
      tr: "Herhangi bir Hadisi 'Yer İmi' butonuna dokunarak yer imlerine ekleyebilirsiniz. Kaydedilen tüm Hadislere, çevrimdışı kolay okuma için **Yer İmleri** sekmesinden anında erişilebilir.",
      id: "Anda dapat menandai Hadits apa pun dengan mengetuk tombol 'Penanda'. Semua Hadits yang disimpan akan langsung dapat diakses di bawah tab **Penanda Buku** untuk kemudahan membaca secara luring.",
      fr: "Vous pouvez ajouter un Hadith à vos signets en appuyant sur le bouton 'Signet'. Tous les Hadiths enregistrés seront instantanément accessibles sous l'onglet **Signets** pour une lecture hors ligne facile."
    }
  },
  {
    keywords: ["hello", "salam", "assalamu", "hey", "hi", "سلام"],
    reply: {
      en: "Walaikum Assalam! I am your Quran360 AI Assistant. How can I help you today on your journey of learning the Quran and Hadith?",
      ur: "وعلیکم السلام! میں آپ کا قرآن 360 اے آئی اسسٹنٹ ہوں۔ قرآن اور حدیث سیکھنے کے سفر میں آج میں آپ کی کیا مدد کر سکتا ہوں؟",
      ar: "وعليكم السلام! أنا مساعد الذكاء الاصطناعي لـ Quran360. كيف يمكنني مساعدتك اليوم في رحلتك لتعلم القرآن والحديث الشريف؟",
      tr: "Ve Aleykümselam! Ben Kuran360 Yapay Zeka Asistanınızım. Bugün Kuran ve Hadis öğrenme yolculuğunuzda size nasıl yardımcı olabilirim?",
      id: "Walaikum Assalam! Saya Asisten AI Quran360 Anda. Bagaimana saya bisa membantu Anda hari ini dalam perjalanan belajar Al-Quran dan Hadits?",
      fr: "Walaikum Assalam ! Je suis votre assistant IA Quran360. Comment puis-je vous aider aujourd'hui dans votre parcours d'apprentissage du Coran et des Hadiths ?"
    }
  }
];

function initChatbot() {
  const userInput = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");
  const micBtn = document.getElementById("micBtn");
  const speakToggleBtn = document.getElementById("speakToggleBtn");

  if (!userInput) return;

  userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  if (sendBtn) sendBtn.addEventListener("click", sendMessage);

  if (speakToggleBtn) {
    speakToggleBtn.addEventListener("click", () => {
      state.voiceEnabled = !state.voiceEnabled;
      localStorage.setItem("voice_enabled", state.voiceEnabled.toString());
      speakToggleBtn.classList.toggle("active", state.voiceEnabled);
      speakToggleBtn.textContent = state.voiceEnabled ? "🔊" : "🔇";
      if (!state.voiceEnabled) {
        window.speechSynthesis.cancel();
        const waveformOverlay = document.getElementById("waveformOverlay");
        const glowRing = document.getElementById("glowRing");
        const statusText = document.getElementById("statusText");
        if (waveformOverlay) waveformOverlay.classList.remove("active");
        if (glowRing) glowRing.className = "glow-ring idle";
        if (statusText && window.i18n) statusText.textContent = window.i18n["chat.ready"][window.currentLang || 'en'];
      }
    });
  }

  // Voice recording Recognition (Mic input)
  if (micBtn) {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      
      const langCodes = {
        en: 'en-US',
        ur: 'ur-PK',
        ar: 'ar-SA',
        hi: 'hi-IN',
        bn: 'bn-IN',
        pa: 'pa-IN',
        ta: 'ta-IN',
        te: 'te-IN',
        mr: 'mr-IN',
        gu: 'gu-IN',
        ml: 'ml-IN',
        kn: 'kn-IN',
        tr: 'tr-TR',
        id: 'id-ID',
        fr: 'fr-FR',
        es: 'es-ES',
        de: 'de-DE',
        ru: 'ru-RU',
        fa: 'fa-IR',
        zh: 'zh-CN',
        ja: 'ja-JP',
        pt: 'pt-PT',
        it: 'it-IT'
      };

      recognition.onstart = () => {
        const glowRing = document.getElementById("glowRing");
        const statusText = document.getElementById("statusText");
        if (glowRing) glowRing.className = "glow-ring listening";
        if (statusText && window.i18n) statusText.textContent = window.i18n["chat.listening"][window.currentLang || 'en'];
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        userInput.value = transcript;
        sendMessage();
      };

      recognition.onend = () => {
        const glowRing = document.getElementById("glowRing");
        const statusText = document.getElementById("statusText");
        if (glowRing) glowRing.className = "glow-ring idle";
        if (statusText && window.i18n) statusText.textContent = window.i18n["chat.ready"][window.currentLang || 'en'];
      };

      recognition.onerror = () => {
        const glowRing = document.getElementById("glowRing");
        const statusText = document.getElementById("statusText");
        if (glowRing) glowRing.className = "glow-ring idle";
        if (statusText && window.i18n) statusText.textContent = window.i18n["chat.ready"][window.currentLang || 'en'];
      };

      micBtn.addEventListener("click", () => {
        recognition.lang = langCodes[window.currentLang || 'en'] || 'en-US';
        recognition.start();
      });
    } else {
      micBtn.style.display = "none";
    }
  }
}

async function sendMessage() {
  const userInput = document.getElementById("userInput");
  if (!userInput) return;

  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = "";
  appendChatMessage(text, "user-msg");

  const statusText = document.getElementById("statusText");
  const glowRing = document.getElementById("glowRing");
  if (statusText && window.i18n) statusText.textContent = window.i18n["chat.thinking"][window.currentLang || 'en'];
  if (glowRing) glowRing.className = "glow-ring thinking";

  const loaderId = appendChatLoader();

  try {
    let reply = "";
    if (state.chatbotKey && state.chatbotKey.trim() !== "") {
      reply = await getLLMResponse(text);
    } else {
      reply = await getOfflineChatResponse(text);
    }

    // Dynamic translate the reply into selected language
    const targetLang = window.currentLang || 'en';
    if (targetLang !== 'en' && window.translateText) {
      reply = await window.translateText(reply, targetLang);
    }

    removeChatLoader(loaderId);
    appendChatMessage(reply, "bot-msg");
    speakText(reply);

  } catch (err) {
    removeChatLoader(loaderId);
    appendChatMessage("Error: " + err.message, "system-msg");
  } finally {
    if (statusText && window.i18n) statusText.textContent = window.i18n["chat.ready"][window.currentLang || 'en'];
    if (glowRing) glowRing.className = "glow-ring idle";
  }
}

function appendChatMessage(text, className) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${className}`;
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";
  contentDiv.innerHTML = text.replace(/\n/g, "<br>");
  
  msgDiv.appendChild(contentDiv);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function appendChatLoader() {
  const container = document.getElementById("chatMessages");
  if (!container) return null;

  const loaderId = "loader-" + Date.now();
  const msgDiv = document.createElement("div");
  msgDiv.className = "message bot-msg typing-loader-msg";
  msgDiv.id = loaderId;
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content typing-indicator";
  contentDiv.innerHTML = `<span></span><span></span><span></span>`;
  
  msgDiv.appendChild(contentDiv);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
  
  return loaderId;
}

function removeChatLoader(id) {
  if (!id) return;
  const loader = document.getElementById(id);
  if (loader) loader.remove();
}

let activeChatAudio = null;

function speakText(text) {
  if (!state.voiceEnabled) return;
  
  const cleanText = text.replace(/<[^>]*>/g, '').replace(/\*\*+/g, '').trim();
  
  if (activeChatAudio) {
    activeChatAudio.pause();
    activeChatAudio = null;
  }
  window.speechSynthesis.cancel();
  
  const langCodes = {
    en: 'en-US', ur: 'ur-PK', ar: 'ar-SA', hi: 'hi-IN', bn: 'bn-IN',
    pa: 'pa-IN', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN', gu: 'gu-IN',
    ml: 'ml-IN', kn: 'kn-IN', tr: 'tr-TR', id: 'id-ID', fr: 'fr-FR',
    es: 'es-ES', de: 'de-DE', ru: 'ru-RU', fa: 'fa-IR', zh: 'zh-CN',
    ja: 'ja-JP', pt: 'pt-PT', it: 'it-IT'
  };
  const activeLang = window.currentLang || 'en';
  const voiceLangCode = langCodes[activeLang] || 'en-US';

  const waveformOverlay = document.getElementById("waveformOverlay");
  const glowRing = document.getElementById("glowRing");
  const statusText = document.getElementById("statusText");

  const onStart = () => {
    if (waveformOverlay) waveformOverlay.classList.add("active");
    if (glowRing) glowRing.className = "glow-ring speaking";
    if (statusText && window.i18n) statusText.textContent = window.i18n["chat.speaking"][activeLang];
  };

  const onEnd = () => {
    if (waveformOverlay) waveformOverlay.classList.remove("active");
    if (glowRing) glowRing.className = "glow-ring idle";
    if (statusText && window.i18n) statusText.textContent = window.i18n["chat.ready"][activeLang];
  };

  if (navigator.onLine) {
    try {
      const gLang = voiceLangCode.split('-')[0];
      const url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(cleanText) + "&tl=" + gLang + "&client=tw-ob";
      activeChatAudio = new Audio(url);
      activeChatAudio.onplay = onStart;
      activeChatAudio.onended = onEnd;
      activeChatAudio.onerror = () => {
        fallbackChatNativeTTS(cleanText, voiceLangCode, onStart, onEnd);
      };
      activeChatAudio.play().catch(() => {
        fallbackChatNativeTTS(cleanText, voiceLangCode, onStart, onEnd);
      });
      return;
    } catch(e) {
      console.warn("Chat audio TTS error:", e);
    }
  }

  fallbackChatNativeTTS(cleanText, voiceLangCode, onStart, onEnd);
}

function fallbackChatNativeTTS(text, lang, onStart, onEnd) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.onstart = onStart;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

function getPageContextInfo(viewId) {
  const views = {
    'dashboard': {
      title: 'Dashboard / Home',
      description: {
        en: 'The main dashboard displaying Assalamu Alaikum welcome card, Hijri Date, Daily Ayah/Hadith highlights, core features (Learn Quran, Word by Word, Talkbot), and audio recitation player for different Qaris.',
        ur: 'مرکزی ڈیش بورڈ جہاں خوش آمدید کارڈ، ہجری تاریخ، روزانہ کی آیت/حدیث، اہم خصوصیات، اور مختلف قاریوں کی آواز میں آڈیو تلاوت کا پلیئر موجود ہے۔',
        ar: 'لوحة القيادة الرئيسية التي تعرض بطاقة الترحيب، والتاريخ الهجري، والآية والحديث اليومي، والمميزات الأساسية، ومشغل تلاوة القرآن بأصوات قراء متعددين.'
      }
    },
    'sabaq': {
      title: 'Learn Quran (Grammar Lessons)',
      description: {
        en: 'Interactive Quranic grammar vocabulary lessons 1 to 22 (parts A & B). Contains word analysis tables showing root letters, grammatical types, Urdu and English meanings, and audio pronunciation.',
        ur: 'قرآنی گرامر اور الفاظ کے اسباق 1 سے 22 (حصہ A اور B)۔ یہاں الفاظ کے مادے (حروف اصلی)، گرامر کی قسم، اردو اور انگریزی معانی، اور آڈیو تلفظ شامل ہیں۔',
        ar: 'دروس قواعد ومفردات القرآن التفاعلية من ١ إلى ٢٢ (أ وب). تحتوي على جداول تحليل الكلمات التي تبين الحروف الأصلية، والنوع النحوي، والمعاني باللغتين الأردية والإنجليزية، والنطق الصوتي.'
      }
    },
    'hadith': {
      title: 'Hadith Library Search',
      description: {
        en: 'Offline database search of 9 core Hadith books including Sahih Bukhari and Sahih Muslim. Users can query by keyword search (e.g. wudu, prayer) or Hadith number (e.g. bukhari 10).',
        ur: 'حدیث کی 9 بنیادی کتابوں (صحیح بخاری، صحیح مسلم وغیرہ) کا آف لائن ڈیٹا بیس۔ صارف الفاظ (جیسے وضو، نماز) یا حدیث نمبر (جیسے بخاری 10) کے ذریعے تلاش کر سکتے ہیں۔',
        ar: 'البحث في قاعدة بيانات ٩ كتب حديث رئيسية (مثل صحيح البخاري وصحيح مسلم) دون اتصال بالإنترنت. يمكن للمستخدمين البحث بالكلمات المفتاحية أو رقم الحديث.'
      }
    },
    'names': {
      title: '99 Names of Allah (Asma-ul-Husna)',
      description: {
        en: 'Interactive grid displaying the 99 Beautiful Names of Allah. Tapping a card reveals its Arabic text, English transliteration, Urdu/English translations, and detailed spiritual meaning.',
        ur: 'اللہ تعالیٰ کے 99 مبارک ناموں (اسمائے حسنیٰ) کا خوبصورت گرڈ۔ کسی بھی کارڈ پر کلک کرنے سے عربی متن، انگریزی تلفظ، اردو/انگریزی ترجمہ اور تفصیلی تشریح ظاہر ہوتی ہے۔',
        ar: 'شبكة تفاعلية تعرض أسماء الله الحسنى الـ ٩٩. يكشف الضغط على أي بطاقة عن النص العربي، والكتابة الصوتية بالإنجليزية، والترجمات الأردية/الإنجليزية، والمعنى الروحي التفصيلي.'
      }
    },
    'bookmarks': {
      title: 'Bookmarks Library',
      description: {
        en: 'Saved list of favorite Hadiths bookmarked by the user for offline reading. These bookmarks are persisted via localStorage.',
        ur: 'صارف کی طرف سے بک مارک کی گئی پسندیدہ احادیث کی فہرست جو آف لائن مطالعہ کے لیے محفوظ کی گئی ہیں۔ یہ بک مارکس لوکل سٹوریج میں محفوظ رہتے ہیں۔',
        ar: 'قائمة الأحاديث المفضلة التي قام المستخدم بحفظها للقراءة دون اتصال بالإنترنت. يتم حفظ هذه العلامات المرجعية محلياً.'
      }
    },
    'chatbot': {
      title: 'Talkbot AI Chatbot',
      description: {
        en: 'Interactive AI Chatbot assistant with microphone voice input and text-to-speech voice playback. Can answer questions offline from Hadith database/FAQ, or online via OpenAI GPT model.',
        ur: 'مائیکروفون ان پٹ اور آواز کی تلاوت کے ساتھ اے آئی چیٹ بوٹ اسسٹنٹ۔ یہ آف لائن حدیث ڈیٹا بیس/سوالات کے جوابات دے سکتا ہے، یا ترتیبات میں کی درج کرنے پر اوپن اے آئی کے ذریعے چیٹ کر سکتا ہے۔',
        ar: 'مساعد الذكاء الاصطناعي التفاعلي مع إدخال صوتي بالميكروفون وتشغيل نطق النصوص. يمكنه الإجابة دون اتصال بالإنترنت من قاعدة بيانات الحديث، أو عبر الإنترنت باستخدام نموذج OpenAI GPT.'
      }
    },
    'quran-read': {
      title: 'Quran Reader (Mushaf)',
      description: {
        en: 'Complete Quran Mushaf reading section. Displaying page by page surahs, translation switches, audio player controls for verse recitations, and interactive translations.',
        ur: 'مکمل قرآن مجید (مصحف) پڑھنے کا سیکشن۔ یہاں سورتیں، ترجمہ آن/آف، اور ہر آیت کی آڈیو تلاوت سننے کا پلیئر موجود ہے۔',
        ar: 'قسم قراءة المصحف الشريف كاملاً. يعرض السور صفحة بصفحة، مع إمكانية تبديل الترجمة، ومفاتيح التحكم في مشغل الصوت لتلاوة الآيات.'
      }
    },
    'fahm': {
      title: 'Fahm-ul-Quran (Vocabulary Practice)',
      description: {
        en: 'Quranic vocabulary learning section. Includes interactive vocabulary flashcards, words tracking, and offline lesson details to learn the meaning of Quranic words.',
        ur: 'فہم القرآن قرآنی الفاظ سیکھنے کا سیکشن۔ یہاں قرآنی الفاظ کے معانی سیکھنے کے لیے الفاظ کے کارڈز اور اسباق کی تفصیلات موجود ہیں۔',
        ar: 'قسم فهم القرآن لتعلم المفردات. يتضمن بطاقات تعليمية تفاعلية للمفردات، وتتبع الكلمات، وتفاصيل الدروس دون اتصال بالإنترنت لتعلم معاني كلمات القرآن.'
      }
    },
    'duas': {
      title: 'Islamic Supplications (Duas)',
      description: {
        en: 'Supplications Center containing thematic categories of Quran and Sunnah Duas (like morning/evening, travel, protection) in Arabic with translations and references.',
        ur: 'دعاؤں کا مرکز جہاں قرآن و سنت سے منتخب دعائیں (جیسے صبح و شام، سفر، حفاظت) عربی متن، ترجمہ اور حوالوں کے ساتھ موضوع وار تقسیم ہیں۔',
        ar: 'مركز الأدعية يحتوي على تصنيفات موضوعية لأدعية القرآن والسنة الشريفة (مثل أدعية الصباح/المساء، السفر، الحماية) باللغة العربية مع الترجمة والمراجع.'
      }
    },
    'topics': {
      title: 'Quran Subject Index',
      description: {
        en: 'Comprehensive search index of the Quran, categorized by topics (like patience, charity, parents) showing all verses related to each subject with translations.',
        ur: 'قرآن مجید کا موضوع وار اشاریہ جہاں مختلف موضوعات (جیسے صبر، صدقہ، والدین) پر قرآنی آیات ترجمہ کے ساتھ موجود ہیں۔',
        ar: 'فهرس موضوعات القرآن الشامل، مصنف حسب الموضوعات (مثل الصبر، الصدقة، بر الوالدين) ويعرض جميع الآيات المتعلقة بكل موضوع مع الترجمات.'
      }
    },
    'settings': {
      title: 'Application Settings',
      description: {
        en: 'Configuration options where users can customize visual theme (dark, light, emerald), logo styles, Arabic/translation font sizes, language interface, and enter OpenAI API Key for chatbot.',
        ur: 'ایپلی کیشن کی ترتیبات جہاں صارف تھیم (ڈارک، لائٹ، ایمرالڈ)، لوگو کا اسٹائل، عربی/ترجمہ کا فونٹ سائز، زبان، اور چیٹ بوٹ کے لیے اے پی آئی کی سیٹ کر سکتے ہیں۔',
        ar: 'خيارات التكوين حيث يمكن للمستخدمين تخصيص المظهر المرئي (الداكن، الفاتح، الزمردي)، وأنماط الشعار، وأحجام الخطوط العربية/الترجمة، وواجهة اللغة، وإدخال مفتاح OpenAI API.'
      }
    }
  };

  const currentView = views[viewId] || views['dashboard'];
  return currentView;
}

async function getOfflineChatResponse(text) {
  const query = text.toLowerCase().trim();

  // Check if asking about the current page/view
  const pageKeywords = ["page", "view", "here", "this tab", "about this", "how to use", "what is this", "صفحہ", "یہاں", "طریقہ", "مدد", "help"];
  const isAskingAboutPage = pageKeywords.some(keyword => query.includes(keyword)) || query === "help" || query === "?";
  
  if (isAskingAboutPage) {
    const pageInfo = getPageContextInfo(state.activeView || 'dashboard');
    const pageLang = window.currentLang || 'en';
    const pageDesc = pageInfo.description[pageLang] || pageInfo.description['en'];
    
    const responses = {
      en: `You are currently viewing **${pageInfo.title}**.<br><br>${pageDesc}`,
      ur: `آپ اس وقت **${pageInfo.title}** دیکھ رہے ہیں۔<br><br>${pageDesc}`,
      ar: `أنت تستعرض حالياً **${pageInfo.title}**.<br><br>${pageDesc}`
    };
    return responses[pageLang] || responses['en'];
  }

  // 1. Check if user is asking for a specific Hadith
  let bookName = "bukhari.db";
  let bookTitle = "Sahih al-Bukhari";
  let hadithNum = null;

  const bukhariMatch = query.match(/(bukhari|بخاری)\s*#?\s*(\d+)/i);
  const muslimMatch = query.match(/(muslim|مسلم)\s*#?\s*(\d+)/i);
  const generalHadithMatch = query.match(/(hadith|حديث|حدیث)\s*#?\s*(\d+)/i);
  const numOnlyMatch = query.match(/^#?(\d+)$/);

  if (bukhariMatch) {
    hadithNum = parseInt(bukhariMatch[2], 10);
  } else if (muslimMatch) {
    bookName = "muslim.db";
    bookTitle = "Sahih Muslim";
    hadithNum = parseInt(muslimMatch[2], 10);
  } else if (generalHadithMatch) {
    hadithNum = parseInt(generalHadithMatch[2], 10);
  } else if (numOnlyMatch) {
    hadithNum = parseInt(numOnlyMatch[1], 10);
  }

  if (hadithNum !== null) {
    const isUrdu = state.hadithLang === 1;
    const res = await queryDatabase(
      bookName,
      `SELECT h.hadees_number, h.arabic, hl.ravi, hl.hadees AS translation
       FROM hadees h
       JOIN hadees_languages hl ON h.record_id = hl.hadees_record_id
       WHERE h.hadees_number = ? AND hl.language_id = ?
       LIMIT 1`,
      [hadithNum, state.hadithLang]
    );

    if (res && res.length > 0) {
      const h = res[0];
      const transText = isUrdu ? decryptUrdu(h.translation) : h.translation;
      return `**${bookTitle} - Hadith ${h.hadees_number}**<br><br>*${h.ravi || ''}*<br><br>${h.arabic}<br><br>${transText}`;
    } else {
      return `I couldn't find Hadith number ${hadithNum} in ${bookTitle} in the offline database.`;
    }
  }

  // 2. Check if user is searching for a keyword in Hadiths
  const searchKeywords = ["wudu", "purification", "prayer", "fasting", "zakat", "charity", "intention", "وضو", "نماز", "روزہ", "زکوۃ", "نیت", "طہارت"];
  const containsKeyword = searchKeywords.some(keyword => query.includes(keyword));

  if (containsKeyword || query.length > 3) {
    const isUrdu = state.hadithLang === 1;
    const dbQueryStr = isUrdu ? scrambleUrdu(text) : `%${text}%`;
    const wildcard = isUrdu ? `%${dbQueryStr}%` : `%${text}%`;

    const res = await queryDatabase(
      "bukhari.db",
      `SELECT h.hadees_number, h.arabic, hl.ravi, hl.hadees AS translation
       FROM hadees h
       JOIN hadees_languages hl ON h.record_id = hl.hadees_record_id
       WHERE (hl.hadees LIKE ? OR hl.ravi LIKE ? OR h.arabic LIKE ?) AND hl.language_id = ?
       LIMIT 1`,
      [wildcard, wildcard, wildcard, state.hadithLang]
    );

    if (res && res.length > 0) {
      const h = res[0];
      const transText = isUrdu ? decryptUrdu(h.translation) : h.translation;
      return `I found a matching Hadith for you:<br><br>**Sahih al-Bukhari - Hadith ${h.hadees_number}**<br><br>*${h.ravi || ''}*<br><br>${h.arabic}<br><br>${transText}`;
    }
  }

  // 3. Fallback to Local FAQ Keywords
  for (const item of quranFAQ) {
    if (item.keywords.some(keyword => query.includes(keyword))) {
      return item.reply[window.currentLang || 'en'] || item.reply["en"];
    }
  }

  // Default Fallback Help Text
  const fallbacks = {
    en: "I'm here to help you study the Quran and Hadith. Try asking me to **'search Hadith 1'**, ask about **'Quran lessons'**, **'99 names'**, or enter an OpenAI API Key in the settings tab to chat about anything!",
    ur: "میں قرآن اور حدیث سیکھنے میں آپ کی مدد کے لیے حاضر ہوں۔ مجھے **'حدیث 1 تلاش کریں'**، **'قرآن کے اسباق'** یا **'99 ناموں'** کے بارے میں پوچھیں، یا ترتیبات میں اوپن اے آئی کی اے پی آئی کی داخل کر کے چیٹ کریں۔",
    ar: "أنا هنا لمساعدتك في دراسة القرآن والحديث الشريف. جرب أن تطلب مني **'البحث عن الحديث ١'**، أو السؤال عن **'دروس القرآن'**، أو **'أسماء الله الحسنى'**، أو أدخل مفتاح OpenAI API في الإعدادات للدردشة التفاعلية!",
    tr: "Kur'an ve Hadis çalışmanıza yardımcı olmak için buradayım. Bana **'Hadis 1 ara'** demeyi deneyin, **'Kuran dersleri'**, **'99 isim'** hakkında soru sorun veya herhangi bir konuda sohbet etmek için ayarlara bir OpenAI API Anahtarı girin!",
    id: "Saya di sini untuk membantu Anda mempelajari Al-Quran dan Hadits. Coba tanyakan kepada saya untuk **'mencari Hadits 1'**, tanyakan tentang **'pelajaran Al-Quran'**, **'99 nama'**, atau masukkan Kunci API OpenAI di tab pengaturan untuk mengobrol!",
    fr: "Je suis là pour vous aider à étudier le Coran et les Hadiths. Essayez de me demander de **'rechercher le Hadith 1'**, posez des questions sur les **'leçons du Coran'**, les **'99 noms d'Allah'**, ou entrez une clé API OpenAI dans les paramètres pour discuter !"
  };

  return fallbacks[window.currentLang || 'en'] || fallbacks["en"];
}

async function getLLMResponse(text) {
  let url = "https://api.openai.com/v1/chat/completions";
  let modelName = "gpt-3.5-turbo";
  
  if (state.chatbotKey && state.chatbotKey.startsWith("sk-or-")) {
    url = "https://openrouter.ai/api/v1/chat/completions";
    modelName = "google/gemini-2.5-flash";
  }
  
  const pageInfo = getPageContextInfo(state.activeView || 'dashboard');
  const pageLang = window.currentLang || 'en';
  const pageDesc = pageInfo.description[pageLang] || pageInfo.description['en'];
  
  const systemPrompt = `You are a versatile, friendly, and smart AI Assistant (like Google Assistant or Siri) inside the Quran360 AI application. You are capable of answering ANY question the user asks, including general knowledge, history, science, mathematics, coding, translation, daily productivity, or casual chat. You also specialize in helping users study the Quran and navigate this application. Answer in the language the user asks. Keep responses direct, helpful, and under 3-4 sentences.

Application Navigation & Feature Details:
1. **Dashboard (#dashboard)**: Main hub. Quick links to Sabaq (Quran lessons), Hadith Library, Names of Allah, and Duas.
2. **Learn Quran (#sabaq)**: Interactive Quran lessons 1 to 22 (Arabic alphabets, rules, recitation practice).
3. **Hadith Library (#hadith)**: Searchable collection of Hadiths from Sahih al-Bukhari, Sahih Muslim, Sunan Abi Dawood, Sunan an-Nasa'i, Jami' at-Tirmidhi, Sunan Ibn Majah, Mishkat al-Masabih, Musnad Ahmad, and Silsila Sahiha in Urdu/English translation.
4. **99 Names (#names)**: Audio and translation for the 99 Names of Allah.
5. **Quran Reader (#quran-read)**: Complete word-by-word Quran recitation and translation.
6. **Fahm-ul-Quran (#fahm)**: Quranic vocabulary list to learn translation of individual Quranic words.
7. **Duas Center (#duas)**: Daily supplications categorized by situations (Duas for traveling, sleeping, eating, etc.) with audio.
8. **Quran Topics (#topics)**: Verse lists classified by topic/subject.
9. **Bookmarks (#bookmarks)**: Saved verses and Hadiths.
10. **Settings (#settings)**: Controls for font sizes, default Hadith translation language, and the Voice Guidance toggle.

User Guidance Rules:
- If a user is confused, inputs something invalid, or gets lost, kindly correct them and give them clear, step-by-step instructions on how to find the feature (e.g., "To view the Quran Reader, click on 'Quran Reader' in the sidebar or menu").
- Remind them that they can click the speaker icon (🔊/🔇) at the top of the chatbot panel to toggle Voice Guidance so you can read instructions aloud to guide them.

Current Context:
- Active page title: "${pageInfo.title}"
- Active hash path: #${state.activeView || 'dashboard'}
- What the user currently sees: ${pageDesc}`;
  
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${state.chatbotKey}`
  };
  
  if (url.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = window.location.href;
    headers["X-Title"] = "Quran360 AI";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      max_tokens: 250,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    throw new Error(errorJson.error?.message || `API error [${response.status}]`);
  }

  const json = await response.json();
  return json.choices[0].message.content.trim();
}

// Qari Audio Recitations Manager
let activeQariAudio = null;
let activeQariId = null;
let activeQariAudioFinishedCallback = null;

// Handle Android completion callback
window.onAndroidAudioFinished = function() {
  if (typeof activeQariAudioFinishedCallback === 'function') {
    activeQariAudioFinishedCallback();
  }
};

function toggleQariRecitation(qariId, audioUrl) {
  const cards = document.querySelectorAll('.reciter-card');
  
  const resetButtons = () => {
    cards.forEach(card => {
      const btn = card.querySelector('.qari-play-btn');
      if (btn) {
        btn.classList.remove('playing');
        btn.textContent = '▶ Play Sample';
      }
    });
  };

  const card = document.getElementById(`qari-${qariId}`);
  const btn = card ? card.querySelector('.qari-play-btn') : null;

  // 1. If clicked Qari is already playing, stop/pause it
  if (activeQariId === qariId) {
    if (isAndroid) {
      try {
        QuranAndroidBridge.stopAudio();
      } catch (e) {
        console.error("Bridge stop audio error:", e);
      }
    } else if (activeQariAudio) {
      activeQariAudio.pause();
    }
    activeQariAudio = null;
    activeQariId = null;
    activeQariAudioFinishedCallback = null;
    resetButtons();
    return;
  }

  // 2. If another Qari is playing, stop it first
  if (activeQariId) {
    if (isAndroid) {
      try {
        QuranAndroidBridge.stopAudio();
      } catch (e) {
        console.error("Bridge stop audio error:", e);
      }
    } else if (activeQariAudio) {
      activeQariAudio.pause();
    }
  }

  resetButtons();

  activeQariId = qariId;

  if (btn) {
    btn.classList.add('playing');
    btn.textContent = '⏸ Pause';
  }

  // 3. Play audio
  if (isAndroid) {
    try {
      activeQariAudio = true; // Use simple truthy value to indicate active playing state
      activeQariAudioFinishedCallback = () => {
        resetButtons();
        activeQariAudio = null;
        activeQariId = null;
        activeQariAudioFinishedCallback = null;
      };
      QuranAndroidBridge.playAudio(audioUrl);
    } catch (e) {
      console.error("Bridge play audio error:", e);
      resetButtons();
      activeQariAudio = null;
      activeQariId = null;
      activeQariAudioFinishedCallback = null;
    }
  } else {
    const audio = new Audio(audioUrl);
    activeQariAudio = audio;

    audio.play().catch(err => {
      console.error("Audio playback error:", err);
      resetButtons();
      activeQariAudio = null;
      activeQariId = null;
    });

    audio.onended = () => {
      resetButtons();
      activeQariAudio = null;
      activeQariId = null;
    };
  }
}

// Seerat un Nabi Tab Switcher
function switchSeeratTab(clickedBtn, tabName) {
  const tabBtns = document.querySelectorAll('.seerat-tab-btn');
  tabBtns.forEach(btn => {
    btn.classList.remove('active');
  });
  if (clickedBtn) {
    clickedBtn.classList.add('active');
  }

  const panels = document.querySelectorAll('.seerat-panel');
  panels.forEach(panel => {
    panel.classList.remove('active');
  });

  const activePanel = document.getElementById(`seerat-panel-${tabName}`);
  if (activePanel) {
    activePanel.classList.add('active');
  }
}


// ==========================================================================
/* QURAN READER (MUSHAF FLOW) MODULE */
// ==========================================================================

let readerState = {
  selectedSurah: 1,
  showTranslation: true,
  fontSize: 28
};

function initQuranReader() {
  const select = document.getElementById('quranReadSurahSelect');
  if (!select) return;

  select.innerHTML = '';
  for (let i = 0; i < 114; i++) {
    const sId = i + 1;
    const option = document.createElement('option');
    option.value = sId;
    option.textContent = `${sId}. ${wbwSurahNames[i]} (${wbwSurahArabicNames[i]})`;
    select.appendChild(option);
  }

  readerState.selectedSurah = 1;
  readerState.showTranslation = true;
  readerState.fontSize = 28;
}

function onQuranReadSurahChange() {
  const select = document.getElementById('quranReadSurahSelect');
  if (!select) return;
  readerState.selectedSurah = parseInt(select.value);
  loadQuranReaderVerses();
}

function toggleReaderTranslation() {
  const toggle = document.getElementById('quranReadTranslationToggle');
  if (!toggle) return;
  readerState.showTranslation = toggle.checked;
  loadQuranReaderVerses();
}

function adjustReaderFontSize(amount) {
  readerState.fontSize = Math.max(18, Math.min(48, readerState.fontSize + amount));
  loadQuranReaderVerses();
}

async function loadQuranReaderVerses() {
  const container = document.getElementById('quranReaderContainer');
  if (!container) return;

  container.innerHTML = '<div class="loading-indicator">Loading Quranic text...</div>';

  try {
    const verses = await queryDatabase(
      "quranDb.db",
      "SELECT id, ayat_number, arabic, translation_urdu, translation_english FROM tbl_QuranComplete WHERE surat_id = ? ORDER BY ayat_number",
      [readerState.selectedSurah]
    );

    container.innerHTML = '';
    if (verses.length === 0) {
      container.innerHTML = '<div class="empty-indicator">No verses found in database.</div>';
      return;
    }

    verses.forEach(v => {
      const vDiv = document.createElement('div');
      vDiv.className = 'quran-reader-verse';

      let transHTML = '';
      if (readerState.showTranslation) {
        transHTML = `
          <div class="reader-trans-line urdu">${v.translation_urdu ? decryptUrdu(v.translation_urdu) : ''}</div>
          <div class="reader-trans-line">${v.translation_english || ''}</div>
        `;
      }

      vDiv.innerHTML = `
        <div class="reader-arabic-line" style="font-size: ${readerState.fontSize}px;">
          ${v.arabic} <span style="font-size: 16px; color: var(--accent-teal); margin-left: 8px;">(${v.ayat_number})</span>
        </div>
        ${transHTML}
      `;
      container.appendChild(vDiv);
    });
  } catch (e) {
    container.innerHTML = `<div class="error-indicator">Error rendering reader: ${e.message}</div>`;
  }
}


// ==========================================================================
/* FAHM-UL-QURAN VOCABULARY ENGINE */
// ==========================================================================

let fahmVocabCache = [];

async function loadFahmVocabulary() {
  const container = document.getElementById('fahmContainer');
  if (!container) return;

  if (fahmVocabCache.length > 0) {
    renderFahmVocabulary(fahmVocabCache);
    return;
  }

  container.innerHTML = '<div class="loading-indicator">Loading Vocabulary builder...</div>';

  try {
    fahmVocabCache = await queryDatabase("quranDb.db", "SELECT id, ayat, urdu, english FROM faham_quran ORDER BY id");
    renderFahmVocabulary(fahmVocabCache);
  } catch (e) {
    container.innerHTML = `<div class="error-indicator">Error loading Vocabulary: ${e.message}</div>`;
  }
}

function renderFahmVocabulary(list) {
  const container = document.getElementById('fahmContainer');
  if (!container) return;

  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-indicator">No matching words found.</div>';
    return;
  }

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'fahm-word-card glass-card';
    card.innerHTML = `
      <div class="fahm-word-arabic">${item.ayat}</div>
      <div class="fahm-word-meanings">
        <div class="fahm-mean-row">
          <strong>Urdu:</strong>
          <span>${item.urdu || 'N/A'}</span>
        </div>
        <div class="fahm-mean-row">
          <strong>English:</strong>
          <span>${item.english || 'N/A'}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function filterFahmVocabulary() {
  const query = document.getElementById('fahmSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderFahmVocabulary(fahmVocabCache);
    return;
  }

  const filtered = fahmVocabCache.filter(item => {
    return (item.ayat && item.ayat.toLowerCase().includes(query)) ||
           (item.urdu && item.urdu.toLowerCase().includes(query)) ||
           (item.english && item.english.toLowerCase().includes(query));
  });

  renderFahmVocabulary(filtered);
}


// ==========================================================================
/* ISLAMIC SUPPLICATIONS & DUAS CENTER */
// ==========================================================================

let supplicationsState = {
  currentTab: 'daily' // 'daily', 'roza', 'janaza', 'sunnah'
};

async function loadSupplications() {
  const container = document.getElementById('duasContainer');
  if (!container) return;

  container.innerHTML = '<div class="loading-indicator">Loading Supplications...</div>';

  try {
    let sql = "";
    let dbFile = "quranDb.db";

    if (supplicationsState.currentTab === 'daily') {
      sql = "SELECT dua_title as category, dua_seq as serial_no, dua_desc as virtues, dua_arabic as dua, dua_urdu as translation, dua_ref as reference FROM tbl_dua_Urdu ORDER BY dua_title, dua_seq";
    } else if (supplicationsState.currentTab === 'roza') {
      sql = "SELECT dua_title as category, dua_seq as serial_no, dua_desc as virtues, dua_arabic as dua, dua_urdu as translation, dua_ref as reference FROM tbl_roza ORDER BY dua_seq";
    } else if (supplicationsState.currentTab === 'janaza') {
      sql = "SELECT dua_title as category, dua_seq as serial_no, dua_desc as virtues, dua_arabic as dua, dua_urdu as translation, dua_ref as reference FROM tbl_namaz_e_janaza ORDER BY dua_seq";
    } else if (supplicationsState.currentTab === 'sunnah') {
      sql = "SELECT dua_title as category, dua_seq as serial_no, dua_desc as virtues, dua_arabic as dua, dua_urdu as translation, dua_ref as reference FROM tbl_prayer ORDER BY dua_seq";
    } else if (supplicationsState.currentTab === 'masnoon') {
      dbFile = "masnoon_dua.db";
      sql = "SELECT title as category, id as serial_no, intro || '<br/><br/>' || virtues as virtues, arabic_text as dua, translation as translation, '' as reference FROM data ORDER BY id";
    }

    const list = await queryDatabase(dbFile, sql);
    renderDuas(list);
  } catch (e) {
    container.innerHTML = `<div class="error-indicator">Error loading Supplications: ${e.message}</div>`;
  }
}

function switchDuaTab(tabName) {
  supplicationsState.currentTab = tabName;

  // Toggle tab buttons
  const tabs = ['daily', 'roza', 'janaza', 'sunnah', 'masnoon'];
  tabs.forEach(t => {
    const btn = document.getElementById(`dua-tab-${t}`);
    if (btn) {
      if (t === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  loadSupplications();
}

let activeDuaArAudio = null;
let activeDuaTransAudio = null;
let duaSpeaking = false;

window.speakDua = function(arabic, translation, category, btnEl) {
  // Stop any currently playing Dua
  if (duaSpeaking) {
    duaSpeaking = false;
    if (window.QuranAndroidBridge) {
      window.QuranAndroidBridge.stopSpeech();
    } else {
      window.speechSynthesis.cancel();
    }
    document.querySelectorAll('.dua-audio-btn').forEach(b => {
      b.textContent = '🔊 Listen';
      b.classList.remove('playing');
    });
    return;
  }

  const cleanArabic = arabic.replace(/<[^>]*>/g, '').trim();
  const cleanTranslation = translation.replace(/<[^>]*>/g, '').trim();
  const isUrdu = /[\u0600-\u06FF]/.test(cleanTranslation);
  const transLang = isUrdu ? 'ur-PK' : 'en-US';

  const btn = btnEl || null;
  if (btn) {
    btn.textContent = '⏹ Stop';
    btn.classList.add('playing');
  }
  duaSpeaking = true;

  const resetBtn = () => {
    duaSpeaking = false;
    if (btn) {
      btn.textContent = '🔊 Listen';
      btn.classList.remove('playing');
    }
  };

  // ✅ Android WebView native TTS bridge
  if (window.QuranAndroidBridge && typeof window.QuranAndroidBridge.speakText === 'function') {
    window.QuranAndroidBridge.speakText(cleanArabic, 'ar-SA');
    // Play translation after estimated Arabic duration (1 char ≈ 150ms at rate 0.75)
    const estimatedMs = Math.max(2000, cleanArabic.length * 150);
    setTimeout(() => {
      if (!duaSpeaking) return;
      window.QuranAndroidBridge.speakText(cleanTranslation, transLang);
      const transDuration = Math.max(2000, cleanTranslation.length * 80);
      setTimeout(resetBtn, transDuration);
    }, estimatedMs);
    return;
  }

  // ✅ Web browser Web Speech API
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();

    const arUtterance = new SpeechSynthesisUtterance(cleanArabic);
    arUtterance.lang = 'ar-SA';
    arUtterance.rate = 0.6;   // Slow, clear Quranic-style recitation
    arUtterance.pitch = 1.0;
    arUtterance.volume = 1;

    const transUtterance = new SpeechSynthesisUtterance(cleanTranslation);
    transUtterance.lang = transLang;
    transUtterance.rate = 0.75;  // Calm, easy to understand
    transUtterance.pitch = 1.0;
    transUtterance.volume = 1;

    // 800ms natural pause between Arabic and translation
    arUtterance.onend = () => {
      setTimeout(() => {
        if (duaSpeaking) window.speechSynthesis.speak(transUtterance);
      }, 800);
    };
    transUtterance.onend = resetBtn;
    arUtterance.onerror = transUtterance.onerror = () => { resetBtn(); window.speechSynthesis.cancel(); };

    window.speechSynthesis.speak(arUtterance);
    return;
  }

  // No TTS available at all
  resetBtn();
  console.warn('No TTS engine available on this device.');
};

function renderDuas(list) {
  const container = document.getElementById('duasContainer');
  if (!container) return;

  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-indicator">No supplications found.</div>';
    return;
  }

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'dua-card glass-card';

    let virtuesHTML = '';
    if (item.virtues) {
      virtuesHTML = `<div class="dua-virtues"><strong>Virtue:</strong> ${item.virtues}</div>`;
    }

    // Escape quotes to prevent breaks in inline attributes
    const escapedDua = (item.dua || '').replace(/['"`]/g, '\\$&');
    const escapedTranslation = (item.translation || '').replace(/['"`]/g, '\\$&');
    const escapedCategory = (item.category || '').replace(/['"`]/g, '\\$&');

    card.innerHTML = `
      <div class="dua-card-header">
        <span class="dua-category-badge">${item.category || 'Supplication'}</span>
        <button class="dua-audio-btn" onclick="speakDua('${escapedDua}', '${escapedTranslation}', '${escapedCategory}', this)" title="Play Audio Recitation">🔊 Listen</button>
      </div>
      <div class="dua-arabic">${item.dua}</div>
      <div class="dua-translation-box">
        <strong>ترجمہ:</strong>
        <p>${item.translation}</p>
      </div>
      ${virtuesHTML}
      <div class="dua-reference">${item.reference || ''}</div>
    `;
    container.appendChild(card);
  });
}


// ==========================================================================
/* QURANIC SUBJECTS & TOPICS INDEX INDEXER */
// ==========================================================================

let quranTopicsCache = [];

async function loadQuranTopics() {
  const container = document.getElementById('topicsContainer');
  if (!container) return;

  if (quranTopicsCache.length > 0) {
    renderQuranTopics(quranTopicsCache);
    return;
  }

  container.innerHTML = '<div class="loading-indicator">Loading Subject index...</div>';

  try {
    quranTopicsCache = await queryDatabase(
      "quranDb.db",
      "SELECT topic_id as id, surat_id as surah_id, surat_name as surah_name, start_ayat_id as start_ayah, end_ayat_id as end_ayah, urdu_topics as topic_urdu, eng_topics as topic_english FROM tbl_QuranTopics ORDER BY topic_id"
    );
    renderQuranTopics(quranTopicsCache);
  } catch (e) {
    container.innerHTML = `<div class="error-indicator">Error loading Subject index: ${e.message}</div>`;
  }
}

function renderQuranTopics(list) {
  const container = document.getElementById('topicsContainer');
  if (!container) return;

  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-indicator">No subjects found.</div>';
    return;
  }

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'topic-card glass-card';
    card.onclick = () => showTopicVerses(item.surah_id, item.start_ayah, item.end_ayah, item.topic_urdu, item.topic_english);

    card.innerHTML = `
      <div class="topic-card-header">
        <span class="topic-surah-badge">${item.surah_name} (Surah ${item.surah_id})</span>
        <span class="topic-ayah-badge">Ayah ${item.start_ayah} - ${item.end_ayah}</span>
      </div>
      <div class="topic-title-ur">${item.topic_urdu}</div>
      <div class="topic-title-en">${item.topic_english}</div>
    `;
    container.appendChild(card);
  });
}

function filterQuranTopics() {
  const query = document.getElementById('topicsSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderQuranTopics(quranTopicsCache);
    return;
  }

  const filtered = quranTopicsCache.filter(item => {
    return (item.surah_name && item.surah_name.toLowerCase().includes(query)) ||
           (item.topic_urdu && item.topic_urdu.toLowerCase().includes(query)) ||
           (item.topic_english && item.topic_english.toLowerCase().includes(query));
  });

  renderQuranTopics(filtered);
}

async function showTopicVerses(surahId, startAyah, endAyah, topicUr, topicEn) {
  const modal = document.getElementById('topicVersesModal');
  const title = document.getElementById('topicModalTitle');
  const body = document.getElementById('topicModalBody');
  if (!modal || !body) return;

  title.textContent = topicUr ? `${topicUr} (${topicEn})` : topicEn;
  body.innerHTML = '<div class="loading-indicator">Loading verses...</div>';
  modal.style.display = 'flex';

  try {
    const verses = await queryDatabase(
      "quranDb.db",
      "SELECT id, ayat_number, arabic, translation_urdu, translation_english FROM tbl_QuranComplete WHERE surat_id = ? AND ayat_number >= ? AND ayat_number <= ? ORDER BY ayat_number",
      [surahId, startAyah, endAyah]
    );

    body.innerHTML = '';
    if (verses.length === 0) {
      body.innerHTML = '<div class="empty-indicator">No verses found in this range.</div>';
      return;
    }

    verses.forEach(v => {
      const item = document.createElement('div');
      item.className = 'wbw-verse-card glass-card';
      item.style.padding = '16px';
      item.innerHTML = `
        <div class="wbw-verse-header" style="margin-bottom: 8px;">
          <span class="wbw-verse-badge" style="background-color: var(--accent-gold);">Ayah ${v.ayat_number}</span>
          <button class="wbw-verse-audio-btn" id="topic-audio-btn-${v.id}" onclick="toggleVerseAudio(${v.id})">▶</button>
        </div>
        <div class="reader-arabic-line" style="font-size: 24px; margin-bottom: 8px;">${v.arabic}</div>
        <div class="wbw-full-translations" style="margin-top: 8px;">
          <div class="wbw-trans-line"><strong>Urdu:</strong> <p>${v.translation_urdu ? decryptUrdu(v.translation_urdu) : ''}</p></div>
          <div class="wbw-trans-line"><strong>English:</strong> <p>${v.translation_english || ''}</p></div>
        </div>
      `;
      body.appendChild(item);
    });
  } catch (e) {
    body.innerHTML = `<div class="error-indicator">Error loading verses: ${e.message}</div>`;
  }
}

function closeTopicModal() {
  const modal = document.getElementById('topicVersesModal');
  if (modal) {
    modal.style.display = 'none';
  }
  stopActiveVerseAudio();
}


// ==========================================================================
/* WORD-BY-WORD QURAN ENGINE & DATABASE VIEWER */
// ==========================================================================

const wbwSurahNames = [
  "Al-Fatihah", "Al-Baqarah", "Al-Imran", "An-Nisa'", "Al-Ma'idah", "Al-An'am", "Al-A'raf", "Al-Anfal", "At-Tawbah", "Yunus",
  "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr", "An-Nahl", "Al-Isra'", "Al-Kahf", "Maryam", "Ta-Ha",
  "Al-Anbiya'", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan", "Ash-Shu'ara'", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum",
  "Luqman", "As-Sajdah", "Al-Ahzab", "Saba'", "Fatir", "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir",
  "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah", "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
  "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman", "Al-Waqi'ah", "Al-Hadid", "Al-Mujadilah", "Al-Hashr", "Al-Mumtahanah",
  "As-Saff", "Al-Jumu'ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq", "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij",
  "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah", "Al-Insan", "Al-Mursalat", "An-Naba'", "An-Nazi'at", "'Abasa",
  "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj", "At-Tariq", "Al-A'la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad",
  "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh", "At-Tin", "Al-'Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-'Adiyat",
  "Al-Qari'ah", "At-Takathur", "Al-'Asr", "Al-Humazah", "Al-Fil", "Quraysh", "Al-Ma'un", "Al-Kawthar", "Al-Kafirun", "An-Nasr",
  "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas"
];

const wbwSurahArabicNames = [
  "الفاتحة", "البقرة", "آل عمران", "النساء", "المائدة", "الأنعام", "الأعراف", "الأنفال", "التوبة", "يونس",
  "هود", "يوسف", "الرعد", "إبراهيم", "الحجر", "النحل", "الإسراء", "الكهف", "مريم", "طه",
  "الأنبياء", "الحج", "المؤمنون", "النور", "الفرقان", "الشعراء", "النمل", "القصص", "العنكبوت", "الروم",
  "لقمان", "السجدة", "الأحزاب", "سبأ", "فاطر", "يس", "الصافات", "ص", "الزمر", "غافر",
  "فصلت", "الشورى", "الزخرف", "الدخان", "الجاثية", "الأحقاف", "محمد", "الفتح", "الحجرات", "ق",
  "الذاريات", "الطور", "النجم", "القمر", "الرحمن", "الواقعة", "الحديد", "المجادلة", "الحشر", "الممتحنة",
  "الصف", "الجمعة", "المنافقون", "التغابن", "الطلاق", "التحريم", "الملک", "القلم", "الحاقة", "المعارج",
  "نوح", "الجن", "المزمل", "المدثر", "القيامة", "الإنسان", "المرسلات", "النبأ", "النازعات", "عبس",
  "التكوير", "الانفطار", "المطففين", "الانشقاق", "البروج", "الطارق", "الأعلى", "الغاشية", "الفجر", "البلد",
  "الشمس", "الليل", "الضحى", "الشرح", "التين", "العلق", "القدر", "البينة", "الزلزلة", "العاديات",
  "القارعة", "التكاثر", "العصر", "الهمزة", "الفيل", "قريش", "الماعون", "الکوثر", "الكافرون", "النصر",
  "المسد", "الإخلاص", "الفلق", "الناس"
];

let wbwState = {
  selectedSurah: 1,
  selectedAyah: "all",
  loadedVerses: [],
  pageIndex: 0,
  pageSize: 10,
  activeVerseAudio: null,
  activeVerseAudioId: null
};

function initWbwQuran() {
  const surahSelect = document.getElementById('wbwSurahSelect');
  if (!surahSelect) return;

  surahSelect.innerHTML = '';
  for (let i = 0; i < 114; i++) {
    const sId = i + 1;
    const option = document.createElement('option');
    option.value = sId;
    option.textContent = `${sId}. ${wbwSurahNames[i]} (${wbwSurahArabicNames[i]})`;
    surahSelect.appendChild(option);
  }

  wbwState.selectedSurah = 1;
  wbwState.selectedAyah = "all";
  updateWbwAyahDropdown();
}

async function updateWbwAyahDropdown() {
  const ayahSelect = document.getElementById('wbwAyahSelect');
  if (!ayahSelect) return;

  ayahSelect.innerHTML = '<option value="all">All Verses</option>';
  
  try {
    const res = await queryDatabase(
      "quranDb.db",
      "SELECT COUNT(*) as total FROM tbl_QuranComplete WHERE surat_id = ?",
      [wbwState.selectedSurah]
    );
    if (res && res.length > 0) {
      const totalAyahs = res[0].total;
      for (let i = 1; i <= totalAyahs; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Ayah ${i}`;
        ayahSelect.appendChild(option);
      }
    }
  } catch (e) {
    console.error("Error populating Ayah count:", e);
  }
}

async function onWbwSurahChange() {
  const surahSelect = document.getElementById('wbwSurahSelect');
  if (!surahSelect) return;
  
  wbwState.selectedSurah = parseInt(surahSelect.value);
  wbwState.selectedAyah = "all";
  wbwState.pageIndex = 0;
  
  await updateWbwAyahDropdown();
  await loadWbwVerses();
}

async function onWbwAyahChange() {
  const ayahSelect = document.getElementById('wbwAyahSelect');
  if (!ayahSelect) return;
  
  wbwState.selectedAyah = ayahSelect.value;
  wbwState.pageIndex = 0;
  
  await loadWbwVerses();
}

async function loadWbwVerses() {
  stopActiveVerseAudio();

  const container = document.getElementById('wbwVersesContainer');
  const loadMoreBtn = document.getElementById('wbwLoadMoreBtn');
  if (!container) return;

  if (wbwState.pageIndex === 0) {
    container.innerHTML = '<div class="loading-indicator">Loading Quranic data...</div>';
  }

  try {
    let versesSql = "";
    let wbwsSql = "";
    let params = [];

    if (wbwState.selectedAyah === "all") {
      versesSql = "SELECT id, ayat_number, arabic, translation_urdu, translation_english, id - (SELECT COUNT(*) FROM tbl_QuranComplete z WHERE z.ayat_number=0 AND z.id <= t.id) AS global_num FROM tbl_QuranComplete t WHERE surat_id = ? AND ayat_number > 0 ORDER BY ayat_number";
      wbwsSql = "SELECT ayat_number, translation FROM tbl_word_by_word_new WHERE surat_id = ?";
      params = [wbwState.selectedSurah];
    } else {
      versesSql = "SELECT id, ayat_number, arabic, translation_urdu, translation_english, id - (SELECT COUNT(*) FROM tbl_QuranComplete z WHERE z.ayat_number=0 AND z.id <= t.id) AS global_num FROM tbl_QuranComplete t WHERE surat_id = ? AND ayat_number = ?";
      wbwsSql = "SELECT ayat_number, translation FROM tbl_word_by_word_new WHERE surat_id = ? AND ayat_number = ?";
      params = [wbwState.selectedSurah, parseInt(wbwState.selectedAyah)];
    }

    const verses = await queryDatabase("quranDb.db", versesSql, params);
    const wbws = await queryDatabase("quranDb.db", wbwsSql, params);

    const wbwMap = {};
    wbws.forEach(item => {
      wbwMap[item.ayat_number] = item.translation;
    });

    const merged = verses.map(v => {
      return {
        ...v,
        wbwText: wbwMap[v.ayat_number] || ""
      };
    });

    wbwState.loadedVerses = merged;

    if (wbwState.selectedAyah === "all") {
      renderWbwVersesPaged();
    } else {
      renderWbwVersesList(merged);
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    }
  } catch (e) {
    container.innerHTML = `<div class="error-indicator">Error loading database resources: ${e.message}</div>`;
  }
}

function renderWbwVersesPaged() {
  const container = document.getElementById('wbwVersesContainer');
  const loadMoreBtn = document.getElementById('wbwLoadMoreBtn');
  if (!container) return;

  const start = wbwState.pageIndex * wbwState.pageSize;
  const end = start + wbwState.pageSize;
  const pageSlice = wbwState.loadedVerses.slice(start, end);

  if (wbwState.pageIndex === 0) {
    container.innerHTML = '';
  }

  const loading = container.querySelector('.loading-indicator');
  if (loading) loading.remove();

  renderWbwVersesList(pageSlice, true);

  if (end < wbwState.loadedVerses.length) {
    if (loadMoreBtn) loadMoreBtn.style.display = 'block';
  } else {
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  }
}

function loadMoreWbwVerses() {
  wbwState.pageIndex++;
  renderWbwVersesPaged();
}

function renderWbwVersesList(versesSlice, append = false) {
  const container = document.getElementById('wbwVersesContainer');
  if (!container) return;

  if (!append) {
    container.innerHTML = '';
  }

  if (versesSlice.length === 0) {
    container.innerHTML = '<div class="empty-indicator">No verses found in database.</div>';
    return;
  }

  versesSlice.forEach(v => {
    const card = document.createElement('div');
    card.className = 'wbw-verse-card glass-card';

    let wbwHTML = '';
    if (v.wbwText) {
      const cleanWbw = v.wbwText.split('||')[0];
      const segments = cleanWbw.split('@');
      segments.forEach(seg => {
        const parts = seg.split('&');
        const arabicWord = parts[0]?.trim() || '';
        const transWord = parts[1]?.trim() || '';
        if (arabicWord || transWord) {
          wbwHTML += `
            <div class="wbw-word-tile">
              <span class="wbw-arabic">${arabicWord}</span>
              <span class="wbw-translation">${transWord}</span>
            </div>
          `;
        }
      });
    } else {
      wbwHTML = `<div class="wbw-word-tile-placeholder">${v.arabic}</div>`;
    }

    card.innerHTML = `
      <div class="wbw-verse-header">
        <span class="wbw-verse-badge">Surah ${wbwState.selectedSurah} : Ayah ${v.ayat_number}</span>
        <button class="wbw-verse-audio-btn" id="wbw-audio-btn-${v.global_num}" onclick="toggleVerseAudio(${v.global_num})">▶</button>
      </div>
      <div class="wbw-words-flex">
        ${wbwHTML}
      </div>
      <div class="wbw-full-translations">
        <div class="wbw-trans-line">
          <strong>اردو:</strong>
          <p>${v.translation_urdu ? decryptUrdu(v.translation_urdu) : 'Urdu translation not available.'}</p>
        </div>
        <div class="wbw-trans-line">
          <strong>English:</strong>
          <p>${v.translation_english || 'English translation not available.'}</p>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function toggleVerseAudio(verseId) {
  if (wbwState.activeVerseAudioId === verseId) {
    stopActiveVerseAudio();
    return;
  }

  stopActiveVerseAudio();

  const audioUrl = `https://cdn.islamic.network/quran/audio/128/ar.alafasy/${verseId}.mp3`;
  const playBtn = document.getElementById(`wbw-audio-btn-${verseId}`) ||
                  document.getElementById(`topic-audio-btn-${verseId}`);


  if (isAndroid) {
    try {
      wbwState.activeVerseAudio = true;
      wbwState.activeVerseAudioId = verseId;
      if (playBtn) {
        playBtn.classList.add('playing');
        playBtn.textContent = '⏸';
      }

      activeQariAudioFinishedCallback = () => {
        if (playBtn) {
          playBtn.classList.remove('playing');
          playBtn.textContent = '▶';
        }
        wbwState.activeVerseAudio = null;
        wbwState.activeVerseAudioId = null;
        activeQariAudioFinishedCallback = null;
      };

      QuranAndroidBridge.playAudio(audioUrl);
    } catch (e) {
      console.error("Bridge verse play audio error:", e);
      stopActiveVerseAudio();
    }
  } else {
    const audio = new Audio(audioUrl);
    wbwState.activeVerseAudio = audio;
    wbwState.activeVerseAudioId = verseId;

    if (playBtn) {
      playBtn.classList.add('playing');
      playBtn.textContent = '⏸';
    }

    audio.play().catch(err => {
      console.error("Verse audio playback error:", err);
      stopActiveVerseAudio();
    });

    audio.onended = () => {
      if (playBtn) {
        playBtn.classList.remove('playing');
        playBtn.textContent = '▶';
      }
      wbwState.activeVerseAudio = null;
      wbwState.activeVerseAudioId = null;
    };
  }
}

function stopActiveVerseAudio() {
  if (wbwState.activeVerseAudioId) {
    const playBtn = document.getElementById(`wbw-audio-btn-${wbwState.activeVerseAudioId}`) ||
                    document.getElementById(`topic-audio-btn-${wbwState.activeVerseAudioId}`);
    if (playBtn) {
      playBtn.classList.remove('playing');
      playBtn.textContent = '▶';
    }
  }


  if (isAndroid) {
    try {
      QuranAndroidBridge.stopAudio();
    } catch (e) {
      console.error("Bridge stop audio error:", e);
    }
  } else if (wbwState.activeVerseAudio) {
    wbwState.activeVerseAudio.pause();
  }

  wbwState.activeVerseAudio = null;
  wbwState.activeVerseAudioId = null;
  activeQariAudioFinishedCallback = null;
}




// ============================================================
// DAWAT AUR TABLIGH — Multilingual System (28 Languages)
// ============================================================

let dawatActiveLang = 'ur';
let dawatActiveType = 'sathiyon';

// ── Card UI labels per language ──────────────────────────────
const dawatCardLabels = {
  ur: { c1t: 'پرانے ساتھیوں کو ہدایت', c1s: 'Purane Sathiyon ko Hidayat', c1d: 'پرانے دوستوں اور ساتھیوں کو دین کی طرف واپس لانے کا طریقہ، حکمت اور محبت سے دعوت دینے کے اصول۔', b1: '📖 پڑھیں — Hidayat ka Tariqa', c2t: 'دعوت کا کام', c2s: 'Dawat ka Kaam', c2d: 'دعوت کا کام نہ کرنے کے نقصانات اور فوائد — قرآن و حدیث کی روشنی میں۔', bn: '⚠️ نقصان', bf: '✨ فوائد' },
  en: { c1t: 'Guiding Old Companions', c1s: 'Giving Da\'wah to Friends', c1d: 'The method of bringing old friends back to Deen with wisdom, love and Islamic principles.', b1: '📖 Read — Method of Guidance', c2t: 'Dawat Work', c2s: 'Dawat ka Kaam — Benefits & Harms', c2d: 'The harms of abandoning dawat and the benefits of engaging in this noble work, from Quran & Hadith.', bn: '⚠️ Harms of Leaving', bf: '✨ Benefits of Doing' },
  ar: { c1t: 'هداية الرفاق القدامى', c1s: 'الدعوة إلى الله', c1d: 'طريقة إعادة الأصدقاء القدامى إلى الدين بالحكمة والمحبة.', b1: '📖 اقرأ — طريقة الهداية', c2t: 'عمل الدعوة', c2s: 'الدعوة — الفوائد والأضرار', c2d: 'أضرار ترك الدعوة وفوائد العمل بها من القرآن والسنة.', bn: '⚠️ أضرار الترك', bf: '✨ فوائد العمل' },
  hi: { c1t: 'पुराने साथियों को हिदायत', c1s: 'पुराने दोस्तों को दावत', c1d: 'पुराने दोस्तों को दीन की तरफ वापस लाने का तरीका, हिकमत और मोहब्बत से।', b1: '📖 पढ़ें — हिदायत का तरीका', c2t: 'दावत का काम', c2s: 'Dawat ka Kaam — फायदे और नुकसान', c2d: 'दावत न करने के नुकसान और करने के फायदे — क़ुरआन व हदीस की रोशनी में।', bn: '⚠️ न करने का नुकसान', bf: '✨ करने के फायदे' },
  bn: { c1t: 'পুরনো সাথীদের হেদায়াত', c1s: 'দাওয়াত দেওয়ার পদ্ধতি', c1d: 'পুরনো বন্ধুদের দ্বীনের দিকে ফিরিয়ে আনার পদ্ধতি, হিকমত ও ভালোবাসা দিয়ে।', b1: '📖 পড়ুন — হেদায়াতের পদ্ধতি', c2t: 'দাওয়াতের কাজ', c2s: 'দাওয়াত — উপকার ও ক্ষতি', c2d: 'দাওয়াত না করার ক্ষতি এবং করার উপকার — কুরআন ও হাদিসের আলোকে।', bn: '⚠️ না করার ক্ষতি', bf: '✨ করার উপকার' },
  pa: { c1t: 'ਪੁਰਾਣੇ ਸਾਥੀਆਂ ਨੂੰ ਹਿਦਾਇਤ', c1s: 'ਦਾਵਤ ਦੇਣ ਦਾ ਤਰੀਕਾ', c1d: 'ਪੁਰਾਣੇ ਦੋਸਤਾਂ ਨੂੰ ਦੀਨ ਵੱਲ ਵਾਪਸ ਲਿਆਉਣ ਦਾ ਤਰੀਕਾ।', b1: '📖 ਪੜ੍ਹੋ — ਹਿਦਾਇਤ ਦਾ ਤਰੀਕਾ', c2t: 'ਦਾਵਤ ਦਾ ਕੰਮ', c2s: 'ਦਾਵਤ — ਫਾਇਦੇ ਅਤੇ ਨੁਕਸਾਨ', c2d: 'ਦਾਵਤ ਨਾ ਕਰਨ ਦੇ ਨੁਕਸਾਨ ਅਤੇ ਕਰਨ ਦੇ ਫਾਇਦੇ।', bn: '⚠️ ਨਾ ਕਰਨ ਦਾ ਨੁਕਸਾਨ', bf: '✨ ਕਰਨ ਦੇ ਫਾਇਦੇ' },
  id: { c1t: 'Membimbing Teman Lama', c1s: 'Cara Berdakwah kepada Teman', c1d: 'Cara membawa teman lama kembali ke jalan Islam dengan hikmah dan kasih sayang.', b1: '📖 Baca — Cara Membimbing', c2t: 'Pekerjaan Dakwah', c2s: 'Dakwah — Manfaat & Bahaya', c2d: 'Bahaya meninggalkan dakwah dan manfaat menjalankannya — dari Al-Quran dan Hadits.', bn: '⚠️ Bahaya Meninggalkan', bf: '✨ Manfaat Berdakwah' },
  ms: { c1t: 'Hidayah kepada Sahabat Lama', c1s: 'Cara Berdakwah', c1d: 'Cara membawa sahabat lama kembali kepada Islam dengan penuh hikmah dan kasih sayang.', b1: '📖 Baca — Cara Hidayah', c2t: 'Kerja Dakwah', c2s: 'Dakwah — Faedah & Mudarat', c2d: 'Mudarat meninggalkan dakwah dan faedah melakukannya dari Al-Quran dan Hadith.', bn: '⚠️ Mudarat Tinggalkan', bf: '✨ Faedah Berdakwah' },
  tr: { c1t: 'Eski Dostları Hidayete Erdirmek', c1s: 'Davet Yöntemi', c1d: 'Eski arkadaşları dine kazandırmanın yöntemi, hikmet ve sevgiyle davet etme ilkeleri.', b1: '📖 Oku — Hidayet Yöntemi', c2t: 'Davet Çalışması', c2s: 'Davet — Faydalar & Zararlar', c2d: 'Davet çalışmasını terk etmenin zararları ve yapmanın faydaları — Kuran ve Hadisten.', bn: '⚠️ Terk Etmenin Zararı', bf: '✨ Yapmanın Faydası' },
  fa: { c1t: 'هدایت دوستان قدیم', c1s: 'روش دعوت به دین', c1d: 'روش بازگرداندن دوستان قدیم به دین با حکمت و محبت.', b1: '📖 بخوان — روش هدایت', c2t: 'کار دعوت', c2s: 'دعوت — فواید و زیان‌ها', c2d: 'زیان‌های ترک دعوت و فواید انجام آن از قرآن و حدیث.', bn: '⚠️ زیان ترک دعوت', bf: '✨ فواید دعوت' },
  fr: { c1t: "Guider les Anciens Compagnons", c1s: "Méthode de Da'wah", c1d: "La méthode pour ramener les anciens amis vers la religion avec sagesse et amour.", b1: "📖 Lire — Méthode de Guidage", c2t: "Travail de Da'wah", c2s: "Da'wah — Avantages & Inconvénients", c2d: "Les inconvénients d'abandonner le da'wah et les avantages de le pratiquer.", bn: "⚠️ Inconvénients", bf: "✨ Avantages" },
  es: { c1t: 'Guiar a los Compañeros Antiguos', c1s: 'Método de Da\'wah', c1d: 'El método para traer de vuelta a los amigos al Islam con sabiduría y amor.', b1: '📖 Leer — Método de Guía', c2t: 'Trabajo de Da\'wah', c2s: 'Da\'wah — Beneficios & Perjuicios', c2d: 'Los perjuicios de abandonar la da\'wah y los beneficios de practicarla.', bn: '⚠️ Perjuicios', bf: '✨ Beneficios' },
  de: { c1t: 'Alte Gefährten leiten', c1s: 'Da\'wah-Methode', c1d: 'Die Methode, alte Freunde mit Weisheit und Liebe zum Islam zurückzubringen.', b1: '📖 Lesen — Führungsmethode', c2t: 'Da\'wah-Arbeit', c2s: 'Da\'wah — Nutzen & Schaden', c2d: 'Der Schaden des Unterlassens von Da\'wah und der Nutzen ihrer Ausführung.', bn: '⚠️ Schaden', bf: '✨ Nutzen' },
  ru: { c1t: 'Направление старых товарищей', c1s: 'Метод Дауа', c1d: 'Метод возвращения старых друзей к исламу с мудростью и любовью.', b1: '📖 Читать — Метод руководства', c2t: 'Работа Дауа', c2s: 'Дауа — Польза и вред', c2d: 'Вред от оставления дауа и польза от его выполнения из Корана и хадисов.', bn: '⚠️ Вред от оставления', bf: '✨ Польза' },
  zh: { c1t: '引导旧日同伴', c1s: '达瓦方法', c1d: '用智慧和爱心将旧朋友带回伊斯兰的方法。', b1: '📖 阅读 — 引导方法', c2t: '达瓦工作', c2s: '达瓦 — 益处与危害', c2d: '放弃达瓦的危害和践行达瓦的益处 — 来自古兰经与圣训。', bn: '⚠️ 放弃的危害', bf: '✨ 践行的益处' },
  ja: { c1t: '旧友への導き', c1s: 'ダワの方法', c1d: '知恵と愛をもって旧友をイスラムへ戻す方法。', b1: '📖 読む — 導きの方法', c2t: 'ダワの仕事', c2s: 'ダワ — 益と害', c2d: 'ダワを怠ることの害とダワを行う益 — クルアーンとハディースから。', bn: '⚠️ 怠ることの害', bf: '✨ 行うことの益' },
  sw: { c1t: 'Kuwaongoza Marafiki wa Zamani', c1s: 'Njia ya Dawah', c1d: 'Njia ya kuwarudisha marafiki wa zamani kwa dini kwa hekima na upendo.', b1: '📖 Soma — Njia ya Uongozi', c2t: 'Kazi ya Dawah', c2s: 'Dawah — Faida na Hasara', c2d: 'Hasara za kuacha dawah na faida za kuifanya kutoka Quran na Hadith.', bn: '⚠️ Hasara', bf: '✨ Faida' },
  ha: { c1t: 'Jagorantar Tsoffin Abokai', c1s: 'Hanyar Da\'awa', c1d: 'Hanyar mayar da tsoffin aboki zuwa addini da hikima da ƙauna.', b1: '📖 Karanta — Hanyar Jagoranci', c2t: 'Aikin Da\'awa', c2s: "Da'awa — Amfani da Cutarwa", c2d: "Cutarwar barin da'awa da amfanin yin ta daga Alƙur'ani da Hadisi.", bn: '⚠️ Cutarwa', bf: '✨ Amfani' },
  so: { c1t: 'Hanunaynta Saaxiibada Hore', c1s: 'Hab-ka Dacwada', c1d: 'Hab-ka dib-u-celinta saaxiibada hore ee diinta iyadoo la adeegsanayo xigmadda iyo jacaylka.', b1: '📖 Akhri — Hab-ka Hanunaynta', c2t: 'Shaqada Dacwada', c2s: 'Dacwada — Faa\'iidada & Dhibaatada', c2d: 'Dhibaatada ka tagista dacwada iyo faa\'iidada ka qabashada — Quraan iyo Xadiis.', bn: '⚠️ Dhibaatada', bf: '✨ Faa\'iidada' },
  ta: { c1t: 'பழைய தோழர்களுக்கு வழிகாட்டுதல்', c1s: 'தவ்வா முறை', c1d: 'ஞானம் மற்றும் அன்பு கொண்டு பழைய நண்பர்களை இஸ்லாமிற்கு திரும்ப அழைக்கும் முறை.', b1: '📖 படிக்கவும் — வழிகாட்டல் முறை', c2t: 'தவ்வா பணி', c2s: 'தவ்வா — நன்மைகள் & தீமைகள்', c2d: 'தவ்வா விடுவதால் வரும் தீமைகள் மற்றும் செய்வதால் வரும் நன்மைகள்.', bn: '⚠️ தீமைகள்', bf: '✨ நன்மைகள்' },
  te: { c1t: 'పాత సహచరులకు మార్గదర్శనం', c1s: 'దావా పద్ధతి', c1d: 'జ్ఞానం మరియు ప్రేమతో పాత మిత్రులను ఇస్లాంకు తిరిగి తీసుకురావడానికి పద్ధతి.', b1: '📖 చదవండి — మార్గదర్శన పద్ధతి', c2t: 'దావా పని', c2s: 'దావా — ప్రయోజనాలు & హానులు', c2d: 'దావా వదిలివేయడం వల్ల హానులు మరియు చేయడం వల్ల ప్రయోజనాలు.', bn: '⚠️ హానులు', bf: '✨ ప్రయోజనాలు' },
  pt: { c1t: 'Guiar Antigos Companheiros', c1s: 'Método de Da\'wah', c1d: 'O método de trazer antigos amigos de volta ao Islã com sabedoria e amor.', b1: '📖 Ler — Método de Orientação', c2t: 'Trabalho de Da\'wah', c2s: 'Da\'wah — Benefícios & Malefícios', c2d: 'Os malefícios de abandonar a da\'wah e os benefícios de praticá-la.', bn: '⚠️ Malefícios', bf: '✨ Benefícios' },
  it: { c1t: 'Guidare i Vecchi Compagni', c1s: "Metodo di Da'wah", c1d: "Il metodo per riportare i vecchi amici all'Islam con saggezza e amore.", b1: '📖 Leggi — Metodo di Guida', c2t: "Lavoro di Da'wah", c2s: "Da'wah — Vantaggi & Svantaggi", c2d: "Gli svantaggi di abbandonare la da'wah e i vantaggi di praticarla.", bn: '⚠️ Svantaggi', bf: '✨ Vantaggi' },
  nl: { c1t: 'Oude Metgezellen Leiden', c1s: "Da'wah Methode", c1d: "De methode om oude vrienden met wijsheid en liefde terug naar de islam te brengen.", b1: '📖 Lees — Leidingmethode', c2t: "Da'wah Werk", c2s: "Da'wah — Voordelen & Nadelen", c2d: "De nadelen van het nalaten van da'wah en de voordelen van het uitvoeren ervan.", bn: '⚠️ Nadelen', bf: '✨ Voordelen' },
  ps: { c1t: 'د زاړه ملګرو لارښوونه', c1s: 'د دعوت طریقه', c1d: 'د زاړه ملګرو بیرته دین ته راوستلو طریقه، له حکمت او مینې سره.', b1: '📖 ولولئ — د لارښوونې طریقه', c2t: 'د دعوت کار', c2s: 'دعوت — ګټې او زیانونه', c2d: 'د دعوت پریښودو زیانونه او کولو ګټې — له قرآن او حدیث.', bn: '⚠️ زیانونه', bf: '✨ ګټې' },
  ug: { c1t: 'كونا دوستلارنى يوللاش', c1s: 'دەۋەت ئۇسۇلى', c1d: 'كونا دوستلارنى ھيكمەت ۋە مۇھەببەت بىلەن دىنگە قايتۇرۇش ئۇسۇلى.', b1: '📖 ئوقۇڭ — يوللاش ئۇسۇلى', c2t: 'دەۋەت ئىشى', c2s: 'دەۋەت — پايدا ۋە زىيان', c2d: 'دەۋەتنى تاشلاپ قويۇشنىڭ زىيىنى ۋە قىلىشنىڭ پايدىسى.', bn: '⚠️ زىيان', bf: '✨ پايدا' },
  az: { c1t: 'Köhnə Dostları Doğru Yola Gətirmək', c1s: 'Dəvət Metodu', c1d: 'Köhnə dostları hikmət və sevgi ilə İslama qaytarmaq üsulu.', b1: '📖 Oxu — Rəhbərlik Metodu', c2t: 'Dəvət İşi', c2s: 'Dəvət — Faydalar & Zərərlər', c2d: 'Dəvəti tərk etməyin zərərləri və etməyin faydaları — Quran və Hədisdən.', bn: '⚠️ Zərərlər', bf: '✨ Faydalar' },
  uz: { c1t: 'Eski Do\'stlarni Hidoyat Qilish', c1s: 'Da\'vat Usuli', c1d: 'Eski do\'stlarni hikmat va muhabbat bilan dinga qaytarish usuli.', b1: '📖 O\'qi — Hidoyat Usuli', c2t: 'Da\'vat Ishi', c2s: 'Da\'vat — Foyda va Zararlar', c2d: 'Da\'vatni tark etishning zararlari va qilishning foydalari — Qur\'on va Hadisdan.', bn: '⚠️ Zararlar', bf: '✨ Foydalar' }
};

// ── Modal content per language ────────────────────────────────
function buildModalBody(lang, type) {
  const P = (num, text) => `<div class="dawat-point"><span class="dawat-point-num">${num}</span><span class="dawat-point-text">${text}</span></div>`;
  const A = (text, ref) => `<div class="dawat-ayah">${text}<div class="dawat-ref">${ref}</div></div>`;

  const content = {
    ur: {
      sathiyon: A('وَمَنْ أَحْسَنُ قَوْلًا مِّمَّن دَعَا إِلَى اللَّهِ وَعَمِلَ صَالِحًا', '— سورۃ فصلت: 33') + P('🌟','<strong>محبت اور حکمت سے دعوت دیں</strong> — پرانے ساتھیوں کے ساتھ پرانی یادیں تازہ کریں، پھر آہستہ آہستہ دین کی بات کریں۔') + P('💬','<strong>اپنی زندگی کی مثال دیں</strong> — زبان سے پہلے اپنے عمل سے دعوت دیں۔ جب ساتھی آپ کی تبدیلی دیکھیں تو خود پوچھیں گے۔') + P('🤲','<strong>ان کے لیے دعا کریں</strong> — ہدایت صرف اللہ دے سکتا ہے۔ رات کو تہجد میں ان کے لیے دعا کریں۔') + P('📖','<strong>قرآن کی آیات شیئر کریں</strong> — کسی مناسب موقع پر قرآن کی کوئی آیت سنائیں جو دل کو چھو جائے۔') + P('🎯','<strong>صبر سے کام لیں</strong> — نبی کریم ﷺ نے ۲۳ سال تک صبر اور حکمت سے دعوت دی۔') + P('🕌','<strong>تبلیغی جماعت یا بیان میں لے جائیں</strong> — کسی عالم کا بیان دل میں انقلاب لے آتا ہے۔'),
      nuksan: A('لَتَأْمُرُنَّ بِالْمَعْرُوفِ وَلَتَنْهَوُنَّ عَنِ الْمُنكَرِ أَوْ لَيُوشِكَنَّ اللَّهُ أَن يَبْعَثَ عَلَيْكُمْ عِقَابًا', '— ترمذی | نبی کریم ﷺ') + P('❌','<strong>فریضہ کی ادائیگی نہ ہوگی</strong> — امر بالمعروف ہر مسلمان پر فرض ہے۔') + P('🔥','<strong>اللہ کا عذاب پوری قوم پر آتا ہے</strong> — برائی دیکھ کر نہ روکنے والے بھی عذاب میں شامل ہوتے ہیں (بخاری)۔') + P('💔','<strong>اپنے پیاروں کو جہنم کی طرف چھوڑنا</strong> — قیامت میں ذمہ دار ٹھہرایا جائے گا۔') + P('📉','<strong>امت کی تباہی</strong> — دعوت چھوڑنے والی امت دینی زوال کا شکار ہو جاتی ہے۔') + P('😔','<strong>اپنا ایمان کمزور پڑتا ہے</strong> — دعوت سے کنارہ کشی کرنے والے کا خود ایمان کمزور ہو جاتا ہے۔') + P('⏳','<strong>قیامت میں جواب دہی</strong> — اللہ پوچھے گا: تم نے لوگوں کو کیوں نہیں بتایا؟'),
      fayde: A('وَمَنْ أَحْسَنُ قَوْلًا مِّمَّن دَعَا إِلَى اللَّهِ وَعَمِلَ صَالِحًا وَقَالَ إِنَّنِي مِنَ الْمُسْلِمِينَ', '— سورۃ فصلت: 33') + P('🏆','<strong>ہدایت کا ذریعہ بننا</strong> — ایک شخص کی ہدایت دنیا کی تمام نعمتوں سے بہتر ہے (بخاری)۔') + P('💰','<strong>صدقہ جاریہ</strong> — جب آپ کی دعوت سے کوئی نیک عمل کرے تو قیامت تک ثواب ملتا رہے گا (مسلم)۔') + P('🌟','<strong>انبیاء کا کام سرانجام دینا</strong> — یہ انبیاء علیہم السلام کا عظیم ترین فریضہ ہے۔') + P('❤️','<strong>خود کا ایمان مضبوط ہوتا ہے</strong> — دعوت ایمان کو تازہ رکھتی ہے۔') + P('🤲','<strong>اللہ کی مدد اور برکت</strong> — دعوت دینے والے کے گھر میں برکت آتی ہے۔') + P('🕊️','<strong>سماجی اصلاح</strong> — دعوت سے معاشرہ بہتر ہوتا ہے اور امن آتا ہے۔')
    },
    en: {
      sathiyon: A('And who is better in speech than one who invites to Allah and does righteousness?', '— Surah Fussilat 41:33') + P('🌟','<strong>Invite with Love & Wisdom</strong> — Reconnect over old memories, then gently introduce the religion with kindness.') + P('💬','<strong>Lead by Example</strong> — Let your changed life speak first. When they see your transformation, they will ask how.') + P('🤲','<strong>Pray for Them</strong> — Guidance belongs to Allah alone. Make du\'a for them in Tahajjud every night.') + P('📖','<strong>Share Quranic Verses</strong> — Share a verse or hadith that touches the heart at the right moment.') + P('🎯','<strong>Be Patient</strong> — The Prophet ﷺ gave da\'wah for 23 years with patience. Guidance is not instant.') + P('🕌','<strong>Take Them to a Bayan</strong> — Attending a scholar\'s talk or Tablighi Jamaat can transform a heart.'),
      nuksan: A('You must enjoin good and forbid evil, or Allah will send upon you a punishment from Him.', '— Tirmidhi | Prophet ﷺ') + P('❌','<strong>A Duty Left Unfulfilled</strong> — Enjoining good and forbidding evil is obligatory on every Muslim.') + P('🔥','<strong>Punishment Falls on the Whole Nation</strong> — When a people see evil and do nothing, the punishment includes everyone (Bukhari).') + P('💔','<strong>Abandoning Loved Ones to Hellfire</strong> — If we didn\'t warn our friends, we will be questioned on Judgment Day.') + P('📉','<strong>Downfall of the Ummah</strong> — A nation that abandons da\'wah loses its identity and faces spiritual decline.') + P('😔','<strong>Your Own Faith Weakens</strong> — Turning away from da\'wah weakens your own iman over time.') + P('⏳','<strong>Accountability on Judgment Day</strong> — Allah will ask: "Why did you not warn them?" No excuse will be accepted.'),
      fayde: A('And who is better in speech than one who invites to Allah and does righteousness and says, "Indeed, I am of the Muslims."', '— Surah Fussilat 41:33') + P('🏆','<strong>Becoming a Source of Guidance</strong> — The Prophet ﷺ said: "If Allah guides one person through you, it is better than the whole world." (Bukhari)') + P('💰','<strong>Ongoing Charity (Sadaqa Jariyah)</strong> — When someone you guided does good deeds, you earn reward until the Day of Judgment (Muslim).') + P('🌟','<strong>Continuing the Work of the Prophets</strong> — Da\'wah is the noble task of all Prophets. Following it is the greatest honor.') + P('❤️','<strong>Strengthening Your Own Faith</strong> — Da\'wah keeps your iman fresh and protects you from sins.') + P('🤲','<strong>Allah\'s Help & Blessings</strong> — "If you support Allah, He will support you." Blessings flow into the home of a da\'ee.') + P('🕊️','<strong>Social Reform & Peace</strong> — Da\'wah improves society, reduces evil, and brings peace to the world.')
    },
    ar: {
      sathiyon: A('وَمَنْ أَحْسَنُ قَوْلًا مِّمَّن دَعَا إِلَى اللَّهِ وَعَمِلَ صَالِحًا', '— سورة فصلت: 33') + P('🌟','<strong>ادعُ بالحكمة والمحبة</strong> — تذكّر الأيام القديمة مع رفاقك ثم أدخل موضوع الدين بلطف ومحبة.') + P('💬','<strong>كن قدوةً حسنة</strong> — قبل أن تتكلم، اجعل حياتك المتغيرة تتحدث عنك.') + P('🤲','<strong>ادعُ لهم</strong> — الهداية بيد الله وحده، ادعُ لهم في صلاة التهجد كل ليلة.') + P('📖','<strong>شارك الآيات القرآنية</strong> — شارك آيةً أو حديثاً يلمس القلب في اللحظة المناسبة.') + P('🎯','<strong>تحلَّ بالصبر</strong> — دعا النبي ﷺ ثلاثة وعشرين عاماً بصبر وحكمة. الهداية لا تأتي فجأة.') + P('🕌','<strong>اصطحبهم إلى محاضرة أو جماعة</strong> — حضور مجلس العلم يمكن أن يغيّر القلوب.'),
      nuksan: A('لَتَأْمُرُنَّ بِالْمَعْرُوفِ وَلَتَنْهَوُنَّ عَنِ الْمُنكَرِ أَوْ لَيُوشِكَنَّ اللَّهُ أَن يَبْعَثَ عَلَيْكُمْ عِقَابًا مِّنْهُ', '— رواه الترمذي | قول النبي ﷺ') + P('❌','<strong>إهمال الواجب</strong> — الأمر بالمعروف والنهي عن المنكر فريضة على كل مسلم.') + P('🔥','<strong>العقوبة تعم الجميع</strong> — إذا رأت أمة المنكر ولم تنكره، عمّها العذاب (البخاري).') + P('💔','<strong>تركُ أحبائك لجهنم</strong> — إذا لم تنصح أقاربك وأصدقاءك، ستسأل عنهم يوم القيامة.') + P('📉','<strong>انهيار الأمة</strong> — الأمة التي تترك الدعوة تفقد هويتها وتتردى في الانحدار الديني.') + P('😔','<strong>ضعف الإيمان الشخصي</strong> — الإعراض عن الدعوة يضعف إيمان الداعية نفسه تدريجياً.') + P('⏳','<strong>المحاسبة يوم القيامة</strong> — سيسألك الله: لماذا لم تبلّغ؟ ولن ينفع عذر.'),
      fayde: A('وَمَنْ أَحْسَنُ قَوْلًا مِّمَّن دَعَا إِلَى اللَّهِ وَعَمِلَ صَالِحًا وَقَالَ إِنَّنِي مِنَ الْمُسْلِمِينَ', '— سورة فصلت: 33') + P('🏆','<strong>أن تكون سبباً للهداية</strong> — قال النبي ﷺ: "لأن يهدي الله بك رجلاً واحداً خير لك من الدنيا وما فيها" (البخاري).') + P('💰','<strong>صدقة جارية</strong> — إذا عمل من هديته عملاً صالحاً، وصل إليك أجره إلى يوم القيامة (مسلم).') + P('🌟','<strong>السير على خطى الأنبياء</strong> — الدعوة هي عمل الأنبياء الكرام، وهي أعلى منزلة.') + P('❤️','<strong>تقوية إيمانك</strong> — الدعوة تجدد الإيمان وتبعد النفس عن المعاصي.') + P('🤲','<strong>توفيق الله وبركته</strong> — "إن تنصروا الله ينصركم" — البيت الذي يُدعى فيه مبارك.') + P('🕊️','<strong>إصلاح المجتمع</strong> — الدعوة تحسّن المجتمع وتقلل الشرور وتجلب السلام.')
    },
    hi: {
      sathiyon: A('وَمَنْ أَحْسَنُ قَوْلًا مِّمَّن دَعَا إِلَى اللَّهِ', '— सूरह फ़ुस्सिलत: 33') + P('🌟','<strong>मोहब्बत और हिकमत से दावत दें</strong> — पुराने दोस्तों के साथ पुरानी यादें ताजा करें, फिर धीरे-धीरे दीन की बात करें।') + P('💬','<strong>अपनी जिंदगी की मिसाल दें</strong> — जुबान से पहले अपने अमल से दावत दें।') + P('🤲','<strong>उनके लिए दुआ करें</strong> — हिदायत सिर्फ अल्लाह दे सकता है, तहज्जुद में दुआ करें।') + P('📖','<strong>कुरआन की आयतें शेयर करें</strong> — कोई दिल को छूने वाली आयत या हदीस सुनाएं।') + P('🎯','<strong>सब्र से काम लें</strong> — नबी ﷺ ने 23 साल सब्र के साथ दावत दी।') + P('🕌','<strong>किसी बयान या जमात में ले जाएं</strong> — किसी आलिम का बयान दिल में इंकलाब लाता है।'),
      nuksan: A('تم जरूर नेकी का हुक्म दो और बुराई से रोको वरना अल्लाह तुम पर अजाब भेजेगा', '— तिर्मिज़ी | नबी ﷺ का फरमान') + P('❌','<strong>फर्ज़ अदा न होगा</strong> — अम्र बिल मारूफ हर मुसलमान पर फर्ज़ है।') + P('🔥','<strong>अल्लाह का अजाब पूरी क़ौम पर आता है</strong> — जब क़ौम बुराई देखे और न रोके (बुखारी)।') + P('💔','<strong>अपने प्यारों को जहन्नम की तरफ छोड़ना</strong> — क़यामत में जवाबदेह होंगे।') + P('📉','<strong>उम्मत की तबाही</strong> — दावत छोड़ने वाली उम्मत दीनी ज़वाल का शिकार होती है।') + P('😔','<strong>अपना ईमान कमजोर पड़ता है</strong> — दावत छोड़ने से खुद का ईमान भी कमजोर होता है।') + P('⏳','<strong>क़यामत में जवाबदेही</strong> — अल्लाह पूछेगा: तुमने क्यों नहीं बताया?'),
      fayde: A('وَمَنْ أَحْسَنُ قَوْلًا مِّمَّن دَعَا إِلَى اللَّهِ', '— सूरह फ़ुस्सिलत: 33') + P('🏆','<strong>हिदायत का ज़रिया बनना</strong> — एक शख्स की हिदायत दुनिया की तमाम नेमतों से बेहतर है (बुखारी)।') + P('💰','<strong>सदक़ा-ए-जारिया</strong> — जिसे आपने हिदायत दी वो नेक अमल करे तो क़यामत तक ठवाब मिलता रहेगा (मुस्लिम)।') + P('🌟','<strong>अंबिया का काम अंजाम देना</strong> — दावत अंबिया का फरीज़ा है, यही सबसे बड़ा शरफ है।') + P('❤️','<strong>खुद का ईमान मज़बूत होता है</strong> — दावत से ईमान ताज़ा रहता है।') + P('🤲','<strong>अल्लाह की मदद और बरकत</strong> — दावत देने वाले के घर में बरकत आती है।') + P('🕊️','<strong>समाजी इस्लाह</strong> — दावत से समाज बेहतर होता है और अमन आता है।')
    }
  };

  // For languages not yet fully translated, fall back to English
  const langContent = content[lang] || content['en'];
  return langContent[type] || content['en'][type];
}

// ── Card text update ──────────────────────────────────────────
function setDawatLang(lang) {
  dawatActiveLang = lang;

  // Update active button in lang bar
  document.querySelectorAll('.dlang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });

  // Also sync modal lang bar
  document.querySelectorAll('.dmlang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });

  const L = dawatCardLabels[lang] || dawatCardLabels['en'];
  const isRTL = ['ur','ar','fa','ps','ug'].includes(lang);

  // Update card 1
  document.getElementById('dawat-card1-title').textContent = L.c1t;
  document.getElementById('dawat-card1-sub').textContent = L.c1s;
  document.getElementById('dawat-card1-desc').textContent = L.c1d;
  document.getElementById('dawat-btn1-label').textContent = L.b1;

  // Update card 2
  document.getElementById('dawat-card2-title').textContent = L.c2t;
  document.getElementById('dawat-card2-sub').textContent = L.c2s;
  document.getElementById('dawat-card2-desc').textContent = L.c2d;
  document.getElementById('dawat-btn-nuksan-label').textContent = L.bn;
  document.getElementById('dawat-btn-fayde-label').textContent = L.bf;

  // RTL direction for cards
  ['dawat-card-sathiyon','dawat-card-fayde-nuksan'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.direction = isRTL ? 'rtl' : 'ltr';
  });
}

// ── Modal lang switch ─────────────────────────────────────────
function setDawatModalLang(lang) {
  dawatActiveLang = lang;

  document.querySelectorAll('.dmlang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
  document.querySelectorAll('.dlang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });

  // Rebuild modal body in new language
  const body = buildModalBody(lang, dawatActiveType);
  document.getElementById('dawat-modal-body').innerHTML = body;

  const isRTL = ['ur','ar','fa','ps','ug'].includes(lang);
  const modal = document.getElementById('dawat-modal');
  modal.style.direction = isRTL ? 'rtl' : 'ltr';
  modal.style.textAlign = isRTL ? 'right' : 'left';
}

// ── Open modal ────────────────────────────────────────────────
function openDawatModal(type) {
  dawatActiveType = type;

  const icons = { sathiyon: '🤝', nuksan: '⚠️', fayde: '✨' };
  const L = dawatCardLabels[dawatActiveLang] || dawatCardLabels['ur'];
  const titles = {
    sathiyon: L.c1t,
    nuksan: L.bn.replace(/^[^a-zA-Z\u0600-\u06FF\u0900-\u097F]+/, '').trim() || 'Harms of Leaving Dawat',
    fayde: L.bf.replace(/^[^a-zA-Z\u0600-\u06FF\u0900-\u097F]+/, '').trim() || 'Benefits of Dawat'
  };

  document.getElementById('dawat-modal-icon').textContent = icons[type];
  document.getElementById('dawat-modal-title').textContent = titles[type];
  document.getElementById('dawat-modal-body').innerHTML = buildModalBody(dawatActiveLang, type);

  // Sync modal lang buttons
  document.querySelectorAll('.dmlang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === dawatActiveLang);
  });

  const isRTL = ['ur','ar','fa','ps','ug'].includes(dawatActiveLang);
  const modal = document.getElementById('dawat-modal');
  modal.style.direction = isRTL ? 'rtl' : 'ltr';
  modal.style.textAlign = isRTL ? 'right' : 'left';

  document.getElementById('dawat-modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDawatModal(event, force = false) {
  if (force || (event && event.target === document.getElementById('dawat-modal-overlay'))) {
    document.getElementById('dawat-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// Close on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeDawatModal(null, true);
  }
});
