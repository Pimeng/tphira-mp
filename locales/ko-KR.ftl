
create-id-occupied = 방 ID가 이미 사용 중입니다

join-game-ongoing = 게임이 진행 중입니다
join-room-full = 방이 가득 찼습니다
join-room-locked = 방이 잠겨 있습니다
join-cant-monitor = 권한이 없습니다. 이 방을 관전할 수 없습니다.

start-no-chart-selected = 선택된 채보가 없습니다

http-not-found = 찾을 수 없음
http-internal-error = 내부 오류
http-rate-limited = 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요

bad-enabled = enabled 파라미터가 없습니다
auth-unauthorized = 인증되지 않음
token-expired = 토큰이 만료되었습니다
admin-disabled = 관리자 기능이 비활성화되어 있습니다
otp-disabled-when-token-configured = 관리자 토큰이 설정되어 있어 OTP가 비활성화되었습니다
bad-request = 잘못된 요청
invalid-or-expired-session = 세션이 유효하지 않거나 만료되었습니다
ip-mismatch = IP 주소가 일치하지 않습니다
pending-approval = 승인 대기 중
approval-denied = 승인이 거부되었습니다
token-not-issued = 토큰이 발급되지 않았습니다
ip-banned-too-many-attempts = 시도 횟수가 너무 많아 해당 IP가 차단되었습니다
ssid-banned-too-many-attempts = 시도 횟수가 너무 많아 해당 세션이 차단되었습니다
invalid-or-expired-otp = OTP가 유효하지 않거나 만료되었습니다
bad-token = 토큰은 비워 둘 수 없습니다
upload-failed = 업로드 실패
share-station-not-configured = 공유 스테이션이 설정되지 않았습니다
upload-success = 업로드 성공
user-must-be-disconnected = 사용자는 연결이 끊긴 상태여야 합니다
user-not-in-room = 사용자가 방에 없습니다
cannot-move-while-playing = 플레이 중에는 사용자를 이동할 수 없습니다
target-room-not-idle = 대상 방이 대기 상태가 아닙니다

cli-invalid-port = 잘못된 포트 번호
cli-invalid-http-service = 잘못된 HTTP 서비스 플래그
cli-invalid-http-port = 잘못된 HTTP 포트 번호
cli-invalid-room-max-users = 잘못된 ROOM_MAX_USERS
cli-invalid-monitors = 잘못된 MONITORS

label-monitor-suffix = （관전자）
replay-recorder-name = 리플레이 레코더

chat-welcome = "{ $userName }"님, 안녕하세요! { $serverName }에 오신 것을 환영합니다!
chat-welcome-version = 서버 버전: { $version }
chat-hitokoto = { $quote } —— { $from }
chat-hitokoto-from-unknown = 작자 미상
chat-roomlist-title = 사용 가능한 방:
chat-roomlist-empty = 사용 가능한 방이 없습니다
chat-roomlist-item = { $id }（{ $count }/{ $max }）
chat-disabled-by-server = 안전 문제를 방지하기 위해 이 서버에서는 채팅이 비활성화되어 있습니다.

chat-game-summary =
    경기 요약:
    { $scoreText }
    { $accText }
    { $stdText }
chat-game-summary-score = 최고 점수: "{ $name } "({ $id }) { $score }
chat-game-summary-acc = 최고 정확도: "{ $name } "({ $id }) { $acc }
chat-game-summary-std = 최고 안정도: "{ $name } "({ $id }) { $std }ms

auth-invalid-token = 잘못된 토큰
auth-fetch-me-failed = 사용자 정보를 가져오지 못했습니다
auth-failed = 인증 실패
auth-invalid-response = 잘못된 인증 응답
auth-invalid-user-id = 인증 응답의 사용자 ID가 잘못되었습니다
auth-invalid-user-name = 인증 응답의 사용자 이름이 잘못되었습니다
auth-repeated-authenticate = 중복 인증
user-banned-by-server = 이 서버에서 차단되어 어떠한 작업도 수행할 수 없습니다.

