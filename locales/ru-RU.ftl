
create-id-occupied = ID комнаты уже занят

join-game-ongoing = Игра уже идёт
join-room-full = Комната заполнена
join-room-locked = Комната заблокирована
join-cant-monitor = Доступ запрещён. Вы не можете наблюдать за этой комнатой.

start-no-chart-selected = Карта не выбрана

http-not-found = Не найдено
http-internal-error = Внутренняя ошибка
http-rate-limited = Слишком много запросов. Пожалуйста, повторите попытку позже

bad-enabled = Отсутствует параметр enabled
auth-unauthorized = Не авторизован
token-expired = Срок действия токена истёк
admin-disabled = Функция администратора отключена
otp-disabled-when-token-configured = OTP отключён, когда настроен токен администратора
bad-request = Неверный запрос
invalid-or-expired-session = Недействительная или истёкшая сессия
ip-mismatch = Несовпадение IP-адреса
pending-approval = Ожидает подтверждения
approval-denied = В подтверждении отказано
token-not-issued = Токен не выдан
ip-banned-too-many-attempts = IP заблокирован из-за слишком большого числа попыток
ssid-banned-too-many-attempts = Сессия заблокирована из-за слишком большого числа попыток
invalid-or-expired-otp = Недействительный или истёкший OTP
bad-token = Токен не может быть пустым
upload-failed = Ошибка загрузки
share-station-not-configured = Станция обмена не настроена
upload-success = Загрузка успешна
user-must-be-disconnected = Пользователь должен быть отключён
user-not-in-room = Пользователь не в комнате
cannot-move-while-playing = Невозможно переместить пользователя во время игры
target-room-not-idle = Целевая комната не находится в режиме ожидания

cli-invalid-port = Неверный номер порта
cli-invalid-http-service = Неверный флаг HTTP-службы
cli-invalid-http-port = Неверный номер HTTP-порта
cli-invalid-room-max-users = Неверный ROOM_MAX_USERS
cli-invalid-monitors = Неверный MONITORS

label-monitor-suffix = (наблюдатель)
replay-recorder-name = Запись повтора

chat-welcome = Привет, «{ $userName }»! Добро пожаловать на { $serverName }!
chat-welcome-version = Сервер работает на версии { $version }
chat-hitokoto = { $quote } — { $from }
chat-hitokoto-from-unknown = Неизвестно
chat-roomlist-title = Доступные комнаты:
chat-roomlist-empty = Нет доступных комнат
chat-roomlist-item = { $id } ({ $count }/{ $max })
chat-disabled-by-server = Чат отключён на этом сервере во избежание проблем с безопасностью.

chat-game-summary =
    Итоги матча:
    { $scoreText }
    { $accText }
    { $stdText }
chat-game-summary-score = Лучший счёт: «{ $name } »({ $id }) { $score }
chat-game-summary-acc = Лучшая точность: «{ $name } »({ $id }) { $acc }
chat-game-summary-std = Лучшая стабильность: «{ $name } »({ $id }) { $std }мс

auth-invalid-token = Недействительный токен
auth-fetch-me-failed = Не удалось получить информацию о пользователе
auth-failed = Ошибка аутентификации
auth-invalid-response = Недействительный ответ аутентификации
auth-invalid-user-id = Недействительный ID пользователя в ответе аутентификации
auth-invalid-user-name = Недействительное имя пользователя в ответе аутентификации
auth-repeated-authenticate = Повторная аутентификация
user-banned-by-server = Вы заблокированы на этом сервере и не можете выполнять никаких действий.

room-already-in-room = Вы уже в комнате
room-creation-disabled = Создание комнат отключено администратором
rooms-limit-reached = Достигнут лимит комнат на сервере, попробуйте позже
room-not-found = Комната не найдена
room-no-room = Вы не в комнате
room-banned = Вам запрещён вход в комнату { $id }
room-not-whitelisted = Вас нет в белом списке этой комнаты
room-only-host = Только хост может это сделать
room-invalid-state = Недопустимое состояние комнаты
room-already-ready = Уже готов
room-not-ready = Не готов
room-game-aborted = Игра прервана

record-invalid = Недействительная запись
record-already-uploaded = Запись уже загружена
record-fetch-failed = Не удалось получить запись
record-chart-mismatch = Запись не соответствует текущей карте

