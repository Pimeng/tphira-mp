
create-id-occupied = Room ID is occupied

join-game-ongoing = Game is ongoing
join-room-full = Room is full
join-room-locked = Room is locked
join-cant-monitor = Permission denied. You can't monitor this room.

start-no-chart-selected = No chart selected

http-not-found = Not found
http-internal-error = Internal error
http-rate-limited = Too many requests. Please try again later

bad-enabled = Missing enabled parameter
auth-unauthorized = Unauthorized
token-expired = Token expired
admin-disabled = Admin feature is disabled
otp-disabled-when-token-configured = OTP is disabled when admin token is configured
bad-request = Bad request
invalid-or-expired-session = Invalid or expired session
ip-mismatch = IP address mismatch
pending-approval = Pending approval
approval-denied = Approval denied
token-not-issued = Token not issued
ip-banned-too-many-attempts = IP banned due to too many attempts
ssid-banned-too-many-attempts = Session banned due to too many attempts
invalid-or-expired-otp = Invalid or expired OTP
bad-token = Token cannot be empty
upload-failed = Upload failed
share-station-not-configured = Share station is not configured
upload-success = Upload successful
user-must-be-disconnected = User must be disconnected
user-not-in-room = User is not in a room
cannot-move-while-playing = Cannot move user while playing
target-room-not-idle = Target room is not idle

cli-invalid-port = Invalid port number
cli-invalid-http-service = Invalid HTTP service flag
cli-invalid-http-port = Invalid HTTP port number
cli-invalid-room-max-users = Invalid ROOM_MAX_USERS
cli-invalid-monitors = Invalid MONITORS

label-monitor-suffix = (monitor)
replay-recorder-name = Replay Recorder

chat-welcome = Hello "{ $userName }"! Welcome to { $serverName }!
chat-welcome-version = Server is running version { $version }
chat-hitokoto = { $quote } — { $from }
chat-hitokoto-from-unknown = Unknown
chat-roomlist-title = Available rooms:
chat-roomlist-empty = No available rooms
chat-roomlist-item = { $id } ({ $count }/{ $max })
chat-disabled-by-server = Chat is disabled on this server to avoid safety issues.

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
auth-failed = Authentication failed
auth-invalid-response = Invalid auth response
auth-invalid-user-id = Invalid user ID in auth response
auth-invalid-user-name = Invalid user name in auth response
auth-repeated-authenticate = Repeated authenticate
user-banned-by-server = You have been banned from this server and cannot perform any operations.

room-already-in-room = Already in a room
room-creation-disabled = Room creation has been disabled by administrator
rooms-limit-reached = Server room limit reached, please try again later
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
record-chart-mismatch = Record does not match the current chart

command-rate-limited = Too many requests, please slow down

chart-fetch-failed = Failed to fetch chart

server-maintenance = The server is under maintenance and cannot be joined right now
log-auth-rejected-maintenance = Maintenance mode: rejected new connection "{ $user }"
chat-maintenance-enabled = ⚙️ The server has entered maintenance mode; new players are paused. Please finish the current game soon
chat-maintenance-disabled = ✅ Server maintenance is over; back to normal
chat-server-stopping = ⚠️ The server is shutting down for maintenance; you will be disconnected after the current game
chat-waiting-reconnect = ⏳ "{ $user }" disconnected unexpectedly; waiting for reconnect — the game will end in { $seconds }s if they don't return
cli-maintenance-status = Maintenance mode: { $state }
cli-usage-maintenance = Usage: maintenance <on|off|status> [notice message]

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

log-player-join = Player { $user }({ $id }){ $monitorSuffix } joined the server

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