room-already-in-room = 이미 방에 있습니다
room-creation-disabled = 방 생성이 관리자에 의해 비활성화되었습니다
rooms-limit-reached = 서버 방 수가 한도에 도달했습니다. 나중에 다시 시도해 주세요
room-not-found = 방을 찾을 수 없습니다
room-no-room = 방에 있지 않습니다
room-banned = 방 { $id }에서 차단되었습니다
room-not-whitelisted = 이 방의 화이트리스트에 등록되어 있지 않습니다
room-only-host = 방장만 이 작업을 수행할 수 있습니다
room-invalid-state = 방 상태가 잘못되었습니다
room-already-ready = 이미 준비됨
room-not-ready = 준비되지 않음
room-game-aborted = 게임이 중단되었습니다

record-invalid = 잘못된 기록
record-already-uploaded = 기록이 이미 업로드되었습니다
record-fetch-failed = 기록을 가져오지 못했습니다
record-chart-mismatch = 기록이 현재 차트와 일치하지 않습니다

command-rate-limited = 요청이 너무 많습니다. 잠시 후 다시 시도하세요

chart-fetch-failed = 채보를 가져오지 못했습니다

server-maintenance = 서버가 점검 중이라 지금은 참가할 수 없습니다
log-auth-rejected-maintenance = 점검 모드: 새 연결 "{ $user }"을(를) 거부했습니다
chat-maintenance-enabled = ⚙️ 서버가 점검 모드로 전환되어 신규 참가가 중단됩니다. 현재 게임을 곧 마쳐 주세요
chat-maintenance-disabled = ✅ 서버 점검이 끝나 정상으로 돌아왔습니다
chat-server-stopping = ⚠️ 서버가 곧 점검을 위해 종료됩니다. 현재 게임이 끝나면 연결이 끊깁니다
chat-waiting-reconnect = ⏳ "{ $user }" 님의 연결이 끊겼습니다. 재접속을 기다리는 중이며, { $seconds }초 내에 돌아오지 않으면 대국을 종료합니다
cli-maintenance-status = 점검 모드: { $state }
cli-usage-maintenance = 사용법: maintenance <on|off|status> [안내 메시지]

net-connection-closed = 연결이 닫혔습니다
net-send-timeout = 전송 시간 초과
net-unsupported-protocol-version = 지원되지 않는 프로토콜 버전: { $version }

roomid-empty = 방 ID는 비워 둘 수 없습니다
roomid-too-long = 방 ID가 너무 깁니다
roomid-invalid = 잘못된 방 ID

frame-invalid-length = 잘못된 길이
frame-invalid-length-prefix = 잘못된 길이 접두사
frame-payload-too-large = 페이로드가 너무 큽니다

binary-unexpected-eof = 예기치 않은 EOF
binary-length-too-large = 길이가 너무 큽니다
binary-string-too-long = 문자열이 너무 깁니다

proto-roomstate-tag-invalid = 잘못된 RoomState 태그
proto-users-key-missing = users 키가 없습니다
proto-message-tag-invalid = 잘못된 Message 태그
proto-clientcommand-tag-invalid = 잘못된 ClientCommand 태그
proto-servercommand-tag-invalid = 잘못된 ServerCommand 태그

client-not-connected = 연결되지 않음
client-ping-in-flight = 이전 ping이 아직 완료되지 않았습니다
client-heartbeat-timeout = 하트비트 시간 초과
client-timeout = 시간 초과

log-new-connection = 새 연결. id={ $id }, remote={ $remote }
log-handshake-ok = 핸드셰이크 성공. id={ $id }, version="{ $version }"
log-handshake-failed = 핸드셰이크 실패. id={ $id }, reason={ $reason }

log-server-version = 서버 버전 { $version }
log-runtime-env = 런타임 { $platform } node{ $node }
log-server-listen = { $addr }에서 수신 대기 중
log-http-listen = HTTP가 { $addr }에서 수신 대기 중
log-server-name = 서버 이름 { $name }
log-server-stopped = 서버가 중지되었습니다

