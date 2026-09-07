## 7 сентября 2026 — продолжение после тематической фиксации

Наработки сохранены коммитами, [проверки и состав](implementation-status.md)
зафиксированы. Runtime клиента сохранил SHA d35ee7f6…fa3; новые Hermes-прогоны,
deploy и установка не выполнялись. Резервная копия исходного состояния:
`.dock/commit-split-20260907-211544/`.
Продолжать с [подплана 02](../plans/loginom-dock/02-add-nodes.md) и контрактов 03.
Пять удалений benchmark/locomo/openclaw не включены в коммиты и требуют отдельного
выяснения происхождения. Не считать их частью реализации Loginom Dock.

## 7 сентября 2026, 20:57 МСК — реализован подплан 01

Текущая точка: [контракт подготовки workspace](workspace-preparation.md).
Новый черновик, открытие точного пакета и возврат к точному workflow реализованы
через существующий `dock_prepare`. Подготовка имеет квитанцию, document/workflow
identity и именованные ожидания; повтор не создаёт дубль. Новый Hermes-профиль
Sol/low закреплён в launcher, evidence, audit и admission.

Последний самостоятельный прогон `20260907-205626-3110e56a`: **17/17 PASS**,
3 API calls; активных прогонов нет. Private evidence `.dock/open-draft-v1/`.
Следующий этап — 02, общий драйвер добавления/связей с проверкой полученного
workflow и drag readiness. 03 реализует полный node.apply. Production и
установленный клиент не обновлялись. Прежние checkpoint-записи ниже — история.

---

# Историческая точка — переработка плана до реализации 01, 7 сентября 2026

Пользователь запросил переработку существующего плана под согласованную реализацию.
[Новая каноническая редакция](../plans/2026-09-02-loginom-dock-implementation-plan.md)
определяет восемь типов первого выпуска, полный локальный цикл node.apply,
проверку выхода без штатного wizard reopen, UI-резерв и сохранения по этапам.

Профиль всех будущих Hermes-прогонов: openai-codex / gpt-5.6-sol / low.
Фактический launcher/audit/admission ещё не переключены; новые прогоны в этой
документационной задаче не запускались. Новый полный node.apply не реализован.
Следующий технический этап — V1: закрепить subset/контракты, согласовать профиль
запуска и проверок, затем V2 — полный цикл импорта и безопасное recovery.
Подготовлены [десять отдельных подпланов](../plans/loginom-dock/README.md).
Начать с [01 — открытия Loginom и черновика](../plans/loginom-dock/01-open-loginom-draft.md)
и контрактов 02/03; далее импорт, Калькулятор, Группировка и Сортировка для V3.
Другие четыре обработчика идут после общей основы; V5 сохраняется в основном плане.
Все подпланы пока planned, новая реализация этой декомпозицией не начата.

Последний зафиксированный runtime-факт остаётся прежним:
20260907-172236-0bae3c10 — frozen audit 25/27, не PASS, отказ до клика
UnitPrice/data_kind на шаге 37. Локальный MCP-native PASS 24,948 с и более ранний
Hermes PASS 54/54 относятся к своим прежним pins. Они не доказывают новый цикл
или Sol/low. Последнее записанное состояние idle/мастер формата не является
проверкой текущего живого браузера.

Ниже сохранены прежние evidence, SHA и диагноз. Старые «первое действие»,
§13.2а/P3 и Luna/medium — исторические инструкции; актуальная очередь находится
в новом плане. Код, установленный клиент, production и старые audits не менялись.

---

## Историческая точка P3 — 7 сентября 2026

**ОСТАНОВЛЕНО по просьбе пользователя 7 сентября.** Новые исправления и
Hermes-прогоны не запускать до команды продолжения. Активных прогонов нет.

Последний run `20260907-172236-0bae3c10` завершён: 58 API calls, returncode 0,
timed_out=false. Frozen audit **25/27, НЕ PASS**, SHA256
`2fcfcc9226920c17746a7204f6e0f3105be5ac6efcfb66719f8b6c8dae6faa8e`.
Не пересчитывать этот audit. Предыдущий PASS 54/54 (`20260907-170150-12a754e8`)
относится к прежней конфигурации; новый settle:0 не принят через Hermes.
Полный P3 не принят.

Безопасная остановка проверена: процессы Hermes/MCP helper PID 39190/39191
отсутствуют; все prepared и node_step_prepared имеют завершённые квитанции.
Последнее наблюдение `5cebd8e3-5ad5-4d28-822a-365d02981afd`: мастер
text_import_format, операция idle. Hermes отказался от продолжения частичной
настройки и разрешил последующую неудачную попытку возврата на источник.
Сохранение через «Готово» и сохранение пакета не подтверждены. Это последнее
записанное UI-состояние; сохранность черновика после закрытия браузера не доказана.

В `client/lib/session.mjs` внесено `timeouts.settle: 0` для executor-preview /
executor-replay. Playwright dependency и guards не изменены. MCP-native проход
`mcp-zero-1788790834304`: 24,948 с, 65 шагов, локальный независимый proof PASS.
Тесты: 405 client PASS, 1 Windows-only skip; 228 Python PASS. Runtime последней
попытки: `efbb8c26efa06f424e2a93ca74defcd63c8d1ad043d125af8b9f251959c1117d`.
Все незавершённые изменения сохранены; этой правкой commit/deploy/reinstall
не выполнялись.