command-rate-limited = Слишком много запросов, пожалуйста, помедленнее

chart-fetch-failed = Не удалось получить карту

server-maintenance = Сервер на техническом обслуживании, подключение временно недоступно
log-auth-rejected-maintenance = Режим обслуживания: новое подключение «{ $user }» отклонено
chat-maintenance-enabled = ⚙️ Сервер перешёл в режим обслуживания, новые игроки приостановлены. Пожалуйста, скорее завершите текущую игру
chat-maintenance-disabled = ✅ Обслуживание сервера завершено, работа в обычном режиме
chat-server-stopping = ⚠️ Сервер скоро остановится на обслуживание; вы будете отключены после текущей игры
chat-waiting-reconnect = ⏳ «{ $user }» неожиданно отключился; ожидание переподключения — игра завершится через { $seconds } с, если он не вернётся
cli-maintenance-status = Режим обслуживания: { $state }
cli-usage-maintenance = Использование: maintenance <on|off|status> [текст уведомления]

net-connection-closed = Соединение закрыто
net-send-timeout = Тайм-аут отправки
net-unsupported-protocol-version = Неподдерживаемая версия протокола: { $version }

roomid-empty = ID комнаты не может быть пустым
roomid-too-long = ID комнаты слишком длинный
roomid-invalid = Недействительный ID комнаты

frame-invalid-length = Недопустимая длина
frame-invalid-length-prefix = Недопустимый префикс длины
frame-payload-too-large = Слишком большой объём данных

binary-unexpected-eof = Неожиданный EOF
binary-length-too-large = Слишком большая длина
binary-string-too-long = Слишком длинная строка

proto-roomstate-tag-invalid = Недопустимый тег RoomState
proto-users-key-missing = Отсутствует ключ users
proto-message-tag-invalid = Недопустимый тег Message
proto-clientcommand-tag-invalid = Недопустимый тег ClientCommand
proto-servercommand-tag-invalid = Недопустимый тег ServerCommand

client-not-connected = Не подключено
client-ping-in-flight = Предыдущий ping ещё не завершён
client-heartbeat-timeout = Тайм-аут пульса
client-timeout = Тайм-аут

log-new-connection = Новое соединение. id={ $id }, remote={ $remote }
log-handshake-ok = Рукопожатие успешно. id={ $id }, version=«{ $version }»
log-handshake-failed = Ошибка рукопожатия. id={ $id }, reason={ $reason }

log-server-version = Версия сервера { $version }
log-runtime-env = Среда выполнения { $platform } node{ $node }
log-server-listen = Прослушивание на { $addr }
log-http-listen = HTTP прослушивает на { $addr }
log-server-name = Имя сервера { $name }
log-server-stopped = Сервер остановлен

log-heartbeat-timeout-disconnect = Тайм-аут пульса. Отключение (id={ $id })
log-auth-ok = Аутентификация успешна. id={ $id }, user=«{ $user }»{ $monitorSuffix }, proto=«{ $version }»
log-auth-failed = Ошибка аутентификации. id={ $id }, reason={ $reason }

log-player-join = Игрок { $user }({ $id }){ $monitorSuffix } присоединился к серверу

log-disconnect = Отключено. id={ $id }{ $who }
log-disconnect-user = , user=«{ $user }»

log-user-disconnect-playing = «{ $user }» отключился во время игры, принудительный выход из комнаты «{ $room }»
log-room-recycled = Комната «{ $room }» освобождена (пуста)
log-user-dangle = «{ $user }» отключился, ожидание переподключения
log-user-dangle-timeout-remove = Тайм-аут переподключения «{ $user }», удалён и покинул комнату «{ $room }»

log-user-chat = «{ $user }» отправил сообщение в чат в комнате «{ $room }»
log-user-touches = «{ $user }» сообщил { $count } кадров касаний в комнате «{ $room }»
log-user-judges = «{ $user }» сообщил { $count } событий судейства в комнате «{ $room }»

log-room-created = «{ $user }» создал комнату «{ $room }»
log-room-joined = «{ $user }»{ $suffix } присоединился к комнате «{ $room }»
log-room-left = «{ $user }»{ $suffix } покинул комнату «{ $room }»

