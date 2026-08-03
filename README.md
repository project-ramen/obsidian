# Ramen

Obsidian vault의 마크다운 파일을 [Ramen 블로그 서버](https://github.com/project-ramen/ramen)와 동기화하는 Obsidian 플러그인.

- 파일 저장 시 500ms 디바운스 후 자동 push
- 파일 이름 변경/삭제도 감지해서 반영
- 시작 시 연결된 블로그 전체 동기화

## 사용 방법

1. 설정(Settings) → Ramen 탭에서 블로그 URL과 비밀번호를 입력해 **Connect**.
2. vault 폴더 하나를 해당 블로그의 root로 지정 (`rootFolder`). 그 아래 마크다운 파일이 동기화 대상.
3. 파일을 저장하면 자동으로 서버에 반영됨. 파일 탐색기에서 공개된 글은 `✓`, 업로드만 되고 비공개인 글은 `●`로 표시.

## 명령어 (Command Palette)

| 명령어 | 설명 |
|---|---|
| 이미지 삽입 | 커서 위치에 이미지를 삽입 |
| 전체 댓글 보기 (블로그별 그룹) | 연결된 블로그들의 댓글을 모아서 확인 |
| 블로그에 포스트 동기화 | 연결된 블로그 전체를 즉시 동기화 |
| 블로그 재연결 | 연결이 끊긴 블로그를 다시 연결 |
| 블로그에서 포스트 가져오기 | 서버에 있는 포스트를 vault로 pull |

## 파일 우클릭 메뉴

블로그 root 폴더 안의 `.md` 파일을 우클릭하면:

- **공개로 전환** / **비공개로 전환** — `published` 상태 토글
- **블로그에서 제거** — 서버에서 삭제 처리

## 개발

```bash
bun install
bun run dev    # watch 모드로 main.ts → main.js 컴파일
bun run build  # 타입 체크 + production 빌드
bun run lint   # eslint
```

로컬 테스트는 이 저장소(또는 빌드 결과물)를 vault의 `.obsidian/plugins/ramen/`에 두고 Obsidian에서 플러그인을 활성화하면 됩니다.

## 릴리즈

버전 태그(`git tag x.y.z && git push --tags`)를 push하면 GitHub Actions가 lint 통과 후 `main.js`, `manifest.json`, `styles.css`를 첨부해 자동으로 릴리즈를 생성합니다 (`.github/workflows/release.yml`).
