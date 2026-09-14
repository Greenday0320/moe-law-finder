(function () {
  const state = {
    laws: [],
    category: '전체',
    query: '',
    department: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const listEl = $('#law-list');
  const emptyEl = $('#empty-state');
  const countEl = $('#result-count');
  const updatedEl = $('#updated-at');
  const searchInput = $('#search-input');
  const tabs = document.querySelectorAll('.tab');
  const deptChip = $('#dept-filter-chip');

  const viewModeButtons = document.querySelectorAll('.view-mode');
  const searchView = $('#search-view');
  const orgView = $('#org-view');
  const orgTreeEl = $('#org-tree');

  const overlay = $('#detail-overlay');
  const detailTitle = $('#detail-title');
  const detailMeta = $('#detail-meta');
  const detailLink = $('#detail-link');
  const relatedTabs = $('#related-tabs');
  const detailArticles = $('#detail-articles');
  const articleSearchInput = $('#article-search-input');
  const closeBtn = $('#detail-close');

  // ㆍ(U+318D, 법령명에 흔히 쓰이는 한글 가운뎃점)는 일반 마침표(·, U+00B7)와
  // 다른 문자라서 별도로 제거해줘야 "초중등교육법"처럼 점 없이 검색해도 매칭된다.
  const normalize = (s) => (s || '').toLowerCase().replace(/[\s·ㆍ.\-]/g, '');

  // 법령의 연락부서명에는 "교원정책과:초중등교원"처럼 세부 업무가 덧붙는 경우가
  // 있어, 조직도의 과 이름과 맞추려면 ":"나 "-" 뒤를 떼어 기본 과 이름만 비교한다.
  function normalizeDept(name) {
    return (name || '').split(/[:\-]/)[0].trim();
  }

  // "OO법 시행령", "OO법 시행규칙" 처럼 이름 뒤에 붙는 접미사를 떼어
  // 법률-시행령-시행규칙을 같은 그룹으로 묶기 위한 기준 이름을 만든다.
  const TIER_ORDER = { 법률: 0, 시행령: 1, 시행규칙: 2 };
  function baseName(name) {
    return (name || '').replace(/\s*시행규칙$/, '').replace(/\s*시행령$/, '').trim();
  }
  function buildGroups(laws) {
    const groups = new Map();
    for (const law of laws) {
      const key = baseName(law.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(law);
    }
    return groups;
  }

  function deptLabel(law) {
    if (law.departments && law.departments.length > 0) {
      return `${law.department || ''} ${law.departments.join(', ')}`.trim();
    }
    return law.department || '';
  }

  function formatDate(d) {
    if (!d || d.length !== 8) return d || '';
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  }

  async function loadIndex() {
    const [indexRes, orgRes] = await Promise.all([
      fetch('data/index.json', { cache: 'no-cache' }),
      fetch('data/org.json', { cache: 'no-cache' }).catch(() => null),
    ]);
    const data = await indexRes.json();
    state.laws = data.laws || [];
    state.groups = buildGroups(state.laws);
    if (data.sample) {
      updatedEl.textContent = '샘플 데이터 표시 중 (Actions 실행 후 실제 데이터로 자동 갱신)';
    } else if (data.updatedAt) {
      const d = new Date(data.updatedAt);
      updatedEl.textContent = `최근 업데이트: ${d.toLocaleDateString('ko-KR')} · 총 ${data.count}건`;
    }
    if (orgRes && orgRes.ok) {
      state.org = await orgRes.json();
      renderOrgTree();
    }
    render();
  }

  function matches(law) {
    const categoryOk = state.category === '전체' || law.category === state.category;
    if (!categoryOk) return false;
    if (state.department && !(law.departments || []).some((d) => normalizeDept(d) === state.department)) return false;
    if (!state.query) return true;
    return normalize(law.name).includes(normalize(state.query));
  }

  function setDepartment(name) {
    state.department = name;
    switchView('search');
    render();
  }

  function renderDeptChip() {
    if (!state.department) {
      deptChip.hidden = true;
      deptChip.innerHTML = '';
      return;
    }
    deptChip.hidden = false;
    deptChip.innerHTML = `부서: ${state.department} <button type="button" id="dept-clear" aria-label="필터 해제">&times;</button>`;
    $('#dept-clear').addEventListener('click', () => {
      state.department = null;
      render();
    });
  }

  function countForDept(name) {
    return state.laws.filter((l) => (l.departments || []).some((d) => normalizeDept(d) === name)).length;
  }

  function countForNode(node) {
    if (!node.children) return countForDept(node.name);
    return node.children.reduce((sum, c) => sum + countForNode(c), 0);
  }

  function renderOrgNode(node) {
    if (!node.children) {
      const count = countForDept(node.name);
      const disabled = count === 0;
      return `<button type="button" class="org-leaf${disabled ? ' empty' : ''}" data-dept="${node.name}" ${disabled ? 'disabled' : ''}>
        <span>${node.name}</span><span class="count">${count}건</span>
      </button>`;
    }
    const total = countForNode(node);
    return `<details>
      <summary><span>${node.name}</span><span class="count">${total}건</span></summary>
      ${node.children.map(renderOrgNode).join('')}
    </details>`;
  }

  function renderOrgTree() {
    if (!state.org) return;
    orgTreeEl.innerHTML = state.org.map(renderOrgNode).join('');
    orgTreeEl.querySelectorAll('.org-leaf:not(.empty)').forEach((btn) => {
      btn.addEventListener('click', () => setDepartment(btn.dataset.dept));
    });
  }

  function switchView(mode) {
    viewModeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    searchView.hidden = mode !== 'search';
    orgView.hidden = mode !== 'org';
  }

  function render() {
    renderDeptChip();
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
        <p class="law-meta">${deptLabel(law)} · 시행일 ${formatDate(law.enforcementDate)}</p>
      `;
      li.addEventListener('click', () => openDetail(law));
      listEl.appendChild(li);
    }
  }

  async function openDetail(law) {
    overlay.hidden = false;
    detailTitle.textContent = law.name;
    detailMeta.textContent = `${law.categoryRaw || law.category} · ${deptLabel(law)} · 공포 ${formatDate(law.promulgationDate)} · 시행 ${formatDate(law.enforcementDate)}`;
    detailLink.href = law.detailLink || '#';
    renderRelatedTabs(law);
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

  function renderRelatedTabs(law) {
    const group = (state.groups && state.groups.get(baseName(law.name))) || [law];
    if (group.length <= 1) {
      relatedTabs.innerHTML = '';
      return;
    }
    const sorted = [...group].sort(
      (a, b) => (TIER_ORDER[a.category] ?? 99) - (TIER_ORDER[b.category] ?? 99)
    );
    relatedTabs.innerHTML = sorted
      .map((l) => {
        const isCurrent = l.mst === law.mst;
        return `<button type="button" class="related-tab${isCurrent ? ' current' : ''}" data-mst="${l.mst}">${l.category}</button>`;
      })
      .join('');
    relatedTabs.querySelectorAll('.related-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = sorted.find((l) => l.mst === btn.dataset.mst);
        if (target && target.mst !== law.mst) openDetail(target);
      });
    });
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
      .map((a) => {
        if (a.type === 'heading') {
          return `<p class="article-heading">${escapeHtml(a.text || '')}</p>`;
        }
        return `
        <div class="article">
          <p class="article-title">${a.title || `제${a.no}조`}</p>
          <p class="article-text">${escapeHtml(a.text || '')}</p>
        </div>`;
      })
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

  viewModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.mode));
  });

  closeBtn.addEventListener('click', closeDetail);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDetail();
  });

  loadIndex();
})();
