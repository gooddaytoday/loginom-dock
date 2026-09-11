# Исполнитель и границы изоляции Loginom benchmark

Дата проверки: 2026-09-10. Статус: исследование для дизайн-документа; модели,
контейнеры и новые браузеры не запускались, SUT и настройки не изменялись.
Исходники исследованы в checkout с HEAD
`dee1d210f91818b6f8d7fb5cfd0454eddcc5044c`. Это идентификатор исследования,
а не утверждение, что установленный клиент или production имеют ту же ревизию.

## Вывод

Codex остаётся предпочтительным первым исполнителем. Локальный CLI поддерживает
автономный запуск, поток событий и изолированную конфигурацию; технического
основания отклонять его не найдено. Измеряемая попытка должна запускаться новым
процессом в проверенной внешней песочнице, а не продолжением текущей задачи
Desktop с исследовательским контекстом и доступом к репозиторию.

Для недельного MVP разумен небольшой TypeScript runner, rootless Docker и
штатный `codex exec`. Сложный auth broker, универсальный knowledge gateway и
экспериментальный remote exec-server не нужны в обязательном пути. Однако
первый измеряемый запуск допустим только после проверок доступа к эталонам,
секретам, чужим пакетам Loginom и данным прошлых попыток. Если эти условия
не обеспечены на имеющемся стенде, первый цикл считается диагностическим;
это ограничение среды, а не доказательство непригодности Codex.

## Подтверждённое локальное состояние

