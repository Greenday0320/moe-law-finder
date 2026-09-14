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

  let category = '기타';
  if (categoryRaw.includes('법률')) category = '법률';
  else if (categoryRaw.includes('대통령령')) category = '시행령';
  else if (categoryRaw.includes('총리령') || categoryRaw.includes('부령')) category = '시행규칙';

  // API의 "법령상세링크" 필드는 OC 인증키가 그대로 박힌 내부 DRF API 주소라
  // 일반 사용자에게 노출하면 안 되고 권한도 없으면 접근이 막힌다.
  // 대신 일반인이 보는 국가법령정보센터 공개 페이지 주소(lsiSeq=법령일련번호)를 사용한다.
  const detailLink = `https://www.law.go.kr/lsInfoP.do?lsiSeq=${mst}`;

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

// 항내용/호내용/목내용 등은 보통 문자열이지만, 줄바꿈이 있는 경우 문자열 배열로
// 오기도 해서 두 형태 모두 안전하게 하나의 문자열로 합친다.
function textOf(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('\n').trim();
  if (typeof v === 'string') return v.trim();
  return String(v).trim();
}

function walkMok(mok, lines) {
  for (const m of asList(mok)) {
    const t = textOf(m?.목내용);
    if (t) lines.push(t);
  }
}

function walkHo(ho, lines) {
  for (const h of asList(ho)) {
    const t = textOf(h?.호내용);
    if (t) lines.push(t);
    if (h?.목) walkMok(h.목, lines);
  }
}

function walkHang(hang, lines) {
  for (const h of asList(hang)) {
    const t = textOf(h?.항내용);
    if (t) lines.push(t);
    if (h?.호) walkHo(h.호, lines);
  }
}

function formatJoText(jo) {
  const lines = [];
  const t = textOf(jo?.조문내용);
  if (t) lines.push(t);
  if (jo?.항) walkHang(jo.항, lines);
  return lines.join('\n');
}

// 조문단위 배열에는 실제 조문 외에 "제1장 총칙" 같은 장/절 구분 항목도 섞여 있다.
// 이런 구분 항목은 조문여부가 "조문"이 아니고(보통 "전문"), 조문번호가 실제 조문과
// 우연히 같은 값(주로 "1")을 가져서 구분 없이 두면 "제1조"가 두 번 나온 것처럼 보인다.
function extractArticles(json) {
  const root = json?.법령 ?? json?.Law ?? json;
  const joMok = root?.조문?.조문단위 ?? root?.조문 ?? null;
  if (!joMok) return [];
  return asList(joMok)
    .map((jo) => {
      const no = pick(jo, ['조문번호', '조번호']);
      const title = pick(jo, ['조문제목', '조제목']) || '';
      const text = formatJoText(jo);
      const type = jo?.조문여부 === '조문' ? 'article' : 'heading';
      if (!no && !text) return null;
      return { no, title, text, type };
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
  const failedLaws = [];
  let articlesFetched = 0;

  for (const law of laws) {
    let articles = [];
    try {
      articles = await fetchArticles(law.mst);
      if (articles.length > 0) articlesFetched++;
      else failedLaws.push(law);
    } catch (err) {
      failedLaws.push(law);
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

  // 첫 시도에서 실패한 항목은 API 서버의 일시적 오류일 가능성이 높아
  // 잠시 대기 후 한 번 더 재시도한다.
  if (failedLaws.length > 0) {
    console.log(`1차 실패 ${failedLaws.length}건 재시도 중...`);
    await sleep(3000);
    for (const law of failedLaws) {
      try {
        const articles = await fetchArticles(law.mst);
        if (articles.length > 0) {
          articlesFetched++;
          await writeFile(
            path.join(LAWS_DIR, `${law.mst}.json`),
            JSON.stringify({ ...law, articles }, null, 2),
            'utf-8'
          );
          const entry = index.find((l) => l.mst === law.mst);
          if (entry) entry.hasArticles = true;
        }
      } catch (err) {
        console.warn(`재시도 실패: ${law.name} (MST=${law.mst}) - ${err.message}`);
      }
      await sleep(300);
    }
  }

  const articlesFailed = index.filter((l) => !l.hasArticles).length;

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