log-heartbeat-timeout-disconnect = 하트비트 시간 초과. 연결을 끊습니다 (id={ $id })
log-auth-ok = 인증 성공. id={ $id }, user="{ $user }"{ $monitorSuffix }, proto="{ $version }"
log-auth-failed = 인증 실패. id={ $id }, reason={ $reason }

log-player-join = 플레이어 { $user }({ $id }){ $monitorSuffix } 서버에 접속했습니다

log-disconnect = 연결 끊김. id={ $id }{ $who }
log-disconnect-user = , user="{ $user }"

log-user-disconnect-playing = "{ $user }"가 플레이 중 연결이 끊겨 방 "{ $room }"에서 강제 퇴장했습니다
log-room-recycled = 방 "{ $room }" 회수됨 (비어 있음)
log-user-dangle = "{ $user }"의 연결이 끊겨 재연결을 기다리는 중입니다
log-user-dangle-timeout-remove = "{ $user }"의 재연결 시간이 초과되어 제거되고 방 "{ $room }"에서 퇴장했습니다

log-user-chat = "{ $user }"가 방 "{ $room }"에서 채팅을 보냈습니다
log-user-touches = "{ $user }"가 방 "{ $room }"에서 { $count }개의 터치 프레임을 보고했습니다
log-user-judges = "{ $user }"가 방 "{ $room }"에서 { $count }개의 판정 이벤트를 보고했습니다

log-room-created = "{ $user }"가 방 "{ $room }"을 생성했습니다
log-room-joined = "{ $user }"{ $suffix }가 방 "{ $room }"에 입장했습니다
log-room-left = "{ $user }"{ $suffix }가 방 "{ $room }"에서 퇴장했습니다

