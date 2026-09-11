# Репозитории и существующий контур приёмки Loginom

Проверено 2026-09-10. Это исследование исходников для дизайн-документа; модели,
приёмочные прогоны и Loginom UI этим исследованием не запускались. Наличие теста
или исторического PASS ниже не объявляется новой live-проверкой. Все изменения
исследователя ограничены `evals/`.

## Основной вывод

Для недельного MVP пригодна небольшая внешняя оболочка на TypeScript: запуск
изолированного SUT, сохранение манифеста/существующих traces, отдельный verifier
сохранённого пакета и статический отчёт. В Dock уже есть полезные аудиты raw UI,
полноты таблицы, execution identity и save/reopen; их нижние слои можно вызывать
как закреплённые Python-компоненты. Полные сценарные audit-функции нельзя объявить
универсальным benchmark verifier: они привязаны к конкретным task, fixture,
manifest, формулам и порядку действий одной исторической приёмки.

Первый набор ограничить текстовым импортом и Калькулятором в режиме «Выражение»,
с созданием/открытием пакета и работой с графом из подпланов 01–04. Параметры полей,
Фильтр строк, Группировка, Сортировка, Слияние и Объединение ещё `planned`.
Экспорт отдельным узлом также не входит в подтверждённый набор 01–04; verifier
может читать таблицу независимо, но SUT не следует требовать создать exporter.

## Состояние и закреплённые источники

| Источник | Доступность / прочитанная ревизия | Что действительно установлено |
| --- | --- | --- |
| `/home/george/git/loginom-dock` | Рабочая ветка `rl-bench`, HEAD `dee1d210f91818b6f8d7fb5cfd0454eddcc5044c` | Исходники и актуальные начала handoff/status/README прочитаны. Первоначальный `git status --short` содержал только незакоммиченные `rl-benchmark.md`, `docs/loginom-dock/local-openviking-check.md`, `scripts/openviking-workspace-mcp.mjs`; они не менялись. HEAD не заменяет runtime hash. |
| `/home/george/git/testing/e2e-tests` | Доступен, HEAD `7a41b5adbb9c45dca8d756a8220615554301c2e0` | TestCafe selectors/helpers и тесты мастеров импорта/Калькулятора доступны; в рамках исследования не выполнялись. |
| `/home/george/git/testing/integration` | Доступен, HEAD `c81703ad7a5e077e6ec2417a83192753edbe8400` | Jest/TypeScript запуск пакетов через BatchLauncher и сравнение result/expected файлов; готовые тесты форматов дат и округлений. Развёрнутый BatchLauncher/его конфигурация не проверены. |
| `/home/george/git/testing/agent` | Доступен; `infra/evals` = `b7060d7fe93ed9c64b4bfe7f890985d3a1f8a4d1` | Чужая ветка изучалась командами `git show`/`git ls-tree`, без checkout и изменений. Её рабочее дерево уже находилось на `infra/evals`. |
| `/home/george/git/testing/agent-validation` | Доступен; working branch `master`, `simple-packages` = `8620891564a63d7cf9d9ff513481496bf127a851` | Общий README прочитан из рабочего дерева; маленькие fixtures `sources/simple` изучены через `git show simple-packages:...`, без переключения. |

Актуальный [README подпланов](/home/george/git/loginom-dock/docs/plans/loginom-dock/README.md:3)
различает 01–04 и planned 05–10. Начала
[handoff](/home/george/git/loginom-dock/docs/loginom-dock/agent-handoff.md:3) и
[implementation-status](/home/george/git/loginom-dock/docs/loginom-dock/implementation-status.md:3)
сообщают о Loginom 7.4.2, source runtime и Hermes 45/45 после исправлений ревью.
Production и установленный клиент не обновлялись. Эти сведения являются
зафиксированной исторической приёмкой, а не инвентаризацией текущего стенда.

Известное ограничение: переименование существующего выражения в свободное новое
имя при настроенном выходном mapping может разорвать источник старого поля;
операция честно отказывает. Это не закрытый дефект:
[04-review-followup](/home/george/git/loginom-dock/docs/plans/loginom-dock/04-review-followup.md:58).
Для первого набора разумнее изменение формулы без переименования; edge-case
переименования можно позднее сохранить отдельным ожидаемо провальным regression case.

## Повторное использование Dock

