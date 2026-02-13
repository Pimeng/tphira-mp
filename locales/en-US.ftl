
create-id-occupied = Room ID is occupied

join-game-ongoing = Game is ongoing
join-room-full = Room is full
join-room-locked = Room is locked
join-cant-monitor = Permission denied. You can't monitor this room.

start-no-chart-selected = No chart selected

http-not-found = Not found
http-internal-error = Internal error

cli-invalid-port = Invalid port number
cli-invalid-http-service = Invalid HTTP service flag
cli-invalid-http-port = Invalid HTTP port number
cli-invalid-room-max-users = Invalid ROOM_MAX_USERS
cli-invalid-monitors = Invalid MONITORS

label-monitor-suffix = (monitor)

chat-welcome = Hello "{ $userName }"! Welcome to { $serverName }!
chat-hitokoto = { $quote } — { $from }
chat-hitokoto-from-unknown = Unknown
chat-hitokoto-unavailable = Failed to fetch quote
chat-roomlist-title = Available rooms:
chat-roomlist-empty = No available rooms
chat-roomlist-item = { $id } ({ $count }/{ $max })

chat-game-summary =
    Match summary:
    { $scoreText }
    { $accText }
    { $stdText }
chat-game-summary-score = Best score: "{ $name } "({ $id }) { $score }
chat-game-summary-acc = Best accuracy: "{ $name } "({ $id }) { $acc }
chat-game-summary-std = Best std: "{ $name } "({ $id }) { $std }ms

auth-invalid-token = Invalid token
auth-fetch-me-failed = Failed to fetch user info
auth-account-already-online = Account is already online. Duplicate connection blocked.
auth-failed = Authentication failed
auth-repeated-authenticate = Repeated authenticate
auth-banned = You are banned from this server
user-banned-by-server = You have been banned from this server and cannot perform any operations.

room-already-in-room = Already in a room
room-creation-disabled = Room creation has been disabled by administrator
room-not-found = Room not found
room-no-room = Not in a room
room-banned = You are banned from room { $id }
room-not-whitelisted = You are not whitelisted for this room
room-only-host = Only the host can do this
room-invalid-state = Invalid room state
room-already-ready = Already ready
room-not-ready = Not ready
room-game-aborted = Game aborted

record-invalid = Invalid record
record-already-uploaded = Record already uploaded
record-fetch-failed = Failed to fetch record

chart-fetch-failed = Failed to fetch chart

net-request-timeout = Request timeout
net-connection-closed = Connection closed
net-send-timeout = Send timeout
net-unsupported-protocol-version = Unsupported protocol version: { $version }

roomid-empty = Room ID cannot be empty
roomid-too-long = Room ID is too long
roomid-invalid = Invalid Room ID

frame-invalid-length = Invalid length
frame-invalid-length-prefix = Invalid length prefix
frame-payload-too-large = Payload too large

binary-unexpected-eof = Unexpected EOF
binary-length-too-large = Length too large
binary-string-too-long = String too long

proto-roomstate-tag-invalid = Invalid RoomState tag
proto-users-key-missing = Missing users key
proto-message-tag-invalid = Invalid Message tag
proto-clientcommand-tag-invalid = Invalid ClientCommand tag
proto-servercommand-tag-invalid = Invalid ServerCommand tag

client-not-connected = Not connected
client-ping-in-flight = Previous ping still pending
client-heartbeat-timeout = Heartbeat timeout
client-timeout = Timeout

log-new-connection = New connection. id={ $id }, remote={ $remote }
log-handshake-ok = Handshake OK. id={ $id }, version="{ $version }"
log-handshake-failed = Handshake failed. id={ $id }, reason={ $reason }

log-server-version = Server version { $version }
log-runtime-env = Runtime { $platform } node{ $node }
log-server-listen = Listening on { $addr }
log-http-listen = HTTP listening on { $addr }
log-server-name = Server name { $name }
log-server-stopped = Server stopped

log-heartbeat-timeout-disconnect = Heartbeat timeout. Disconnecting (id={ $id })
log-auth-ok = Auth OK. id={ $id }, user="{ $user }"{ $monitorSuffix }, proto="{ $version }"
log-auth-failed = Auth failed. id={ $id }, reason={ $reason }

log-player-join = Player { $who }({ $id })

log-disconnect = Disconnected. id={ $id }{ $who }
log-disconnect-user = , user="{ $user }"

log-user-disconnect-playing = "{ $user }" disconnected during play, force leave room "{ $room }"
log-room-recycled = Room "{ $room }" recycled (empty)
log-user-dangle = "{ $user }" disconnected, waiting for reconnect
log-user-dangle-timeout-remove = "{ $user }" reconnect timeout, removed and left room "{ $room }"

log-user-chat = "{ $user }" sent chat in room "{ $room }"
log-user-touches = "{ $user }" reported { $count } touch frames in room "{ $room }"
log-user-judges = "{ $user }" reported { $count } judge events in room "{ $room }"

log-room-created = "{ $user }" created room "{ $room }"
log-room-joined = "{ $user }"{ $suffix } joined room "{ $room }"
log-room-left = "{ $user }"{ $suffix } left room "{ $room }"

log-room-lock = "{ $user }" { $lock ->
    [true] locked
   *[false] unlocked
  } room "{ $room }"

log-room-cycle = "{ $user }" { $cycle ->
    [true] enabled
   *[false] disabled
  } host cycling in room "{ $room }"

log-room-select-chart = "{ $user }"(id={ $userId }) selected "{ $chart }" in room "{ $room }"
log-room-request-start = "{ $user }" requested start in room "{ $room }"
log-room-ready = "{ $user }" is ready in room "{ $room }"
log-room-cancel-game = "{ $user }" canceled the game in room "{ $room }"
log-room-cancel-ready = "{ $user }" canceled ready in room "{ $room }"
log-room-played = "{ $user }" uploaded record in room "{ $room }" (score={ $score }, acc={ $acc })
log-room-abort = "{ $user }" aborted the game in room "{ $room }"

log-room-host-changed-offline = Room "{ $room }" host changed (offline): { $old } -> { $next }
log-room-game-start = Room "{ $room }" game start. users: { $users }{ $monitorsSuffix }
log-room-game-start-monitors = , monitors: { $monitors }
log-room-game-end = Room "{ $room }" game end (uploaded={ $uploaded }, aborted={ $aborted })
log-contest-game-results = Contest room "{ $room }" results: chart={ $chart } results={ $results } aborted={ $aborted }
log-room-host-changed-cycle = Room "{ $room }" host changed (cycle): { $old } -> { $next }

log-admin-broadcast = Admin broadcast: { $message } (sent to { $rooms } rooms)
log-admin-room-message = Admin sent message to room "{ $room }": { $message }
log-room-disbanded-by-admin = Room "{ $room }" disbanded by admin

room-disbanded-by-admin = Room has been disbanded by administrator

log-websocket-connected = WebSocket client connected, total connections: { $total }
log-websocket-disconnected = WebSocket client disconnected, total connections: { $total }
