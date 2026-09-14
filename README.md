# 교육부 법령 찾기

교육부 소관 법률·시행령·시행규칙을 검색·열람할 수 있는 정적 웹사이트입니다.
국가법령정보센터(law.go.kr) Open API에서 주기적으로 데이터를 가져와 정적 JSON으로 저장하고,
빌드 과정 없는 순수 HTML/CSS/JS로 GitHub Pages에 배포합니다. 서버나 API 키 노출 없이
모바일 브라우저에서 바로 볼 수 있습니다.

## 동작 방식

```
GitHub Actions (매주 1회, 또는 수동 실행)
   └─ scripts/fetch-laws.mjs
        └─ law.go.kr Open API 호출 (OC 인증)
             └─ data/index.json, data/laws/<MST>.json 갱신 후 자동 커밋
GitHub Pages
   └─ index.html + assets/app.js 가 data/*.json 을 읽어 검색 화면 렌더링
```

## 처음 설정하는 방법

### 1. 국가법령정보 Open API 사용 신청 (OC 값 발급)

1. https://www.law.go.kr 회원가입
2. https://open.law.go.kr 접속 → OpenAPI 사용 신청 (승인까지 1~2일 소요)
3. 승인 후, **가입 시 등록한 이메일의 @ 앞부분**이 API 인증에 쓰이는 `OC` 값입니다.
   (예: 가입 이메일이 `abc@gmail.com` 이면 `OC=abc`)

### 2. GitHub 저장소 시크릿 등록

저장소 Settings → Secrets and variables → Actions → New repository secret

- Name: `LAW_API_OC`
- Value: 위에서 확인한 OC 값

### 3. GitHub Pages 활성화

저장소 Settings → Pages → Build and deployment
- Source: `Deploy from a branch`
- Branch: `main` / `/(root)`

저장 후 몇 분 뒤 `https://<계정명>.github.io/<저장소명>/` 주소로 접속할 수 있습니다.
휴대폰 브라우저에서 접속 후 "홈 화면에 추가"를 하면 앱처럼 사용할 수 있습니다.

### 4. 데이터 최초 수집 실행

Actions 탭 → "Update law data" 워크플로 → **Run workflow** 를 눌러 수동 실행하면
`data/index.json`, `data/laws/*.json` 이 실제 데이터로 채워지고 자동 커밋됩니다.
이후에는 매주 월요일 자동으로 갱신됩니다.

## 로컬에서 데이터 수집 테스트

```bash
LAW_API_OC=본인의OC값 node scripts/fetch-laws.mjs
```

윈도우 PowerShell:

```powershell
$env:LAW_API_OC="본인의OC값"; node scripts/fetch-laws.mjs
```

## 로컬에서 화면 미리보기

정적 파일이라 아무 웹서버로나 열면 됩니다.

```bash
npx serve .
# 또는
python -m http.server 8080
```

## 알아둘 점 (v1 한계)

- `scripts/fetch-laws.mjs` 는 law.go.kr 응답의 조문 JSON 구조를 방어적으로 파싱하도록
  작성했지만, 실제 OC 키로 처음 실행했을 때 필드명이 예상과 다르면 조문 본문이 비어있을 수
  있습니다. 이 경우 각 법령 카드의 "국가법령정보센터에서 원문 보기" 링크로 원문을 확인할 수
  있고, 실제 응답을 같이 보고 파싱 로직을 보정하면 됩니다.
- 현재는 법령명 검색 + 개별 법령 안의 조문 검색만 지원합니다. 모든 법령의 조문 전체를
  가로지르는 통합 본문 검색은 데이터 용량 문제로 후속 작업으로 남겨두었습니다.
- `org` 파라미터(교육부 코드 `1342000`)로 필터링을 시도하고, 결과가 없으면 전체 법령을
  훑어 소관부처명이 "교육부"인 항목만 남기는 fallback이 동작합니다.