| Компонент / источник | Полезный контракт | Граница использования |
| --- | --- | --- |
| [preflight.py](/home/george/git/loginom-dock/tools/loginom-acceptance/preflight.py:16) | Самостоятельно вычисляет SHA каждого runtime input и общий digest, включая новые lib-модули; читает literal список, не исполняет SUT. `inventory()` сверяет с точным Git commit. | Читать вызовом из внешнего `evals/` без изменений SUT; не включать `__pycache__` вне `evals/` (`PYTHONDONTWRITEBYTECODE=1`). Этот preflight доказывает только source state. |
| [runtime-pin.mjs](/home/george/git/loginom-dock/client/lib/runtime-pin.mjs:4), [session.mjs](/home/george/git/loginom-dock/client/lib/session.mjs:47) | Пофайловые pins, lockfiles, plugin/skill/adapter inputs; сессионная метаинформация о Node, MCP, браузере. | Закреплять фактическую доставленную копию, не только HEAD. Дополнительно нужны hashes задания, данных, verifier и знания Dock. |
| [run.py: manifest](/home/george/git/loginom-dock/tools/loginom-acceptance/run.py:166) | До модели фиксирует исходники harness, task SHA, fixture SHA, budgets, provider/model/reasoning, source inventory, manifest URI/SHA. | Текущая schema фиксирует один специфический goal. Для benchmark — отдельная schema в `evals/`, а не изменение launcher. |
| [run.py: isolation](/home/george/git/loginom-dock/tools/loginom-acceptance/run.py:206) | Свежие private Hermes home/Dock state; отдельный skill, явно выбранные `--toolsets loginom-dock`, `--skills loginom`, память отключена, plugins пусты; процесс имеет отдельную session. | Это полезные hygiene seams, но не OS isolation. Наследуется настоящий `HOME`/`PATH`; один Unix-user потенциально видит соседние каталоги, network/MCP boundaries отдельно не доказаны. |
| [run.py: launch](/home/george/git/loginom-dock/tools/loginom-acceptance/run.py:238) | Явные provider/model/reasoning, `fallback_providers: []`, tool precheck, runtime/harness неизменность перед запуском; экспорт usage/events. | Не запускать в исследовании. Его Mac-only guard нельзя обходить правкой SUT/harness за пределами `evals/`. |
| [calculator_output_evidence.py](/home/george/git/loginom-dock/tools/loginom-acceptance/calculator_output_evidence.py:1) | Ожидания передаются независимо от результата node; проверяются внутренний journal, fresh execution, native table/cells/format. | Сам файл явно не доказывает identity исходных байтов и сохранённого пакета. Не считать API-result или checkpoint эквивалентом доказательства. |
| [import_output_evidence.py](/home/george/git/loginom-dock/tools/loginom-acceptance/import_output_evidence.py:194) | Независимый CSV parse; проверяет node/view/port/schema ownership, row/column totals, Null display, полные cells. | Количество строк проверяемого sample ограничено запрошенным `sample_rows`. Для MVP fixture <= 10 строк и запрос всего fixture обязательны; большой preview не станет полной сверкой. |
| [import_execution_evidence.py](/home/george/git/loginom-dock/tools/loginom-acceptance/import_execution_evidence.py:33) | До/после execution history, новый process id/record, completed child, переход к владельцу и связь с node. | Не доказывает данные/сохранение. Raw-журнал всё ещё собирает клиент SUT: нужен отдельный post-run observer для главного verdict. |
| [calculator_node_acceptance.py](/home/george/git/loginom-dock/tools/loginom-acceptance/calculator_node_acceptance.py:40) | Композитный fail-closed audit task/profile/tool scope, source pins, public calls, graph, delivery, save/reopen, output. | Hardcode `calculator-node-complete`, имя/путь, manifest, четыре node operations, две saves, exact formulas/task fixture. Нельзя импортировать его целиком как бизнес-verifier произвольного решения. |
| [calculator_node_acceptance.py: persistence](/home/george/git/loginom-dock/tools/loginom-acceptance/calculator_node_acceptance.py:124) | Проверяет reopen identity, сохранность semantics, отличный execution id, пустые patch/mappings/inputs при повторе, отсутствие неожиданных мутаций. | Audit читает завершённый trace той же SUT-попытки, не создаёт отдельную verifier session. Требование benchmark строже: постфактум открыть сохранённый артефакт и выполнить его отдельно без исправления. |
| [node_efficiency.py](/home/george/git/loginom-dock/tools/loginom-acceptance/node_efficiency.py:10) | Из существующих events/usage считает public calls, API calls, времена локальных фаз, nullable token counters. | Фазы включают транспорт/ожидание, не равны model latency. Cache/reasoning счётчики могут пересекаться с другими токенами; unknown не заменять нулём. |

