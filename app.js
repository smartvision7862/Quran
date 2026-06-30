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
  bookmarks: []
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
    } else if ((c >= 0x0600 && c <= 0x06FF) ||
               (c >= 0x0750 && c <= 0x077F) ||
               (c >= 0xFB50 && c <= 0xFDFF) ||
               (c >= 0xFE70 && c <= 0xFEFF)) {
      result.push(String.fromCharCode(c - 3));
    } else {
      result.push(scrambledText.charAt(i));
    }
  }
  return result.join('');
}

// Check if running in Android app via bridge
const isAndroid = typeof QuranAndroidBridge !== 'undefined';

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
    // Return mock data for standard web browser environment
    return getMockData(dbFile, sql, argsArray);
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
  loadLessonsGrid();
  loadHadithBooks();
  loadAllahNames();
  
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

  // Update Topbar Title
  const titles = {
    '#dashboard': 'Dashboard',
    '#sabaq': 'Learn Quran',
    '#hadith': 'Hadith Library',
    '#names': '99 Names of Allah',
    '#bookmarks': 'My Bookmarks',
    '#settings': 'Settings'
  };
  document.getElementById('pageTitle').textContent = titles[hash] || 'Islam360';
  state.activeView = hash.substring(1);
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
}

function saveSettings() {
  localStorage.setItem('theme', document.body.className.replace('-theme', ''));
  localStorage.setItem('arabicFontSize', state.arabicFontSize.toString());
  localStorage.setItem('translationFontSize', state.translationFontSize.toString());
  localStorage.setItem('hadithLang', state.hadithLang.toString());
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
            <span class="name-front-num" style="font-size: 11px; color: var(--text-muted)">${idx + 1}</span>
            <div class="arabic">${n.urdu}</div>
            <div class="translit">${n.english}</div>
          </div>
          <div class="name-back">
            <div class="meaning">${n.englishMeaning}</div>
            <div class="meaning-ur" dir="rtl">${n.urduMeaning}</div>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Failed to load names: ' + err.message + '</p>';
  }
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
  if (sql.includes("COUNT(*)")) {
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
  
  return [];
}