**Точка отладки:** configure-text-import-001 остановилась на внутреннем шаге 37,
клик picker «Вид данных» у UnitPrice. Шаг 36 подтвердил редактор index:3,
property:data_kind, значение «Дискретный», тип real за 117 мс. До клика изменилась
DOM epoch. Шаг 37: NOT_APPLIED / UI_EPOCH_CHANGED / phase preconditions /
effect_possible=false / cleanup_complete=true; trace — только начало наблюдения
и отказ. Клик не выполнен. Предыдущие настройки уже частично изменены, поэтому
родитель правильно остался AMBIGUOUS, settings_readback_verified=false.

**Первое действие после продолжения:** Codex воспроизводит гонку в живом UI /
настоящем MCP с settle:0. Ограниченная локальная обработка доказанного отказа
до жеста лишь СПЛАНИРОВАНА, НЕ РЕАЛИЗОВАНА: заново выполнить именованное ожидание,
проверить тот же документ/узел/целевой элемент и повторить попытку только при
строгой квитанции отсутствия эффекта. Ограничить число обновлений и deadline;
журналировать отказ и новое чтение. Auditor должен независимо проверять цепочку.
Не ослаблять epoch guard и не повторять жест с неизвестным/возможным эффектом.
Негативные тесты и Codex-native воспроизведение выполнить до нового Hermes run.

Отдельно разобрать failed gates pipeline_exactly_one_upload_and_verify и
node_import_internal_roundtrip. Не считать первую ошибкой аудитора до разбора
обоих upload requests. Проверка экспортированных settings показала Null длиной
2 символа (один обратный слеш и N); отдельная ошибка этого параметра не подтверждена.

Пользователь дважды отметил длительность всей задачи: десятки внешних вызовов
Hermes на подготовку/навигацию/исправления остаются медленными. В замерах разделять
подготовку, локальную настройку и восстановление; ускорение одного участка не
означает ускорения всего сценария.

Канонический порядок — план §13.2а. История прежних итераций сохранена в
[архиве checkpoint](checkpoints/2026-09-06-before-run215646.md).

