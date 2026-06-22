
create-id-occupied = ルームIDは既に使用されています

join-game-ongoing = ゲームが進行中です
join-room-full = ルームが満員です
join-room-locked = ルームがロックされています
join-cant-monitor = 権限がありません。このルームを観戦できません。

start-no-chart-selected = 譜面が選択されていません

http-not-found = 見つかりません
http-internal-error = 内部エラー
http-rate-limited = リクエストが多すぎます。しばらくしてからお試しください

bad-enabled = enabled パラメータがありません
auth-unauthorized = 認証されていません
token-expired = トークンの有効期限が切れています
admin-disabled = 管理者機能は無効になっています
otp-disabled-when-token-configured = 管理者トークンが設定されているため、OTP は無効です
bad-request = リクエストが不正です
invalid-or-expired-session = セッションが無効または期限切れです
ip-mismatch = IP アドレスが一致しません
pending-approval = 承認待ちです
approval-denied = 承認が拒否されました
token-not-issued = トークンが発行されていません
ip-banned-too-many-attempts = 試行回数が多すぎるため、この IP は禁止されました
ssid-banned-too-many-attempts = 試行回数が多すぎるため、このセッションは禁止されました
invalid-or-expired-otp = OTP が無効または期限切れです
bad-token = トークンを空にすることはできません
upload-failed = アップロードに失敗しました
share-station-not-configured = シェアステーションが設定されていません
upload-success = アップロードに成功しました
user-must-be-disconnected = ユーザーは切断状態である必要があります
user-not-in-room = ユーザーはルームにいません
cannot-move-while-playing = プレイ中はユーザーを移動できません
target-room-not-idle = 対象のルームがアイドル状態ではありません

cli-invalid-port = ポート番号が不正です
cli-invalid-http-service = HTTP サービスフラグが不正です
cli-invalid-http-port = HTTP ポート番号が不正です
cli-invalid-room-max-users = ROOM_MAX_USERS が不正です
cli-invalid-monitors = MONITORS が不正です

label-monitor-suffix = （観戦者）
replay-recorder-name = リプレイレコーダー

chat-welcome = 「{ $userName }」さん、こんにちは！{ $serverName } へようこそ！
chat-welcome-version = サーバーのバージョンは { $version } です
chat-hitokoto = { $quote } —— { $from }
chat-hitokoto-from-unknown = 詠み人知らず
chat-roomlist-title = 利用可能なルーム：
chat-roomlist-empty = 利用可能なルームはありません
chat-roomlist-item = { $id }（{ $count }/{ $max }）
chat-disabled-by-server = 安全上の問題を避けるため、このサーバーではチャットが無効になっています。

chat-game-summary =
    対局結果：
    { $scoreText }
    { $accText }
    { $stdText }
chat-game-summary-score = 最高スコア：「{ $name } 」({ $id }) { $score }
chat-game-summary-acc = 最高精度：「{ $name } 」({ $id }) { $acc }
chat-game-summary-std = 最高安定度：「{ $name } 」({ $id }) { $std }ms

auth-invalid-token = トークンが不正です
auth-fetch-me-failed = ユーザー情報の取得に失敗しました
auth-failed = 認証に失敗しました
auth-invalid-response = 認証応答が不正です
auth-invalid-user-id = 認証応答のユーザーIDが不正です
auth-invalid-user-name = 認証応答のユーザー名が不正です
auth-repeated-authenticate = 認証が重複しています
user-banned-by-server = あなたはこのサーバーから禁止されており、いかなる操作も行えません。

room-already-in-room = 既にルームにいます
room-creation-disabled = ルーム作成は管理者によって無効化されています
rooms-limit-reached = サーバーのルーム数が上限に達しました。後でもう一度お試しください
room-not-found = ルームが見つかりません
room-no-room = ルームにいません
room-banned = あなたはルーム { $id } から禁止されています
room-not-whitelisted = あなたはこのルームのホワイトリストに登録されていません
room-only-host = ホストのみがこの操作を実行できます
room-invalid-state = ルームの状態が不正です
room-already-ready = 既に準備完了です
room-not-ready = 準備ができていません
room-game-aborted = ゲームが中止されました

record-invalid = 記録が不正です
record-already-uploaded = 記録は既にアップロードされています
record-fetch-failed = 記録の取得に失敗しました
record-chart-mismatch = 記録が現在の譜面と一致しません

command-rate-limited = 操作が頻繁すぎます。しばらくしてから再試行してください