log-msg-create-room = { $user } создал комнату
log-msg-join-room = { $name } присоединился к комнате
log-msg-leave-room = { $name } покинул комнату
log-msg-new-host = { $user } стал новым хостом
log-msg-select-chart = Хост { $user } выбрал карту { $name } (#{ $id })
log-msg-game-start = Хост { $user } начал игру, приготовьтесь
log-msg-ready = { $user } готов
log-msg-cancel-ready = { $user } отменил готовность
log-msg-cancel-game = { $user } отменил игру
log-msg-start-playing = Игра началась
log-msg-played = { $user } закончил игру: { $score } ({ $acc }%){ $fc ->
    [true] , FC
   *[false] {""}
}
log-msg-game-end = Игра окончена
log-msg-abort = { $user } прервал игру
log-msg-lock-room = { $lock ->
    [true] Комната заблокирована
   *[false] Комната разблокирована
}
log-msg-cycle-room = { $cycle ->
    [true] Режим ротации комнаты включён
   *[false] Режим ротации комнаты выключен
}

log-room-lock = «{ $user }» { $lock ->
    [true] заблокировал
   *[false] разблокировал
  } комнату «{ $room }»

log-room-cycle = «{ $user }» { $cycle ->
    [true] включил
   *[false] выключил
  } ротацию хоста в комнате «{ $room }»

log-room-select-chart = «{ $user }»(id={ $userId }) выбрал «{ $chart }» в комнате «{ $room }»
log-room-request-start = «{ $user }» запросил начало в комнате «{ $room }»
log-room-ready = «{ $user }» готов в комнате «{ $room }»
log-room-cancel-game = «{ $user }» отменил игру в комнате «{ $room }»
log-room-cancel-ready = «{ $user }» отменил готовность в комнате «{ $room }»
log-room-played = «{ $user }» загрузил запись в комнате «{ $room }» (score={ $score }, acc={ $acc })
log-room-abort = «{ $user }» прервал игру в комнате «{ $room }»

log-room-host-changed-offline = Хост комнаты «{ $room }» изменён (офлайн): { $old } -> { $next }
log-room-game-start = Начало игры в комнате «{ $room }». users: { $users }{ $monitorsSuffix }
log-room-game-start-monitors = , monitors: { $monitors }
log-room-game-end = Конец игры в комнате «{ $room }» (uploaded={ $uploaded }, aborted={ $aborted })
log-contest-game-results = Результаты турнирной комнаты «{ $room }»: chart={ $chart } results={ $results } aborted={ $aborted }
log-room-host-changed-cycle = Хост комнаты «{ $room }» изменён (ротация): { $old } -> { $next }

log-admin-broadcast = Рассылка администратора: { $message } (отправлено в { $rooms } комнат)
log-gui-console-command = Команда из GUI-консоли: { $command }
log-gui-http-forced = GUI включён, HTTP-сервис запущен автоматически
log-gui-window-launched = Окно GUI открыто: { $url }
log-gui-window-failed = Не удалось автоматически открыть окно GUI. Откройте в локальном браузере: { $url }
log-admin-room-message = Администратор отправил сообщение в комнату «{ $room }»: { $message }
log-room-disbanded-by-admin = Комната «{ $room }» распущена администратором

room-disbanded-by-admin = Комната распущена администратором

log-websocket-connected = WebSocket-клиент подключён, всего соединений: { $total }
log-websocket-disconnected = WebSocket-клиент отключён, всего соединений: { $total }

# ====== Консоль CLI ======

cli-bad-user-id = Неверный ID пользователя
cli-bad-room-id = Неверный ID комнаты
cli-message-empty = Сообщение не может быть пустым
cli-message-too-long = Сообщение слишком длинное (макс. { $max } символов)

cli-stop-hint = Используйте Ctrl+C для остановки сервера
cli-stopping = Завершение работы сервера, подождите...
locales-fetched = Загружено { $count } языковых файлов онлайн
locales-override-applied = Применено переопределение locales/{ $lang }.ftl ({ $count } ключ(ей))
config-auto-created = Файл конфигурации не найден; создан стандартный конфиг: { $path } (отредактируйте и перезапустите для применения)
http-admin-token-missing = HTTP-сервис включён, но ADMIN_TOKEN не задан; все эндпоинты /admin будут отклонены. Используйте pending / approve в CLI для временного доступа или задайте ADMIN_TOKEN в конфигурации.
cli-unknown-command = Неизвестная команда: { $cmd }. Введите 'help' для списка доступных команд
cli-command-failed = Команда не выполнена: { $reason }

cli-help =

    === Команды сервера Phira MP ===
    help                          - Показать эту справку
    list, rooms                   - Список всех комнат
    users                         - Список всех онлайн-пользователей
    user <id>                     - Информация о пользователе
    kick <userId> [preserve]      - Кикнуть пользователя (preserve=true сохранить место в комнате)
    ban <userId>                  - Заблокировать пользователя на сервере
    unban <userId>                - Разблокировать пользователя
    banlist                       - Список заблокированных
    banroom <userId> <roomId>     - Заблокировать пользователя в комнате
    unbanroom <userId> <roomId>   - Разблокировать пользователя в комнате
    broadcast <message>           - Транслировать сообщение
    say <message>                 - Трансляция (псевдоним broadcast)
    roomsay <roomId> <message>    - Отправить сообщение в комнату
    maxusers <roomId> <count>     - Задать макс. число пользователей комнаты
    disband <roomId>              - Распустить комнату
    replay <on|off|status>        - Переключение записи повтора
    roomcreation <on|off|status>  - Переключение создания комнат
    maintenance <on|off|status> [сообщение]  - Режим обслуживания (пауза новых игроков)
    contest <roomId> <subcommand> - Управление турнирной комнатой
      contest <roomId> enable [userIds...]    - Включить турнирный режим
      contest <roomId> disable                - Выключить турнирный режим
      contest <roomId> whitelist <userIds...> - Задать белый список
      contest <roomId> start [force]          - Начать турнир
    ipblacklist <list|remove|clear> - Управление чёрным списком IP
    pending                       - Список всех ожидающих запросов на повышение CLI
    approve <ssid>                - Одобрить запрос на повышение CLI и выдать временный TOKEN (принимает префикс ssid)
    deny <ssid>                   - Отклонить запрос на повышение CLI (принимает префикс ssid)
    stop, shutdown                - Корректно остановить сервер

cli-no-rooms = Сейчас нет комнат
cli-rooms-total = Всего комнат: { $count }
cli-room-line = [{ $id }] { $state } | Игроки: { $users }/{ $maxUsers } | Наблюдатели: { $monitors } | Карта: { $chart } | Заблокирована: { $locked } | Ротация: { $cycle } | Турнир: { $contest }

cli-no-users = Нет пользователей онлайн
cli-users-total = Всего пользователей: { $count }
cli-user-line = [{ $id }] { $name } | { $status } | { $role } | Комната: { $room }{ $bannedTag }
cli-user-status-online = Онлайн
cli-user-status-offline = Офлайн
cli-user-role-monitor = Наблюдатель
cli-user-role-player = Игрок
cli-user-banned-tag =  [ЗАБЛОКИРОВАН]
cli-none = Нет
cli-yes = Да
cli-no = Нет
cli-state-on = Включено
cli-state-off = Выключено
cli-room-state-playing = Игра
cli-room-state-waiting = Ожидание готовности
cli-room-state-select = Выбор карты
cli-bool-yes = Да
cli-bool-no = Нет

cli-usage-user = Использование: user <userId>
cli-usage-kick = Использование: kick <userId> [preserve]
cli-usage-ban = Использование: ban <userId>
cli-usage-unban = Использование: unban <userId>
cli-usage-banroom = Использование: banroom <userId> <roomId>
cli-usage-unbanroom = Использование: unbanroom <userId> <roomId>
cli-usage-broadcast = Использование: broadcast <message>
cli-usage-roomsay = Использование: roomsay <roomId> <message>
cli-usage-maxusers = Использование: maxusers <roomId> <count>
cli-usage-disband = Использование: disband <roomId>
cli-usage-replay = Использование: replay <on|off|status>
cli-usage-roomcreation = Использование: roomcreation <on|off|status>
cli-usage-contest = Использование: contest <roomId> <enable|disable|whitelist|start>
cli-usage-ipblacklist = Использование: ipblacklist <list|remove|clear>
cli-usage-ipblacklist-remove = Использование: ipblacklist remove <ip>

cli-user-not-found = Пользователь не найден: { $id }
cli-user-info-header = Информация о пользователе:
cli-user-info-id =   ID: { $id }
cli-user-info-name =   Имя: { $name }
cli-user-info-status =   Статус: { $status }
cli-user-info-role =   Роль: { $role }
cli-user-info-room =   Комната: { $room }
cli-user-info-banned =   Заблокирован: { $banned }
cli-user-info-game-time =   Игровое время: { $time }
cli-user-info-language =   Язык: { $lang }

cli-user-not-connected = Пользователь не подключён: { $id }
cli-user-kicked = Пользователь кикнут: { $id }
cli-user-banned = Пользователь заблокирован: { $id }
cli-user-unbanned = Пользователь разблокирован: { $id }
cli-no-banned-users = Нет заблокированных пользователей
cli-banned-list-header = Заблокированные пользователи ({ $count }):
cli-room-user-banned = Пользователь { $userId } заблокирован в комнате { $room }
cli-room-user-unbanned = Пользователь { $userId } разблокирован в комнате { $room }
cli-broadcast-sent = Трансляция в { $count } комнат
cli-room-not-found = Комната не найдена
cli-room-not-found-named = Комната не найдена: { $room }
cli-room-message-sent = Сообщение отправлено в комнату { $room }
cli-bad-max-users = Неверное число (1-64)
cli-room-max-users-set = Установлено макс. число пользователей комнаты { $room }: { $count }
cli-room-disbanded = Комната { $room } распущена

cli-replay-status = Запись повтора: { $state }
cli-replay-toggled-on = Запись повтора включена
cli-replay-toggled-off = Запись повтора выключена
cli-room-creation-status = Создание комнат: { $state }
cli-room-creation-toggled-on = Создание комнат включено
cli-room-creation-toggled-off = Создание комнат выключено

cli-contest-enabled = Турнирный режим включён для комнаты { $room }
cli-contest-disabled = Турнирный режим выключен для комнаты { $room }
cli-contest-no-user-id = Укажите хотя бы один ID пользователя
cli-contest-not-enabled = Комната не найдена или турнирный режим не включён
cli-contest-whitelist-updated = Белый список комнаты { $room } обновлён
contest-room-not-found = Турнирная комната не найдена
room-not-waiting = Комната не ожидает готовности
no-chart-selected = Карта не выбрана
not-all-ready = Не все игроки готовы
cli-contest-cannot-start = Невозможно начать турнир: { $reason }
cli-contest-started = Турнир начат для комнаты { $room }
cli-contest-unknown-subcommand = Неизвестная подкоманда. Доступно: enable, disable, whitelist, start

cli-blacklist-empty = Чёрный список IP пуст
cli-blacklist-header = Чёрный список IP ({ $count }):
cli-blacklist-line =   { $ip } (истекает через { $minutes } минут)
cli-blacklist-removed = Удалено из чёрного списка: { $ip }
cli-blacklist-cleared = Чёрный список IP очищен
cli-ipblacklist-unknown-subcommand = Неизвестная подкоманда. Доступно: list, remove, clear

cli-usage-approve = Использование: approve <ssid> (полный ssid или короткий префикс)
cli-usage-deny = Использование: deny <ssid> (полный ssid или короткий префикс)
cli-approve-not-found = Не найден ожидающий запрос на повышение: { $input }
cli-approve-ambiguous = Короткий код { $input } соответствует нескольким запросам на повышение; используйте более длинный префикс
cli-approve-expired = Срок запроса на повышение { $ssid } истёк
cli-approve-already-handled = Запрос на повышение { $ssid } уже в состоянии { $status } и не может быть обработан повторно
cli-approve-success = Запрос на повышение { $ssid } одобрен (IP запросившего: { $ip }); выдан временный TOKEN
cli-deny-success = Запрос на повышение { $ssid } отклонён (IP запросившего: { $ip })
cli-pending-empty = Нет ожидающих запросов на повышение CLI
cli-pending-header = Ожидающие запросы на повышение CLI ({ $count }):
cli-pending-line =   [{ $ssid }] полный ssid: { $full } | IP: { $ip } | осталось { $seconds }с
