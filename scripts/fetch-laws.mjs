// 국가법령정보센터 Open API(open.law.go.kr / www.law.go.kr/DRF)에서
// 교육부 소관 법률·시행령·시행규칙 목록과 조문 본문을 가져와
// data/index.json, data/laws/<MST>.json 으로 저장한다.
//
// 실행 전 준비:
//   1) https://www.law.go.kr 회원가입 후 https://open.law.go.kr 에서 OpenAPI 사용신청 (승인 1~2일 소요)
//   2) 신청 시 등록한 이메일의 아이디 부분(예: abc@gmail.com -> abc)이 OC 값
//   3) 환경변수 LAW_API_OC 로 전달 (GitHub Actions에서는 secrets.LAW_API_OC)
//
// 주의: 법령 API의 실제 JSON 응답 필드명은 사전 계약값과 다를 수 있어
// normalizeLawEntry / extractArticles 는 여러 필드명 후보를 시도하도록 방어적으로 작성했다.
// 최초 실행 로그(console.warn)를 보고 실제 필드명이 다르면 이 부분만 맞춰 수정하면 된다.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const OC = process.env.LAW_API_OC;
if (!OC) {
  console.error('환경변수 LAW_API_OC 가 설정되어 있지 않습니다. (open.law.go.kr 신청 시 등록한 이메일 아이디)');
  process.exit(1);
}

const SEARCH_URL = 'https://www.law.go.kr/DRF/lawSearch.do';
const SERVICE_URL = 'https://www.law.go.kr/DRF/lawService.do';

// 정부 표준 기관코드(교육부) - 실제 API의 org 파라미터와 다를 경우 대비해
// 결과가 비어있으면 전체 목록을 페이징 조회 후 소관부처명으로 필터링하는 fallback을 사용한다.
const MOE_ORG_CODE = '1342000';
const MOE_NAME = '교육부';

const DATA_DIR = path.resolve('data');
const LAWS_DIR = path.join(DATA_DIR, 'laws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'moe-law-finder/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`JSON 파싱 실패 (응답 앞부분): ${text.slice(0, 200)}`);
      }
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

function buildSearchUrl({ page, org }) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('OC', OC);
  url.searchParams.set('target', 'law');
  url.searchParams.set('type', 'JSON');
  url.searchParams.set('display', '100');
  url.searchParams.set('page', String(page));
  if (org) url.searchParams.set('org', org);
  return url.toString();
}

function getListArray(json) {
  const root = json?.LawSearch ?? json?.lawSearch ?? json;
  if (!root) return [];
  const candidate = root.law ?? root.Law ?? root.laws;
  if (!candidate) return [];
  return Array.isArray(candidate) ? candidate : [candidate];
}

async function fetchAllPages({ org, maxPages }) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const json = await fetchJson(buildSearchUrl({ page, org }));
    const items = getListArray(json);
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < 100) break;
    await sleep(250);
  }
  return all;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

function normalizeLawEntry(raw) {
  const name = pick(raw, ['법령명한글', '법령명', 'lawNm']);
  const mst = pick(raw, ['법령일련번호', 'MST', 'mst']);
  const department = pick(raw, ['소관부처명', 'department']);
  const categoryRaw = pick(raw, ['법령구분명', 'category']) || '';
  const promulgationDate = pick(raw, ['공포일자', 'promulgationDate']);
  const enforcementDate = pick(raw, ['시행일자', 'enforcementDate']);
  const lawId = pick(raw, ['법령ID', 'lawId']);
  const apiLink = pick(raw, ['법령상세링크', 'detailLink']);

  let category = '기타';
  if (categoryRaw.includes('법률')) category = '법률';
  else if (categoryRaw.includes('대통령령')) category = '시행령';
  else if (categoryRaw.includes('총리령') || categoryRaw.includes('부령')) category = '시행규칙';

  const detailLink = apiLink
    ? (apiLink.startsWith('http') ? apiLink : `https://www.law.go.kr${apiLink}`)
    : `https://www.law.go.kr/법령/${encodeURIComponent(name ?? '')}`;

  return {
    id: lawId ?? mst,
    mst,
    name,
    category,
    categoryRaw,
    department,
    promulgationDate,
    enforcementDate,
    detailLink,
  };
}