| Проверка | Наблюдение | Следствие |
| --- | --- | --- |
| ОС | Linux 7.0.0-28-generic, x86_64, UID 1000 | Это не Mac исторической Hermes-приёмки |
| `codex --version`, `codex exec --help` через PATH | Wrapper прекращает работу с сообщением, что Happ VPN не активен | До CLI дело не дошло; это не ограничение CLI |
| Offline `--version` и `exec --help` настоящего бинарника | `/home/kiselev/.local/bin/codex`, `codex-cli 0.153.4` | Проверены только справка/версия; модель и auth не использовались |
| Поддержка CLI | `exec`, `--json`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--strict-config`, `--skip-git-repo-check`, `--sandbox`, `--output-schema`, `--output-last-message`, `--model`, `--config` | Тонкий внешний адаптер возможен; `--ignore-user-config` оставляет auth в `CODEX_HOME` |
| Локальные Codex model defaults | Из `~/.codex/config.toml` выведены только model-related поля: `model = gpt-6-astra`, `model_reasoning_effort = ultra`; `model_provider` и `profile` отсутствуют | Это локальный default, не effective profile будущего запуска: CLI/managed overrides и фактический usage не проверены. Переносить профиль надо явно; незаметно заменить на Sol/low нельзя |
| Docker | 27.4.1; `docker info` вернул `seccomp` builtin, `rootless`, `cgroupns` | Rootless daemon работает. Только read-only daemon query; образы, volumes и контейнеры не изменялись |
| Sandbox-инструменты | `/usr/bin/bwrap`, `/usr/bin/unshare` присутствуют | Наличие проверено; проба конфигурации будущей песочницы ещё не проводилась |
| Podman | executable присутствует; даже info/version wrapper получил ошибку создания `/run/user/1000/libpod` в read-only окружении | Работоспособность Podman не подтверждена; он не нужен при доступном Docker |
| Hermes | `/home/kiselev/.local/bin/hermes` доступен в PATH; состояние `~/.hermes` и live profile не проверялись | Наличие бинарника не доказывает подписку, effective profile или готовность к запуску |
| Dock client | `~/.loginom-dock` существует | Наличие state directory не доказывает, что клиент установлен, настроен или готов к runtime |

Сначала daemon socket был недоступен из sandbox текущей задачи. Повторный
read-only `docker info --format '{{json .SecurityOptions}}'` с разрешённым
автоматической проверкой доступом подтвердил rootless. Это не проверяет запуск
целевого image, nested sandbox или графическую сессию.

## Codex: подтверждения официальной документацией

- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
  подтверждает программный `codex exec`, JSONL событий, ephemeral sessions и
  обязательный MCP server. Поток может включать reasoning: runner должен
  фильтровать события до сохранения, а не записывать сырой stdout. Последнее
  сообщение и exit code не являются оценкой результата Loginom.
- [Authentication](https://learn.chatgpt.com/docs/auth) подтверждает доступ CLI
  по подписке ChatGPT и сохранённую auth-сессию. Отдельная покупка API не является
  обязательным условием. Токены обновляются автоматически; перенос auth требует
  отдельного управления жизненным циклом. `auth.json` нельзя отдавать инструментам
  модели, включать в evidence или размножать конкурентными refresh-процессами.
- [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)
  описывает deny-read filesystem rules, shell/environment restrictions,
  `hide_agent_reasoning`, отключение shell, MCP allowlist и domain rules.
  Domain rules защищают sandboxed commands, только когда включён network proxy;
  они **не ограничивают MCP, apps и web search**. Поэтому их недостаточно для
  общей сетевой границы benchmark.
- [Sandbox](https://learn.chatgpt.com/docs/sandboxing) подтверждает OS enforcement
  для spawned commands и использование bubblewrap на Linux. Обычный read-only
  режим относится к правам, а не к отсутствию скрытых читаемых данных.
- [MCP](https://learn.chatgpt.com/docs/extend/mcp) подтверждает `required`,
  `enabled_tools` и `disabled_tools`. Сам список доступных tools проверяется
  перед запуском, а не выводится из одного config-файла.
- [App Server](https://learn.chatgpt.com/docs/app-server) позволяет запрашивать
  effective config, tools и account state, а также работать с внешними ChatGPT
  tokens. Последний режим экспериментальный. Для MVP это резерв исследования,
  не обязательная новая подсистема. Локальный `exec-server --help` тоже помечен
  EXPERIMENTAL; его наличие не равно проверенной интеграции.

Справка локального CLI и текущая официальная документация были реально открыты.
Managed account availability и выполнение выбранной моделью не проверялись.
Точный модельный профиль Codex фиксируется до baseline; модель не подменяется
из-за ошибки доступности. Для Hermes профиль уже определён правилами проекта.

## Что можно переиспользовать из проекта

1. [preflight.py](../../../tools/loginom-acceptance/preflight.py) воспроизводит
   runtime pin из буквального списка и всех `.mjs`/`.d.ts` client/lib, учитывает
   working bytes, отвергает escaping symlinks и связывает inventory с build inputs.
   Использовать этот контракт через внешний адаптер; HEAD без hashes недостаточен.
2. [run.py](../../../tools/loginom-acceptance/run.py) фиксирует явные
   `openai-codex / gpt-5.6-sol / low`, `fallback_providers: []`, отдельный
   `HERMES_HOME`, единственный `loginom-dock` toolset и native Loginom skill,
   лимиты, process group, исходный prompt, manifest URI/SHA и harness hashes.
   После запуска сверяет actual usage identifiers и неизменность исходников.
3. Тот же `run.py` в `validate_inputs` требует `sys.platform == "darwin"`.
   Его нельзя назвать готовым Linux runner или незаметно исправить ради MVP:
   нужен внешний `evals/` адаптер к штатным интерфейсам. Пути переопределяемы
   CLI, но platform gate от этого не исчезает.
4. [hermes_auth_guard.py](../../../tools/loginom-acceptance/hermes_auth_guard.py)
   блокирует import/recovery Codex CLI tokens и refresh Hermes connection.
   `connection()` требует существующую Hermes ChatGPT-сессию и срок действия
   access token больше 4200 секунд. Auth guard проверяет только известную
   реализацию Hermes; неизвестная версия прекращает запуск.
5. [session.mjs](../../../client/lib/session.mjs) реально поддерживает
   darwin/linux/win32, отдельные browser profile/artifacts/session ID,
   закреплённые Node/MCP/Playwright/Chromium, `--start-maximized` и `viewport: null`
   для видимого браузера. Linux требует DISPLAY или WAYLAND_DISPLAY.
6. [Codex Loginom skill](../../../plugins/loginom-dock/skills/loginom/SKILL.md)
   требует `dock_prepare`, штатные typed executor operations, recovery knowledge
   из E2E/Help. Он не требует произвольного shell для сценарного executor-пути.
   Замораживается без добавления benchmark-инструкций или готовых решений.
7. [README acceptance](../../../tools/loginom-acceptance/README.md) содержит
   исторический Luna/medium, `/user` и Mac. Это не актуальный default: действующие
   AGENTS и исходники задают Sol/low и явную Loginom identity/storage destination.

Существующий новый home полезен для отсутствия прошлой истории, но не обеспечивает
полноценную изоляцию: `environment()` сохраняет настоящий `HOME`, процессы
используют того же OS-пользователя, а runtime/config и fixtures находятся в
доступном checkout. `--toolsets loginom-dock` сужает инструментальный интерфейс,
но не доказывает файловые, сетевые и серверные ACL.

## Минимальная техническая граница

Trusted runner, SUT и verifier имеют разные права. Runner знает приватные
ожидания и выделяет ресурсы, но передаёт SUT только публичный envelope.
Verifier получает сохранённый артефакт после остановки SUT и новую сессию;
не подсказывает, не исправляет пакет и не использует ответы SUT как эталон.

| Канал | Предлагаемый механизм | Обязательная проверка перед baseline |
| --- | --- | --- |
| Файлы | Rootless container с read-only frozen runtime и public case inputs; writable только run workspace/state; private fixtures и research/docs вообще не монтируются | Canary за границей отсутствует/недоступен; symlink/path traversal не открывает host |
| Git | SUT bundle без `.git`, objects, worktrees, alternates и remote credentials; исходный repo не монтируется; Git requirement снимается штатным CLI flag | `git show`, alternate object path и parent traversal не получают историю/эталоны |
| Shell/processes | Native Codex minimal filesystem rules, deny auth/control paths, запрещённое повышение прав; только declared tool surface; PID namespace, без host `/proc`, ptrace и Docker socket | Проверены built-in FS, shell и `/proc` маршруты; доступ к runner/verifier/auth невозможен |
| Конфигурация/контекст | Новый процесс, свежий HOME/CODEX_HOME, allowlisted frozen instructions/skills и единственный Dock MCP; без resume/fork, parent turns, personal hooks/plugins/config | Effective config/tool catalog/skill hashes совпадают; контрольные старые context markers не попали в prompt |
| Auth | Trusted credential provisioning, минимальная auth state, исключённая из model-readable filesystem и tool subprocess environment; serialized refresh ownership | Canary вместо настоящего секрета нельзя прочесть всеми доступными каналами; auth mode/profile проверены без credentials |
| MCP | Один Dock MCP через заранее проверенную конфигурацию; отдельный процесс/container не имеет private fixtures; personal memory/connector MCP отсутствуют | tools/list совпадает с manifest; нет raw host/browser escape и доступа к memory provider |
| Browser | Свежий профиль и отдельная графическая сессия; браузерный процесс не видит auth/hidden mounts; rootless/network restrictions вне модели | Новая session, фактические maximized window/viewport, недоступны чужие tabs/profiles, file URLs и arbitrary origins |
| Network | Default deny наружу; только Loginom target и разрешённые Dock endpoints, а модельный транспорт только у trusted executor; без host networking, metadata endpoints и обхода proxy | HTTP(S), redirects, DNS/IP literals, localhost, WebSocket и MCP browser egress проверены; domain-only config не считается достаточным |
| Dock knowledge | Разрешённый frozen набор продуктовых E2E/Help/catalog resources; запрет личной памяти, прошлых traces, benchmark docs/fixtures | Scoped search/read/list возвращают только разрешённое; заранее проверен поиск готового решения каждого case |
| Loginom | Явно выбранный authenticated test principal с проверенными правами либо одноразовый reset изолированного стенда; только текущие public inputs/outputs | Чужие/прошлые пакеты недоступны и известный контрольный hidden package нельзя открыть из UI/storage |
| Evidence | SUT не монтирует verdict, expected, verifier code и прошлые traces. После stop runner замораживает артефакт и hashes | Повторное открытие verifier связано с этим артефактом; hashes проверены до/после, нет write-back от SUT |

Для контейнерного видимого браузера нужен отдельный X server/window manager и
просматриваемый оператором desktop, например через готовое VNC/noVNC решение.
Монтирование X socket обычной пользовательской сессии связывает clipboard и окна
с host и ослабляет границу. Даже при отдельном display сохраняются максимизация,
`viewport: null` и проверка реального размера. Это ещё не было испытано.

Docker не скрывает данные, специально смонтированные в контейнер. Read-only mount
также не скрывает секрет. Auth file внутри одного unrestricted UID с shell можно
прочесть; секреты в env доступны дочерним процессам. Поэтому сочетание «container
+ новый home + copied auth.json» без native restrictions и canary-тестов не
позволяет заявлять защищённый benchmark. Если штатные ограничения установленного
Codex не обеспечивают это на выбранной ОС, минимальный следующий шаг — отдельная
VM/OS identity и инструментальный процесс без model credentials, а не ослабление
границы или тайное переключение модели.

Важный остаточный предел: разрешённый модельный провайдер получает публичную
задачу и допустимые наблюдения по назначению. Default-deny egress и canary tests
не доказывают отсутствие kernel/runtime уязвимостей. Заявляем конкретные
проверенные границы, не абсолютную невозможность любой утечки.

## Loginom и знания: развилки, влияющие на достоверность

Одна папка `/.../benchmark/<run_id>` внутри общего passwordless аккаунта не
является ACL. Если этот аккаунт видит прошлые решения, агент может открыть их
через штатный storage UI, даже когда host filesystem идеален. Для полноценного
baseline нужны либо права выделенного аутентифицированного test principal,
который не видит чужие пакеты, либо disposable Loginom instance/data volume с
предварительно известным чистым состоянием. Переиспользовать principal между
последовательными попытками можно только после подтверждённого удаления именно
benchmark-owned прошлых данных и выгрузки evidence за его область доступа.
Создавать аккаунты, менять server ACL или reset production на этапе дизайна нельзя.

Для Dock сначала проверить штатные возможности scoped token/resource ACL.
Если прав достаточно, отдельный gateway избыточен. Если нужной границы нет,
узкий внешний read-only MCP proxy может проверять `target_uri`/`uri` и returned
resource references по immutable allowlist. Он сохраняет стандартные MCP/OpenViking
API; не импортирует репозитории и не переписывает SUT. Просто фильтра запросов
недостаточно, если ответ содержит чужой snippet/готовое решение: нужен проверенный
корпус и запрет открытого search/read за его границей. Это изменение доступных
знаний фиксируется в manifest; его нельзя смешивать со штатным полным корпусом.

Нельзя решить отсутствие пригодных ACL построением за неделю универсальной
knowledge/search платформы. Если небольшой проверяемый adapter не укладывается
в первые дни, фиксируется `diagnostic_only` и конкретная инфраструктурная
предпосылка полноценной серии. Скрытые benchmark материалы вообще не публикуются
в Dock; разрешённые публикации требуют своего согласованного manifest.

## Оценка объёма и stop conditions

Инженерная оценка, а не результат испытаний: 0.5–1 день на prepared bundles,
rootless image/config и canary preflight при готовом Loginom principal/ACL;
0.5–1 день на один публичный case, автономную попытку, freeze saved package и
отдельный verifier/report. Остальная неделя — расширение до 3×3 и mutation
checks. Новый Loginom deployment, отсутствующая подписка на выбранном хосте или
сложный auth broker могут вывести MVP за срок, поэтому это ранние go/no-go gates.

- Не найден runtime/подписка/выбранная модель: `INFRA_ERROR` до модели, без fallback.
- Изоляция или canary не прошли: измеряемую попытку не начинать; отдельно
  разрешённый диагностический запуск не входит в denominator benchmark.
- Модель уже началась и не решила задачу/исчерпала бюджет: исходная попытка
  сохраняется; повторный старт не заменяет её.
- Hermes на текущем Linux не установлен, существующий acceptance launcher
  запрещает Linux: нельзя обещать готовый fallback здесь. Использовать уже
  подключённый Hermes на одобренном host после отдельного preflight, с тем же
  `openai-codex / gpt-5.6-sol / low` и без изменения auth connection.
- Итоговая автономная проектная Hermes-приёмка остаётся отдельным обязательством;
  Codex baseline не заменяет её и результаты двух исполнителей не смешиваются.

## Что остаётся непроверенным

Полный canary matrix, isolation image, graphical browser, live Loginom account/ACL,
чистота knowledge corpus, модельный вызов и effective model identifiers,
fresh execution verifier и контейнерная интеграция Dock не испытаны. В текущем
исследовании подтверждены пригодность CLI, rootless Docker и контракты source
runner; ни одна успешная автономная Loginom попытка из этого не следует.