chart-fetch-failed = 譜面の取得に失敗しました

server-maintenance = サーバーはメンテナンス中のため、現在参加できません
log-auth-rejected-maintenance = メンテナンスモード：新規接続「{ $user }」を拒否しました
chat-maintenance-enabled = ⚙️ サーバーがメンテナンスモードに入りました。新規参加を停止します。現在の対局を早めに終了してください
chat-maintenance-disabled = ✅ サーバーのメンテナンスが終了し、通常状態に戻りました
chat-server-stopping = ⚠️ サーバーはまもなくメンテナンスのため停止します。対局終了後に切断されます
chat-waiting-reconnect = ⏳ 「{ $user }」が切断されました。再接続を待っています。{ $seconds } 秒以内に戻らない場合、対局を終了します
cli-maintenance-status = メンテナンスモード：{ $state }
cli-usage-maintenance = 使い方：maintenance <on|off|status> [お知らせメッセージ]

net-connection-closed = 接続が閉じられました
net-send-timeout = 送信タイムアウト
net-unsupported-protocol-version = サポートされていないプロトコルバージョン：{ $version }

roomid-empty = ルームIDを空にすることはできません
roomid-too-long = ルームIDが長すぎます
roomid-invalid = ルームIDが不正です

frame-invalid-length = 長さが不正です
frame-invalid-length-prefix = 長さプレフィックスが不正です
frame-payload-too-large = ペイロードが大きすぎます

binary-unexpected-eof = 予期しない EOF
binary-length-too-large = 長さが大きすぎます
binary-string-too-long = 文字列が長すぎます

proto-roomstate-tag-invalid = RoomState タグが不正です
proto-users-key-missing = users キーがありません
proto-message-tag-invalid = Message タグが不正です
proto-clientcommand-tag-invalid = ClientCommand タグが不正です
proto-servercommand-tag-invalid = ServerCommand タグが不正です

client-not-connected = 接続されていません
client-ping-in-flight = 前回の ping がまだ完了していません
client-heartbeat-timeout = ハートビートタイムアウト
client-timeout = タイムアウト

log-new-connection = 新しい接続。id={ $id }、remote={ $remote }
log-handshake-ok = ハンドシェイク成功。id={ $id }、version=「{ $version }」
log-handshake-failed = ハンドシェイク失敗。id={ $id }、reason={ $reason }

log-server-version = サーバーバージョン { $version }
log-runtime-env = ランタイム { $platform } node{ $node }
log-server-listen = { $addr } で待機中
log-http-listen = HTTP は { $addr } で待機中
log-server-name = サーバー名 { $name }
log-server-stopped = サーバーが停止しました

log-heartbeat-timeout-disconnect = ハートビートタイムアウト。切断します（id={ $id }）
log-auth-ok = 認証成功。id={ $id }、user=「{ $user }」{ $monitorSuffix }、proto=「{ $version }」
log-auth-failed = 認証失敗。id={ $id }、reason={ $reason }

log-player-join = プレイヤー { $user }({ $id }){ $monitorSuffix } がサーバーに参加しました

log-disconnect = 切断しました。id={ $id }{ $who }
log-disconnect-user = 、user=「{ $user }」

log-user-disconnect-playing = 「{ $user }」がプレイ中に切断し、ルーム「{ $room }」から強制退出しました
log-room-recycled = ルーム「{ $room }」を回収しました（空）
log-user-dangle = 「{ $user }」が切断し、再接続を待機しています
log-user-dangle-timeout-remove = 「{ $user }」の再接続がタイムアウトし、削除してルーム「{ $room }」から退出しました

log-user-chat = 「{ $user }」がルーム「{ $room }」でチャットを送信しました
log-user-touches = 「{ $user }」がルーム「{ $room }」で { $count } 件のタッチフレームを報告しました
log-user-judges = 「{ $user }」がルーム「{ $room }」で { $count } 件の判定イベントを報告しました

log-room-created = 「{ $user }」がルーム「{ $room }」を作成しました
log-room-joined = 「{ $user }」{ $suffix } がルーム「{ $room }」に参加しました
log-room-left = 「{ $user }」{ $suffix } がルーム「{ $room }」から退出しました