log-msg-create-room = { $user } created the room
log-msg-join-room = { $name } joined the room
log-msg-leave-room = { $name } left the room
log-msg-new-host = { $user } became the new host
log-msg-select-chart = Host { $user } selected chart { $name } (#{ $id })
log-msg-game-start = Host { $user } started the game, please get ready
log-msg-ready = { $user } is ready
log-msg-cancel-ready = { $user } canceled ready
log-msg-cancel-game = { $user } canceled the game
log-msg-start-playing = Game started
log-msg-played = { $user } finished playing: { $score } ({ $acc }%){ $fc ->
    [true] , FC
   *[false] {""}
}
log-msg-game-end = Game ended
log-msg-abort = { $user } aborted the game
log-msg-lock-room = { $lock ->
    [true] Room locked
   *[false] Room unlocked
}
log-msg-cycle-room = { $cycle ->
    [true] Room cycle mode enabled
   *[false] Room cycle mode disabled
}

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
log-gui-console-command = GUI console command executed: { $command }
log-gui-http-forced = GUI enabled, HTTP service was turned on automatically
log-gui-window-launched = GUI window opened: { $url }
log-gui-window-failed = Failed to open the GUI window automatically. Open this URL in a local browser: { $url }
log-admin-room-message = Admin sent message to room "{ $room }": { $message }
log-room-disbanded-by-admin = Room "{ $room }" disbanded by admin

room-disbanded-by-admin = Room has been disbanded by administrator

log-websocket-connected = WebSocket client connected, total connections: { $total }
log-websocket-disconnected = WebSocket client disconnected, total connections: { $total }

# ====== CLI console ======

cli-bad-user-id = Invalid user ID
cli-bad-room-id = Invalid room ID
cli-message-empty = Message cannot be empty
cli-message-too-long = Message too long (max { $max } characters)

cli-stop-hint = Use Ctrl+C to stop the server
cli-stopping = Shutting down the server, please wait...
locales-fetched = Fetched { $count } locale file(s) online
locales-override-applied = Applied locales/{ $lang }.ftl override ({ $count } key(s))
config-auto-created = No config file found; generated a default config at { $path } (edit it and restart to apply)
http-admin-token-missing = HTTP service is enabled but ADMIN_TOKEN is not set; all /admin endpoints will be denied. Use the CLI pending / approve flow for temporary access, or set ADMIN_TOKEN in the config.
cli-unknown-command = Unknown command: { $cmd }. Type 'help' for available commands
cli-command-failed = Command failed: { $reason }

cli-help =

    === Phira MP Server Commands ===
    help                          - Show this help
    list, rooms                   - List all rooms
    users                         - List all online users
    user <id>                     - View user info
    kick <userId> [preserve]      - Kick user (preserve=true to keep room slot)
    ban <userId>                  - Ban user from server
    unban <userId>                - Unban user
    banlist                       - View ban list
    banroom <userId> <roomId>     - Ban user from room
    unbanroom <userId> <roomId>   - Unban user from room
    broadcast <message>           - Broadcast message
    say <message>                 - Broadcast (alias of broadcast)
    roomsay <roomId> <message>    - Send message to room
    maxusers <roomId> <count>     - Set room max users
    disband <roomId>              - Disband room
    replay <on|off|status>        - Replay recording toggle
    roomcreation <on|off|status>  - Room creation toggle
    maintenance <on|off|status> [msg]  - Maintenance mode toggle (pause new players)
    contest <roomId> <subcommand> - Contest room management
      contest <roomId> enable [userIds...]    - Enable contest mode
      contest <roomId> disable                - Disable contest mode
      contest <roomId> whitelist <userIds...> - Set whitelist
      contest <roomId> start [force]          - Start contest
    ipblacklist <list|remove|clear> - IP blacklist management
    pending                       - List all pending CLI elevation requests
    approve <ssid>                - Approve a CLI elevation request and issue a temp TOKEN (accepts ssid prefix)
    deny <ssid>                   - Deny a CLI elevation request (accepts ssid prefix)
    stop, shutdown                - Gracefully shut down the server

cli-no-rooms = No rooms currently
cli-rooms-total = Total rooms: { $count }
cli-room-line = [{ $id }] { $state } | Players: { $users }/{ $maxUsers } | Monitors: { $monitors } | Chart: { $chart } | Locked: { $locked } | Cycle: { $cycle } | Contest: { $contest }

cli-no-users = No users online
cli-users-total = Total users: { $count }
cli-user-line = [{ $id }] { $name } | { $status } | { $role } | Room: { $room }{ $bannedTag }
cli-user-status-online = Online
cli-user-status-offline = Offline
cli-user-role-monitor = Monitor
cli-user-role-player = Player
cli-user-banned-tag =  [BANNED]
cli-none = None
cli-yes = Yes
cli-no = No
cli-state-on = Enabled
cli-state-off = Disabled
cli-room-state-playing = Playing
cli-room-state-waiting = WaitForReady
cli-room-state-select = SelectChart
cli-bool-yes = Yes
cli-bool-no = No

cli-usage-user = Usage: user <userId>
cli-usage-kick = Usage: kick <userId> [preserve]
cli-usage-ban = Usage: ban <userId>
cli-usage-unban = Usage: unban <userId>
cli-usage-banroom = Usage: banroom <userId> <roomId>
cli-usage-unbanroom = Usage: unbanroom <userId> <roomId>
cli-usage-broadcast = Usage: broadcast <message>
cli-usage-roomsay = Usage: roomsay <roomId> <message>
cli-usage-maxusers = Usage: maxusers <roomId> <count>
cli-usage-disband = Usage: disband <roomId>
cli-usage-replay = Usage: replay <on|off|status>
cli-usage-roomcreation = Usage: roomcreation <on|off|status>
cli-usage-contest = Usage: contest <roomId> <enable|disable|whitelist|start>
cli-usage-ipblacklist = Usage: ipblacklist <list|remove|clear>
cli-usage-ipblacklist-remove = Usage: ipblacklist remove <ip>

cli-user-not-found = User not found: { $id }
cli-user-info-header = User info:
cli-user-info-id =   ID: { $id }
cli-user-info-name =   Name: { $name }
cli-user-info-status =   Status: { $status }
cli-user-info-role =   Role: { $role }
cli-user-info-room =   Room: { $room }
cli-user-info-banned =   Banned: { $banned }
cli-user-info-game-time =   Game time: { $time }
cli-user-info-language =   Language: { $lang }

cli-user-not-connected = User not connected: { $id }
cli-user-kicked = Kicked user: { $id }
cli-user-banned = Banned user: { $id }
cli-user-unbanned = Unbanned user: { $id }
cli-no-banned-users = No banned users
cli-banned-list-header = Banned users ({ $count }):
cli-room-user-banned = Banned user { $userId } from room { $room }
cli-room-user-unbanned = Unbanned user { $userId } from room { $room }
cli-broadcast-sent = Broadcast to { $count } rooms
cli-room-not-found = Room not found
cli-room-not-found-named = Room not found: { $room }
cli-room-message-sent = Message sent to room { $room }
cli-bad-max-users = Invalid count (1-64)
cli-room-max-users-set = Set room { $room } max users to { $count }
cli-room-disbanded = Disbanded room { $room }

cli-replay-status = Replay recording: { $state }
cli-replay-toggled-on = Replay recording enabled
cli-replay-toggled-off = Replay recording disabled
cli-room-creation-status = Room creation: { $state }
cli-room-creation-toggled-on = Room creation enabled
cli-room-creation-toggled-off = Room creation disabled

cli-contest-enabled = Enabled contest mode for room { $room }
cli-contest-disabled = Disabled contest mode for room { $room }
cli-contest-no-user-id = Please provide at least one user ID
cli-contest-not-enabled = Room not found or contest mode not enabled
cli-contest-whitelist-updated = Updated whitelist for room { $room }
contest-room-not-found = Contest room not found
room-not-waiting = Room is not waiting for ready
no-chart-selected = No chart selected
not-all-ready = Not all players are ready
cli-contest-cannot-start = Cannot start contest: { $reason }
cli-contest-started = Started contest for room { $room }
cli-contest-unknown-subcommand = Unknown subcommand. Available: enable, disable, whitelist, start

cli-blacklist-empty = IP blacklist is empty
cli-blacklist-header = IP Blacklist ({ $count }):
cli-blacklist-line =   { $ip } (expires in { $minutes } minutes)
cli-blacklist-removed = Removed from blacklist: { $ip }
cli-blacklist-cleared = Cleared IP blacklist
cli-ipblacklist-unknown-subcommand = Unknown subcommand. Available: list, remove, clear

cli-usage-approve = Usage: approve <ssid> (full ssid or prefix shortcode)
cli-usage-deny = Usage: deny <ssid> (full ssid or prefix shortcode)
cli-approve-not-found = No pending elevation request matched: { $input }
cli-approve-ambiguous = Shortcode { $input } matches multiple elevation requests; please use a longer prefix
cli-approve-expired = Elevation request { $ssid } has expired
cli-approve-already-handled = Elevation request { $ssid } is already in { $status } state and cannot be handled again
cli-approve-success = Approved elevation request { $ssid } (requester IP: { $ip }); temporary TOKEN issued
cli-deny-success = Denied elevation request { $ssid } (requester IP: { $ip })
cli-pending-empty = No pending CLI elevation requests
cli-pending-header = Pending CLI elevation requests ({ $count }):
cli-pending-line =   [{ $ssid }] full ssid: { $full } | IP: { $ip } | remaining { $seconds }s