**Реализация закреплена вариантом 2:** локальные операции настройки узла,
сначала импорт, затем Калькулятор. Основную отладку выполняет текущая модель
Codex; Hermes / ChatGPT / gpt-5.6-luna / medium запускается после отладки для
итоговой самостоятельной приёмки. Её независимый PASS — критерий успеха.
Видимый браузер: `--start-maximized`, `viewport: null`, с проверкой фактического
размера. Первый живой разбор и контракт выполнены; повтор неизменного calculator-roundtrip не является
следующим шагом. Правила обычной проверки и приёмочного reopen разделены в
[плане §13.3](../plans/2026-09-02-loginom-dock-implementation-plan.md#node-level-operations).

## Диагностика разницы скорости Codex / Hermes — 7 сентября

Пользователь спросил, почему одинаковые действия в прямой диагностике заметно
быстрее Hermes. По журналам окончательной версии: direct native
`integrated-1788789489572` — 25,046 с; Hermes `20260907-170150-12a754e8` —
82,818 с. В обоих случаях 22 действия, их browser trace занимает 15,786 / 16,781 с.
43 ожидания занимают соответственно 8,304 / 51,166 с.

Причина найдена в установленном закреплённом Playwright MCP: `browser_run_code_unsafe`
оборачивает каждый вызов в `waitForCompletion`, который после callback делает
`waitForTimeout(config.timeouts.settle ?? 500)`; при сетевых запросах возможна
дополнительная такая пауза. В конфигурациях обеих сессий принятого Hermes-run
есть action/navigation, но settle отсутствует. Прямой native driver вызывает
тот же обработчик напрямую через Playwright, без MCP-обёртки. 44 samples × 2
вызова (roots/detail) + 22 действия = 110 внутренних вызовов, то есть минимум
около 55 секунд фиксированных пауз. Это почти вся наблюдаемая разница 57,772 с;
доля оставшихся накладных расходов отдельно не измерена.

По команде пользователя «давай уберем» `client/lib/session.mjs` теперь задаёт
`timeouts.settle: 0` для executor-preview и executor-replay. Classic/research
сохраняют свой прежний default. Зависимость Playwright не изменяется; штатные
семантические ожидания и guards Dock сохранены.

Codex-диагностика через настоящий MCP (не прямой Playwright), созданный штатным
`createSession`, прошла: `mcp-zero-1788790834304`, 65 шагов, 24,948 секунды,
независимый локальный proof PASS. Проверены четыре режима конфигурации,
maximized/viewport:null и фактическое окно 2044×1035. Тесты: 405 client PASS,
1 Windows-only skip; 228 Python PASS. Далее — итоговый Hermes/Luna/medium run
с новым runtime pin; прежний PASS остаётся доказательством прежней конфигурации.
Запущен `20260907-172236-0bae3c10`, handle 16434; runtime pin
`efbb8c26efa06f424e2a93ca74defcd63c8d1ad043d125af8b9f251959c1117d`.
Прогон завершён и audited; состояние остановки — сверху документа.

## Вариант 2 — текущая реализация

Добавлены локальные модули `client/lib/node-procedure.mjs` и
`client/lib/text-import-procedure.mjs`; операция `node.configure_text_import`
интегрирована в общий mutation/pending gate, registry, capability ABI 1.2.0,
каталог кандидата и runtime pins (49 файлов). До настройки требуется завершённая
проверенная загрузка с точным путём. Каждый внутренний шаг имеет durable journal,
свежие refs, проверку документа/владельца и отдельную квитанцию.

По замечанию пользователя ожидания теперь именованные и явные: этап/поля,
применённое значение, редактор конкретного столбца, его список, полный состав
столбцов, доступность «Далее»/«Готово», сохранённый узел и повторное открытие.
Предел ожидания — 15 секунд и общий deadline операции, отмена проверяется между
наблюдениями; неизменный DOM — дополнительная защита ссылок. Toast должен
исчезнуть вместе с выполнением целевого условия; неизвестный диалог блокирует
процедуру. Проверка отсутствия ещё не появившегося toast удалена из диагностики.

Реальный интегрированный проход `.dock/node-pilot-20260907/integrated-1788788401659`
подтвердил загрузку/байты, настройку, «Готово», повторное открытие, readback всех
страниц и повторное «Готово» за 65 внутренних шагов. Независимый локальный
verifier PASS. Это Codex-диагностика, не Hermes acceptance и не сохранение пакета.
Повторный native-проход с окончательными условиями кнопок и обязательным
именем ожидания также PASS: `integrated-1788788541121`, 65 шагов. 21 source-тест ожиданий, 226 Python-тестов acceptance и
10 тестов клиентской упаковки прошли; изолированному комплекту добавлена реальная
зависимость `rename_effect.py`, без пропуска теста.

На VPS собран и проверен staged-каталог
`2026.09.07-node-import.1-candidate`, SHA256
`dcef4bc665c53185eca66e674b126b21fae3b21077bc5cdc293769afc053321f`.
Production activation не выполнялась. Новая отдельная цель
`node-import-roundtrip` проверяет привязку внешнего вызова, upload, внутреннего
журнала и readback; полный P3 по-прежнему не принят. Первый Hermes `20260907-164407-76877468` завершён: 40 API calls,
`node.configure_text_import` SUCCEEDED, frozen audit **51/54** (SHA256
`a21aeb5e0cf1c36360050f5a55c77de67d55b8e155070e5ee52274d4b66693c8`).
Не пересчитывать этот audit. Диагностика: auditor не учитывал постраничную доставку
одного наблюдения перед upload и безопасный отказ Enter до взаимодействия;
зависимый node proof поэтому оставался закрыт. Добавлены проверки привязки
каждой страницы к журналу/курсорной цепочке и строгой квитанции отказа без эффекта.

Замер первой Hermes-операции: 258,439 секунды, из них 227,543 секунды — 43 ожидания
(175 полных снимков). Повторение четырёх одинаковых DOM-снимков удалено:
`semantic_condition_v2` завершает ожидание после выполнения явного условия;
только после «Готово» дополнительно подтверждается одна и та же DOM-инкарнация
узла двумя наблюдениями. Перед каждым действием остаются штатные проверки epoch,
идентичности и доступности цели. Полное удаление этой адресной защиты выявило
`UI_REFERENCE_STALE` и не было принято.

Финальный Codex-native `integrated-1788789489572`: SUCCEEDED, 65 шагов,
25,046 секунды; независимый локальный proof PASS. 22 теста локальной процедуры и
228 Python tests PASS. Preflight актуального runtime
`dcef5ae4d7bbf2aa3183f368182537a9ad9cd6ea58c33d61fc92603cbe411c63` PASS.
Ускоренная версия принята в самостоятельном Hermes/Luna/medium прогоне
`20260907-170150-12a754e8`: 56 API calls, frozen audit 54/54 PASS, SHA256
`4526bf48dfc71e6f75b92b8cf3e879d684be0357ab477a570ad413efa652b550`.
Handle 8554 завершён, активных Hermes runs нет. Операция заняла 82,818 секунды
вместо 258,439; снимков 44 вместо 175. Полный клиентский набор: 405 PASS,
1 Windows-only skip. Подробности и пределы результата — сверху
[implementation-status.md](implementation-status.md). Следующий этап — расширение
по §13.3; независимая приёмка одного импорта не закрывает P3.

Ограничения текущего кандидата: 1–8 полностью видимых столбцов, один явный путь,
имена/метки/выбор столбцов должны совпадать; меняются тип и вид данных.
Это границы первого обработчика, не сокращение согласованного объёма продукта.
Исходные незавершённые изменения других задач сохранены. Production не менялся.

## Предыдущая остановка — историческое состояние

Последний `calculator-roundtrip` **20260907-133241-682396db завершён**:
158 API calls, completed=true, returncode=0, timed_out=false. Активных прогонов
Hermes нет; handle29775 завершён. ChatGPT / openai-codex / gpt-5.6-luna / medium.
Единственный frozen audit: **52/59**, P3 не принят. Файл:
`.dock/post-mvp-p0/runs/20260907-133241-682396db/audit.json`, SHA256
`c5bf61263a4d84b51f12210b3b8cb33f417426cf1e2799eeec9c057f36f9534e`.
Контрольная сумма повторно проверена при остановке; аудит не пересчитывался.

Transfer подтверждён, но полной повторной проверки импорта нет: после reopen
прочитана только первая страница, затем мастер закрыт без повторного чтения
формата и выходных полей. Перед первым finish также использовалась команда
закрытия с диалогом подтверждения. Calculator не получил обязательные полные
input/node/output-port proofs: после reopen не прочитаны параметры выражения,
в конце открыт только контекст входного порта. Пять остальных domain verifiers
ещё не интегрированы. Завершение процесса не означает приёмку сценария.

**Первое действие после возобновления:** текущей моделью Codex воспроизвести
проблемный переход в отдельном развёрнутом Loginom UI, сверить E2E/Help и
контракт операции импорта по варианту 2. Использовать tool receipts для разбора
пропуска контрольных чтений и Close вместо штатного завершения. После реализации
отладить заявленный участок и независимые verifiers силами Codex; только затем
выполнить итоговую Hermes-приёмку на прежней подписке/Luna/medium с новыми
согласованными runtime/catalog pins. Пока пять недостающих gates не реализованы,
полный P3 PASS невозможен независимо от успеха UI. Связь пропуска с compaction не доказана;
не читать hidden reasoning, assistant content и системные prompts. Проверки
Group/Reform, execution/results/save/reopen остаются обязательными.

Диагностическая сессия `ed81d32e-5429-4330-ba87-41bcdba8cc68` оставлена открытой
на `logi-test-plan` (user без пароля), черновик **Package1 не сохранён**.
Окна Filter и Format закрыты через «Отмена»; повторное наблюдение подтвердило
отсутствие видимых диалогов. В Table узла «Изменение» вручную наблюдались
Север 5/52/2, Юг 4/10/2, Запад 1/0/2 и требуемые типы четырёх полей.
Это только диагностические данные: независимые execution identity,
полнота результата и package persistence не подтверждены.

В исходниках интегрированы maximized launch, agent5/Reform, поддержка native
глобального редактора поля, точная literal-кавычка импорта и цель
calculator-roundtrip. Выполненные проверки: 218 Python, 188 workspace/pager,
8 catalog PASS. Private `candidate-group-native` (Group, group_output,
reform_settings) — 14 synthetic tests PASS, **не интегрирован**, полного
живого source chain PASS нет. Файлы находятся в
`.dock/post-mvp-p0/resume-20260907/candidate-group-native/`; не перегенерировать
старыми скриптами поверх последних дополнений.

Каталог agent5 собран на VPS и staged/readback проверен, activated=false.
Production current остался `/opt/loginom-dock/releases/20260904-landing-7b711846`;
установленный клиент этой P3-итерацией не обновлялся. HEAD при остановке
`9afe1de558ac4bc46ebc0ebdb11184fac38d27c9`. Рабочее дерево содержит незакоммиченные
P3 и параллельные изменения; всё сохранено на диске без commit/reset/clean.
Ниже — история этапов, а не команды активного запуска.

## После run130446 — исправления и следующий этап

`20260907-130446-ce351426` TERMINAL,145 APIcalls, ChatGPT/Luna/medium,
без timeout; source/harness unchanged. Frozen audit52/59 SHA
`dc412dbe40c18aae2c40fff0e01dfb5db7ba76ddd296c4c5b6ceb3c395dff32c`.
Transfer verified; import roundtrip не принят, Calculator также не принят;
остальные5domain verifiers пока отсутствуют. Model завершил настройку Group,
но отдельные input/output-port roundtrip Калькулятора пропустил.

После terminal интегрированы source catalog agent5/Reform и поддержка отдельного
глобального `EditReformColumnDefForm` Loginom7.4.2. Требуются единственный modal,
единственный видимый active wizard, полная выбранная строка и7параметров;
дубликаты/чужой wizard/не-модальный impostor не получают typed actions.
Live: после Group узел Параметры полей прочитал4поля; Quantity real, Id integer.
Нативное изменение Quantity→QuantitySum/integer через select_wizard_option и
apply_reform_column подтвердилось полным readback. Это ручная диагностика.

Точный literal `"` добавлен к наблюдаемой подписи кавычки в verifier. Codex
в собственном UI подтвердил label→fill/blur literal→next/back label. Пробелы,
другая кавычка и неизвестные подписи не нормализуются. Отдельная диагностика
старого журнала всё равно не нашла полной контрольной серии после последней
правки. Frozen audit не заменялся.

Добавлена промежуточная цель calculator-roundtrip: только import→Calculator,
с обязательной полной серией от первой страницы импорта после всех правок,
и тремя отдельными roundtrip Калькулятора (input/node/output). Она использует
те же полные независимые P3 gates и не может объявить полный P3 принятым.
Следующий запуск — agent5, max240, timeout3600, максимизированное окно,
user без пароля на logi-test-plan, /user/dock-p3. Тесты:218Python,188workspace/pager,8catalog PASS.
Calculator-roundtrip `20260907-133241-682396db`, handle29775, завершён;
результат и точка остановки приведены выше. Во время run runtime/harness/goals/catalog не менялись.

### Private Group verifier во время run133241

`candidate-group-native` содержит native composed Group gate: полностью
перепроверенный Calculator → входной порт Group → exact keys/3aggregations,
14factor options до apply и после reopen/cancel. Source bridges учитывают
отдельный выходной порт Calculator и обычную связь0→0. Bounded selection и
transfer/pinned fixture admission реализованы. Добавлены private group_output.py
(отдельный derived output port с4полями, Quantity real/Id integer) и
reform_settings.py (4конечных поля,7параметров QuantitySum, apply/finish/reopen/
cancel по immutable receipts; source/persistence пока false).14synthetic tests PASS.
Эти последние2модуля ещё не соединены в полный source chain и не имеют audit gate.
Не интегрирован, живого полного Group PASS нет. Старый candidate-group-current
остаётся историей и напрямую использоваться не должен.

Ручная UI диагностика Reform продолжена: после закрытия/повторного открытия
QuantitySum сохранил integer. Затем Expr1→AmountSum (real), Id→RowCount(integer)
применены штатным typed apply_reform_column; полная схема4полей без excluded
совпала с ТЗ. Diagnostic node default label «Изменение», черновик Package1,
не сохранён. Это не автономная приёмка Hermes и не часть его журнала.

## Продолжение после run123922 — интегрировано

Run `20260907-123922-c3a12900` TERMINAL,136 APIcalls, ChatGPT/Luna/medium,
source/harness unchanged. Frozen audit21/22 SHA
`c96755b6ef19695d7dc482b6cdb61a48824368942027269e570ae004ac611f2c`.
Причина: повторная compaction архивировала retained prepare pair, экспорт
ошибочно считал точную копию отдельным вызовом. Исправлен exporter: тот же
полный call/response или точный stub, timestamp, archived origin и adjacent
summary marker обязательны; active retained pair может стать archived.
Тест различает настоящие повторные вызовы/изменённые timestamps/контент.
Отдельный export-diagnostic-123922.json показал transfer=true (исправление
narrow folder подтвердилось), import roundtrip отсутствовал. Это диагностика,
не замена frozen audit и не новая приёмка.

После terminal интегрированы Group available_fields и обработка собственной
пустой summary row в Group/Factor. Live ручная диагностика дала четыре поля,
SUM/COUNT и полные14опций; она не заменяет Hermes acceptance.

Независимый calculator_expression_and_mappings больше не hardcoded false:
calculator_receipts.py + calculator_evidence.py проверяют import/input-port/
node/output-port отдельные roundtrip, options, native finish, точные refs,
source bridges и immutable receipts. Поддержаны F2 и наблюдённый btnExprEdit.
Bounded selection и pinned transfer→import admission проверены синтетическими
positive/negative fixtures. Живого PASS калькулятора ещё нет. Оставшиеся5
verifiers не реализованы, P3 не принят. Новые зависимости включены в pins.

217 Python и188 workspace/pager tests PASS; git diff --check PASS.
Цель data-pipeline разбита на последовательные этапы с обязательным import
roundtrip перед Calculator. Запущен следующий run `20260907-130446-ce351426`, handle85124; runtime/harness/
goals снова заморожены до terminal.

Отдельно подготовлен private candidate-catalog-reform: node.add revision3,
transform.reform_columns; selector подтверждён bg/selectors.ts:370–374 и
ручным созданием узла в diagnostic UI. Source catalog ещё не интегрирован.
Сборка на VPS и stage/read-back agent5 завершены; activated=false.
URI viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.07-agent.5-candidate/manifest.json,
SHA 25c659669ace184ba27e7c8b0cea6c030997e29f2c7c89372d565f4bc8cdd4eb.
Build /opt/loginom-dock/releases/20260907-catalog-agent5-reform/.
Текущий run130446 остаётся на agent4; agent5 предназначен следующему replay.

## Размер окна — проверено по запросу пользователя

В client/lib/session.mjs видимый запуск получил --start-maximized и viewport:null.
Настоящий createSession→MCP на Mac подтвердил native maximized и2044×1035;
отдельно fullscreen дал2048×1152. Используется обычное развёрнутое окно.
Headless сохраняет1280×800. Source change относится к следующим source runs;
установленный клиент и production не обновлялись. Private window-session-proof.json.
P3 остаётся активной задачей; первый import gate принят ниже, далее Calculator.

## Активный прогон с новыми параметрами

`20260907-123922-c3a12900`, handle 93232, data-pipeline, ChatGPT/Luna/medium,
max_turns 240 / timeout 3600. Запуск с --start-maximized / viewport:null.
После preflight runtime/harness/goals заморожены до terminal; проверять один audit
после завершения. Новая приёмка ещё не получена.

Перед запуском исправлено узкое чтение имени каталога: тип берётся из точной
видимой соседней ячейки той же строки, даже когда она вне selected root.
Соседние action refs не выдаются. Live user теперь kind=folder, before/after
сохраняют /; hidden/duplicate/foreign-row/type negatives и 167 workspace tests PASS.
200 Python tests PASS; git diff --check PASS. Аудитор навигации не ослаблялся.
Старый run120318: неверный kind=unknown на row20 отклонил выделение user.
Далее Hermes дошёл до Group, но не выполнил обязательные roundtrip; в Calculator
ошибочно ожидал input_mapping после Next (фактически done). В tool description и
цели уточнён наблюдённый 7.4.2 lifecycle с отдельными настройками портов.

Private Calculator v2: 14 tests PASS после исправления scaffold fixture.
Добавлены bounded candidate selection и audit_gate с повторной проверкой pinned
fixture и transfer→import binding; integrated/live Calculator acceptance ещё нет.
Дальше: закончить проверку private verifier на настоящем полном журнале, затем
интегрировать после terminal. Старый Calculator prototype не подключать неизменным.

## Готовится после terminal: доступные поля Group

Private candidate-group-available воспроизвёл ещё один blocker run120318:
настоящие доступные поля Group были на экране, но observer не выдавал controls.
Добавлены точные wizard/grid/row-bound available_fields без полноты/source claims.
Нативная пустая summary row повторяет tid последнего поля; Group parser и Factor
binding теперь отличают её от настоящей data cell, не выдают ей action ref.

Live candidate: Region→Группа; Quantity/Expr1/Id→Показатели; Id настроен Count
через два set_checked и Apply. Четыре выбранных поля прочитаны с complete bounds;
Factor portal дал 14 опций и ровно count=true.170 private workspace tests PASS,
включая hidden/nonblank/foreign summary и отдельный portal read.
Это ручная диагностика, не автономная приёмка. До terminal активного run не
переносить candidate в client. Затем перенести только runtime diff и три test
изменения, без перепривязок import путей из private test copy.

Own UI ed81d32e…: TF1 output-port wizard группы Quantity_Выражение1_Id_по_Region,
отдельная несохранённая диагностика. Native output names Region/Quantity/Expr1/Id.

## Последний цельный прогон завершён

`20260907-120318-0631d223`, data-pipeline, ChatGPT/Luna/medium,
max_turns 240 / timeout 3600, TERMINAL / EXPORTED_PENDING_AUDIT → audit 51/59.
Frozen audit SHA256:
`2a6111d0f13f6651bf955a932a62239b2f6402f9f0f7c78665202dc3f6ca7e58`.
Повторно не запускать аудит с перезаписью этого файла.
Session metadata подтвердила browserViewport=null и browserWindowMode=maximized.
Runtime/harness не изменялись во время прогона. Активного Hermes run нет.

Восемь непройденных проверок: transfer_only_observed_file_storage_navigation,
зависимый wizard_settings_readback (transfer_or_pinned_fixture_missing) и шесть
ещё не реализованных domain verifiers. Успешный короткий import run ниже остаётся
историческим доказательством; полный P3 не принят. Следующий шаг — разобрать
конкретную навигацию Files в evidence этого прогона, воспроизвести в отдельном
живом UI и только затем менять подход к replay.

Private candidate-calculator-v2: последние 8 tests — 6 прошли, 2 содержат ошибки
подготовки нового scaffold fixture (KeyError: ui.truncated, 10 subtest errors).
Не интегрирован. Native node/output lifecycle и joined chain проверены отдельно;
ещё требуется исправить fixture и проверить scaffold binding, добавить bounded
candidate selection. Старый candidate-calculator-current не подключать неизменным.

## После проверки размера окна и native Calculator output

Live7.4.2 подтвердил Calc → done без output_mapping. Отдельный мастер
выходного порта имеет port_context, owner_context unobserved. Чтение полноты
расширено на две точные Derived... формы; live6fields complete, auto_sync=true.
Добавлен typed output_port finish: один Done, exact node/workflow,3quiet samples;
live SUCCEEDED ~1.15s. settings/source/package flags остаются false.
184 workspace/pager tests и200 Python tests PASS, git diff --check PASS.
Private proofs calc-output-complete.txt/output-port-finish-live.txt.

Далее один цельный data-pipeline на новом maximize runtime и прежнем
ChatGPT/Luna/medium. Первый import gate уже принят; пока Hermes выполняется,
продолжать private journal-bound Calculator v2 и остальные verifier. Не менять
client/runtime/harness/goal до terminal, не подключать старый synthetic Calculator
с output_mapping внутри node wizard. Своя диагностика: TF1 graph, три узла,
импорт связан отдельно с Выражение1 и Параметры полей, пакет не сохранён.

## Актуально: первый P3 gate принят

Run `20260907-113445-24e336d0` TERMINAL, frozen audit53/59 SHA
`ababc2dce0aba4d8da589661f3b84b51b6e546ccf250152c921294ab5c4ef020`.
`wizard_settings_readback=true`, transfer verified. Все шесть FAIL — ещё
не реализованные domain verifiers. Это первая независимая живая приёмка
импорта после finish/reopen на новом стенде. Полный P3 ещё не принят.

**Следующее:** Calculator candidate нельзя подключать без коррекции native
lifecycle: текущий private verifier ожидает output_mapping внутри мастера узла,
но ранее наблюдённый Calc Next ведёт прямо к done, output port имеет отдельный
мастер и owner context. Перепроверить в живом7.4.2 и связать отдельный output
port roundtrip с выражением.19 synthetic tests не доказывают достижимость в UI.
Group candidate зависит от этого и ещё требует output/Reform proof.

После terminal из private candidate-reform-coverage интегрирован bounded
readback полноты1–8 строк параметров полей; live5fields complete, clipping900px
и фильтр Quantity дают partial. 163 workspace tests PASS после интеграции; git diff --check PASS.
Это полнота прочитанных настроек, не source binding/сохранение/полная группировка.
Своя диагностика: user, Package1 TF1, import diagnostic-20260907.csv → Параметры
полей, мастер done,1600x1000, пакет не сохранён. Production не переключён.

Предыдущий run111942 TERMINAL45calls audit52/59 SHA
`5ad57f4e18cf8eea3df3f025c956f2060ac034f94d5225c443a9d7a2b77c17c7`.
Upload прошёл, узел не создан: Hermes нажимал декоративные Graph;Vertex.
Исправление фильтра и явная цель создания узла проверены162workspace/200Python
и следующим принятым run113445. Исторические audits не менялись.

## Последний run и исправление native chooser

`20260907-111147-6fc1a5c9` TERMINAL:23APIcalls, ChatGPT/Luna/medium,
auth guard installed/blocked0, токены/runtime/harness неизменны. Frozen audit24/32,
SHA `575dac8b29e2220e5261b4af790883135a910e8429094052cdb2f23e48e7139b`.
Hermes нажал Files Upload обычным ui.act, MCP вернул native File chooser вместо
типизированного результата. Pending не был снят, дальнейшие изменения запрещены.
Повторено в своей сессии на TF4: обычный Upload открыл chooser; закрыт через
browser_file_upload без paths. Ни один файл ручной диагностикой не передавался.
После terminal Upload и его descendants исключены из generic allowed_actions;
использовать только dock_artifact_upload с подготовленным grant/hidden input.
После этого выполнен run111942 (см. выше). Private Calculator candidate получил19PASS
включая no-effect ref issuance и forged/effect/foreign/duplicate negatives.

## Текущий запуск на новом стенде

Созданы через живой UI `/user/dock-p3` и `/user/dock-p3/packages`; повторное
открытие подтвердило каталоги. Отдельный приватный config нового origin:
`.dock/post-mvp-p0/resume-20260907/dock-config.json` (не публиковать: содержит ключ).
На VPS собран и staged/read-back candidate `2026.09.07-agent.4-candidate`,
manifest SHA `85ac2d532245d2da2c9428c499cfa74ba3cc0b3a6e0732c51e6b96cf9f96b0fa`,
URI `viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.07-agent.4-candidate/manifest.json`.
Profile loginom-7.4.2-macos-chromium-ru; save allowed root `/user/dock-p3/packages`.
Server build/report `/opt/loginom-dock/releases/20260907-catalog-agent4-loginom742/`.
Production current не переключался. Стартует новый import-roundtrip: account user,
storage /user/dock-p3, ChatGPT/Luna/medium, max_turns100/timeout1200.
Во время run не менять client runtime и tools/loginom-acceptance; terminal→audit один раз.

## Новый стенд — выбор пользователя 7 сентября

Тестирование и отладку перенести на `http://logi-test-plan.bg.local/app/`,
автоматизацию открывать с `?testable=true`. Loginom: явно `user`, без пароля.
Живой вход успешен; avatar visible, masks0, версия7.4.2. Раздел «Файлы» доступен,
`/user` открыт через дерево, title `user · / · Loginom`. Запись/сохранение ещё
не проверялись. Диагностическая Dock session ed81d32e-5429-4330-ba87-41bcdba8cc68.
Старый dev-test и account test больше не являются выбранной средой.
Следующее: настроить отдельный test config нового origin, собрать на VPS новый
candidate profile для наблюдаемого build и проверенного storage destination;
сохранить строгие build/origin/allowed-root guards. Затем import-roundtrip.

Последний автономный run `20260907-110115-58e89963` на прежнем стенде terminal:
5APIcalls, openai-codex/gpt-5.6-luna/medium, returncode0, completedtrue,
токены неизменны. Frozen audit20/23 SHA
`867feb112a043aaef5ab0e24b27f41fa664757cd93ec7fc259739ab234bf9e13`.
Dock подготовка INCOMPATIBLE (на старом стенде уже build49408), P3 не принят.
В новом Hermes693641aa8b OAuth вынесен в auth_codex; guard расширен на внутренний
модуль и публичные aliases. Процесс использует os._exit: после terminal отчёт
guard исправлен на запись перед CLI и перед каждым отказом; старый audit с
пустым guard не заменялся.200Python tests PASS, реальный guarded preflight PASS.
Активных Hermes runs нет. Рабочие изменения других задач сохранять.

## Авторизация восстановлена 7 сентября

Пользователь повторно вошёл в Hermes и явно разрешил использовать новый
аккаунт ChatGPT после сообщения о несовпадении с прежним. Единственная новая
manual:device_code запись выбрана через штатный Hermes `_save_codex_tokens`;
read-back подтвердил точное совпадение. Профиль остаётся openai-codex /
gpt-5.6-luna / medium; credential import/fallback запрещён. Следующий шаг —
короткий import-roundtrip с guard и неизменными runtime/harness.

## История блокировки авторизации

Последний run `20260906-222609-b484f90f` завершился до первого tool call:
1 API call, completed=false, failed=true, `401 token_revoked`. Frozen audit18/23,
SHA256 `ecc51eb29c527b12e76a09cb31c22a92bbdab7995b8f61964d0208b733da9803`.
Исходный Hermes refresh проверен отдельно через pure refresh без fallback:
`refresh_token_invalidated`, relogin_required=true. Токены не изменены.

В Hermes обнаружен автоматический импорт Codex CLI при ошибке refresh.
У изолированных runs215646 и222609 конечные JWT subject и account отличаются
от исходного Hermes singleton (сравнены только boolean, без сохранения IDs).
Источник чужого подключения напрямую не читался; путь fallback подтверждён
исходниками Hermes. Оба run не допускаются как доказательство выполнения на
исходной подписке. Исторические audits/evidence не изменены.

Добавлен `hermes_auth_guard.py`: отдельный acceptance entry point блокирует
CLI import/recovery и pure refresh до импорта CLI/credential pool. Установка
Hermes, HOME и CODEX_HOME не меняются. Runner использует этот entry point для
ChatGPT; auditor требует guard receipt без попыток fallback и неизменные токены.
При несовместимом Hermes запуск закрыт. Guarded --version реального Hermes
0.21.0 прошёл без модели/credentials; 199Python tests PASS.

Прежнее ограничение (снято явным выбором нового аккаунта 7 сентября):
не повторять model run до повторного входа пользователя в прежний аккаунт.
Команда `hermes auth add openai-codex --type oauth` делает свежий device login,
но добавляет pool entry, не обновляет singleton. После входа проверить совпадение
account/subject с исходным подключением без вывода IDs; только затем обновить
singleton этой же учётной записью и проверить effective profile. Не выбирать
другую pool entry и не импортировать Codex CLI. Далее короткий import-roundtrip.

## Предыдущий автономный прогон

`20260906-215646-197a9e70`, import-roundtrip: Hermes openai-codex /
gpt-5.6-luna / medium,123APIcalls, returncode0, timeoutfalse. Runtime/harness
не менялись до terminal. Frozen audit20/22, SHA256
`2b8843f7a1c8862b027ce2f46841a0c9d27d81b1e334054b117753f17581b9e4`.

Причины: две архивные duplicate-tool заглушки дали152calls/154replies.
Компрессор применяет их не только к read, но и к inspection/observation.
Экспортёр исправлен после terminal: exact original timestamp/session/call,
compression boundary, archived identical witness обязательны; реальные вызовы
не объединяются. Восемь методов тестов, включая28 комбинаций marker-negatives,
прошли. Диагностика152/152: transfer PASS, knowledge scope PASS, import FAIL.
Hermes не прочитал output_mapping после reopen (после UI_EPOCH_CHANGED перешёл
к закрытию), а после последней коррекции UnitPrice не собрал чистую baseline.
Это реальная недоделка; исправление экспортёра не превратило её в PASS.

Private evidence и диагностика: `.dock/post-mvp-p0/runs/<run>/` и
`.dock/post-mvp-p0/resume-20260906/run215646-export-diagnostic.json`.
Старые audits и исходный evidence неизменны.

## Последние изменения исходников

- `scope: wizard` читает единственный текущий мастер через bounded roots→root
  в одном запросе. Неоднозначный/чужой/исчезнувший мастер не подставляется;
  fallback явно возвращает roots. Cursor/explicit-root семантика сохранена.
  Live source page SUCCEEDED, Next доступен; перед подтверждением деактивации
  узла wizard отсутствовал и выбор не состоялся — корректный отказ.
- `table_coverage`: парные native grid records, границы без прокрутки, null
  pressed-state, точный GoToLine range и четыре pagination controls. Предел16
  маленьких строк; source_total/result/execution остаются неподтверждёнными.
  Live6paired rows, range1–6; отдельный verifier ещё нужен.
- Исправлено enabled для x-menu-item-disabled, включая предка внутреннего
  menuitem. После disabled смены action отклоняется до gesture.
- Новое metadata сохраняется pager-ом и независимо сверяется с journal;
  подмена count отклоняется.

Проверки после интеграции:232 browser/recovery/workspace/pager tests PASS,
195Python acceptance tests PASS. Live proof: `wizard-focus-live.txt`,
`candidate-table-completeness/menu-live.txt` в private resume-20260906.
После них добавлена защита авторизации; полный Python suite теперь199PASS.

## Следующая работа

1. После восстановления исходной авторизации — короткий новый import-roundtrip на новых pins, используя доступный scope
   wizard через обычные схемы tools. Не менять runtime/harness во время run;
   terminal → audit один раз. Цель остаётся goal-only и требует обе полные серии.
2. После импорта интегрировать проверенный Calculator candidate из private
   candidate-calculator-verifier (17tests PASS); учитывать no-effect ref issuance.
   Native input_port_finish уже есть в actual runtime.
3. Group candidate6tests PASS, но он ещё не доказывает output names/types/Reform;
   не подключать весь gate до закрытия этого пробела. Execution candidate также
   частный и требует реальной цепочки owner/fresh start. Все шесть domain gates
   кроме импорта ещё не подключены; сквозная приёмка отключена.
4. Завершить table owner/port/execution + filter/format/полнота, затем package
   save→close→exact path reopen→settings→reexecute; отрицательные и empty cases
   из P3 обязательны. Не останавливаться после очередного частичного исправления.

## Среда и ограничения

Собственный диагностический browser session37ba80aa-9e64-4254-ba41-1c54d28fbe9d,
test, несохранённый Package1, один import и Table. Сейчас source-page мастера
импорта CSV run203659 после подтверждённой деактивации. Этот пакет НЕ oracle
fixture: numeric/null conversions в прежней ручной диагностике не совпадали.
Hermes runs полностью отдельные. Активных Hermes runs после run222609 нет.

Production/установленный клиент не изменены, коммитов не сделано. Сохранить
все посторонние dirty files, включая удаления benchmark/locomo/openclaw.
Личная память: viking://user/kartamyshev/peers/-Users-kartamyshev-Git-loginom-dock/memories,
actor/exact target. Dock resource URI не является личной памятью.