log-msg-create-room = { $user } がルームを作成しました
log-msg-join-room = { $name } がルームに参加しました
log-msg-leave-room = { $name } がルームから退出しました
log-msg-new-host = { $user } が新しいホストになりました
log-msg-select-chart = ホスト { $user } が譜面 { $name } (#{ $id }) を選択しました
log-msg-game-start = ホスト { $user } がゲームを開始しました、準備してください
log-msg-ready = { $user } が準備完了しました
log-msg-cancel-ready = { $user } が準備をキャンセルしました
log-msg-cancel-game = { $user } がゲームをキャンセルしました
log-msg-start-playing = ゲーム開始
log-msg-played = { $user } がプレイを終了しました：{ $score } ({ $acc }%){ $fc ->
    [true] 、FC
   *[false] {""}
}
log-msg-game-end = ゲーム終了
log-msg-abort = { $user } がゲームを中止しました
log-msg-lock-room = { $lock ->
    [true] ルームをロックしました
   *[false] ルームのロックを解除しました
}
log-msg-cycle-room = { $cycle ->
    [true] ルームのサイクルモードを有効にしました
   *[false] ルームのサイクルモードを無効にしました
}

log-room-lock = 「{ $user }」がルーム「{ $room }」を{ $lock ->
    [true] ロック
   *[false] ロック解除
  }しました

log-room-cycle = 「{ $user }」がルーム「{ $room }」のホストサイクルを{ $cycle ->
    [true] 有効化
   *[false] 無効化
  }しました

log-room-select-chart = 「{ $user }」（id={ $userId }）がルーム「{ $room }」で「{ $chart }」を選択しました
log-room-request-start = 「{ $user }」がルーム「{ $room }」で開始を要求しました
log-room-ready = 「{ $user }」がルーム「{ $room }」で準備完了しました
log-room-cancel-game = 「{ $user }」がルーム「{ $room }」でゲームをキャンセルしました
log-room-cancel-ready = 「{ $user }」がルーム「{ $room }」で準備をキャンセルしました
log-room-played = 「{ $user }」がルーム「{ $room }」で記録をアップロードしました（score={ $score }、acc={ $acc }）
log-room-abort = 「{ $user }」がルーム「{ $room }」でゲームを中止しました

log-room-host-changed-offline = ルーム「{ $room }」のホストが変更されました（オフライン）：{ $old } -> { $next }
log-room-game-start = ルーム「{ $room }」のゲーム開始。users: { $users }{ $monitorsSuffix }
log-room-game-start-monitors = 、monitors: { $monitors }
log-room-game-end = ルーム「{ $room }」のゲーム終了（uploaded={ $uploaded }、aborted={ $aborted }）
log-contest-game-results = 大会ルーム「{ $room }」の結果：chart={ $chart } results={ $results } aborted={ $aborted }
log-room-host-changed-cycle = ルーム「{ $room }」のホストが変更されました（サイクル）：{ $old } -> { $next }

log-admin-broadcast = 管理者ブロードキャスト：{ $message }（{ $rooms } ルームに送信）
log-gui-console-command = GUI コンソールでコマンドを実行：{ $command }
log-gui-http-forced = GUI が有効のため、HTTP サービスを自動的に開始しました
log-gui-window-launched = GUI ウィンドウを開きました：{ $url }
log-gui-window-failed = GUI ウィンドウを自動的に開けませんでした。ローカルブラウザで開いてください：{ $url }
log-admin-room-message = 管理者がルーム「{ $room }」にメッセージを送信しました：{ $message }
log-room-disbanded-by-admin = ルーム「{ $room }」が管理者によって解散されました

room-disbanded-by-admin = ルームが管理者によって解散されました

log-websocket-connected = WebSocket クライアントが接続しました、合計接続数：{ $total }
log-websocket-disconnected = WebSocket クライアントが切断しました、合計接続数：{ $total }

# ====== CLI コンソール ======

cli-bad-user-id = 無効なユーザーID
cli-bad-room-id = 無効なルームID
cli-message-empty = メッセージを空にすることはできません
cli-message-too-long = メッセージが長すぎます（最大 { $max } 文字）

cli-stop-hint = Ctrl+C でサーバーを停止します
cli-stopping = サーバーをシャットダウンしています。しばらくお待ちください……
locales-fetched = { $count } 個の言語ファイルをオンラインで取得しました
locales-override-applied = locales/{ $lang }.ftl の上書きを適用しました（{ $count } 件）
config-auto-created = 設定ファイルが見つからないため、既定の設定を生成しました：{ $path }（編集後、再起動で反映されます）
http-admin-token-missing = HTTP サービスは有効ですが ADMIN_TOKEN が未設定のため、/admin エンドポイントはすべて拒否されます。CLI の pending / approve で一時的に許可するか、設定で ADMIN_TOKEN を指定してください。
cli-unknown-command = 不明なコマンド：{ $cmd }。'help' で利用可能なコマンドを表示します
cli-command-failed = コマンドが失敗しました：{ $reason }

cli-help =

    === Phira MP Server Commands ===
    help                          - このヘルプを表示
    list, rooms                   - すべてのルームを一覧表示
    users                         - すべてのオンラインユーザーを一覧表示
    user <id>                     - ユーザー情報を表示
    kick <userId> [preserve]      - ユーザーをキック（preserve=true でルーム枠を保持）
    ban <userId>                  - サーバーからユーザーを禁止
    unban <userId>                - ユーザーの禁止を解除
    banlist                       - 禁止リストを表示
    banroom <userId> <roomId>     - ルームからユーザーを禁止
    unbanroom <userId> <roomId>   - ルームの禁止を解除
    broadcast <message>           - メッセージをブロードキャスト
    say <message>                 - ブロードキャスト（broadcast の別名）
    roomsay <roomId> <message>    - ルームにメッセージを送信
    maxusers <roomId> <count>     - ルームの最大人数を設定
    disband <roomId>              - ルームを解散
    replay <on|off|status>        - リプレイ録画の切り替え
    roomcreation <on|off|status>  - ルーム作成の切り替え
    maintenance <on|off|status> [メッセージ]  - メンテナンスモード切り替え（新規参加を停止）
    contest <roomId> <subcommand> - 大会ルーム管理
      contest <roomId> enable [userIds...]    - 大会モードを有効化
      contest <roomId> disable                - 大会モードを無効化
      contest <roomId> whitelist <userIds...> - ホワイトリストを設定
      contest <roomId> start [force]          - 大会を開始
    ipblacklist <list|remove|clear> - IP ブラックリスト管理
    pending                       - 保留中の CLI 昇格申請を一覧表示
    approve <ssid>                - CLI 昇格申請を承認し一時 TOKEN を発行（ssid プレフィックス対応）
    deny <ssid>                   - CLI 昇格申請を拒否（ssid プレフィックス対応）
    stop, shutdown                - サーバーを正常にシャットダウン

cli-no-rooms = 現在ルームはありません
cli-rooms-total = ルーム総数：{ $count }
cli-room-line = [{ $id }] { $state } | プレイヤー：{ $users }/{ $maxUsers } | 観戦：{ $monitors } | 譜面：{ $chart } | ロック：{ $locked } | サイクル：{ $cycle } | 大会：{ $contest }

cli-no-users = オンラインユーザーはいません
cli-users-total = ユーザー総数：{ $count }
cli-user-line = [{ $id }] { $name } | { $status } | { $role } | ルーム：{ $room }{ $bannedTag }
cli-user-status-online = オンライン
cli-user-status-offline = オフライン
cli-user-role-monitor = 観戦者
cli-user-role-player = プレイヤー
cli-user-banned-tag =  [禁止済み]
cli-none = なし
cli-yes = はい
cli-no = いいえ
cli-state-on = 有効
cli-state-off = 無効
cli-room-state-playing = プレイ中
cli-room-state-waiting = 準備待ち
cli-room-state-select = 譜面選択中
cli-bool-yes = はい
cli-bool-no = いいえ

cli-usage-user = 使い方：user <userId>
cli-usage-kick = 使い方：kick <userId> [preserve]
cli-usage-ban = 使い方：ban <userId>
cli-usage-unban = 使い方：unban <userId>
cli-usage-banroom = 使い方：banroom <userId> <roomId>
cli-usage-unbanroom = 使い方：unbanroom <userId> <roomId>
cli-usage-broadcast = 使い方：broadcast <message>
cli-usage-roomsay = 使い方：roomsay <roomId> <message>
cli-usage-maxusers = 使い方：maxusers <roomId> <count>
cli-usage-disband = 使い方：disband <roomId>
cli-usage-replay = 使い方：replay <on|off|status>
cli-usage-roomcreation = 使い方：roomcreation <on|off|status>
cli-usage-contest = 使い方：contest <roomId> <enable|disable|whitelist|start>
cli-usage-ipblacklist = 使い方：ipblacklist <list|remove|clear>
cli-usage-ipblacklist-remove = 使い方：ipblacklist remove <ip>

cli-user-not-found = ユーザーが見つかりません：{ $id }
cli-user-info-header = ユーザー情報：
cli-user-info-id =   ID：{ $id }
cli-user-info-name =   名前：{ $name }
cli-user-info-status =   状態：{ $status }
cli-user-info-role =   役割：{ $role }
cli-user-info-room =   ルーム：{ $room }
cli-user-info-banned =   禁止：{ $banned }
cli-user-info-game-time =   プレイ時間：{ $time }
cli-user-info-language =   言語：{ $lang }

cli-user-not-connected = ユーザーが接続されていません：{ $id }
cli-user-kicked = ユーザーをキックしました：{ $id }
cli-user-banned = ユーザーを禁止しました：{ $id }
cli-user-unbanned = ユーザーの禁止を解除しました：{ $id }
cli-no-banned-users = 禁止されたユーザーはいません
cli-banned-list-header = 禁止ユーザー（{ $count } 人）：
cli-room-user-banned = ユーザー { $userId } をルーム { $room } から禁止しました
cli-room-user-unbanned = ユーザー { $userId } のルーム { $room } の禁止を解除しました
cli-broadcast-sent = { $count } ルームにブロードキャストしました
cli-room-not-found = ルームが見つかりません
cli-room-not-found-named = ルームが見つかりません：{ $room }
cli-room-message-sent = ルーム { $room } にメッセージを送信しました
cli-bad-max-users = 無効な人数（1-64）
cli-room-max-users-set = ルーム { $room } の最大人数を { $count } に設定しました
cli-room-disbanded = ルーム { $room } を解散しました

cli-replay-status = リプレイ録画：{ $state }
cli-replay-toggled-on = リプレイ録画を有効にしました
cli-replay-toggled-off = リプレイ録画を無効にしました
cli-room-creation-status = ルーム作成：{ $state }
cli-room-creation-toggled-on = ルーム作成を有効にしました
cli-room-creation-toggled-off = ルーム作成を無効にしました

cli-contest-enabled = ルーム { $room } の大会モードを有効にしました
cli-contest-disabled = ルーム { $room } の大会モードを無効にしました
cli-contest-no-user-id = ユーザーIDを少なくとも1つ指定してください
cli-contest-not-enabled = ルームが見つからないか、大会モードが有効になっていません
cli-contest-whitelist-updated = ルーム { $room } のホワイトリストを更新しました
contest-room-not-found = 大会ルームが見つかりません
room-not-waiting = ルームは準備待ち状態ではありません
no-chart-selected = 譜面が選択されていません
not-all-ready = すべてのプレイヤーが準備完了していません
cli-contest-cannot-start = 大会を開始できません：{ $reason }
cli-contest-started = ルーム { $room } の大会を開始しました
cli-contest-unknown-subcommand = 不明なサブコマンド。利用可能：enable、disable、whitelist、start

cli-blacklist-empty = IP ブラックリストは空です
cli-blacklist-header = IP ブラックリスト（{ $count } 件）：
cli-blacklist-line =   { $ip }（{ $minutes } 分後に期限切れ）
cli-blacklist-removed = ブラックリストから削除しました：{ $ip }
cli-blacklist-cleared = IP ブラックリストをクリアしました
cli-ipblacklist-unknown-subcommand = 不明なサブコマンド。利用可能：list、remove、clear

cli-usage-approve = 使い方：approve <ssid>（完全な ssid またはプレフィックス短縮コード）
cli-usage-deny = 使い方：deny <ssid>（完全な ssid またはプレフィックス短縮コード）
cli-approve-not-found = 一致する昇格申請が見つかりません：{ $input }
cli-approve-ambiguous = 短縮コード { $input } が複数の昇格申請に一致します。より長いプレフィックスを使用してください
cli-approve-expired = 昇格申請 { $ssid } は期限切れです
cli-approve-already-handled = 昇格申請 { $ssid } は既に { $status } 状態であり、再度処理できません
cli-approve-success = 昇格申請 { $ssid } を承認しました（要求元 IP：{ $ip }）。一時 TOKEN を発行しました
cli-deny-success = 昇格申請 { $ssid } を拒否しました（要求元 IP：{ $ip }）
cli-pending-empty = 保留中の CLI 昇格申請はありません
cli-pending-header = 保留中の CLI 昇格申請（{ $count } 件）：
cli-pending-line =   [{ $ssid }] full ssid: { $full } | IP: { $ip } | 残り { $seconds }秒