Вычисление ожидаемых значений существующего теста отделено от runtime:
[calculator_goal_contract.py](/home/george/git/loginom-dock/tools/loginom-acceptance/calculator_goal_contract.py:27)
читает зафиксированный CSV средствами Python и вычисляет арифметику/Null.
Но цель дополнительно сравнивает написание формулы по токенам и структуру запросов;
для пользовательских benchmark-задач это чрезмерно сильный контракт, если конкретный
синтаксис формулы не потребован публичным заданием. Независимый benchmark oracle
должен разрешать эквивалентные формулы, проверять полные значения и зависимость от
входа. Использовать отдельную контрольную замену входа после попытки либо заранее
описанное structural/data-lineage правило; не выполнять ожидания кодом SUT.

## Подтверждённые локальные ограничения

На 2026-09-10 точечные read-only проверки установили:

- `uname -s` = Linux. `command -v` нашёл Node в `~/.nvm/versions/node/v20.19.2/bin/node`,
  `/usr/bin/python3`, `/usr/bin/docker`, `/usr/bin/google-chrome`,
  `/home/george/.local/bin/codex`; `hermes` в текущем PATH не найден.
- По точным стандартным путям не обнаружены `client/node_modules`, `~/.hermes`,
  `~/.loginom-dock/config.json`. Это не полный поиск нестандартных установок.
- Dock требует [Node 24.19.0](/home/george/git/loginom-dock/client/.node-version:1),
  [MCP 1.30.0 и @playwright/mcp 0.0.80](/home/george/git/loginom-dock/client/package.json:8).
  Наличие системного Chrome не доказывает установку pinned Chromium.
- Существующий [launcher run.py](/home/george/git/loginom-dock/tools/loginom-acceptance/run.py:116)
  явно отказывает на `sys.platform != "darwin"`; это конкретный блокер прямого
  использования launcher здесь. Core
  [session.mjs](/home/george/git/loginom-dock/client/lib/session.mjs:17) поддерживает
  Linux при наличии display; невозможность Linux для самого клиента не доказана.
- Видимый браузер в source уже получает
  [--start-maximized и viewport:null](/home/george/git/loginom-dock/client/lib/session.mjs:58).
  Фактические window/viewport в исследовании этим субагентом не проверялись.
- Документ [operations](/home/george/git/loginom-dock/docs/loginom-dock/operations.md:73)
  содержит исторический Mac checkout `/Users/kartamyshev/Git/loginom-dock` и
  [macOS compatibility profile](/home/george/git/loginom-dock/docs/loginom-dock/operations.md:450).
  Эти пути/manifest нельзя переносить на Linux как подтверждённые.

Здесь не подтверждены: работоспособность Docker daemon, готовность sandbox image,
подключённая Hermes подписка на этом Linux-хосте, Loginom test account/storage,
fresh-session persistence verifier, allowlisted Dock knowledge, отсутствие утечки
через ресурсы/память/сеть. Это обязательные design feasibility gates, а не повод
тихо менять исполнителя, профиль модели или основной код SUT.

## E2E и integration: что полезно взять

Из E2E:

- [format_settings.ts](/home/george/git/testing/e2e-tests/tests/acceptance/wizards/imports/txt/format_settings.ts:32)
  показывает последовательность открытия мастера, настройки UTF-8/заголовков,
  перехода к форматам; строки 83–97 — Execute и сравнение preview. Строки 101–134
  перечисляют delimiters, Null, decimal и другие независимые форматные fixtures.
- [calculator_helpers.ts](/home/george/git/testing/e2e-tests/bg/helpers/wizards/transform/calculator_helpers.ts:384)
  содержит проверки открытого редактора и фактических параметров; строки 463–472
  — reopen/readback выражения, 518 — replacement, 543 — порядок. Это источник
  selector semantics для отдельного Playwright verifier, не готовый drop-in:
  helper завязан на TestCafe, собственные logger/selector/wizard модули.

Из integration:

- [packageRunners.ts](/home/george/git/testing/integration/bg/lib/packageRunners.ts:61)
  принимает точный пакет, endpoint/account/node/variables, запускает установленный
  `Conf.BatchLauncherPath`; параметры подключения могут включать пароль, поэтому
  переносить сырые argv/logs в отчёты нельзя.
- [testPackage.ts](/home/george/git/testing/integration/bg/lib/testPackage.ts:22)
  делает execution, затем [сравнивает result/expected файлы](/home/george/git/testing/integration/bg/lib/testPackage.ts:70).
  Это полезная архитектура независимого oracle, но testdata/export и launcher
  должны существовать. Он сам по себе не подтверждает saved package в Web UI.
- [round.ts](/home/george/git/testing/integration/__tests__/transform/calculator/round.ts:39)
  содержит параметризованные rounding cases; [dates_import.ts](/home/george/git/testing/integration/__tests__/Import/TextFile/Date/dates_import.ts:13)
  явно фиксирует форматы дат и предупреждает о неоднозначном MDY default. Для
  простого MVP разумно оставить явные decimal/Null и не расширять набор датами.

## Что изучено в старом eval-контуре

Все ссылки этого раздела относятся к Git blob ревизии
`b7060d7fe93ed9c64b4bfe7f890985d3a1f8a4d1` ветки `infra/evals`; прочитано через
`git -C /home/george/git/testing/agent show infra/evals:<path>`.

1. `evals/README.md:3–28`: старый SUT — Hermes skill `build-loginom-packages`;
   Promptfoo вызывает provider, затем controller удерживает artifact SHA и
   запускает deterministic browser/oracle graders. Внешний runner/own verifier
   полезны; XML package-building skill SUT здесь не переносится.
2. `evals/README.md:31–44`: отдельные оси lifecycle/validity/package/infra полезны.
   Их `eligible package pass rate` исключает invalid/inconclusive; заимствовать
   этот знаменатель как единственный показатель автономного успеха нельзя.
   Нужен общий success/planned attempts и рядом eligibility/infrastructure.
3. `evals/README.md:65–71,126–130`: controller-owned retained bridge, одноразовый
   handle, exact verifier, SHA package/case bundle; Hermes не участвует в hard
   browser gate. Это полезный образец binding отдельной проверки к артефакту.
4. `evals/EVAL_MASTER_02_SUT_ISOLATION.md:40–66,103–108`: опубликованный статус
   Full-DONE относится к hybrid/model-free scope; live vault и live-model части
   оставались deferred/blocked. Этот код не является подтверждением готовой
   интеграции с текущей подпиской/браузером Dock.
5. Там же `:112–122`: описан реально найденный contamination — SUT читал
   соседний task/generator, потому что controller и workspace совмещались.
   Это напрямую объясняет необходимость OS/tool/resource границы вокруг SUT.
6. `evals/sut_delivery_policy.json:1`: allowlist delivery с roles и публичным
   template полезна. Трансформация или урезание skill/instructions поменяет SUT;
   для Dock сохранять byte-identical SUT, изолируя скрытый benchmark снаружи.
7. `evals/sut_runtime.py`: файл 12 275 строк, сильно связан с Docker guard,
   bubblewrap 0.6.1, leased bridge, image/Hermes attestation. Полный перенос
   существенно превышает минимальные нужды недели; использовать lessons/contracts.
8. `evals/cases/calc-data-double/oracle.yaml:28–59,92–132`: lineage к import,
   `expression_depends_on_inputs`, `reject_literal_only`, запрет static/precomputed
   output. `:132–182` — две контрольные подстановки данных с предзаданными SHA и
   ожидаемой relation factor=2. Контрольный input challenge проще большого
   XML semantic registry, если есть независимый способ безопасно заменить вход.

Точный `calc-data-double` старого набора требует import → calculator → **export**
и smoke tool names. Он не годится без адаптации публичной задачи: exporter не
входит в изученные подпланы 01–04. Код/пакеты SUT через XML генерировать нельзя;
статическое чтение полученного `.lgp` verifier допустимо как дополнительное
свидетельство, но не замена fresh execution и полным значениям.

## Данные и три рекомендуемых сценария