log-msg-create-room = { $user }가 방을 생성했습니다
log-msg-join-room = { $name }가 방에 입장했습니다
log-msg-leave-room = { $name }가 방에서 퇴장했습니다
log-msg-new-host = { $user }가 새 방장이 되었습니다
log-msg-select-chart = 방장 { $user }가 채보 { $name } (#{ $id })를 선택했습니다
log-msg-game-start = 방장 { $user }가 게임을 시작했습니다, 준비해 주세요
log-msg-ready = { $user }가 준비되었습니다
log-msg-cancel-ready = { $user }가 준비를 취소했습니다
log-msg-cancel-game = { $user }가 게임을 취소했습니다
log-msg-start-playing = 게임 시작
log-msg-played = { $user }가 플레이를 마쳤습니다: { $score } ({ $acc }%){ $fc ->
    [true] , FC
   *[false] {""}
}
log-msg-game-end = 게임 종료
log-msg-abort = { $user }가 게임을 중단했습니다
log-msg-lock-room = { $lock ->
    [true] 방이 잠겼습니다
   *[false] 방 잠금이 해제되었습니다
}
log-msg-cycle-room = { $cycle ->
    [true] 방 순환 모드가 활성화되었습니다
   *[false] 방 순환 모드가 비활성화되었습니다
}

log-room-lock = "{ $user }"가 방 "{ $room }"을 { $lock ->
    [true] 잠갔습니다
   *[false] 잠금 해제했습니다
  }

log-room-cycle = "{ $user }"가 방 "{ $room }"의 방장 순환을 { $cycle ->
    [true] 활성화했습니다
   *[false] 비활성화했습니다
  }

log-room-select-chart = "{ $user }"(id={ $userId })가 방 "{ $room }"에서 "{ $chart }"를 선택했습니다
log-room-request-start = "{ $user }"가 방 "{ $room }"에서 시작을 요청했습니다
log-room-ready = "{ $user }"가 방 "{ $room }"에서 준비되었습니다
log-room-cancel-game = "{ $user }"가 방 "{ $room }"에서 게임을 취소했습니다
log-room-cancel-ready = "{ $user }"가 방 "{ $room }"에서 준비를 취소했습니다
log-room-played = "{ $user }"가 방 "{ $room }"에서 기록을 업로드했습니다 (score={ $score }, acc={ $acc })
log-room-abort = "{ $user }"가 방 "{ $room }"에서 게임을 중단했습니다

log-room-host-changed-offline = 방 "{ $room }" 방장 변경 (오프라인): { $old } -> { $next }
log-room-game-start = 방 "{ $room }" 게임 시작. users: { $users }{ $monitorsSuffix }
log-room-game-start-monitors = , monitors: { $monitors }
log-room-game-end = 방 "{ $room }" 게임 종료 (uploaded={ $uploaded }, aborted={ $aborted })
log-contest-game-results = 대회 방 "{ $room }" 결과: chart={ $chart } results={ $results } aborted={ $aborted }
log-room-host-changed-cycle = 방 "{ $room }" 방장 변경 (순환): { $old } -> { $next }

log-admin-broadcast = 관리자 브로드캐스트: { $message } ({ $rooms }개 방에 전송)
log-gui-console-command = GUI 콘솔 명령 실행: { $command }
log-gui-http-forced = GUI가 활성화되어 HTTP 서비스가 자동으로 켜졌습니다
log-gui-window-launched = GUI 창이 열렸습니다: { $url }
log-gui-window-failed = GUI 창을 자동으로 열 수 없습니다. 로컬 브라우저에서 여세요: { $url }
log-admin-room-message = 관리자가 방 "{ $room }"에 메시지를 보냈습니다: { $message }
log-room-disbanded-by-admin = 방 "{ $room }"가 관리자에 의해 해산되었습니다

room-disbanded-by-admin = 방이 관리자에 의해 해산되었습니다

log-websocket-connected = WebSocket 클라이언트가 연결됨, 총 연결 수: { $total }
log-websocket-disconnected = WebSocket 클라이언트가 연결 해제됨, 총 연결 수: { $total }

# ====== CLI 콘솔 ======

cli-bad-user-id = 잘못된 사용자 ID
cli-bad-room-id = 잘못된 방 ID
cli-message-empty = 메시지는 비워 둘 수 없습니다
cli-message-too-long = 메시지가 너무 깁니다 (최대 { $max }자)

cli-stop-hint = Ctrl+C로 서버를 중지합니다
cli-stopping = 서버를 종료하는 중입니다. 잠시만 기다려 주세요……
locales-fetched = { $count }개의 언어 파일을 온라인으로 가져왔습니다
locales-override-applied = locales/{ $lang }.ftl 재정의를 적용했습니다 ({ $count }개 키)
config-auto-created = 설정 파일을 찾을 수 없어 기본 설정을 생성했습니다: { $path } (수정 후 재시작하면 적용됩니다)
http-admin-token-missing = HTTP 서비스가 활성화되었지만 ADMIN_TOKEN이 설정되지 않아 모든 /admin 엔드포인트가 거부됩니다. CLI의 pending / approve로 임시 권한을 부여하거나 설정에서 ADMIN_TOKEN을 지정하세요.
cli-unknown-command = 알 수 없는 명령: { $cmd }. 'help'를 입력하여 사용 가능한 명령을 확인하세요
cli-command-failed = 명령 실패: { $reason }

cli-help =

    === Phira MP Server Commands ===
    help                          - 이 도움말 표시
    list, rooms                   - 모든 방 목록
    users                         - 모든 온라인 사용자 목록
    user <id>                     - 사용자 정보 보기
    kick <userId> [preserve]      - 사용자 강퇴 (preserve=true로 방 자리 유지)
    ban <userId>                  - 서버에서 사용자 차단
    unban <userId>                - 사용자 차단 해제
    banlist                       - 차단 목록 보기
    banroom <userId> <roomId>     - 방에서 사용자 차단
    unbanroom <userId> <roomId>   - 방 차단 해제
    broadcast <message>           - 메시지 브로드캐스트
    say <message>                 - 브로드캐스트 (broadcast 별칭)
    roomsay <roomId> <message>    - 방에 메시지 전송
    maxusers <roomId> <count>     - 방 최대 인원 설정
    disband <roomId>              - 방 해산
    replay <on|off|status>        - 리플레이 녹화 전환
    roomcreation <on|off|status>  - 방 생성 전환
    maintenance <on|off|status> [메시지]  - 점검 모드 전환 (신규 참가 중단)
    contest <roomId> <subcommand> - 대회 방 관리
      contest <roomId> enable [userIds...]    - 대회 모드 활성화
      contest <roomId> disable                - 대회 모드 비활성화
      contest <roomId> whitelist <userIds...> - 화이트리스트 설정
      contest <roomId> start [force]          - 대회 시작
    ipblacklist <list|remove|clear> - IP 블랙리스트 관리
    pending                       - 대기 중인 모든 CLI 권한 상승 요청 목록
    approve <ssid>                - CLI 권한 상승 요청을 승인하고 임시 TOKEN 발급 (ssid 접두사 지원)
    deny <ssid>                   - CLI 권한 상승 요청 거부 (ssid 접두사 지원)
    stop, shutdown                - 서버를 정상적으로 종료

cli-no-rooms = 현재 방이 없습니다
cli-rooms-total = 총 방 수: { $count }
cli-room-line = [{ $id }] { $state } | 플레이어: { $users }/{ $maxUsers } | 관전: { $monitors } | 채보: { $chart } | 잠금: { $locked } | 순환: { $cycle } | 대회: { $contest }

cli-no-users = 온라인 사용자가 없습니다
cli-users-total = 총 사용자 수: { $count }
cli-user-line = [{ $id }] { $name } | { $status } | { $role } | 방: { $room }{ $bannedTag }
cli-user-status-online = 온라인
cli-user-status-offline = 오프라인
cli-user-role-monitor = 관전자
cli-user-role-player = 플레이어
cli-user-banned-tag =  [차단됨]
cli-none = 없음
cli-yes = 예
cli-no = 아니오
cli-state-on = 활성화
cli-state-off = 비활성화
cli-room-state-playing = 플레이 중
cli-room-state-waiting = 준비 대기
cli-room-state-select = 채보 선택
cli-bool-yes = 예
cli-bool-no = 아니오

cli-usage-user = 사용법: user <userId>
cli-usage-kick = 사용법: kick <userId> [preserve]
cli-usage-ban = 사용법: ban <userId>
cli-usage-unban = 사용법: unban <userId>
cli-usage-banroom = 사용법: banroom <userId> <roomId>
cli-usage-unbanroom = 사용법: unbanroom <userId> <roomId>
cli-usage-broadcast = 사용법: broadcast <message>
cli-usage-roomsay = 사용법: roomsay <roomId> <message>
cli-usage-maxusers = 사용법: maxusers <roomId> <count>
cli-usage-disband = 사용법: disband <roomId>
cli-usage-replay = 사용법: replay <on|off|status>
cli-usage-roomcreation = 사용법: roomcreation <on|off|status>
cli-usage-contest = 사용법: contest <roomId> <enable|disable|whitelist|start>
cli-usage-ipblacklist = 사용법: ipblacklist <list|remove|clear>
cli-usage-ipblacklist-remove = 사용법: ipblacklist remove <ip>

cli-user-not-found = 사용자를 찾을 수 없음: { $id }
cli-user-info-header = 사용자 정보:
cli-user-info-id =   ID: { $id }
cli-user-info-name =   이름: { $name }
cli-user-info-status =   상태: { $status }
cli-user-info-role =   역할: { $role }
cli-user-info-room =   방: { $room }
cli-user-info-banned =   차단: { $banned }
cli-user-info-game-time =   플레이 시간: { $time }
cli-user-info-language =   언어: { $lang }

cli-user-not-connected = 사용자가 연결되지 않음: { $id }
cli-user-kicked = 사용자 강퇴됨: { $id }
cli-user-banned = 사용자 차단됨: { $id }
cli-user-unbanned = 사용자 차단 해제됨: { $id }
cli-no-banned-users = 차단된 사용자가 없습니다
cli-banned-list-header = 차단된 사용자 ({ $count }명):
cli-room-user-banned = 사용자 { $userId }를 방 { $room }에서 차단했습니다
cli-room-user-unbanned = 사용자 { $userId }의 방 { $room } 차단을 해제했습니다
cli-broadcast-sent = { $count }개 방에 브로드캐스트했습니다
cli-room-not-found = 방을 찾을 수 없습니다
cli-room-not-found-named = 방을 찾을 수 없음: { $room }
cli-room-message-sent = 방 { $room }에 메시지를 보냈습니다
cli-bad-max-users = 잘못된 인원 수 (1-64)
cli-room-max-users-set = 방 { $room }의 최대 인원을 { $count }로 설정했습니다
cli-room-disbanded = 방 { $room }를 해산했습니다

cli-replay-status = 리플레이 녹화: { $state }
cli-replay-toggled-on = 리플레이 녹화가 활성화되었습니다
cli-replay-toggled-off = 리플레이 녹화가 비활성화되었습니다
cli-room-creation-status = 방 생성: { $state }
cli-room-creation-toggled-on = 방 생성이 활성화되었습니다
cli-room-creation-toggled-off = 방 생성이 비활성화되었습니다

cli-contest-enabled = 방 { $room }의 대회 모드를 활성화했습니다
cli-contest-disabled = 방 { $room }의 대회 모드를 비활성화했습니다
cli-contest-no-user-id = 사용자 ID를 하나 이상 입력하세요
cli-contest-not-enabled = 방을 찾을 수 없거나 대회 모드가 활성화되지 않았습니다
cli-contest-whitelist-updated = 방 { $room }의 화이트리스트를 업데이트했습니다
contest-room-not-found = 대회 방을 찾을 수 없습니다
room-not-waiting = 방이 준비 대기 상태가 아닙니다
no-chart-selected = 선택된 채보가 없습니다
not-all-ready = 모든 플레이어가 준비되지 않았습니다
cli-contest-cannot-start = 대회를 시작할 수 없습니다: { $reason }
cli-contest-started = 방 { $room }의 대회를 시작했습니다
cli-contest-unknown-subcommand = 알 수 없는 하위 명령. 사용 가능: enable, disable, whitelist, start

cli-blacklist-empty = IP 블랙리스트가 비어 있습니다
cli-blacklist-header = IP 블랙리스트 ({ $count }개):
cli-blacklist-line =   { $ip } ({ $minutes }분 후 만료)
cli-blacklist-removed = 블랙리스트에서 제거됨: { $ip }
cli-blacklist-cleared = IP 블랙리스트를 비웠습니다
cli-ipblacklist-unknown-subcommand = 알 수 없는 하위 명령. 사용 가능: list, remove, clear

cli-usage-approve = 사용법: approve <ssid> (전체 ssid 또는 접두사 단축 코드)
cli-usage-deny = 사용법: deny <ssid> (전체 ssid 또는 접두사 단축 코드)
cli-approve-not-found = 일치하는 권한 상승 요청을 찾을 수 없음: { $input }
cli-approve-ambiguous = 단축 코드 { $input }가 여러 권한 상승 요청과 일치합니다. 더 긴 접두사를 사용하세요
cli-approve-expired = 권한 상승 요청 { $ssid }가 만료되었습니다
cli-approve-already-handled = 권한 상승 요청 { $ssid }는 이미 { $status } 상태이므로 다시 처리할 수 없습니다
cli-approve-success = 권한 상승 요청 { $ssid }를 승인했습니다 (요청 IP: { $ip }); 임시 TOKEN이 발급되었습니다
cli-deny-success = 권한 상승 요청 { $ssid }를 거부했습니다 (요청 IP: { $ip })
cli-pending-empty = 대기 중인 CLI 권한 상승 요청이 없습니다
cli-pending-header = 대기 중인 CLI 권한 상승 요청 ({ $count }개):
cli-pending-line =   [{ $ssid }] full ssid: { $full } | IP: { $ip } | 남은 시간 { $seconds }초
