(function () {
  const state = {
    laws: [],
    category: '전체',
    query: '',
  };

  const $ = (sel) => document.querySelector(sel);
  const listEl = $('#law-list');
  const emptyEl = $('#empty-state');
  const countEl = $('#result-count');
  const updatedEl = $('#updated-at');
  const searchInput = $('#search-input');
  const tabs = document.querySelectorAll('.tab');

  const overlay = $('#detail-overlay');
  const detailTitle = $('#detail-title');
  const detailMeta = $('#detail-meta');
  const detailLink = $('#detail-link');
  const detailArticles = $('#detail-articles');
  const articleSearchInput = $('#article-search-input');
  const closeBtn = $('#detail-close');

  const normalize = (s) => (s || '').toLowerCase().replace(/[\s·.\-]/g, '');

  function formatDate(d) {
    if (!d || d.length !== 8) return d || '';
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  }

  async function loadIndex() {
    const res = await fetch('data/index.json', { cache: 'no-cache' });
    const data = await res.json();
    state.laws = data.laws || [];
    if (data.sample) {
      updatedEl.textContent = '샘플 데이터 표시 중 (Actions 실행 후 실제 데이터로 자동 갱신)';
    } else if (data.updatedAt) {
      const d = new Date(data.updatedAt);
      updatedEl.textContent = `최근 업데이트: ${d.toLocaleDateString('ko-KR')} · 총 ${data.count}건`;
    }
    render();
  }

  function matches(law) {
    const categoryOk = state.category === '전체' || law.category === state.category;
    if (!categoryOk) return false;
    if (!state.query) return true;
    return normalize(law.name).includes(normalize(state.query));
  }

  function render() {
    const filtered = state.laws.filter(matches);
    listEl.innerHTML = '';
    countEl.textContent = `${filtered.length}건`;
    emptyEl.hidden = filtered.length !== 0;

    for (const law of filtered) {
      const li = document.createElement('li');
      li.className = 'law-item';
      li.innerHTML = `
        <div class="law-item-top">
          <span class="badge ${law.category}">${law.category}</span>
        </div>
        <p class="law-name">${law.name}</p>
        <p class="law-meta">${law.department || ''} · 시행일 ${formatDate(law.enforcementDate)}</p>
      `;
      li.addEventListener('click', () => openDetail(law));
      listEl.appendChild(li);
    }
  }

  async function openDetail(law) {
    overlay.hidden = false;
    detailTitle.textContent = law.name;
    detailMeta.textContent = `${law.categoryRaw || law.category} · ${law.department || ''} · 공포 ${formatDate(law.promulgationDate)} · 시행 ${formatDate(law.enforcementDate)}`;
    detailLink.href = law.detailLink || '#';
    articleSearchInput.value = '';
    detailArticles.innerHTML = '<p class="no-articles">불러오는 중...</p>';

    try {
      const res = await fetch(`data/laws/${encodeURIComponent(law.mst)}.json`, { cache: 'no-cache' });
      const detail = await res.json();
      renderArticles(detail.articles || []);
      articleSearchInput.oninput = () => renderArticles(detail.articles || [], articleSearchInput.value);
    } catch (err) {
      detailArticles.innerHTML = '<p class="no-articles">조문을 불러오지 못했습니다. 위 링크에서 원문을 확인해주세요.</p>';
    }
  }

  function renderArticles(articles, query) {
    let list = articles;
    if (query) {
      const q = normalize(query);
      list = articles.filter(
        (a) => normalize(a.title).includes(q) || normalize(a.text).includes(q)
      );
    }
    if (list.length === 0) {
      detailArticles.innerHTML = '<p class="no-articles">표시할 조문이 없습니다. 위 링크에서 원문을 확인해주세요.</p>';
      return;
    }
    detailArticles.innerHTML = list
      .map(
        (a) => `
        <div class="article">
          <p class="article-title">${a.title || `제${a.no}조`}</p>
          <p class="article-text">${escapeHtml(a.text || '')}</p>
        </div>`
      )
      .join('');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function closeDetail() {
    overlay.hidden = true;
  }

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    render();
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.category = tab.dataset.category;
      render();
    });
  });

  closeBtn.addEventListener('click', closeDetail);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDetail();
  });

  loadIndex();
})();