Подтверждённый уже принятыми source-тестами Dock input:
[sales.csv](/home/george/git/loginom-dock/tools/loginom-acceptance/fixtures/data-pipeline/sales.csv:1)
содержит 6 строк, `Id/Region/Quantity/UnitPrice/Comment`, quoted `;`, пустую строку,
`\\N`, ноль и отрицательное количество. Independent
[goal oracle](/home/george/git/loginom-dock/tools/loginom-acceptance/calculator_goal_contract.py:27)
вычисляет Revenue, Adjusted, price replacement, Note и Moment. Это хороший
материал для разработки verifier, но задача исторического acceptance публична
и может быть известна SUT через Dock; для измерения нужен новый маленький fixture
того же класса плюс contamination scan. Новые fixture/эталоны здесь не созданы.

В `agent-validation` branch `simple-packages`, commit
`8620891564a63d7cf9d9ff513481496bf127a851`, прочитаны:
`sources/simple/calc-data-double/README.md:1–28` и
`sources/simple/calc-data-double/data/amounts.csv:1–3` (`Amount=10,20`).
Готовый reference содержит export; брать его целиком в MVP нельзя. Другие
`sources/simple` — grouping/filter/list/variables — за пределами выбранных
data-node подпланов либо не дают нового навыка для MVP. Reference correctness
этих пакетов в текущем Loginom в исследовании не проверялась.

| Case | Публичный смысл | Почему подходит / скрытая проверка | Неверный результат для negative control |
| --- | --- | --- | --- |
| 1. Импорт CSV с типами и Null | Импортировать небольшой CSV с заданными delimiter/UTF-8/Null marker и схемой, сохранить пакет по точному пути. | Подпланы 01–03; 6–8 строк, quoted separator, Null/empty, signed/zero, полные row/schema checks после reopen+fresh execution. Добавить дубликат строки в новый fixture и сравнивать мультимножество, если порядок не задан. | `\\N` прочитан строкой или Null заменён пустой строкой; потерян дубль; один integer стал real/string; пакет есть, но не сохранён после настройки. |
| 2. Вычисления над полями | Создать CSV → Калькулятор: сумма строки из количества и цены плюс производное выражение; сохранить все исходные строки. | Подпланы 01–04; простой independently calculated oracle, десятичные/отрицательные/нулевые значения; граф/import source binding и fresh complete output. Проверить другой предзаданный input на копии изолированных data resources после SUT для запрета literal rows. | Правильные значения только для начального fixture, но literal-only выражение/готовая таблица; неверная зависимость второго выражения; округление вне допусков. |
| 3. Изменение существующего сценария | Открыть публичный starter CSV → Калькулятор с известной старой формулой; изменить бизнес-формулу существующего поля без переименования и сохранить под новым путём, сохранив незапрошенные поля/узлы. | Работа с existing node подтверждена актуальным handoff:33. Starter содержит исходную задачу, но не готовое целевое решение. Независимый verifier проверяет исходный starter hash, неизменность входа/полей, новую формулу через output/input challenge, saved identity и fresh execution. | Создан второй новый расчёт вместо изменения требуемого узла; потеряно исходное поле; сохранилась старая формула; package в неправильном месте. |

Для case 3 нужен новый корректно проверенный starter, созданный через реальный
Loginom UI на закреплённом runtime, а не генератором XML. Если его независимая
подготовка и fresh-session proof не укладываются в ранние 1–2 дня, начать первый
полный цикл с case 1, затем case 2; третий кейс не объявлять готовым до проверки.
Все 3 × 3 — предложение состава серии, а не уже исполненные измерения.

## Что требуется подтвердить до выбора механики

1. Живой Web UI, явный Loginom account/storage и точная совместимость source
   runtime на выбранном execution host; отдельно from production/client.
2. Граница fresh SUT session без inherited context/hidden files/git/memory/MCP
   и сетевых копий эталонов; canary inaccessible через каждый доступный канал.
3. Возможность отдельной verifier-сессии открыть и вновь выполнить точный
   сохранённый `.lgp` без помощи SUT, связав proof с hash/version пакета.
4. Проверка allowlist Dock resources на готовые решения выбранных задач.
5. Способ контрольной замены inputs без изменения вычислительного графа и без
   перезаписи submission; если это недоступно, явный альтернативный structural
   gate и честная граница anti-hardcoding coverage.
6. Корректность каждого нового oracle: hand calculation + независимый UI/engine
   result + negative controls, включая stale execution/недостающую страницу.

Полезные seams найдены; перенос SUT, новый runner и verifier не реализованы.