// 조문 JSON 실제 구조(law.go.kr lawService.do 응답 확인 결과):
//   법령.조문.조문단위[] = { 조문번호, 조문제목?, 조문내용, 항?: {...} | [...] }
//   항 = { 항내용, 호?: {...} | [...] }
//   호 = { 호내용, 목?: {...} | [...] }
//   목 = { 목내용 }
// 항/호/목은 1개뿐이면 배열이 아닌 단일 객체로 오는 경우가 있어 항상 배열로 감싸 순회한다.
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function walkMok(mok, lines) {
  for (const m of asList(mok)) {
    if (m?.목내용) lines.push(m.목내용.trim());
  }
}

function walkHo(ho, lines) {
  for (const h of asList(ho)) {
    if (h?.호내용) lines.push(h.호내용.trim());
    if (h?.목) walkMok(h.목, lines);
  }
}

function walkHang(hang, lines) {
  for (const h of asList(hang)) {
    if (h?.항내용) lines.push(h.항내용.trim());
    if (h?.호) walkHo(h.호, lines);
  }
}

function formatJoText(jo) {
  const lines = [];
  if (jo?.조문내용) lines.push(jo.조문내용.trim());
  if (jo?.항) walkHang(jo.항, lines);
  return lines.join('\n');
}

function extractArticles(json) {
  const root = json?.법령 ?? json?.Law ?? json;
  const joMok = root?.조문?.조문단위 ?? root?.조문 ?? null;
  if (!joMok) return [];
  return asList(joMok)
    .map((jo) => {
      const no = pick(jo, ['조문번호', '조번호']);
      const title = pick(jo, ['조문제목', '조제목']) || '';
      const text = formatJoText(jo);
      if (!no && !text) return null;
      return { no, title, text };
    })
    .filter(Boolean);
}

async function fetchArticles(mst) {
  const url = new URL(SERVICE_URL);
  url.searchParams.set('OC', OC);
  url.searchParams.set('target', 'law');
  url.searchParams.set('type', 'JSON');
  url.searchParams.set('MST', String(mst));
  const json = await fetchJson(url.toString());
  return extractArticles(json);
}

async function main() {
  console.log('교육부 소관 법령 목록 조회 중...');
  let raw = await fetchAllPages({ org: MOE_ORG_CODE, maxPages: 20 });
  raw = raw.filter((r) => (pick(r, ['소관부처명', 'department']) || '').includes(MOE_NAME));

  if (raw.length === 0) {
    console.warn(`org=${MOE_ORG_CODE} 로 결과가 없어 전체 목록을 조회 후 소관부처명으로 필터링합니다 (시간이 더 걸립니다).`);
    const all = await fetchAllPages({ org: null, maxPages: 80 });
    raw = all.filter((r) => (pick(r, ['소관부처명', 'department']) || '').includes(MOE_NAME));
  }

  if (raw.length === 0) {
    console.error('교육부 소관 법령을 찾지 못했습니다. API 응답 구조를 확인해야 합니다.');
    process.exit(1);
  }

  const laws = raw.map(normalizeLawEntry).filter((l) => l.name && l.mst);
  console.log(`총 ${laws.length}건 (법률/시행령/시행규칙) 발견`);

  await mkdir(LAWS_DIR, { recursive: true });

  const index = [];
  let articlesFetched = 0;
  let articlesFailed = 0;

  for (const law of laws) {
    let articles = [];
    try {
      articles = await fetchArticles(law.mst);
      if (articles.length > 0) articlesFetched++;
    } catch (err) {
      articlesFailed++;
      console.warn(`조문 조회 실패: ${law.name} (MST=${law.mst}) - ${err.message}`);
    }
    await writeFile(
      path.join(LAWS_DIR, `${law.mst}.json`),
      JSON.stringify({ ...law, articles }, null, 2),
      'utf-8'
    );
    index.push({ ...law, hasArticles: articles.length > 0 });
    await sleep(200);
  }

  index.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  await writeFile(
    path.join(DATA_DIR, 'index.json'),
    JSON.stringify(
      { updatedAt: new Date().toISOString(), count: index.length, laws: index },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`완료: 목록 ${index.length}건, 조문 확보 ${articlesFetched}건, 조문 실패 ${articlesFailed}건`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
