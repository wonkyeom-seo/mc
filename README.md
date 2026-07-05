# MC Control

Minecraft Java 서버를 브라우저에서 관리하는 로컬 웹앱입니다.

- 서버 상태, PID, 가동 시간 확인
- 서버 시작 및 안전 종료
- 실시간 콘솔과 명령어 입력
- 날짜별 콘솔 로그 영구 저장 및 이전 기록 조회
- Linux Java 프로세스 CPU/RSS 실시간 수집, 날짜별 저장 및 그래프 조회
- 서버 폴더 탐색, 텍스트 파일 열기 및 수정
- 파일 경로 이탈/심볼릭 링크 차단, 동시 수정 충돌 감지
- 선택적 관리자 토큰 인증

## 빠른 시작

필수 환경은 Node.js 18 이상과 Java입니다.

```powershell
npm install
Copy-Item .env.example .env
```

`minecraft` 폴더에 서버 JAR 파일을 `server.jar` 이름으로 넣습니다. 다른 위치나 이름을 사용하려면 `.env`의 `MC_SERVER_DIR`, `MC_SERVER_JAR`를 수정하세요.

처음 실행하는 Minecraft 서버라면 Mojang EULA에 동의한 뒤 `minecraft/eula.txt`를 다음과 같이 설정해야 합니다.

```text
eula=true
```

관리 앱을 실행합니다.

```powershell
npm start
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. 콘솔 기록은 `data/console/YYYY-MM-DD.jsonl`, 프로세스 메트릭은 `data/metrics/YYYY-MM-DD.jsonl`에 자동 저장됩니다.

## 주요 환경 설정

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 웹 서버 바인딩 주소 |
| `PORT` | `3000` | 웹 서버 포트 |
| `ADMIN_TOKEN` | 비어 있음 | 관리자 인증 토큰 |
| `MC_SERVER_DIR` | `./minecraft` | Minecraft 서버 폴더 |
| `MC_SERVER_JAR` | `server.jar` | 서버 JAR 이름 또는 절대 경로 |
| `MC_JAVA_COMMAND` | `java` | Java 실행 파일 |
| `MC_MEMORY_MIN` | `1G` | Java 최소 힙 |
| `MC_MEMORY_MAX` | `2G` | Java 최대 힙 |
| `MC_EXTRA_JAVA_ARGS` | `[]` | 추가 Java 인자(JSON 문자열 배열) |
| `MC_SERVER_ARGS` | `["--nogui","--nojline"]` | JAR 뒤에 전달할 서버 인자 |
| `MC_STOP_TIMEOUT_MS` | `30000` | 정상 종료 대기 시간 |
| `METRICS_INTERVAL_MS` | `5000` | Linux Java 프로세스 메트릭 저장 주기(최소 1000ms) |

LAN에서 다른 기기로 접속하려면 `HOST=0.0.0.0`으로 변경하고 긴 임의의 `ADMIN_TOKEN`을 반드시 설정하세요. 주소는 `http://서버-IP:3000`처럼 **HTTP를 명시해서** 접속하세요.

HTTP에서는 토큰이 암호화되지 않으므로 신뢰할 수 없는 네트워크나 인터넷에 직접 공개하지 마세요. 외부 공개가 필요하면 HTTPS를 제공하는 리버스 프록시와 방화벽을 함께 사용하세요. HTTPS를 종료하는 프록시는 `/`, `/api`, `/socket.io` 경로와 WebSocket 업그레이드를 모두 이 앱으로 전달해야 합니다. HSTS는 앱이 아니라 HTTPS 프록시에서 설정하세요.

Paper/CraftBukkit은 웹 관리 앱처럼 실제 터미널이 없는 환경에서 JLine 경고를 출력할 수 있습니다. 기본값의 `--nojline`이 JLine을 끄고 Vanilla 방식 콘솔을 사용하므로 웹 콘솔 기능에는 영향이 없습니다. `--nojline`을 지원하지 않는 Vanilla 계열 JAR이라면 `MC_SERVER_ARGS=["--nogui"]`로 변경하세요.

프로세스 메트릭 수집은 Linux의 `/proc/<pid>/stat`, `/proc/<pid>/status`를 사용합니다. CPU 값은 Java 프로세스가 사용한 코어의 합산 비율이므로 여러 코어를 동시에 사용하면 100%를 넘을 수 있습니다. 메모리는 실제 물리 메모리에 상주하는 RSS 기준입니다.

## 테스트

```powershell
npm test
```
