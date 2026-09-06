**Checkpoint 2026-09-06 — выбор типа выражения после прямой UI-диагностики.**
`select_wizard_option` расширен на `ExprDataEditForm;cbxDataType`: наблюдаемая
опция связана с исходным input, окном параметров и выбранным выражением.
После одного клика чтение идёт из исходного мастера, поскольку floating boundlist
закрывается. Это исправление также проверено для узкого чтения списка импорта.
Проверяется весь прежний wizard с единственным ожидаемым изменением type_label;
подмена input, выбранной строки или имени не даёт подтверждения.

В живом Loginom список оказался sibling окна параметров; мастер под окном имеет
modal_background mask. Разрешена только типизированная опция, связанная с текущим
foreground-окном; busy mask и перекрытие точки клика по-прежнему блокируют действие.
Live: Amount / Сумма, Вещественный → Целый (SUCCEEDED58ms) → Вещественный
(SUCCEEDED64ms), по одному клику. Окно осталось открытым, список закрыт.
Это draft readback, не применение к узлу, сохранение пакета или Hermes acceptance.
Источники: E2E calculator_helpers.ts:731 и sCalculator.ts:243;
Help data/processors/transformation/calc/README.md:51; direct DOM/typed action.
Проверки: 276 client /110 Python /10 packaging PASS.
Private evidence: .dock/post-mvp-p0/expression-type-live-result.txt,
expression-type-{client,python,packaging}-tests.txt. Active Hermes нет.
Далее wizard/node ownership, применение и повторное открытие настроек,
независимые domain proofs полного data-pipeline; P3–P9 остаются открытыми.

## 2026-09-06 — подтверждаемая отмена параметров выражения

Добавлен cancel_expression_parameters через тот же UI executor/receipt.
Только наблюдаемый btnCancel формы с прочитанной исходной выбранной строкой.
Один click, bounded wait закрытия формы и снятия масок; проверяются исходные
name/label/type и тот же row_ref. Используется строка вне диалога, а не
изменённые draft values. Изменение значения или подмена row incarnation дают
AMBIGUOUS; node_settings_applied/package_saved остаются false.

Прямая live проверка: label Сумма→Discard typed cancellation, typed cancel
SUCCEEDED67ms; прежние Amount/Сумма/Вещественный и row_ref подтверждены.
Ручное повторное открытие показало Сумма. Это отмена параметров существующего
выражения; не приёмка удаления вновь созданного выражения или отмены всего мастера.
275 client /110 Python /10 packaging PASS, существующая apply matrix расширена
cancel success/changed value/replaced row. Evidence expression-cancel-*-tests.txt
и .dock/post-mvp-p0/expression-cancel-live-result.txt. Active Hermes нет.

Следующий выбор типа изучен напрямую: cbxDataType;trg_picker открывает exact
ExprDataEditForm;cbxDataType;boundlist;Логический/Дата/Время/Вещественный/Целый/
Строковый/Переменный. Подписи содержат ведущие пробелы от иконок. Использовать
существующий observed combo driver с readback исходного input, не печатать тип.
Нужно также проверить post-read после закрытия boundlist: typed действие должно
читать исходный wizard, а не исчезнувший список. Диагностическая форма остаётся
открытой с Amount/Сумма/Вещественный, список закрыт. Full P3–P9 открыты.

## 2026-09-06 — применение параметров с проверкой строки выражения

Добавлен typed verb apply_expression_parameters через существующий dock_ui_action.
Его получает только observed btnApply единственного ExprDataEditForm, при полном
bounded чтении трёх полей и определённой selected row. Проверяется исходный
wizard/context/epoch/refs; один click, затем чтение исходного wizard root вместо
закрывшегося внешнего диалога. До12 ожиданий по100ms в общем deadline проверяют
закрытие окна, появление выбранной строки и исчезновение масок. Повторного click нет.

Новое wizard.expression_selection читает имя, метку и единственный известный
значок типа в той же selected table row по pinned E2E selectors/DataTypeIcon.
После apply все три значения должны точно совпасть с исходными полями диалога;
другой context, незакрытое окно, маска/диалог, неверная row дают AMBIGUOUS.
Trace expression_parameters_row_verified явно сохраняет node_settings_applied=false
и package_saved=false. Это не доказательство сохранения узла/пакета, формулы,
остальных параметров или всего списка выражений.

Первый живой изменяющий apply подтвердил значения, но вернул AMBIGUOUS. Boolean
trace установил причину: no_masks=false после закрытия окна и обновления row.
В bounded wait включено завершение этой маски; остальные guards не ослаблялись.
Повторный изменяющий apply прошёл SUCCEEDED за198ms, один click, все checks=true:
name Amount, label Сумма, type Вещественный. Ручное повторное открытие ExprDataEditForm
подтвердило эти три значения. Прямой Codex diagnostic, не Hermes acceptance.
Evidence .dock/post-mvp-p0/expression-apply-live-result.txt, expression-apply-*-tests.txt.
275 client /110 Python /10 packaging PASS. Test покрывает actual row rename,
wrong name/label/type, delayed mask, незакрытый диалог и lost reply без повторного click.
Источники: e2e-tests/bg/helpers/wizards/transform/calculator_helpers.ts check.ExprParams/
expression rows, bg/consts/app_consts.ts DataTypeIcon, bg/types.ts DataTypeNames.
Далее cancel/readback, изменение типа, node/wizard binding и полноценные P3–P9.
Active Hermes нет; диагностическая форма Amount/Сумма открыта, мастер не сохранён.

## 2026-09-06 — типизированный ввод имени и метки выражения

set_wizard_field расширен на два наблюдаемых input ExprDataEditForm: name/label.
Descriptor scope=expression_parameter содержит форму, wizard root, owner input,
единственную выбранную строку выражения и native maxlength (cap256). Type combobox
не получает эту операцию. Изменение использует существующие executor receipts,
контекст/epoch/hit/focus guards, клавиатуру и точный draft readback. При проверке
сохраняются выбранная строка, форма, исходные refs, type и прочие настройки.
Это контекст редактирования текущего окна; не отдельное доказательство того,
каким действием оно было открыто, node ownership или применения параметров.

Живая проверка label Amount→Amount diagnostic→Amount прошла. Проверка имени
выявила отложенное обновление связанной метки при завершении ввода: первый
вариант возвращал исходную label, следующее действие корректно отказало
WIZARD_FIELD_CHANGED. Добавлен Tab только после проверки удержания фокуса на
исходном input; итоговое чтение выполняется после завершения ввода. Разрешено
только штатное обновление label с прежнего имени на точное новое имя, когда
до изменения label совпадала с name. Остальные изменения дают AMBIGUOUS.
Повторный live name AmountProbe→Amount→AmountProbe→Amount подтвердил точные
name/label values и сохранённый Вещественный type; текущий draft снова Amount.
Ни btnApply, ни сохранение мастера этой операцией не выполняются; applied_verified=false.

274 client /110 Python /10 packaging PASS. Проверены отложенное обновление label
на Tab, неверная label, смена selected row/type, потеря фокуса. Live evidence:
.dock/post-mvp-p0/expression-name-live-result.txt; тесты expression-field-*-tests.txt.
Следующее — apply/cancel параметров с readback строки/типа и повторным открытием,
затем wizard/node binding и полный P3–P9. Active Hermes нет; модель для следующей
автономной проверки остаётся ChatGPT subscription/Luna/medium.

## 2026-09-06 — живой разбор Калькулятора и чтение параметров выражения

Run20260906-041246-c86bd419 source90d23a39 завершился; session12618 закрыт.
Frozen audit48/58 FAIL, SHA
c74ffe8c296519597a979cbfb8490f7e504e80af0d32d7964e018586e478f9d3.
49 API calls, usage completed=false/failed=true/provider=model=null; preflight
и launcher закрепили openai-codex/gpt-5.6-luna/medium. Из технического error
прочитан только TimeoutError: Codex stream produced no bytes within120s.
До wizard Hermes не дошёл; graph priority автономно ещё не принят. Это
транспортная остановка, не доказательство дефекта новой выдачи графа.

В отдельной сессии Codex добавил Calculator к диагностическому импорту;
автосвязь source→Calculator наблюдалась в DOM. Поля Quantity/UnitPrice доступны.
Через ExprDataEditForm изменено внутреннее имя Expr1→Amount, тип Вещественный;
введена Quantity * UnitPrice через клавиатуру. Next перешёл прямо в done,
Execute запустил узел. Выходной порт active и быстрый просмотр показали шесть
ожидаемых сумм37,50/14,50/10,00/0,00/-8,00/8,00 вместе с исходными полями.
Это ручная диагностика, не независимый domain verifier/full Hermes acceptance.

После ввода name и label через fill метка оказалась AmountAmount; причина
удвоения не установлена. Повторное открытие подтвердило имя Amount и тип
Вещественный. Метка исправлена клавиатурой с точным readback Amount; формула
при повторном открытии Quantity * UnitPrice. Автоматическая метка узла также
изменяется по выражению, не связывать node identity с прежним Calculator label.
При открытии настроек активного узла сначала появляется подтверждение
деактивации; wizard ещё отсутствует. В этом диалоге tid msgbox;tlb;no означает
«Да, больше не спрашивать», а cancel — «Нет». Решать по видимому смыслу,
не по суффиксу tid. Использовано обычное yes без изменения будущих подсказок.

ExprDataEditForm — x-window sibling мастера под MF, не descendant WizrdMCF.
Добавлено wizard.expression_parameters с root_ref и bounded name/label/type_label
readback (input/owner refs, enabled/read_only, truncation). Fixed native queries
включают exact форму и её inputs при узком чтении мастера. Applied_verified=false;
нет доказательства принадлежности выбранному выражению, apply или persistence.
Ссылки в metadata не дают права действия без delivered ui.elements.
Live capability narrow root read подтвердил Amount/Amount/Вещественный.
273 client /110 Python /10 packaging PASS; test проверил внешнюю форму, distinct
name/label, cap256, sensitive input и неоднозначный type input.
Evidence .dock/post-mvp-p0/expression-params-*-tests.txt и expression-params-live-result.txt.
Источники: e2e-tests/bg/helpers/wizards/transform/calculator_helpers.ts,
bg/sels/transform/sCalculator.ts, bg/helpers/workflow/previewTable.ts.
Далее bound parameter set/apply/readback и полный P3–P9. Диагностический
браузер оставлен с открытой формой параметров Amount; active Hermes нет.

## 2026-09-06 — граф выдаёт связанные с узлом controls перед служебными Vertex

Прямая UI-диагностика на отдельном черновике подтвердила: повторяющиеся
Graph;Vertex — безымянные SVG-элементы. Тело узла имеет exact Graph;<label>,
его подпись — Graph;<label>;Label;Label, настройки — Graph;<label>;Setting.
Клик по подписи через client capability дал gesture SUCCEEDED, но не выделил
узел и не показал настройки. Клик по body через те же guards выделил узел;
свежее наблюдение подтвердило видимую и доступную Setting. Не путать жест с целью.

Observer теперь связывает эти три вида controls с видимой меткой и единственным
телом узла через graph_node {node_label,part:body/label/settings}. Это текущая
UI-связь, не постоянная identity или wizard ownership. Settings/body/label идут
перед Vertex/портами/прочей графикой, сохраняя полный доступ к остальным страницам.
Передача ref всё ещё требует delivered element, epoch/identity/hit guards прежние.
Guidance описывает body click → fresh observe → settings click, а также различие
переносимого визуального текста подписи и node_label из test identity.

272 client /110 Python /10 packaging PASS. Test проверил первую compact graph
page с тремя узлами после 70 Vertex: body/labels/settings доступны сразу,
их refs выданы; служебные элементы остаются дальше и не получают graph_node.
Live evidence: .dock/post-mvp-p0/graph-controls-live-result.txt (Codex diagnosis,
не Hermes acceptance). Далее новый полный Luna/ChatGPT/medium run на agent.3.
Все domain gates, wizard apply/readback и полный P3–P9 остаются открыты.

## 2026-09-06 — повторная Hermes проверка и самостоятельный разбор импорта

Run 20260906-035739-62c8e272 на source96282e85 завершён, session17304 закрыт.
Audit один раз: 50/58 FAIL, SHA
8b7b517f0aa808d150d50e537270dfd7ef2578a2c60b290cb33275a640a9086e.
48 API calls, openai-codex/gpt-5.6-luna/medium, completed=true, failed=false.
Использован agent.3 с разрешённым /test/packages. Полный P3 не принят.
Последняя ошибка call109: ref417 не выдан с observation17c4fc6a; graph page
104 выдала вначале links/безымянные Graph;Vertex/переменные, а реальные узлы
остались дальше. Root reads106–108 читали лишь отдельные Vertex. Это требует
улучшить связь node metadata с доступными observed controls и порядок графового
наблюдения; не разрешать невыданные refs и не повторять неизменённый run.

Параллельно в ОТДЕЛЬНОЙ диагностической сессии Codex под test настроил импорт
проверенного /test/Dock-upload-20260906-033638-57049220.csv. Реальный UI подтвердил:
- delimiter dropdown «Точка с запятой», null literal \N, decimal literal .;
  preview шесть строк, Id/Quantity целые, UnitPrice вещественный, Region/Comment
  строки; пустой Comment отличается от <null>.
- переходы file → format → output mapping → done; btnDone «Готово» закрывает
  мастер и автоматически меняет дефолтную метку узла на имя файла. Нельзя
  повторно искать этот узел только по прежнему «Текстовый файл».
- после повторного открытия filename появляется асинхронно: видимый input
  сначала пуст, затем получает сохранённый путь. Видимость не доказывает readiness.
- в повторно открытом формате сохранены «Точка с запятой», \N, «Точка (.)»,
  двойная кавычка. Первоначальный preview потерял дробные значения первых трёх
  UnitPrice, хотя настройки выглядели правильными. После btnRefreshAll ожидаемые
  12,50/7,25/2,50 восстановились. Причина не установлена; не объявлять продуктовый
  дефект или applied/full-result proof по одним settings labels.

Источники: e2e-tests/bg/helpers/wizard.ts, bg/sels/import/sImportTxt.ts,
bg/sels/import/sColumnDefsTuning.ts; loginom-help/data/integration/import/txt/README.md.
Evidence: .dock/post-mvp-p0/import-reopen-diagnostic.txt; UI оставлен открытым
в отдельной диагностической сессии на формате импорта. Hermes не запускался повторно.
Следующее: source/live graph selection contract, затем bound wizard lifecycle и
post-apply refresh/readback. Все domain gates и P3–P9 остаются открыты.

## 2026-09-06 — прямая UI-диагностика навигации и исправление чтения закрытой панели

Run 20260906-033638-57049220 завершён и audited один раз: 49/58 FAIL,
SHA 722b9496db2409de63af0a8c3dabf2e0825fa1f2b0a075f9e4f2ba3584b9ece0.
56 API calls, openai-codex / gpt-5.6-luna / medium, completed=true,
failed=false, returncode=0, timed_out=false. Новый catalog agent.3 использован,
но до save/reopen Hermes не дошёл; последний double_click был по region ref
без allowed_actions. Старый audit остаётся неизменным.

Пользователь разрешил Codex самостоятельно диагностировать затруднения в Loginom UI.
В отдельной браузерной сессии под test, без пароля, создан диагностический черновик.
Live build 7.5.0-alpha+build.49202 подтвердил: MapTreeForm navigation TreeText —
SPAN без ARIA role, TreeExpander — IMG presentation. Эти элементы observer
пропускал; scope roots выдавал безымянные вложенные таблицы вместо дерева.
Источник последовательности: e2e-tests/bg/helpers/navigation.ts ByPanel,
один click по TreeText конечного пункта, не double_click по контейнеру.

Добавлены exact global/local MapTreeForm TreeText/TreeExpander в observed controls,
корень MapTreeForm;tree — в discovery с приоритетом перед таблицами.
Live прямой вызов client capability подтвердил выдачу «Сценарий» и checked click.
Первый вызов выявил UI_ROOT_STALE после штатного закрытия панели; теперь только
после завершённого generic click/double_click/right_click/press при этой ошибке
исполняется bounded roots discovery. Предусловия и typed settings/stage proofs
не используют fallback; потерянный ответ остаётся AMBIGUOUS. Результат жеста
verification_required=true, без утверждения о достижении доменной цели.
Повторный live вызов: SUCCEEDED, панель закрыта, виден сценарий Package1/Модуль1.
Это прямая диагностика Codex, НЕ автономная Hermes acceptance.

271 client /110 Python /10 packaging PASS; новые tests проверяют global/local
навигацию, detached refs, закрытие root после click, отказ до click и lost reply.
Evidence: .dock/post-mvp-p0/navigation-*-tests.txt и navigation-live-result.txt.
Далее новая Hermes acceptance на ChatGPT subscription/Luna/medium с agent.3
URI/SHA из предыдущей записи; сохранить test и /test. Все семь domain gates,
cursor fix live acceptance и полный P3–P9 остаются открыты.

## 2026-09-06 — на VPS собран и staged каталог для /test/packages

Из чистого source11f696c5 подготовлен ограниченный исходный архив, SHA
25872dec4315f7bec5872b3b73db00f39c769c756aad24340bca835c478978a3;
эта сумма подтверждена на VPS. Сборка выполнена на VPS в Docker
node:24.19.0-bookworm-slim с --network none, не на Mac. Каталог:
/opt/loginom-dock/releases/20260906-catalog-agent3-11f696c5/build.
Параметры: --version2026.09.06-agent.3-candidate и --package-root /test/packages.
Builder/publisher validation прошли, stale_actions=[]; после stage все четыре
immutable файла прочитаны обратно и побайтно сверены publisher-ом.

Manifest URI:
viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.06-agent.3-candidate/manifest.json
Manifest SHA256:
007465bf4d8fee5f238ef790db4584313d61373d27f92715f01388edfe413ae6
Actions SHA256:3a293cd8b981a36409bb2f93b0d6b3ac8a057b09cc9373e31090fc969d8ca0b5.
E2E commit2cad5602158fd2e4836d821d644a2b8d92f571a2 сверён с импортированным source.
node.add revision2, link.create revision1, package.save_as revision2 с
allowed_roots=['/test/packages']. Отчёт .dock/post-mvp-p0/catalog-agent3-stage.json.

staged=true, activated=false. Серверный current release остаётся
/opt/loginom-dock/releases/20260904-landing-7b711846; production API/Studio/landing
не пересобирались. Read-only verify-server подтвердил HTTPS/readiness/auth,
role user и15 MCP tools. Один повторный SSH вход был отклонён, следующая проверка
с тем же password профилем успешна; способ аутентификации не менялся.

Далее полный data-pipeline на Hermes ChatGPT subscription/Luna/medium с НОВЫМИ
URI/SHA выше. Stage/readback не является live save/reopen acceptance; необходимо
проверить фактическое сохранение в /test/packages. Cursor fix live, node/settings
binding, applied/results и весь P3–P9 остаются открытыми.

## 2026-09-06 — найден корень /user в каталоге сохранения; подготовлена явная настройка

Run20260906-031541-528cd48f terminal, session89188 закрыт. Source417a2ab7,
runtime b5071ef0ac875f65bc481b710d928c87f7c454574115425de9ca630689bf32fd.
ChatGPT subscription/openai-codex/gpt-5.6-luna/medium,64 API calls,
completed=true/failed=false,exit0/timeout=false. Frozen audit50/58 FAIL, SHA
96067822593abc58aeb60ff0ff37ce5999b9e7530975af0e6b75b8b61863cd57.
Полная цепочка не выполнена; cursor fix live всё ещё не принят.

Ошибки готовых действий: component.imports.text cardinality0, точка вне workflow,
затем save_as /test/packages/Dock-acceptance-20260906-031541-528cd48f.lgp отклонён
как находящийся вне allowed roots. Проверка источника установила: effect
package.save_as в executor/catalog/actions.json разрешает только
/user/data/packages. Это политика старого каталога, не вывод имени Loginom
пользователя из ОС и не основание обходить roots guard.

Сборщик получил повторяемый --package-root. Значения проходят validateEffect,
изменяют только package.save_as в копии каталога, сохраняют stale и прочие
действия, увеличивают numeric action revision при смене roots. Без аргумента
сохраняется исходная политика. Override требует явного нового --version;
результат остаётся candidate и входит в manifest digest. Тестируются /test/packages,
произвольное имя пользователя, отсутствие мутации исходника, отсутствие повторного
bump при той же политике, опасные/пустые/повторные roots и полный pin build fixture.
269 client /110 Python /10 packaging PASS.

Следующий обязательный шаг: собрать на VPS и stage/readback новый immutable
candidate (предлагаемая версия2026.09.06-agent.3-candidate) с --package-root
/test/packages, затем использовать НОВЫЕ manifest URI/SHA в полном Luna run.
Старый candidate/production не изменены и по-прежнему отклонят /test/packages.
Документация operations дополнена. Active Hermes/browser нет; весь P3–P9 открыт.

## 2026-09-06 — прогон остановился на перекрытой вкладке; добавлена диагностика слоя

Run20260906-030443-0696fd47 terminal, session52276 закрыт; source7109eeb0,
runtime4734e818ea48f1e69f6a4ce13cd891b7580e241d8363b4c58a4617adeae7a926.
ChatGPT subscription/openai-codex/gpt-5.6-luna/medium,42 API calls,
completed=true/failed=false,exit0/timeout=false. Frozen audit51/58 FAIL, SHA
11cd18c874b385ed86b79065b948e0b5ca2673877c9c175ed345df0fbf5d6341;
семь domain gates остаются открыты. До мастеров и Calculator не дошёл,
исправление мигания курсора в live НЕ принято.

Последний call91 переключал вкладку сценария по свежему доставленному ref.
Raw journal показывает tab-1 anchor at x49/y0/w125.3359375/h35; ранее он имел
point_observed, затем point_not_observed при прежней геометрии. Последний reply92
корректно вернул NOT_APPLIED/UI_REFERENCE_OBSCURED. Диалоги/маски в выданных
наблюдениях пусты; что именно перекрывало вкладку, старый runtime не записал.
Не делать вывода о неисправности hit-test или включать force click.

В interaction.point_not_observed добавлено covering: до трёх уникальных
перекрывающих DOM элементов из существующих девяти hit-test точек. Только tag,
tid/anchor_tid/role; без текста/значений и без новых actionable refs. Sensitive
элемент даёт только redacted=true. Диагностика должна помочь найти текущий слой
через новое наблюдение, не разрешает произвольные selectors/действия.
267 client /110 Python /10 packaging PASS; описание наблюдения обновлено.

Далее новый полный Luna run для диагностики перекрытия и приёмки исправления
курсора, затем node/settings binding, apply/results и полный P3–P9.
Active Hermes/browser нет, production не менялся.

## 2026-09-06 — установлена причина Calculator epoch отказов; узкое исключение мигания

Run 20260906-024410-296ed587 terminal, session71725 закрыт. Существующая
ChatGPT subscription / openai-codex / gpt-5.6-luna / medium, 127 API calls,
completed=true/failed=false, exit0/timeout=false; harness HEAD3d6a2686,
runtime pin91402be94d5c89948ca3942fa408e9fbf6c0804f539ff63af5ad5a3c408da283.
Frozen audit49/58 FAIL, SHA
6cafc72c4e82492b876bc2efddc3fcdfa79da266a9a0c379efafaa09133f2327.
Не пройдены matching replies, navigation и семь domain gates.

Сравнение requested observation и отказа по mutation_counts показало:
Calculator calls267/271/275/277/279 имеют только cursor_style delta11/11/9/13/10,
остальные категории0. В импорте были другие реальные DOM изменения; их нельзя
игнорировать по аналогии. Причина прежних повторных Calculator epoch отказов
теперь подтверждена live диагностикой, но полного сценария нет.

Первичный источник CodeMirror5 src/display/selection.js restartBlink переключает
только cursorDiv.style.visibility между пустым значением и hidden;
src/display/Display.js создаёт cursorDiv с классом CodeMirror-cursors.
Источники: https://raw.githubusercontent.com/codemirror/codemirror5/master/src/display/selection.js
и https://raw.githubusercontent.com/codemirror/codemirror5/master/src/display/Display.js.

Добавлено узкое исключение из epoch: только подключённый CodeMirror-cursors
внутри CalcDataWizard;cmpExpression, wrapper подтверждён public getWrapperElement,
старый и текущий inline style содержат только пустоту или visibility:hidden.
MutationObserver получает attributeOldValue; строки стилей не сохраняются и
читаются только для этого точного случая. Геометрия/другие свойства, singular
CodeMirror-cursor, чужой контейнер, text/child/class mutations по-прежнему
меняют epoch. Geometry ABA в одном batch оставляет значимое изменение.
Классификация ограничена128 записями; остаток остаётся значимым.

mutation_counts исключены только из digest страниц как диагностика; при next
обновляются до свежего receipt. dom_epoch и остальные scan fields остаются
частью digest; guard state/issued refs не заменяются. Добавлены негативные тесты
и проверка, что диагностические счётчики не делают неизменённую страницу stale.
266 client /110 Python /10 packaging PASS; live исправленной версии ещё не запускался.
Далее полный Luna run для проверки этой причины, затем node/settings binding,
apply/results и весь P3–P9. Active Hermes/browser нет; production не менялся.

## 2026-09-06 — диагностический прогон прерван timeout потока модели

Run 20260906-022803-33baaab3 terminal, session72000 закрыт; исходники заморожены
на 1dd0ea8e, runtime pin
91402be94d5c89948ca3942fa408e9fbf6c0804f539ff63af5ad5a3c408da283.
Preflight/launch подтвердили openai-codex / gpt-5.6-luna / medium. После 35 API
calls usage completed=false/failed=true, provider/model=null. Прочитано только
техническое поле error дампа: TimeoutError, Codex stream produced no bytes within
120s (TTFB threshold: 120s). Process exit0/outer timeout=false не превращают
этот запуск в успешную модельную сессию. Содержимое request/model prose не читалось.

Frozen audit 50/58 FAIL, SHA
4b4d8dc09e38edfd8a6d6996c643b9e667217548575d7a35b12692ff3b6721d9.
Калькулятор не достигнут, причина его epoch отказов всё ещё не установлена.
Live scan.mutation_counts присутствует (последние graph/root observations имеют
одинаковые counts; cursor_style=0). Это подтверждает работу диагностики на графе,
но не доказывает поведение cursor в редакторе. Полный P3–P9 открыт.

Следующая попытка — тот же полный goal и тот же существующий ChatGPT/Luna/medium
профиль после подтверждённого terminal transport timeout. Без fallback и без
изменения guards. Это единичная транспортная ошибка, не подтверждённый внешний
блокер. Active Hermes/browser нет; audit не пересчитывать.

## 2026-09-06 — live импорт и выражение; диагностика повторных epoch отказов

Run 20260906-021403-9b23c08d terminal, session74333 закрыт. ChatGPT subscription /
openai-codex / gpt-5.6-luna / medium, 91 API calls, exit0, timeout=false.
Исходники были заморожены на eb294eaa; runtime pin
1746878d509fcf72a1a50407e03481425cf78a7f814657730a6d3d6cd27003e5.
Frozen audit 50/58 FAIL, SHA
8b6bc7f5b816ed7e939abf7758a27bdeb8508d3bec74580bc831e93dae89d5cb.
Не пройдены navigation gate и семь domain gates; старый audit не пересчитывать.

Live set_wizard_field подтвердил буквальные delimiter=';' (reply113),
null_marker='\N' (reply126), decimal_separator='.' (reply128). select_wizard_option
не вызывался, его live приёмка остаётся открытой. При переходе format→output_mapping
модель ожидала другой этап, получила AMBIGUOUS, затем восстановилась и дошла до
Done/графа. В Calculator reply200 подтвердил replace_expression
'Quantity * UnitPrice' в Expr1. Это draft/полный текст, не syntax/Amount/mappings,
не applied settings и не вычисленный результат.

Последние действия (add expression, Next с неверным ожидаемым grouping, Close)
получили UI_EPOCH_CHANGED без воздействия. В наблюдениях состояние редактора
и полный текст одинаковы, но это не доказывает безвредность DOM mutations.
Для установления причины добавлены scan.mutation_counts: cursor_style,
other_style, attributes, child_list, text, other, unclassified. Классифицируются
не более 128 записей на batch, остаток учитывается счётчиком; dom_epoch.revision
по-прежнему считает ВСЕ записи. Нет игнорирования cursor/style, ослабления ABA
или повторного click. Не сохраняются DOM targets, тексты/значения атрибутов и
произвольные имена классов. cursor_style означает лишь фиксированный CSS-маркер,
а не доказанную безвредность мутации.

263 client /110 Python /10 packaging PASS. Далее получить live категории изменений на Luna,
исправлять только доказанную причину; параллельно по смыслу остаются node/settings
binding, lifecycle apply/cancel и весь P3–P9. Active Hermes/browser нет.

## 2026-09-06 — выбор наблюдаемого пункта списка импорта

Добавлен select_wizard_option через существующий UI receipt/pending. Контракт
применим к четырём известным ValueControl текстового импорта. Source:
e2e-tests/bg/helpers/main.ts SelectDropDownItem — owner;trg_picker,
owner;boundlist, owner;boundlist;Format(label), затем GetInputValue == label.
Клиент не строит селектор из модельного текста: действие принимает только ref
уже выданного пункта. Требуются точный owner, один видимый boundlist, принадлежность
пункта его DOM, соответствие test-id отформатированной подписи и тот же input.
После одного click читается точная подпись в исходном поле с тем же root/context;
неподтверждённый результат остаётся AMBIGUOUS. settings_applied=false сохранён.

Picker получает наблюдаемый ref для обычного одиночного click. Floating boundlist
можно обнаружить как root; известный открытый список выдаётся сразу после wizard,
перед фоновыми таблицами. Narrow list read получает только четыре фиксированных
owner/input guard-запроса, без обхода остального мастера. Общие scan bounds остаются.

Значения полей помечены value_kind=displayed_input_text: подпись выбранного пункта
не является буквальным разделителем. Native maxlength читается в метаданные,
set_wizard_field проверяет его до ввода. Не утверждаем, что именно maxlength
объяснял live усечение в предыдущем run: там атрибут не был прочитан.

261 client /110 Python /10 packaging PASS. Тесты проверяют selection/readback, floating root,
замену/блокировку input, неверное значение, потерю list ownership, native limit
и приоритет раскрытого списка. Live select_wizard_option ещё не принят.
Далее новый полный data-pipeline через Hermes ChatGPT subscription/Luna/medium,
затем node/settings binding, apply/cancel, сохранение/повторное выполнение и
оставшийся P3–P9. Active Hermes/browser нет, production не менялся.

## 2026-09-06 — live переход мастера подтверждён, выявлен неверный ввод варианта списка

Run 20260906-015813-875f450b завершён, session 5853 terminal. Hermes использовал
ChatGPT subscription / openai-codex / gpt-5.6-luna / medium; 80 API calls,
returncode=0, timeout=false. Исходники были заморожены на cf09124e, runtime pin
510bf9c3aef779ca1fc8a4302afbc90a51ff9940bca41da56427cc0b5b674395.
Frozen audit 49/58 FAIL, SHA
799421c525dcefdda80c9f9458ab01df002424a376578888523911c0b9593865.
Не пройдены knowledge scope, delivered upload destination и семь domain gates.
Ответы upload/verify успешны, но это не снимает независимый destination FAIL.

Live подтверждён wizard_step: call154/reply155, один click, переход
text_import_file → text_import_format в том же root, readback через 2141 ms.
Первый call148 был отклонён по UI_EPOCH_CHANGED без воздействия. Это принимает
только переход, не настройки/результаты. Чтение четырёх ValueControl input
также сработало в реальном мастере (reply161).

Попытка set_wizard_field с ';' (call156) отклонена по stale epoch без ввода.
После свежего наблюдения Hermes вместо буквального символа передал
'Точка с запятой' (call162). В том же поле осталась только 'Т'; reply163 корректно
вернул AMBIGUOUS/WIZARD_FIELD_NOT_CONFIRMED, далее inspect и завершение.
Не считать это успешной настройкой или доказанным дефектом Loginom. Причина
усечения (например maxlength) пока не подтверждена атрибутами live DOM.

E2E tests/toreview/helpers/wizards/textimport.ts явно определяет 'Точка с запятой'
как вариант списка Delimiter; input может отображать подпись выбранного пункта,
а не буквальный разделитель. Следующий шаг — source-backed выбор наблюдаемого
пункта combo с проверкой принадлежности полю и результата, плюс чтение native
ограничений ввода. Не вводить подпись списка как сырые символы. Далее остаются
node/settings binding, apply/cancel, applied readback и весь P3–P9. Заголовок
мастера обозначает страницу и сам по себе не доказывает принадлежность узлу.
Нового активного Hermes/browser нет. Старый аудит не пересчитывать.

## 2026-09-06 — подтверждаемый одиночный переход мастера

Добавлен wizard_step в существующий dock_ui_action: observed Next/Previous ref
и явный expected_stage из распознаваемых этапов. Исходный wizard/context/epoch
проверяется до одного click. Наблюдение wizard теперь содержит root_ref текущей
DOM incarnation; переход подтверждается только при том же root, workflow/package,
авторизации, отсутствии масок и неизменном наборе диалогов. После click допустимы
до 24 ограниченных ожиданий по 200 ms в пределах общей 15 s deadline. Повторного
click нет. Неизменившийся этап, закрытие, подмена мастера, новый диалог или
неподтверждённая загрузка сохраняют AMBIGUOUS через существующий pending/receipt.

Trace wizard_step_verified подтверждает только другой явно запрошенный шаг;
settings_applied=false и syntax_validity=unverified сохранены. Кнопки btnDone,
btnExecute и btnClose этим действием не обслуживаются. E2E bg/selectors.ts и
bg/helpers/wizard.ts различают переход, сохранение, выполнение и отмену;
Close требует отдельного подтверждения, а Save проходит страницы с проверкой
ошибок. Нельзя подменять эти операции одним click/закрытием окна.

256 client /110 Python /10 packaging PASS, включая Next/Previous, временную маску, один click
при отсутствии перехода, закрытый/подменённый root и stale исходный этап.
Live пока не запускался. Далее node/settings identity и lifecycle apply/cancel
с проверкой сохранённых настроек, затем полный data-pipeline через Hermes на
ChatGPT subscription / openai-codex / gpt-5.6-luna / medium. Полный P3–P9 открыт.

## 2026-09-06 — типизированное изменение поля формата импорта

В существующий dock_ui_action добавлен set_wizard_field (ref + text), только
для явно предложивших его полей текущего text_import_format. Descriptor связывает
поле с incarnation текущего wizard root и ValueControl owner. Перед вводом
проверяются исходные значения мастера, context/epoch и identity поля; после
получения фокуса и выделения — повторное чтение того же состояния. Ввод идёт
через клавиатуру, без setter внутреннего компонента. Совпадающее значение
не вызывает click/type. Допустимы до 256 UTF-16 единиц без NUL/CR/LF.

После ввода проверяются точное значение, тот же ref/owner/root, остальные
прочитанные поля и контекст. Неподтверждённый результат после возможного
воздействия остаётся AMBIGUOUS через существующий receipt/pending. Успешная
trace wizard_draft_value_verified содержит settings_applied=false: это draft,
не node ownership и не applied settings. Generic fill не стал domain proof.
Описания инструментов рекомендуют новый контракт для предлагающих его полей.

252 client /110 Python /10 packaging PASS; отчёты wizard-set-*-tests.txt
в .dock/post-mvp-p0/. негативные проверки покрывают изменённое исходное
значение, потерю фокуса, смену формы, искажённый readback, read-only и лимит текста.
Live ещё не запускался. Следующий шаг — wizard lifecycle и node/settings binding,
чтение после apply, затем новый полный data-pipeline через Hermes с существующей
подпиской ChatGPT / openai-codex / gpt-5.6-luna / medium, без fallback.
Полный P3–P9 остаётся открытым; production не менялся.

## 2026-09-06 — чтение текущих полей формата текстового импорта

В wizard.settings добавлены delimiter, text_qualifier, null_marker и
decimal_separator (draft_ui_values, applied_verified=false). Точные ValueControl
идентификаторы взяты из e2e-tests/bg/sels/import/sImportTxt.ts. Чтение ограничено
уже обследованным DOM и текущим шагом text_import_format: требуется один видимый
несекретный owner и один input/textarea. Пробелы, пустая строка и буквальный \N
сохраняются; значения ограничены 256 UTF-16 единицами с явным truncated.
Отсутствующий в области чтения или неоднозначный редактор не даёт значения.

248 клиентских, 110 acceptance-harness и 10 packaging тестов прошли.
Отчёты: .dock/post-mvp-p0/wizard-settings-*-tests.txt. Это проверка исходников
и синтетического DOM; live структура ValueControl и applied settings ещё не
приняты. Нового Hermes run нет. Продолжать typed wizard set/lifecycle с проверкой
node/settings identity через существующий executor, затем applied readback и
полную live цепочку. Пользователь подтвердил ChatGPT subscription /
openai-codex /gpt-5.6-luna /medium; fallback запрещён. Полный P3–P9 открыт.

## 2026-09-06 — завершён Luna run 013610, уточнена неверная пара ref/observation

Run 20260906-013610-e4e2d82e terminal, session 63819 закрыт; ChatGPT/Luna/medium,
41 API calls, exit 0, timeout=false. Frozen audit 50/58 FAIL, SHA
961d453b76768ee7d7a021b6353f0768f0c5a45b3fdb12c7b577bcad17e8ccad.
Не пройдены navigation gate и семь domain verifiers. Последний call row 92
взял ref из roots, но указал другой observation_id; raw evidence подтверждает
корректный отказ issued-ref guard. Нового полного результата P3 нет.

В assertIssued добавлена конкретная подсказка: только retained observation,
реально выдавшая ВСЕ refs запроса, может быть названа в ошибке. Ссылка из raw
недоставленной страницы, смесь refs из несовместимых observations и удалённая
сессия не дают подсказки. Alias/автовыполнение не добавлены; state/epoch guards
сохранены. 246 client /110 Python /10 packaging PASS; отчёты ref-pair-*-tests.txt.

Дальнейшее направление: перейти к предусмотренным P3 typed wizard
inspect/set/next/apply/cancel с node/settings identity и applied readback,
используя существующий executor receipt/pending и source-backed selectors.
Не запускать ещё один неизменённый полный generic replay только ради новой
попытки. Эти runs дали достаточно evidence о хрупкости ручной сборки refs и
незавершённых domain contracts. Полный P3–P9 остаётся целью, без замены результата
диагностическим PASS. Продолжать на ChatGPT subscription/Luna/medium.
Active Hermes/browser нет.

## 2026-09-06 — сравнение Xiaomi завершено; продолжение на Luna по запросу

Xiaomi subscription run 20260906-010130-5f13962b terminal, session 38171 закрыт.
Actual usage xiaomi/mimo-v2.5, 114 API calls, completed=true, failed=false,
returncode=0, timeout=false. Подписочное подключение работает. Harness 30fc656f,
runtime e5f0bd6201ab83cbd8915ed3001b29266bc2cb4a5116cbdf0e9068334f9bdf48.
Frozen audit 47/58 FAIL, SHA
846096026ca704856af6e8354208f9493f9f495cd24c11d8fa22e9b341bc00e2.
Дополнительные FAIL: knowledge scope, navigation path, delivered CSV/raw receipt;
семь domain verifiers остаются открыты. Единственный наблюдавшийся wizard stage
text_import_file; полный pipeline не выполнен. Последняя ошибка: call row 226
передал operation_id из reply 225 вместо его output.observation_id.

Сравнение с последней Luna попыткой 004205-b5f4f1d3: 50/58 и 107 API calls,
также без полной P3 приёмки. Это единичные диагностические runs, не оценка общего
качества моделей. Пользователь явно попросил продолжать на ChatGPT/Luna/medium;
Xiaomi больше не используется без нового запроса.

Исправлена обратная связь клиента при смешении IDs: существующий store хранит
последний receipt operation_id для каждой observation. get(wrong receipt ID)
выдаёт правильный output.observation_id и требует только ранее выданные refs;
не принимает alias и не выполняет действие автоматически. Неизвестный/удалённый
ID остаётся stale, неоднозначный не выбирается произвольно. Continuation read
обновляет receipt correlation. 245 client /110 Python /10 packaging PASS.
Отчёты .dock/post-mvp-p0/observation-id-*-tests.txt. Следующий полный run — явно
--model-profile chatgpt-luna. Active Hermes/browser нет до следующего запуска;
цель весь P3–P9, domain gates не закрыты подсказкой.

## 2026-09-06 — уточнён именно подписочный профиль Xiaomi

Пользователь уточнил: использовать подписку Xiaomi. Первый Xiaomi run
20260906-005734-91a132d6 terminal до tools (1 API call, failed=true), audit
18/23 FAIL, SHA 177c3c9e88f9d88ec44bc021580f8dd8ac9a73682f1095608f268cba1942ffe6.
Диагностика только error metadata: 401 Invalid API Key. Причина конфигурации:
скопирован ключ из Hermes .env, но потерян подписочный base_url из Xiaomi
credential_pool; запрос попал на стандартный metered API. Это не доказывает,
что подписочный ключ не работает. Никаких Loginom actions этот run не выполнил.

Исправлено: читается единственная Xiaomi pool entry source=env:XIAOMI_API_KEY,
её token-plan endpoint и тот же ключ; передаются только XIAOMI_API_KEY и
XIAOMI_BASE_URL. Не копируются чужие credentials/pool entries. Missing/duplicate,
HTTP, URL credentials/query и non-subscription endpoints отклоняются без fallback.
110 Python tests PASS. Следующий run должен подтвердить доступ к подписке.
Клиент/полный goal/fixture/лимиты прежние. До запуска active Hermes нет.

## 2026-09-06 — сравнение той же P3 проверки на Xiaomi по запросу пользователя

Luna run 20260906-004205-b5f4f1d3 завершён (session 1629 terminal): exit 0,
107 API calls, timeout=false; frozen audit 50/58 FAIL, SHA
1e469c082c0c47a223b1959de19d88a217a09d1e240fe91ee7285783a234bca0.
Открыты navigation path gate и семь domain verifiers. Полная приёмка не достигнута.

Пользователь попросил ту же проверку с Xiaomi MiMo 2.5. Добавлен opt-in
--model-profile xiaomi-mimo только для data-pipeline: xiaomi/mimo-v2.5/medium.
Default ChatGPT/Luna сохранён. Ключ берётся только из существующего Hermes .env,
не выводится и не сохраняется в child config/auth. Остальные provider keys и
личная MCP-конфигурация не копируются. CLI provider/model явные, fallback_providers
пусты; auditor сверяет request profile и actual usage. 109 Python PASS, включая
изоляцию Xiaomi key, отсутствие interpolation, duplicate/missing/malformed key,
отказ подменённому provider/model и неразрешённой цели.
Runtime Loginom client после 0b7e385d не меняется. Goal/fixture/лимиты прежние.
Новый Xiaomi run ещё должен быть запущен и проверен; см. следующий checkpoint.

## 2026-09-06 — P3: живой ввод формулы подтверждён; основные элементы мастера подняты

Run 20260906-002935-fc60ced5 terminal exit 0, timeout=false, 67 API calls,
Hermes openai-codex/gpt-5.6-luna/medium, test,/test; harness 826221b2.
Runtime b735a27e890da8845946eb32591922c95bceb351510b3b05b53b0635ca9561d6.
Frozen audit 50/58 FAIL, SHA
72be60c84c140477db73de74393cb7a01636e2266ee92279ba47a1138f293041.

Реально подтверждено: в Calculator expression mode selected Expr1, пустой
CodeMirror document был прочитан полностью; dock_ui_action replace_expression
(строка 141) ввёл Quantity * UnitPrice. Reply 142 SUCCEEDED содержит exact
readback, тот же selected field/wrapper/input/document и expression_text_verified.
Это live подтверждение native keyboard + public document reader, НЕ syntax,
Amount field metadata, input mapping, import settings или applied/saved settings.
Перед Калькулятором наблюдались input_mapping и calculator; настройки импорта
в этом run не выполнены. Execution/Group/reopen/reexecute не выполнены.

После ввода cursor дважды устарел, в том числе после корректного fresh
WizrdMCF root read. Raw receipt этого чтения содержит 41 control: AND/OR и
прочие helper buttons раньше btnExprEdit (index 21) и btnNext (index 36),
тогда как первая страница выдала 19 записей. Поэтому одного приоритета root
недостаточно. Исправлено: menu/modal сохраняют приоритет, затем wizard lifecycle,
Calculator edit/add/mode, editor, expression-name rows и обычные поля. Exact
colExpressionName текущего wizard стали наблюдаемыми action targets. Прочие
элементы остаются доступны, guards/freshness не ослаблены. Тест с 70 helper
buttons проверяет реальный pager и выдачу action refs Next/Edit/Amount в первой
странице. 243 full client /107 Python /10 packaging PASS; отчёты wizard-priority-*-tests.txt.

Transfer-only audit не принят по корректной причине: до test агент одиночно
выбрал строку admin. Это выход за разрешённый navigation path; gate не ослаблен.
Последующие страницы каталога теперь прошли immutable receipt/destination gates.
Остальные семь FAIL — открытые domain verifiers. Старый frozen audit не менялся.
Session 63618 terminal, active Hermes/browser нет. Далее полная цепочка начиная
с настройки импорта, затем метаданные Amount/формула/mapping, Group, execution,
results и save/reopen/reexecute; цель весь P3–P9 сохраняется.

## 2026-09-06 — P3: завершён run 001652; исправлена проверка последующих страниц

Полный data-pipeline run 20260906-001652-2b44f209 завершён, процесс exit 0,
без timeout, Hermes openai-codex/gpt-5.6-luna/medium, 63 API calls. Учётная
запись test, destination /test; harness 84ef4e42. Runtime source pin
f48ed0c38a8827d5953a559e5d4d18e2e038ff57bb4303b0a07e95ac18b46136.
Однократный frozen audit: 49/58 FAIL, SHA
f662fa2ca4170e62d22e294702458b4614236eb4fee90c6ffcacdfc823bbf8cf.

Native upload/verify вернули success/completion, но независимая передача НЕ
принята: directory receipt и delivered destination gates не прошли. Причина
аудитора: последний directory read был четвёртой страницей (offset 86), а
compact_receipt_equal принимал только offset 0. Сохранённый FAIL не пересчитан.
Остальные семь FAIL — незавершённые domain verifiers. Модель дошла до
text_import_format, затем завершила работу после повторных stale cursor / ref
rejections. Калькулятор, его document API/keyboard и вся последующая цепочка
не проверены этим запуском. Терминал session 96624 закрыт; active Hermes нет.

Исправлена независимая проверка all-scope continuation pages: точный offset/
returned, slice contents, total, cursor presence, omission/truncated flags,
metadata; последняя страница сама по себе не объявляется complete snapshot.
Тест формирует три страницы через настоящий JS renderer, проверяет их и
отклоняет подмену offset/content/directory/completeness. Это не ослабляет raw
receipt binding и не принимает model domain_proof. 107 Python PASS.

Для recovery после stale cursor добавлена подсказка: заново scope roots, затем
fresh WizrdMCF root_ref/observation_id. Discovery приоритетно выдаёт текущий
wizard перед его таблицами; тест с 80 предыдущими таблицами подтверждает, что
root доступен первым и detailed read ограничен двумя элементами. Guards/freshness
не ослаблены. 242 client /10 packaging PASS, отдельные 12 paging tests PASS. Отчёты
.dock/post-mvp-p0/continuation-{client,pages-client,audit-python,packaging}-tests.txt.
Эффективность recovery и editor contract требуют следующего полного live run.

Дополнительный source finding: E2E tests/issues/04k/04k0/4336.ts проверяет, что
после Next выбирается выражение с ошибкой, даже если перед этим выбрано другое.
Для error readback связывать фактическое поле после validation и MsgBox через
BtnError (bg/helpers/wizard.ts HasWizardError). 4337.ts skipped — только источник
исторического сценария, не актуальное acceptance evidence. Цель весь P3–P9.

## 2026-09-06 — P3: typed замена выражения с чтением документа

Добавлен replace_expression в существующий dock_ui_action/receipt/pending,
без отдельного журнала. Он доступен только exact Calculator cmpExpression,
при единственном выбранном поле (E2E colExpressionName + x-grid-item-selected),
режиме expression и writable CodeMirror document. Read-only public методы
getDoc/getInputField/getWrapperElement, firstLine/lastLine/lineCount/getLine
читают полный LF-текст независимо от viewport: максимум 128 строк/2048 UTF-16.
Поддокумент, неподдержанные методы/размер, readOnly и неоднозначность не дают
права на замену. rendered_lines остаются fallback, не full-text proof.

Ввод — native click/keyboard select-all/backspace/type; setter API редактора
не используется. Перед clearing и вводом проверяются выбранное поле, mode,
identity документа/input/wrapper, текст и фокус. После — точное чтение текста
того же документа. Потеря фокуса/получение другого текста сохраняет AMBIGUOUS.
expression_text_verified НЕ означает проверенный синтаксис или applied/saved
settings: syntax_validity=unverified, settings_applied=false. Эти gates открыты.
Подсказки observe/action и полный diagnostic goal обновлены.

Источники: E2E calculator_helpers.ts, sCalculator.ts, app_consts.ts; публичный
[CodeMirror 5 API](https://raw.githubusercontent.com/codemirror/codemirror5/master/doc/manual.html).
Наличие API и правильный keyboard input в текущем Loginom ещё требуют live
проверки; локальный DOM double этого не доказывает. 240 full client /106 Python /
10 packaging PASS, затем дополнительный race-test: 61 targeted workspace-ui PASS.
Отчёты .dock/post-mvp-p0/expression-contract-*-tests.txt. Runtime inputs остаются 46.
Далее новый полный data-pipeline run на Hermes ChatGPT/Luna/medium, test,/test,
после него исправлять фактическую границу. Все семь domain gates остаются открыты;
execution/full typed results/saved reopen и P4–P9 не заменены этим контрактом.

## 2026-09-06 — P3: наблюдаемый контекст редактора Калькулятора

В workspace-ui добавлен calculator_editor у exact cmpExpression текущего
workflow: режим expression/javascript по source-backed иконке btnCalcMode,
неоднозначность/отсутствие режима и ограниченные rendered_lines (32 строки,
2048 UTF-16 code units, без trim, hidden и sensitive text исключаются).
Narrow read сохраняет mode context через фиксированные queries без обхода
всего мастера. Generic gestures запрещены для wrapper и его потомков до
реализации отдельного typed write/readback contract.

Источник: e2e-tests bg/sels/transform/sCalculator.ts и calculator_helpers.ts
check.Mode / expression.Check; Help calc/README.md и expression.md.
В самом E2E expression.Check отмечена ненадёжность empty/multiline проверки.
Поэтому rendered_lines НЕ полный документ: full_text_verified=false,
syntax_validity=unverified; виртуализация, placeholder, сохранение формулы и
принадлежность конкретному вычисляемому полю ещё требуют отдельного evidence.

Проверки: 234 full client PASS, затем дополнительный line-cap case — 55 targeted
workspace-ui PASS; 106 Python и 10 packaging PASS. Отчёты .dock/post-mvp-p0/
calculator-context-{client,targeted,python,packaging}-tests.txt. Это локальные
проверки, нового live запуска не было. Runtime inventory остаётся 46 inputs.
Следующий шаг — typed editor write с подтверждением полного текста, выбранного
поля и синтаксиса; затем execution/result contracts и новый полный data-pipeline.
Семь domain gates пока открыты. Active Hermes/browser нет, P3–P9 продолжаются.

## 2026-09-06 — P3: независимое сравнение отображаемых таблиц

Добавлен host-only auditor helper rendered_results.py и подключён к диагностике
полного data-pipeline. Он читает только raw observation_completed, связанные
с фактическим вызовом/ответом dock_workspace_observe через точное сравнение
квитанции. Model domain_proof и непривязанные/подменённые ответы игнорируются.
Helper и CSV/expected/task включены в frozen dependency check аудитора.

Сравнение поддерживает текущие fixture import/calculator/group: точные имена
полей и типы, view/workflow identity, field/row identity, полную матрицу видимых
ячеек, untrimmed строки и observed null marker. Counter сохраняет число
дубликатов, но не требует одинакового порядка строк. Локальный numeric parser
использует Decimal и явные decimal/group separators, проверяет группировку,
не применяет float tolerance, не принимает NaN/Infinity/пробелы на краях или
дробь для integer. Неоднозначные имена после потенциально lossy Format не
восстанавливаются: текущий comparator допускает literal ASCII fixture keys.

Результат называется rendered_rows_match, не complete_result_verified.
Подтверждение числового формата пока отсутствует в live evidence: diagnostic
caller не передаёт догадку о локали, а получает numeric_format_required.
Даже пустая отображаемая таблица или совпадение всех видимых строк не доказывает
общее число строк, настройки форматирования, свежий execution, node ownership
или результаты после reopen. Семь domain gates остаются открыты. Это рабочий
компонент сравнения для будущего полного verifier, не P3 acceptance.

**106 Python PASS**: все три ожидаемые таблицы, замена типа/числа/null/строки,
перестановка и потеря дубликатов, пропуски/дубли cell IDs и заголовков,
редактирование связанного ответа, отсутствующая локаль, неверная группировка,
малое числовое отличие, literal <null>, пустой набор и malformed context.
Client runtime не менялся, прежние 231 client /10 packaging относятся к той же
ревизии; live в этом шаге не запускался. Следующий шаг — типизированный контракт
редактора выражения и execution/result ownership/coverage/format evidence,
после чего заменить missing domain gates независимыми проверками и продолжить
полный P3–P9. Active Hermes/browser нет; production/public rc2 не менялись.

## 2026-09-05 — P3: live wizard context и основа чтения табличных данных

Полный run 20260905-233444-3cb9795c закончен, harness 120ec845,
runtime 3421a6fdacb40f9949270ad42027b4466fbdbdaec298d58b9e79f954033c2ec7.
**47/58 frozen FAIL**, audit SHA 1ea5c9e7c2fd06ebeefecb1ab0975d30a314a9e474da59c0817c1e7cc0d69713.
Hermes на текущем Mac / ChatGPT / openai-codex / gpt-5.6-luna / medium,
explicit test,/test; returncode=0, timed_out=false, 87 API calls. Live wizard
metadata показал text_import_format / «Настройка форматов импорта» и done /
«Описание узла» с кнопками. Импорт дошёл до btnDone и возврата в граф; агент
остановился до Калькулятора/Группировки, выполнения, сохранения и reopen.
Одно завершение мастера не доказывает применённые настройки или данные.

Native upload/download/host SHA и resolved присутствовали, но строгий transfer
prefix не принят аудитором: whitelist compact_receipt_equal ещё не включал
новое поле wizard. Исправлен точным сравнением metadata, не удалением поля;
negative tests подмены title/stage/отсутствия metadata проходят. Старый frozen
отчёт не переоценён. Ещё один FAIL: два malformed knowledge read с arguments={},
не подтвердившие scoped access. Семь domain verifiers по-прежнему отсутствуют.
Обнаруженный live шаг ColumnsMappingEngineOutputPortWizard добавлен как
output_mapping по E2E sMapping.DataImport; он отличается от input_mapping.

Добавлена основа read-only result inspect в existing table_cells:
- data_column: view_key, column_key, declared_type и type_status из известных
  E2E CSS-классов; неизвестные/неоднозначные типы не угадываются.
- data_cell: view/column/zero-based row identity, untrimmed display_text до 2048
  chars с text_complete, observed null_marker_present. Числа пока не парсятся.
- Поддержаны плавающий/закреплённый DataSet Preview и ViewsForm;BrowseView.
  Их корни доступны в bounded discovery. Missing/ambiguous header или sensitive
  header/key скрывает текст; inactive view не выдаётся как распознанный dataset.
  Метаданные не доказывают execution identity, row count/completeness или precision.

Help visualization/preview/quick-view.md подтверждает округление real до двух
знаков. Для exact comparison даже этого fixture нельзя исключать скрытую ошибку
под округлением: нужен Table с проверенным форматированием. Help table/format.md
описывает исходную точность по умолчанию; E2E sBrowseView.ts — field/row IDs.
Goal уточнён: продолжить всю цепочку после «Готово», использовать полное
представление для строгой сверки. Новые table metadata пока проверены локально,
не live data acceptance. **231 client /98 Python /10 packaging PASS**. Следующий шаг — typed result/execution/formula
contracts и независимые domain verifiers, затем новая полная live проверка.
Active Hermes/browser нет; production/public rc2 не менялись.

## 2026-09-05 — P3: полный прогон дошёл до мастеров; добавлен контекст шага

20260905-231342-cb9aaa6c, data-pipeline, harness acd5c423,
runtime 12468a779aad238620b50feef26fa58a428233e32d7f41bf13a4754fdbee0efa:
**50/58 frozen FAIL**, audit SHA 16d6df0e6fba897dcc8ff1745f1fbf9e7596b6b5e18021fce842b78e78916975.
Current Mac / Hermes / ChatGPT / openai-codex / gpt-5.6-luna / medium, test,/test.
Transfer prefix прошёл: CSV upload/download/SHA/cleanup/resolved. Созданы
«Источник», «Расчёт», «Итог»; агент работал с мастером текстового импорта,
введённый null marker совпал с fixture. Настройки/вычисленные строки/save/reopen
не подтверждены. FAIL включает семь missing domain verifiers и один malformed
вызов dispatcher (only_supported_dock_tools); транспорт процесса завершён,
returncode=0, timed_out=false. Это не P3 acceptance и не реальный блокер.

В ходе открытия Калькулятора были double_click по Graph;Vertex/Label/Setting,
перекрытия/смены epoch; наблюдался TuneDataSourceInputPortWizard. Он может быть
обычным шагом входного сопоставления перед страницей компонента: без title/
stage нельзя заключать, что был открыт чужой узел. E2E OpenNodeSettings использует
один click по Setting. Goal теперь ссылается на этот helper и точные Calc источники.

Добавлен read-only wizard metadata: видимый root/title, распознанный stage по
фиксированным P3 markers, состояния btnPrev/Next/Done/Execute/Close/Error.
Сопоставление входных полей названо input_mapping, без вывода о владении узлом
или применённых настройках. Невидимые/неактивные forms исключаются, несколько
видимых stages дают ambiguous. Fixed native queries работают при roots/narrow
reads без обхода всей формы; title читается ограниченно с redaction. Metadata
передаётся на всех страницах, изменение шага инвалидирует cursor. Это основа
inspect мастера, не доказательство применения/выполнения/typed results.
Проверки: **228 client /98 Python /10 packaging PASS**. Тест DOM double расширен
для стандартных CSS attribute suffix/prefix/contains и точек внутри attr values.
Для полного data-pipeline разрешён операторский предел до 300 model turns
(прочие goals по-прежнему до 100), общий timeout до 3600s. Следующий полный run
можно выполнять с 240 turns /3600s, текущей подпиской/моделью и явными test,/test.
Сначала проверить live wizard metadata и нормальное прохождение мастера, затем
typed expression/result/execution и остальные P3–P9. Active Hermes/browser нет;
production/public rc2 не менялись, frozen audit не переоценён.

## 2026-09-05 — P3: полная задача и исправление восстановления после отказа

Подключён diagnostic goal data-pipeline (3bbaa3bd): полная цепочка CSV → импорт →
Калькулятор → Группировка → typed results → save/reopen/reexecute. Harness пинит
CSV, expected.json, task.txt и goal до запуска. Transfer prefix проверяется
независимо до первой следующей мутации. Семь domain verifiers ещё отсутствуют;
аудитор явно возвращает diagnostic_only_domain_verifiers_incomplete / FAIL,
не принимает утверждения модели или синтетический domain_proof как успех P3.

Первый live 20260905-230333-1c9cfc15, harness 3bbaa3bd, runtime 333d705948a9e3adeb9473bdf0019a333cd1034f09927515ef74676baa792bd4:
24/32 frozen FAIL, audit SHA d0893174c44edb19ddcf17e870ab02babba397c37d1edacbe6502b4be63016fe.
Hermes ChatGPT/Luna/medium, test,/test. Не дошёл до upload: агент скопировал grant
с опечаткой, получил REQUEST_REJECTED без эффекта. Затем повторный dock_prepare
из файлового хранилища завершился ошибкой и сбросил workspaceReady. Это client
recovery issue, не блокер учётной записи. Прежний frozen report не переоценён.

Исправлено: dock_action_describe возвращает public input_artifacts текущей
сессии; ошибочная пара grant/artifact даёт ту же информацию прямо в отказе.
Это только повторная выдача уже допущенных descriptors, без sourcePath/bytes и
без ослабления точного сравнения ID. Повторный prepare готового workspace
отвергается до браузера и сброса readiness, с указанием observe/describe.
Pipeline audit исключает из счётчика отправок только доказанные pre-action
отказы без эффекта и native records; реальные failed/ambiguous попытки остаются.
Проверки: полный client 225 PASS, Python 98 PASS. Следующий шаг — новый полный
live run, затем наблюдаемые ограничения мастеров/типов/результатов и весь P3–P9.
Production/public rc2 не менялись.

## 2026-09-05 — P3: live transfer завершён после server byte proof

**20260905-225713-f00430f8, file-upload-verify: 48/48 frozen PASS.**
Audit SHA 3a5bfbea5cc42cbab08727642fdc7e384916b97d7735695a4b15b300a94a333f.
Runtime 333d705948a9e3adeb9473bdf0019a333cd1034f09927515ef74676baa792bd4;
harness ec826a24. Текущий Mac / Hermes / existing ChatGPT subscription /
openai-codex / gpt-5.6-luna / medium. Explicit Loginom test, storage /test.

Bounded toolbar discovery → подробное чтение кнопки → переход в /test →
один native upload → inspect pending → exact CSV row → download → host SHA/size →
cleanup leases → durable transfer_completed/verification_completed → inspect
resolved с original upload SUCCEEDED и upload_completion_verified=true.
Destination /test/Dock-upload-20260905-225713-f00430f8.csv, 230 bytes,
SHA f628434c20873f7dd9a8ee142c17af7c0b99f447114fcf60e983f6ed6b357eb3.
Новых mutations после verify не было. Runtime/harness не менялись в ходе
model run, audit выполнен один раз. Полный client suite 223 PASS, Python 91 PASS.

Это закрывает узкую live проверку transfer completion для explicit replace
fixture; не означает полную готовность P3 или выхода из MVP. Следующий шаг —
импорт CSV, Калькулятор, Группировка, typed results и save/reopen/reexecute.
Для text import прочитаны Help data/integration/import/txt/README.md и E2E
wizards/imports/txt/format_settings.ts, bg/sels/import/sImportTxt.ts. E2E
подтверждает ввод произвольного маркера Null; это source evidence, не live
доказательство результата fixture. Reject/conflict и download budget открыты.
Active Hermes/browser нет; production/public rc2 не менялись.

## 2026-09-05 — P3: завершение transfer и доступ к главной панели

В a3a687d2 реализовано завершение original upload по postcondition
`destination_bytes_digest_and_size`: confirmed native submission + matching
server bytes + завершение browser calls + cleanup обоих leases. Промежуточный
`download_verified` сохраняет completion=false; отдельные `transfer_completed`
и `verification_completed` фиксируются до снятия pending. При сбое журнала
inspect завершает запись по сохранённому byte proof без нового download/hash;
при неизвестном submission или неуспешной очистке guard сохраняется.
222 client /91 Python /10 packaging PASS; дополнительные targeted проверки
artifact verification 7 PASS, workspace UI после ref feedback 45 PASS.

Два новых frozen live запуска **не дошли до upload/verify**, 23/24 FAIL каждый:
- 20260905-224356-6232a5f0, runtime 980c900d1bbf2211118f501419fe65a70d12ab8ee52f2a48b0001e28316a62a5,
  harness a3a687d2, audit SHA 1d8ae344ab1ad52b21a87a6c287e4997754d1293f3451f9621ad034d32a78351.
  Агент передал tid вместо opaque ref; запрос отвергнут до действия. В dead3a6e
  уточнены ошибка и допустимое исправление REQUEST_REJECTED без effect.
- 20260905-224849-6b3d76f7, runtime 0077b65452c832669364217f07877637501701347b0ab8393616d27d01cf3848,
  harness dead3a6e, audit SHA bbef8f543a646f3e2f16ed5cc4a75aef0f82bbc3128ed0b773d276ba973b1676.
  Только чтения: агент не нашёл переход в «Файлы». Root discovery не включал
  главную панель. Добавлена точная область MF;cntMain;tlbMainToolbar;
  scoped detail даёт её кнопки, без обхода большого workspace. Synthetic
  regression с 6500 фоновыми элементами и весь workspace suite: 46 PASS;
  Python harness 91 PASS. Новый goal поясняет discovery → detail → button ref.

Оба запуска: текущий Mac, Hermes, existing ChatGPT subscription,
openai-codex / gpt-5.6-luna / medium, explicit test и /test. Frozen отчёты
не переоценены. Completion по новой реализации ещё требует нового live run;
прежний 46/46 PASS ниже доказывает server bytes на старом runtime. Далее
CSV import → calculator → group, reject/conflict, download budget и весь P3–P9.
Production/public rc2 не менялись.

## 2026-09-05 — P3: живая сверка серверного CSV с исходными байтами

20260905-222924-99da5577, file-upload-verify: **46/46 frozen PASS**.
Audit SHA de9b6307e390163ae0c2ed104ee48e3e7de74773894fd669d3d2183721a7f3d8.
Runtime 296dd7aa12345afbcc46030da0dd34e6940a39ed9c02b5724dd236dbb213c9e8;
harness de1364fa. Current Mac / Hermes 0.21.0 / existing ChatGPT subscription /
openai-codex / gpt-5.6-luna / medium. Explicit Loginom test и directory /test.

В одной сессии выполнены upload native input, inspect pending, exact CSV root
lookup/detailed read, native download и host stageDownload.verify. Destination:
/test/Dock-upload-20260905-222924-99da5577.csv. Скачанные 230 bytes совпали с
admitted SHA f628434c20873f7dd9a8ee142c17af7c0b99f447114fcf60e983f6ed6b357eb3.
dock_artifact_verify вернул SUCCEEDED/bytes_verified=true; original upload
по текущей реализации сохранил pending и upload_completion_verified=false.
Имена, grant, directory, delivered file ref/observation и native download receipt
связаны с host download_verified journal. Следующих mutations не было.

Новый harness goal/auditor upload_verify.py проверяет эту цепочку независимо,
включая pending context из inspect, raw observation, exact SHA/size и отсутствие
ложного completion claim. Export теперь поддерживает dock_artifact_verify;
другие goals его не допускают. 91 Python PASS (wrong bytes/ref/receipt/context,
подмена artifact checkpoint, повтор и false resolved — negative cases).
Исходники во время model run не менялись, старые frozen reports не переоценены.

Это подтверждённый server-copy byte proof, не полная приёмка P3. Следующий
шаг — связать browser completion и достигнутый postcondition transfer
(destination_bytes_digest_and_size в effect-contracts.mjs) с завершением
original operation, чтобы продолжить import/calculator/group; не освобождать
guard на одном имени/наличии строки или неопределённом browser call. По-прежнему
нужны reject/conflict и download budget, затем весь P3–P9. Active Hermes/browser
нет; production/public rc2 не менялись.

## 2026-09-05 — P3: runtime связывает download receipt с host SHA

Подключён candidate dock_artifact_verify: original operation_id, verification_id,
observation_id, file_ref. Другие поля (включая download_path) отвергаются MCP
handler до браузера. Требуются pending upload, confirmed browser completion и
cleanup, assertIssued и exact CSV identity. Upload checkpoint хранит storage
root ref для scoped reread. Host stageDownload lease передаётся private primitive;
новый verification ID использует существующий browserReceipt, не второй журнал.

Native artifact.download receipt записывается как download_completed; только
после matching artifact/grant/destination/observation/ref и проверки lease SHA /
size появляется отдельный artifact.verify/download_verified outcome. Ошибочные
байты дают FAILED/DOWNLOADED_ARTIFACT_MISMATCH без вывода их содержимого. Успех
ставит bytes_verified=true и upload_completion_verified=false. Original upload
сохраняет AMBIGUOUS/pending; inspect показывает server_copy_verification summary.
Server transfer completion по этому результату НЕ считается подтверждённым.

Repeat verification ID возвращает cached outcome. Lost response оставляет lease
и unresolved verification; новый ID блокируется. inspect original upload читает
его download receipt и хэширует уже сохранённую копию, без повторных download /
upload. Raw receipt удерживается также при сбое записи host evidence; concurrent
inspection не запускает второй финализатор. NOT_APPLIED освобождает пустую
lease после подтверждения browser completion; завершённые копии сохраняются
до session shutdown для дальнейшей диагностики.

219 client /10 packaging PASS. Четыре integration tests исполняют сериализованный
browser/runtime с внешним Page/download double и настоящим artifactStore/FS:
верные bytes, wrong bytes той же длины, lost response без повторных эффектов,
unissued ref/wrong upload/ID collision. MCP contract проверяет публикацию verify
и отказ на подмену download_path. Python/native/live не запускались: следующим
шагом нужен новый harness goal и independent auditor upload→verify одной сессии;
нынешний file-upload-probe не разрешает verify и не доказывает server SHA.
Затем server completion, download budget/reject и полный P3–P9. Active
Hermes/browser нет; production/public rc2 не менялись. Runtime inputs всё ещё 46.

## 2026-09-05 — P3: привязка CSV download к наблюдаемому файлу

Добавлен private makeArtifactDownloadCode в executor.mjs. Только exact CSV
label и tid FileStorageForm;colName_<Format(name)>; LGP и другой label/ref
отвергаются до браузера. Свежий read NavigationBar root проверяет authenticated
origin/build/workflow, directory, DOM epoch и отсутствие dialogs/masks.
Page download listener регистрируется ДО existing checked UI double-click,
поэтому сохранены incarnation/geometry/hit проверки и быстрый event не теряется.
Скачивание требует expected suggestedFilename и same-origin URL (включая blob);
raw URL с возможными token/query не возвращается. saveAs получает private path
от host adapter, затем storage context читается снова. Результат содержит
bytes_verification_required=true, НЕ утверждает SHA или upload completion.

Wrong filename/origin и event после failed gesture отменяются. Missing event
после жеста остаётся AMBIGUOUS/cleanup unconfirmed. Exception не выводит native
messages/paths, дожидается bounded event и пытается cancel. Event timeout 15s
не ограничивает saveAs/network/disk; этот лимит и receipt recovery остаются
обязанностью следующего runtime integration. Новый primitive ещё НЕ public tool.

215 client /10 packaging PASS. Шесть новых тестов исполняют сериализованный
production driver с внешними Page/download doubles: event-before-click,
exact file/ref/type, directory/epoch change, wrong name/origin, failed gesture,
missing event и context change после saveAs. Python/native/live не запускались:
нет ещё вызова через реальный upload operation и host stageDownload.verify.
Далее связать primitive с assertIssued, original upload ID/verify ID, private
download lease и browserReceipt; после host SHA/size proof отдельно установить
server transfer completion и reject/conflict contract. Затем полный P3–P9.
Активных Hermes/browser нет; production/public rc2 не менялись.

## 2026-09-05 — P3: первая живая отправка синтетического CSV

20260905-215859-f2878b83, file-upload-probe: **36/36 frozen PASS**.
Audit SHA 10a973d4b492573ca8818bbe878fddcf62277f44df092d95dd5c243c1c212011.
Runtime ed30bddcd0b522dd52203613fb2514efa0f3cc01a843dee0ea84418b76ed0288;
harness 594efa2e. Current Mac / Hermes 0.21.0 / connected ChatGPT subscription /
openai-codex / gpt-5.6-luna / medium. Loginom test, directory /test подтверждён
по fresh NavigationBar read перед отправкой. Tool export: 35 calls /31 replies
(calls также включают tool search), одна отправка и затем inspect pending.

Разрешённый destination: /test/Dock-upload-20260905-215859-f2878b83.csv.
Исходный fixture 230 bytes, SHA
f628434c20873f7dd9a8ee142c17af7c0b99f447114fcf60e983f6ed6b357eb3.
Host выдал exact run-specific replace grant. dock_artifact_upload вернул
AMBIGUOUS/UPLOAD_SERVER_VERIFICATION_REQUIRED с upload_submitted=true,
cleanup_complete=true; inspect сохранил pending и отсутствие recovery options.
После отправки изменений UI не было. Ответы связаны с immutable browser journal,
grant — с descriptor из dock_prepare, fixture — с predeclared harness hash.

Probe добавлен в run.py/upload_probe.py/goals: fixture/name/authorization
фиксируются до model run, sourcePath остаётся private CLI argument. Аудитор
отдельно проверяет pre-upload navigation, единственную отправку, trace/journal,
pending после inspect и отсутствие следующих mutations. Для остальных goals
upload запрещён; export теперь поддерживает этот typed tool. 89 Python PASS,
включая negative cases wrong grant/destination/digest, unbound receipt, false
SUCCEEDED/resolved и повторную отправку. Исходники в live run не менялись.

Ограничения: native input completion НЕ подтверждает server transfer completion,
содержимое файла на сервере, запрет перезаписи или весь P3. Pending operation
завершила сессию как unverified; последующие проверки должны связать upload и
download в одной сессии, пока operation/lease существуют. Для этого нужны
server/download-event binding, byte verification/budget и reconciliation; затем
reject semantics и полная pipeline/P3/P4–P9 приёмка. Активных Hermes/browser нет,
production/public rc2 не менялись. Предыдущие frozen отчёты не переоценены.

## 2026-09-05 — P3: candidate upload submission через существующий executor

Подключён dock_artifact_upload в replay/allowCandidate с artifactStore. MCP
схема строго требует artifact_id/upload_grant_id/observation_id/operation_id;
пути/overwrite/прочие поля запроса отклоняются. Runtime получает точный grant,
проверяет наблюдаемый directory, stageUpload/verify и сохраняет prepared journal.
В браузере свежий read проверяет authenticated origin/build/workflow/DOM epoch,
directory и отсутствие dialogs/masks. Нужен единственный enabled hidden
input[type=file] под видимым active FileStorageForm;tbrActions (E2E UploadFiles).
После получения handle epoch проверяется снова; native setInputFiles получает
только private staged path. Ошибки не возвращают native message/локальный путь.

Сейчас поддерживается только явно разрешённый replace. reject даёт отказ до
staging, без fallback. После native input выдаётся AMBIGUOUS с
UPLOAD_SERVER_VERIFICATION_REQUIRED, не SUCCEEDED: server transfer ещё может
выполняться. Тот же executor pending/browserReceipt/journal сохраняет операцию.
Повторный/одновременный ID не отправляет файл; другой ID блокируется. inspect
восстанавливает потерянный receipt без setInputFiles. Pending upload не допускает
prepare/UI repair/abandon/new mutation. Source lease остаётся до подтверждения;
NOT_APPLIED освобождает его после browser completion, в том числе восстановленного.
Отмена до dispatch (включая во время prepared journal) освобождает staging.

208 full client /10 packaging PASS; после финального исправления освобождения
lease при восстановленном NOT_APPLIED и describe metadata — 33 targeted
executor/bridge/upload PASS. Upload tests исполняют сериализованный production
driver/runtime с внешними DOM/Playwright doubles: context/epoch/auth/build,
mask/dialog, неуникальный/недоступный input, concurrent repeat, cancellation,
lost reply/submission error, blocking repair и отсутствие пути в journal.
MCP test проверяет публикацию tool и отказ на лишний destination до браузера.
Python/live не запускались. Production/public rc2 не менялись, активных
Hermes/browser нет. Runtime inputs остаются 46 (новых runtime modules нет).

Это submission-only candidate, НЕ P3 acceptance. Далее server transfer completion
и скачанная копия с привязкой к operation/destination, bounded download,
reconciliation, real conflict/reject semantics; затем fixture pipeline и P4–P9.
До этого нельзя трактовать upload_submitted или наличие строки как успех загрузки.

## 2026-09-05 — P3: явное разрешение на точный upload destination

Trusted startup --input-artifact теперь допускает optional upload с точными
полями directory/overwrite. Политика reject или replace обязательна, default
нет. Проверяется весь batch до admission/file reads; path — виртуальный каталог
Loginom с явными сегментами, не OS user/root. После admission descriptor
содержит upload.grant_id, directory, destination=directory+'/'+display name,
overwrite. Без upload назначения нет. getUploadGrant требует одновременно
artifact_id и grant_id этой сессии, не принимает новый путь/имя/политику.
Возвращаемые descriptors копируются; nested upload metadata в lease frozen.

201 client /10 packaging PASS; тесты покрывают разные Loginom accounts/Unicode,
cross-session/cross-artifact/unknown grant, отсутствие policy, malformed paths,
extra fields, отсутствие частичного admission при невалидном втором элементе,
подмену возвращённых метаданных. Python и live не запускались: Python не менялся,
browser upload driver ещё не подключён. Native roundtrip из предыдущего пункта
остаётся доказательством того зафиксированного runtime, не новой live приёмкой.

Далее связать grant со stageUpload и существующим executor pending/browserReceipt;
нельзя открывать raw file input через generic UI или молча заменять reject на
replace. Grant — только разрешение: server ownership/absence/conflict safety
и привязка download event всё ещё требуют отдельной реализации и live proof.
P3 и весь P4–P9 остаются открыты; production/public rc2 не изменены.

## 2026-09-05 — P3: проверка байтов скачанного файла на клиенте

Добавлен host-only artifactStore.stageDownload(artifact_id): private directory
и заранее отсутствующий файл для Download.saveAs. Нет копирования исходных
admitted bytes в download destination, поэтому отсутствующий download не может
ложно пройти сверку. verify требует точного suggestedFilename браузерного
события, regular file, размера и SHA исходного admission; возвращает descriptor
без path/bytes. Download/upload делят лимит 8 leases и pending stages; shutdown
дожидается обоих видов. Cleanup допускает отсутствующий файл и удаляет symlink
без chmod/follow target (исправлено также для upload lease).

Native MCP/Chromium synthetic input → Blob download event → Download.saveAs →
host name/size/SHA verification: PASS. Report
.dock/post-mvp-p0/artifact-roundtrip-20260905-1.json, SHA
3abc6ce0aa6944e2256793ce996e59d4a276049874be4c7079266f706ce343a9.
artifacts.mjs SHA 77125b7c98d83bb29d35db3c6ad17d06986cad81c6de60b7ecc3fad5b7765574;
check SHA bbbb1fb4abbe7ff2b3c463f9bf51a9811455c9856ceefa929e2e7f9e803f296d.
Синтетический Продажи.csv, 14 bytes, SHA a752aa59… (полный SHA в report).
Node 24.19.0 / MCP 0.0.80 / Chromium 1243; Loginom/model не запускались.
199 client /10 packaging PASS. Новые проверки: missing/zero-byte download,
wrong filename/size/same-size wrong digest, symlink, immutable descriptor,
mixed pending shutdown/limit. Python suite не повторялась: Python не менялся.

Это только транспорт и локальная сверка. Ещё нет model upload dispatcher,
Loginom origin/destination binding для download, overwrite/conflict semantics
и uncertain-upload reconciliation. maxBytes ограничивает verification read,
не browser download network/disk; adapter должен ограничить этот этап отдельно.
E2E UploadFiles подтверждает имя, Help — текущую папку. Повторно проверенные
filestorage tests содержат конфликты create/rename/paste, но не устанавливают
upload overwrite semantics. Далее эти интеграционные шаги и полный P3–P9.
Active browser/Hermes нет; production/public rc2 не менялись.

## 2026-09-05 — P3: передача admitted bytes через локальный browser input

artifactStore.stageUpload(artifact_id) создаёт private transfer-UUID/<name> из
повторно проверенной admitted копии. Имя сохраняется для native setInputFiles;
содержимое не встраивается в browser code. Path/descriptor lease immutable,
файл read-only, каталог закрыт для записи до cleanup. verify повторяет SHA/size
и проверяет directory identity. Timeout сам по себе не освобождает lease.
До 8 concurrent/pending transfers; releaseUploads закрывает admission новых
transfers, дожидается staging и возвращает результаты cleanup. Bridge вызывает
его после fulfilled browser close, не при неизвестном результате транспорта.
Original admitted snapshot сохраняется для дальнейшего чтения/доказательств.

Operator check tools/loginom-acceptance/artifact-transport-check.mjs запускает
закреплённый MCP/Chromium только на локальном синтетическом input[type=file].
Loginom, Dock server, модель и пользовательские файлы не используются. Проверяет
selected file name/size/bytes SHA и отсутствие payload в code, затем закрывает
browser и удаляет private scratch. Output резервируется wx до browser connect;
повторный запуск с прежним output отвергнут до браузера, report bytes сохранены.

Последний native-local report .dock/post-mvp-p0/artifact-transport-20260905-3.json:
PASS, report SHA 893556daa6dd3b934fb76071b316ffb106d2eaf46b9b751fdfc2c9141a4d2d2c;
artifacts.mjs SHA 7d5ea15e288a0030e65f92b4836221e8b3c03f86cdb74d7380210ed70235aed0;
check SHA 88502b713fe5d8995289067f55744394006a69104efd6ec4ce0e4dfddc1c3004.
Синтетический Продажи.csv, 14 bytes, SHA
a752aa59079d524457104bfde6ab4abbfd77542ccf9cc84009df1ac8356ef3d2.
Node 24.19.0 / MCP 0.0.80 / Chromium 1243 (153.0.8010.12).
Предшествующие local reports -1/-2 сохранены, source changes не переоценены.

196 client / 86 Python / 10 packaging PASS; после заморозки lease дополнительно
5 artifact tests PASS и native-local -3 PASS. Active browser/Hermes нет.
Нет model upload tool, Loginom upload, no-overwrite/conflict/reconciliation или
server byte proof. Следующее: связать stage lease с typed upload dispatcher,
наблюдаемым destination /test и ownership/conflict policy; перед отправкой
проверить lease, после — server bytes, неопределённость не повторять вслепую.
Затем полный data-pipeline/P3 и P4–P9. Последний Loginom live PASS остаётся
20260905-211038-3cd006d8 (navigation only), production/public rc2 не изменены.

## 2026-09-05 — P3: storage navigation принята на отдельном аккаунте

**20260905-211038-3cd006d8: 24/24 frozen PASS.** Audit SHA
fdf4685e1a028dee4787a13bf74dbaa1caf61430e9bdb2cbaa747078f1b9b84a,
runtime f6146b4729e1defa7b864112cecf36f911dabf81c7b22de7669d649b1e3473a2,
harness 901aa23f. Current Mac, existing ChatGPT subscription,
openai-codex / gpt-5.6-luna / medium. Новый изолированный профиль, явно выбранный
Loginom account test, destination /test. Read-only file-storage-inspect:
prepare → Files → lookup test → root details → double_click → navigation root.
Browser-derived directory /test, display_path /Файлы/test, navigation_root Файлы,
listing_complete=false. Account/path не предполагаются равными user.

Реализовано:
- roots storage_name: fixed native suffix lookup по E2E Format, CSS hex escaping,
  без TreeWalker всей таблицы. Только candidates: virtualized absence и коллизии
  форматированных tids не являются proof; подробное чтение обязательно.
- Filter доставляется в metadata и сохраняется cursor; mismatch инвалидирует page.
- Вложенные button parts считаются одним сегментом; пустые служебные подписи
  пропускаются как в GetCurrentPath. Первый виртуальный корень Файлы отделяется
  от directory (utils/files.GetRelativePath); вложенные одноимённые папки не
  удаляются. Нераспознанный root/неполные segments дают явный reason.
- Каждый observe получает UUID и сохраняет raw outcome в observation_completed
  до context/page projection. Аудитор проверяет точный idle context и связывает
  delivered read с raw journal. До этого у observe был null ID и raw receipt
  отсутствовал: прежнее требование аудита не могло пройти.
- Replay login требует --replay-login-user; нет hardcoded user. Harness schema2
  требует --loginom-user и --storage-directory для каждого --run. Имя/путь
  задаются независимо, не выводятся из OS/SSH. Audit schema1 поддерживает только
  исторический фиксированный fixture; новые runs всегда schema2. User decision
  о доступном test account закреплён в AGENTS/каноническом плане.

Промежуточные неизменяемые FAIL (не переоценены):
204747-e2b95167 20/23, SHA f0bd2bb2d000663c29d7a8b86a24696e9385147f9cac5d7af5949f9d7e1c131b;
205302-88ea894a 20/23, SHA cad6d6cbecf948fc9f2719156989b9bce004e716c64bb53878ad13d674b20d3b;
205738-14fff9eb 21/23, SHA 90a3034c6f22c21b30a600138d9d099a5ff73482b8f4465a58cd40ca295df64e.
Они последовательно выявили непрочитанный адрес, пустые подписи, виртуальный
корень /Файлы и отсутствие raw observe receipts. Все run IDs имеют префикс
20260905-. Последний PASS не меняет их результат.

Локально: 193 full client PASS + 35 recovery PASS после нового journal test;
10 packaging PASS включает полный suite из 194 client tests; 86 Python PASS.
Active Hermes нет. Production/public rc2 не изменены.
Далее typed upload artifact_id → выбранный /test destination, no-overwrite,
reconciliation и remote byte/SHA proof; затем CSV→Import→Calculator→Group,
execution/results/save/reopen и остальные P3–P9. Навигация не является приёмкой
загрузки, полной таблицы, иных аккаунтов/локалей или выхода из MVP.

## 2026-09-05 — P3 live storage: подтверждён большой DOM после перехода

Добавлен predeclared goal file-storage-inspect (read/navigation only /user/data),
аудитор проверяет delivered target, whitelist navigation, bound raw receipt,
конечный directory и отсутствие дальнейших actions. 83 Python PASS.
Три реальных прогона Hermes, current Mac ChatGPT/openai-codex/Luna/medium:

- 20260905-202721-86b8d02b: 20/23 frozen FAIL, audit SHA
  2402c4160080a1d6f1d4a5aad806b30351fbd753a66bc28db8f6577abf5c16c6,
  runtime 6acdd5c580e35b2a951163925d8bd6f65396d7f8f157ada9021337237466f93c.
  Файловое хранилище открыто, user/common видны как cells без actionable refs.
- После исправления interesting для E2E FileStorageForm;colName_*:
  20260905-203227-42445ff6: 19/23 FAIL, audit SHA
  9dbcffc5851bc97adaae7d14fbf915df7c0c6bbda121c7b1464d4fa12f3e2252,
  runtime a12fe6e0ba3fb41c6f7ea56022fdf9a955a347c63891dc4cdc9cc0e2c3feefe8.
  После перехода чтение даёт UI_BROWSER_CALL_FAILED. Custom Error.code
  теряется на границе page.evaluate; не было подтверждения конкретной причины.
- Добавлен data envelope для UI_SCAN_LIMIT/UI_ROOT_STALE/UI_EPOCH_UNAVAILABLE,
  unknown → UI_OBSERVATION_FAILED без исключений/значений страницы в сообщении.
  20260905-203745-2c218e8b: 19/23 FAIL, audit SHA
  2c415eb0a6e663bda0a97d6a6e6ecd26d0ca7e59870bad056f3af22e7404eb5c,
  runtime b488a620c7d0c1b9b9d3a94a754c421fadbc402add8ab900d5ba3e59bd973fbe.
  Подтверждён UI_SCAN_LIMIT после double_click user; также штатный
  UI_EPOCH_CHANGED до одного жеста. /user/data не доказан. Нет live upload.

После третьего run (не переоценивая прежние FAIL) добавлена NavigationBar в
roots discovery и storage table marker в fixed global queries. Узкое чтение
navigation root теперь может установить directory без обхода строк таблицы.
Local serialized test с 6500 фоновыми элементами: directory /user/data,
listing_complete=false, ни одного обхода table. Эта последняя правка ещё НЕ live.
Итог локальных проверок: 187 client / 83 Python / 10 packaging PASS.

Следующее: доставить конкретную строку data в большом списке через bounded
filter/observation (не повышать бюджет полного обхода); разрешить goal читать
адрес через navigation root, поскольку текущий goal требует full read без root.
Аудитор сейчас отвергает даже штатный NOT_APPLIED UI_EPOCH_CHANGED; новый
контракт должен учитывать только доказанные no-effect отказы с bound journal,
сохранить прежние FAIL. Затем новый frozen live run и typed upload с настоящими
no-overwrite/reconciliation/server bytes proof. Native runtime не менять во время
Hermes; сейчас все три процесса терминальны, active Hermes нет. P0–P9 открыт.

## 2026-09-05 — P3: разрешённые файлы подключены к запуску клиента

CLI executor-preview/replay принимает повторяемый `--input-artifact` JSON
(sourcePath/name/bytes/sha256) от trusted launcher, валидирует batch до чтения
файлов и вызывает session artifactStore до подключения bridge. Только absolute
sourcePath; ≤8 файлов, ≤16 MiB/file, ≤64 MiB/batch, без лишних полей и дубликатов
NFC/case-folded names. Отказ admission прерывает startup: частичный staging
не показывается модели. Classic/research input arguments отвергают.
`dock_prepare` передаёт модели только input_artifacts descriptors; MCP test
проходит через реальный store и подтверждает доставку без sourcePath.
Файл пока остаётся локальным, Loginom upload tool/receipt отсутствуют.

184 client / 81 Python PASS. Первый client/packaging run выявил mock session
без artifactStore; bridge test заменён на реальный store + admission + protocol
assertions. Повторный полный packaging run: 10/10 PASS.
Production/runtime публикация и Hermes live run не выполнялись.
Следующий шаг: установить точную upload conflict семантику (тесты copy/paste
её не доказывают), typed upload/destination/no-overwrite/reconciliation/server
bytes proof и подключение fixture pins/admission к полному data-pipeline goal.

## 2026-09-05 — P3: наблюдение каталога файлового хранилища

Добавлен `file_storage` в подробное workspace observation и его страницы:
активная вкладка + FileStorageForm table + единственная navigation bar,
видимые breadcrumb labels → точный directory. Неоднозначность, скрытые,
чувствительные, слишком длинные или неполные segments дают `unobserved`.
Путь не нормализуется с потерей пробелов/разделителей. Изменение directory
инвалидирует cursor; compact receipt auditor сохраняет metadata.
`listing_complete:false` всегда: видимый DOM не доказывает отсутствие файла
в виртуализированном списке. Это ещё НЕ upload precondition/команда/receipt,
не серверный SHA и не live acceptance. Roots discovery не читает каталог.

Источники: E2E navigation.ts GetCurrentTabPath/GetCurrentPath, selectors.ts
navBar.AddressBar, filestorage.ts OpenFileStorageTab/UploadFiles;
Help data/location_user_files.md. Текущий E2E HEAD 986c87134ac221b7af4cd4ebc75e1d0c9e050111:
три указанных файла не отличаются от pinned 2cad5602158fd2e4836d821d644a2b8d92f571a2.
Help HEAD 353e506ba04b77a2926d8ddf8472b36c684b67fd.

Проверки: 183 client / 81 Python / 10 packaging PASS; после уточнения
однозначности segments дополнительно 49 workspace-ui/observation-pages PASS.
Active Hermes нет. Следующее: typed upload по admitted artifact_id с fresh
проверкой destination, no-overwrite, reconciliation и серверным byte proof;
затем вся CSV → Import → Calculator → Group → save/reopen цепочка P3.
Production/public rc2 не изменены. P0–P9 не завершён.

# Выполнение плана Loginom Dock

## P3: host-only artifact admission — 5 сентября 2026

Добавлен artifacts.mjs и artifactStore в createSession; runtime inputs 46.
Trusted host caller допускает файл только с expected SHA/bytes/name. Bounded
read проверяет regular file, inode/device, размер и SHA; symlink отвергается.
Снимок записывается exclusive/0600 под UUID в artifacts/input; исходный путь
не попадает в публичный descriptor. resolve допускает только текущий registry,
повторно проверяет staged bytes и отдаёт Buffer для будущего upload adapter.
Default max 16 MiB; path-like/Windows special filenames отклоняются.

181 client / 81 Python / 10 packaging PASS; после уточнения имён ещё раз прошли
2 artifact tests. Проверены source mutation после admission, staged tampering,
неверный SHA/size, symlink, чужая сессия и отсутствие sourcePath в descriptor.
В браузер ничего не передавалось; live upload не принят. Artifact registry
после restart пока не восстанавливается. Active Hermes нет.
Далее trusted admission в acceptance harness, typed upload по artifact_id с
проверкой destination/no-overwrite/server identity, затем вся P3 цепочка/P4–P9.

## P3: зафиксирован первый набор данных и oracle — 5 сентября 2026

В `tools/loginom-acceptance/fixtures/data-pipeline` добавлены sales.csv,
expected.json, task.txt и README. Шесть строк, UTF-8/`;`, целые/вещественные/
строки, quoted delimiter, пустая строка и отдельный null marker `\N`, ноль и
отрицательное количество. CSV 230 bytes, SHA
`f628434c20873f7dd9a8ee142c17af7c0b99f447114fcf60e983f6ed6b357eb3`.
Зафиксированы все строки import/calculator/group и типы. Amount=Quantity*UnitPrice;
по Region итог QuantitySum/AmountSum/RowCount: Запад 1/0/2, Север 5/52/2,
Юг 4/10/2. Итоги пересчитаны независимо Decimal по CSV, SHA/размер/null/quotes
проверены. Это fixture-only, не Loginom acceptance.

Runnable goal пока не включён: нужны artifact admission/upload receipt,
настройки и formula/mappings readback, execution/result и save/reopen proof.
E2E filestorage.UploadFiles найден: загрузка через скрытый input toolbar и
проверка имени. Для P3 одной проверки имени недостаточно; generic UI file input
по-прежнему закрыт. Далее отдельный контракт передачи разрешённого artifact и
реализация upload, затем вся цепочка и negative/empty варианты. Active Hermes нет.

## Roots → details → checkbox: frozen live PASS — 5 сентября 2026

Run `20260905-195407-939bc201` — **25/25 frozen PASS**, audit SHA
`8994097cc52abcfbb10849e7fc9b7512ff4e3f7f96b441765b851729d873e6a6`.
Runtime `d2f705228f65429c2df7995e2fb5418a82e6f2147a4f9415092f1eb611978209`,
harness `1ce1608c`, Hermes ChatGPT/openai-codex/gpt-5.6-luna/medium.
Каждый set_checked использовал новое scope=roots, затем root_ref/observation_id
подробного чтения MF;TF-1;WizrdMCF. Независимый аудитор связал discovered region
identity, read-only refs, global_scan=false и controls из подробного снимка;
исходные action receipts и checkbox cycle сохранены. 179 client / 81 Python /
10 packaging актуальны. Active Hermes нет.

Это live acceptance реального обычного мастера, не большой live DOM/виртуальная
таблица. 6500-element background и глобальные blockers/duplicate tid проверены
serialized локальными тестами. Native-query cost остаётся непрерываемым внутри
вызова. Остальные P2 options/radio/large-field/horizontal/table identity и P3–P9
открыты. Следующее — оставшиеся widgets и первая CSV→Import→Calculator→Group
цепочка с upload, execution/result proof, save/reopen. Не повторять checkbox
без нового изменения; не считать root PASS завершением всего выхода из MVP.

## P2: первоначальный поиск областей — 5 сентября 2026

workspace.observe scope=roots обнаруживает region refs на уже большом DOM через
fixed native selectors окон/форм/tables/grids/WizrdMCF/graph containers.
Потомки и содержимое не читаются; roots имеют allowed_actions=[] и служат
только входом root_ref + observation_id для последующего detailed read.
Метаданные observation_kind=roots сохраняются в страницах и cursor resume;
bootstrap и root selection одновременно с roots не допускаются. Discovery
не доказывает отсутствие masks/dialogs/graph: соответствующие truncated=true.

179 client / 80 Python tests. Serialized test начинает с 6500 фоновых элементов
без предварительного полного observe: roots read делает 0 TreeWalker calls,
возвращает форму; detailed root read получает поле. Root gesture отклоняется.
Сохраняется ограничение непрерываемой стоимости native querySelectorAll.
Live discovery/root ещё не принято, active Hermes нет. Далее отдельный live goal
roots → root details → штатная операция с независимой проверкой evidence,
затем остальные P2/P3–P9. Не объявлять всё P2 завершённым по этим unit tests.

## P2: ограничен обход выбранного subtree — 5 сентября 2026

Root read теперь обходит TreeWalker только внутри ранее наблюдённого элемента.
Global auth/active-tab/dialogs/masks/messages находятся fixed native queries;
общий лимит элементов и проверка deadline сохраняются. Native querySelectorAll
синхронен и не прерывается внутри вызова — это явная граница бюджета.
WeakRef registry ограничен 4096 entries, expired root отвергается. Внешние
подробные тексты не читаются, граф помечен неполным. UI action проверяет
глобальную уникальность target locator, поэтому duplicate tid вне root не
обходит guard. Счётчик dom_epoch остаётся document-wide.

177 client / 80 Python / 10 packaging PASS. Serialized test: 6500 фоновых
элементов вызывают UI_SCAN_LIMIT при полном read; root из двух элементов
проходит с одним TreeWalker descendant visit, сохраняя auth/active workspace.
Маска в большом внешнем subtree блокирует fill; внешний duplicate tid также
отвергается до жеста. Live root ещё не принят, active Hermes нет.

**Следующее:** initial root discovery при уже большом DOM (пока нужен ранее
доставленный ref), затем live root acceptance и остальные P2/P3–P9. Не считать
текущий scoped traversal решением первоначального выбора области/всего P2.

## P2: root binding и browser detail filtering — 5 сентября 2026

Добавлены root_ref + observation_id к workspace.observe и bridge. Root допускается
только из доставленных refs; нельзя смешивать его с bootstrap/cursor или менять
область при продолжении страниц. Browser фильтрует controls/cells выбранным
элементом/subtree, сохраняя глобальные auth/build/active-tab, masks/dialogs и граф.
UI action повторно читает тот же root, stale/hidden/inactive root отклоняется.
observation_root входит в digest/projection и явно сообщает global_scan=true;
truncation не выдаёт область за полный UI. 176 client / 80 Python / 10 packaging
PASS: внешняя маска, detached root, cursor binding, admission неизвестных refs.

**Глобальный TreeWalker ещё не ограничен выбранным root**, UI_SCAN_LIMIT остаётся.
Это фильтрация деталей в браузере и привязка протокола, не готовность больших DOM.
Далее отделить bounded discovery global guards/roots от detail scan, проверить
initial discovery при большом DOM, глобальные перекрытия и duplicate tids.
Live root ещё не выполнялся; active Hermes нет. Далее весь оставшийся P2/P3–P9.

## P2: явное усечение значений полей — 5 сентября 2026

Editable field observation теперь содержит value_truncated и value_length_utf16;
value остаётся ограничен 2048 UTF-16 units. Полный хвост не сохраняется в snapshot.
Поля с усечённым значением не получают generic allowed_actions: префикс не
доказывает неизменность невидимой части. При переходе от короткого значения
к длинному старый ref также не допускает fill. 173 client / 80 Python tests:
граница 2048, отсутствие хвоста в output, отказ до клика и сохранность значения.
Это исправление достоверности чтения, не реализация редактирования больших полей.
Dedicated large-field driver и browser root/filter по-прежнему нужны.
Active Hermes нет; нового live после добавления полей ещё не было.

## DOM epoch: live совместимость принята — 5 сентября 2026

Run `20260905-172843-f90ebea6` — **25/25 frozen PASS**, audit SHA
`253f7bc2abb9d04b3a69381c2ec76e70f79cc4112a01f571c4787397797fd2d1`.
Runtime `f4db7d2a41bc5c47a9d4f1ada6bd00ba02f827bfcd883b4ea963598a7c2b1843`,
harness `194f8a8d`, Hermes ChatGPT/openai-codex/gpt-5.6-luna/medium.
Context menu → SetupNode → Text Import → checkbox cycle приняты с dom_epoch.
В реальных наблюдениях revision растёт при изменении UI и остаётся одинаковым
при стабильных чтениях. UI_EPOCH_CHANGED в run не было; два REQUEST_REJECTED
не имели browser effect. 172 client / 80 Python / 10 packaging актуальны.

Это live compatibility текущего сценария, не fault-injected ABA acceptance,
не все анимации/виртуализированные виджеты. Active Hermes нет. Следующий этап —
root/filter на уровне browser scan с глобальными guards; затем остальные P2
и P3–P9. Не повторять этот menu goal без новых изменений/конкретной проверки.

## P2: DOM mutation epoch — 5 сентября 2026

Observer теперь ведёт document identity + монотонный счётчик DOM mutations,
включая pending records до callback. `dom_epoch` передаётся в страницах и
входит в их digest; изменённый epoch отвергает старый cursor и UI action до
жеста, в том числе после проверки target. Никакие mutation targets/text не
сохраняются. Независимый receipt projector сохраняет поле без преобразования.
172 client tests: A→B→A с очередью/доставленным callback, stale cursor при
одинаковых values; recovery fixture обновлён для отдельного epoch read.
80 Python tests актуальны. Live epoch ещё не проверен, предыдущий menu PASS
относится к старому runtime. Active Hermes нет.

Ограничения: document-wide изменения/анимации могут требовать нового чтения;
JS property-only/canvas/server изменения не покрыты MutationObserver. Это
не полный semantic ABA guard и не root-scoped scan. Далее live совместимость
epoch и root/filter с глобальными auth/active-tab/mask guards, затем P3–P9.

## Context menu + checkbox: frozen PASS — 5 сентября 2026

Run `20260905-171627-dab12302` — **25/25 frozen PASS**, audit SHA
`c5c97984f25e9a627bfb2af153cb4d5a84e2b99f76cd68b3c4d14a3e990b3d8a`.
Runtime `65c1e28ab47fb0bf2d443beff1cbbfecd779f2b56b41f166bd1a8abdea7c34ea`,
harness `1644468e`, Hermes ChatGPT/openai-codex/gpt-5.6-luna/medium.
Подтверждены right_click по узлу, observed `mn;mniSetupNode`, bound click,
последующее появление Text Import и checkbox false→true→true(no-op)→false.
Исходные browser receipts сопоставлены с доставленными ответами; новый отчёт
не пересчитывает предыдущие FAIL. 170 client / 80 Python / 10 packaging актуальны.

Мастер оставлен открытым без apply/save; выполнение данных, radio, другие
меню/платформы этим не приняты. Active Hermes нет. Далее P2 root/filter/epoch
и остальные widgets, P3 первая цепочка с данными, затем P4–P9. Чтение исходников
подтвердило: scope сейчас фильтрует уже собранный полный DOM snapshot. Для
root-scoped scan нужны отдельные глобальные guards (auth/build/active tab/masks),
проверяемая identity выбранного root и курсоры, сохраняющие тот же root.
Нельзя просто заменить корень TreeWalker: это потеряет активную вкладку и
перекрытия, а узкая выборка не доказывает полноту графа/уникальность tid во всём DOM.

## Меню и checkbox выполнены; уточнена асинхронная приёмка — 5 сентября

`20260905-170517-60098bf7` — **24/25 frozen FAIL**, SHA
`8c7b7c4690aaf957366594f64c6977a017a68f54a1022b031aa79cfa56ef8445`:
мастер открыт и checkbox cycle подтверждён; аудитор требовал один right_click,
хотя label/node открывают разные меню, и считал pre-browser отказ действием.
После этого добавлены bound повторные right_click и strict исключение отказов
через shared rejected_before_browser; ambiguity/журнальные эффекты не исключаются.

Новый `20260905-171049-7c6c84e4` — **24/25 frozen FAIL**, SHA
`095aa91d8369b16cb81abf0045d13e3a112c2fe40c2064bfd7702dbbce22eb4a`.
Runtime обоих `65c1e28ab47fb0bf2d443beff1cbbfecd779f2b56b41f166bd1a8abdea7c34ea`.
Hermes Luna/medium/ChatGPT снова открыл SetupNode и выполнил checkbox cycle.
Причина оставшегося отказа: click receipt до отрисовки мастера ещё не содержал
checkbox, который появился в последующем workspace.observe. Теперь аудитор
допускает отдельный успешный read, вызванный после click reply в той же сессии
до первого set_checked, без промежуточных mutations. Добавлены negative/positive
тесты порядка, повторов и отказов; 80 Python PASS. Runtime не менялся,
170 client / 10 packaging актуальны. Оба FAIL сохранены, не пересчитывались.
Active Hermes нет. Далее новый context-menu-checkbox для frozen PASS, затем
root/filter/epoch и P3 с данными; остальные P0–P9 остаются полным объёмом цели.

## Context menu: live FAIL и распознавание menu wrappers — 5 сентября

Run `20260905-165713-56812027` — **21/25 frozen FAIL**, SHA
`440bc013e6bd3f27fcd32b003cc2756c50dff93f200f262d3a8585ac5e1996fd`.
Правые клики реально выполнены, агент сначала получил меню метки, затем меню
узла. До мастера/checkbox не дошёл. В доставленных элементах меню присутствовали
анонимные ARIA menuitem, но не E2E wrappers `mn;mniSetupNode`; пункты были
далеко в страницах после graph/palette. Run завершён, active Hermes нет.

Добавлено точное распознавание `mn;mni*` без произвольного CSS от агента.
Видимые wrappers меню и затем ARIA menuitem теперь первыми в bounded controls;
остальные элементы сохраняются в последующих страницах в пределах прежнего cap.
Тест проверяет wrapper+анонимного child, порядок, click и stale после удаления.
170 client tests, 80 Python. Live новой выдачи ещё нет. Следующее: повтор
context-menu-checkbox, затем оставшиеся P2/P3–P9. Старый FAIL не пересчитывать.

## Checkbox принят; добавлен right_click — 5 сентября 2026

Run `20260905-164903-1372db2d` — **24/24 frozen PASS**, audit SHA
`bee237c5f86c221847aee0ca913538681ebafc55441104e323e4ceaecb2f0708`.
Runtime `9f70441a5702744b158b30c4fc1684f6234a68c733f653c4adf2e4cbd4a6b8d7`,
harness `3df3f1cc`, Hermes openai-codex/gpt-5.6-luna/medium. Кнопка Setting
позволила открыть Text Import. Флажок «Параллельная обработка» прошёл цикл
false→true, true→true без gesture/effect, true→false; все квитанции связаны
с immutable journal. Мастер оставлен открытым, настройки не применялись;
radio, сохранение/переоткрытие и импорт данных этим не приняты. Active Hermes нет.

После run добавлен generic right_click по observed ref с теми же guards,
одним page.mouse.click(button=right) и новым наблюдением. Cleanup после
потери ответа освобождает именно правую кнопку; explicit recover освобождает
левую и правую перед Escape. Тесты проверяют реальный serialized body, правую
кнопку/no retry и запрет через modal mask. 169 client / 79 Python tests.
Live right_click ещё не выполнялся. Далее реальное контекстное меню и остальные
P2 drivers/root/filter/epoch, затем P3 с данными и P4–P9. Старые FAIL сохранены.

## Checkbox live: мастер не открыт, исправлена выдача Setting — 5 сентября

Run `20260905-164028-032ecbdd` — **21/24 frozen FAIL**, audit SHA
`ef642fd8e9b53d39ff49522ed2e32bfdf8b1837719063dd5298dceb6c007cab0`.
Hermes Luna/medium/ChatGPT создал узел, читал E2E/Help, но не выполнил ни одного
set_checked. Были REQUEST_REJECTED, UI_REFERENCE_OBSCURED, клики по метке и
другим graph refs; мастер и checkbox cycle не приняты. Run завершён.

E2E `bg/helpers/wizard.ts:29` открывает мастер через node.Setting;
`bg/selectors.ts:1068` задаёт `Graph;<node>;Setting`. Observer не включал
такой SVG control без стандартной роли. Добавлено точное распознавание этого
суффикса, без произвольных graph decorations; тест проверяет click и stale
после удаления. 168 client tests прошли, 79 Python актуальны. Новый live ещё
не выполнялся; старый FAIL не пересчитывать. Далее повтор checkbox-roundtrip
с --require-verification, затем остальные P2/P3–P9.

## Подготовка независимой приёмки checkbox — 5 сентября 2026

Добавлен `tools/loginom-acceptance/checked_state.py`: привязка ответа к одной
исходной completed browser receipt, проверка identity/tid/readback и различение
смены значения от no-op без жеста. Подменённые ответы, другой session, отсутствие
журнала, неверный readback и ложный no-op отвергаются. 78 Python tests прошли.
Helper ещё не подключён к отдельной цели: доставка и свежесть target должны
проверяться вызывающим аудитором. Live запуск не выполнялся; P2 не закрыт.
По E2E `bg/sels/import/sImportTxt.ts` выбран флажок «Параллельная обработка»
на первой странице Text Import для будущей проверки смены/повтора/возврата.

## P2: desired checked state — 5 сентября 2026

ui.act поддерживает set_checked с boolean checked и observed ref. Observer
читает native checkbox/radio, ARIA checked/mixed и Loginom Ext DisplayEl/InputEl:
точный parent tid, x-form-cb-checked и проверку доступности. Источники: pinned
E2E bg/helpers/wizard.ts:425–455, 506–531 и bg/consts/app_consts.ts:245;
состояние Loginom не определяется по input.value.

При уже достигнутом значении клика нет: effect_possible=false,
gesture_applied=false и ui_state_already_satisfied. Иначе один реальный click,
новое readUi и проверка состояния/identity. Неподтверждённый результат остаётся
AMBIGUOUS с UI_STATE_NOT_CONFIRMED; автоматического повторного toggle нет.
Radio разрешает только checked=true, выбор другой опции делается её ref.
ui_state_verified — readback одного переключателя, не готовность мастера,
сохранённых настроек, данных или всей пользовательской цели.

167 client tests прошли (idempotent no-op, failure without retry, точный Ext
owner и radio restriction), 75 Python acceptance tests. **Live мастер с этим
verb ещё не принят.** Далее нужно принять set_checked на реальном мастере,
добавить остальные widgets и продолжить root/filter/epoch/P3 с данными.
Active Hermes нет. Старые palette PASS относятся к прежнему runtime.

## P2 vertical scroll: frozen PASS — 5 сентября 2026

Run `20260905-161157-1fb1e122` — **27/27 frozen PASS**, audit SHA
`76dabe848ed15a0870e4c4fa52a923d269fe3a9c1bacc565dc1563f814d9ac72`.
Runtime `1f654a57dd78f819236839b48a3e5c488b2c766e20d2ccde848f0f1507f2a924`,
45 inputs, harness `391e0204`; Hermes ChatGPT/openai-codex/gpt-5.6-luna/medium.
164 client / 75 Python / 10 packaging checks актуальны.

Приняты bootstrap до prepare, страницы палитры и реальный scroll owner 0→800→0,
строго связанный с исходными browser receipts. Пустой наблюдаемый граф сохранён.
Собраны 77 компонентов/12 групп. reachable-first выдача и отдельная классификация
pre-browser отказов подтверждены новым неизменённым прогоном; старые FAIL сохранены.

Это закрывает вертикальную прокрутку палитры на текущем профиле, не все P2:
browser root/filter для крупного DOM, epoch/ABA, горизонтальные/виртуализированные
виджеты, typed desired-state controls и прочие drivers остаются открытыми.
Далее реализация оставшихся P2 и первая P3 цепочка с реальными данными; предыдущий
полный graph regression остаётся историческим FAIL, не закрывается палитрой.
Активных Hermes нет, production/public release не менялись.

## P2 scroll: оба направления подтверждены, аудит отказов уточнён — 5 сентября

Run `20260905-160516-337e3009`, runtime
`1f654a57dd78f819236839b48a3e5c488b2c766e20d2ccde848f0f1507f2a924`:
**26/27 frozen FAIL**, SHA
`b90e97f1b227d3cbc8b29fa5e0ba56168b2165c087027d8964ed0f17cd2b01c5`.
Оба scroll receipt прошли: один owner 0→800→0. Пустой граф и исходные квитанции
приняты. Единственный failed check — only_observed_palette_groups_interacted_with:
между двумя успешными scroll был REQUEST_REJECTED на уже недоступный ref.
Этот запрос не запускал browser action; фаза request_rejected, effect_possible=false,
state idle, trace пуст и operation ID отсутствует в журнале.

Аудитор после run стал отличать такие отказы от мутаций строго по совокупности
квитанции и отсутствию операции в журнале. Pending/AMBIGUOUS/возможный эффект
или наличие journal record не исключаются. 75 Python tests, включая tampering
отказа. Старый 26/27 **не пересчитывался**; нового frozen PASS ещё нет.
Runtime после f9e4fe83 не менялся, 164 client/10 packaging актуальны.
Active Hermes нет. Далее новый scroll run на исправленном аудиторе, затем
root/filter/epoch и остальная реализация P2/P3–P9.

## P2: порядок доступных целей после scroll — 5 сентября 2026

Run `20260905-155916-07e8ef2e` завершён: **25/27 frozen FAIL**, audit SHA
`187e0dcf7d232f7971ab7a256c56f3589ca5c2191dc9917cf7f608d15a38b636`.
Снова подтверждён scroll 0→800, но возврата нет. Новая interaction-подсказка
была доставлена; агент после scroll прочитал только первую palette page:
16 элементов, **0 point_observed**, next_cursor присутствовал. После очередного
obscured отказа агент завершил задачу, не дочитав страницы.

Исправлена выдача scope=palette: reachable элементы сначала, остальные записи
сохраняются на последующих страницах; это не удаление offscreen inventory.
Scroll включается в allowed_actions только при point_observed. Остальные
жесты и их независимые guards сохранены. Тест подтверждает 80/80 уникальных
записей после перестановки, reachable с исходной позиции 75 выдаётся первой.
164 client / 74 Python checks прошли. Нового live после этой правки ещё нет.
Активных Hermes нет. Далее повтор scroll на обновлённой выдаче, затем browser
root/filter, epoch/ABA и остальные P2/P3–P9. Старый FAIL не пересчитывать.

## P2 scroll: частичный live результат и доступность targets — 5 сентября

Run `20260905-155228-ebda6a6b` завершён: **25/27 frozen FAIL**, SHA
`6fe9e2e675aff81315a810407ea40c673276bf03268d7bb5b7c07e1e2091a74f`.
Hermes Luna/medium/ChatGPT реально прокрутил palette owner с 0 до 800
(ui_scroll_applied, row 38), но не вернулся вверх. Четыре прочих жеста были
NOT_APPLIED с UI_REFERENCE_OBSCURED: DOM/rendered presence не давала агенту
достаточно информации о доступной точке. Пустой граф/bootstrap/pins приняты;
полный scroll goal не принят. Старый отчёт не пересчитывать.

После прогона добавлено поле interaction в наблюдаемые элементы:
outside_viewport, point_observed, point_not_observed или unverified.
Девять пробных точек проверяются через elementFromPoint в пределах viewport
и scan budget. Это выборочная подсказка, не полное доказательство недоступности
и не замена независимого checkedHandle (включая специальную SVG geometry).
visible по-прежнему означает отрисованный DOM. Tool description направляет
агента к point_observed и к другим страницам после scroll.
163 client / 74 Python checks прошли. Live нового interaction ещё нет.
Активных Hermes нет. Далее повтор scroll, browser root/filter, epoch/ABA и
оставшиеся P2/P3–P9. Отказ по крупному DOM не считать готовым root-scoped чтением.

## P2: вертикальная прокрутка наблюдаемой области — 5 сентября 2026

ui.act получил verb=scroll, ref и целочисленный delta_y от -1000 до 1000
без нуля. Только элемент с наблюдаемым scroll owner получает allowed_action;
ref/top/max_top owner входят в полную внутреннюю signature. Используются
обычные проверки контекста, масок, incarnation и видимой точки. Pinned browser
код меняет scrollTop только ближайшего проверенного owner, обрезает значение
по его границам и не передаёт прокрутку внешнему контейнеру. Это DOM scroll,
не эмуляция wheel. После короткого ожидания рендера возвращается новый снимок;
host очищает предыдущие observation IDs/cursors как при любом ui.act.

162 client tests прошли. Serialized проверки подтверждают clamping, неподвижность
внешнего контейнера, отказ на границе, stale signature после scroll и новый ref
после замены виртуализированной строки с тем же tid. Отдельный trace отражает
фактические from/to; успех жеста не доказывает полноту списка/результата.
**Live scroll ещё не проверен.** Горизонтальная прокрутка, epoch/ABA при повторном
использовании DOM, root/filter и крупные UI остаются открытыми. Активных Hermes
нет; следующая приёмка должна разрешать и независимо проверять scroll, после
чего продолжить остальные P2/P3–P9. Публичный клиент/сервер не менялись.

## P2 bootstrap + scan: реальная приёмка — 5 сентября 2026

Run `20260905-154306-0e121bd2` завершён: **26/26 frozen PASS**, audit SHA
`0a39690507aee5ea3e69cac8dbd20b1c5e8a495e5d17296c7ae87809f6393fbd`.
Runtime `e579941f71707a3dfb9f46f0cf71898e73dc4eab6031b7b01dddaea604fe3f5a`,
45 inputs; Hermes/openai-codex/gpt-5.6-luna/medium. Harness `3e14a385`.
160 client / 73 Python / 10 packaging checks перед этим runtime/harness.

До prepare выполнен bootstrap: фактическое состояние **not_open**, без ui refs.
Следующая diagnostics подтвердила archiveActive=false и отсутствие workspaceReady;
лишь затем prepare создал один чистый draft. Подробное наблюдение прочитало
1920 DOM elements в пределах scan budget и доставило все страницы палитры.
Собраны 77 компонентов/12 групп, пустой наблюдаемый граф проверен до/после.
Это реальная проверка not_open/lifecycle и нормального bounded scan. Ветки
bootstrap login_required/blocked/incompatible пока покрыты локальными тестами,
не живой матрицей. Полнота скрытых/виртуализированных компонентов не заявлена.

Активных Hermes нет. Далее browser root/filter для больших UI, явная доступность
targets/scroll и остальные P2/P3–P9. Прежний full graph regression 35/39 FAIL
не изменён и не закрыт этой palette-приёмкой.

## P2: ограничение подробного browser scan — 5 сентября 2026

readUi обходит DOM через TreeWalker с пределом 6000 элементов, 250000
учитываемых шагов и проверкой времени 500 мс. Повторные document-wide queries
заменены выборками из ограниченного списка; учтены обходы предков/текста и
сопоставление ячеек. Это cooperative budget, не прерывание отдельного синхронного
DOM API. Сведения scan доставляются в compact page и учитываются receipt audit.
scan.complete означает завершённый обход, не полноту возвращённых UI/данных.

UI_SCAN_LIMIT не возвращает пустой граф или refs: output содержит
observation_required и scan.complete=false. Повторный бесполезный scan в catch
пропускается. Если лимит встретился до жеста, действие NOT_APPLIED; прежний
успешный snapshot не позволяет обойти этот отказ. После возможного жеста
сохраняется неопределённость эффекта.

160 client / 72 Python / 10 packaging checks прошли. Тест бесконечного внешнего
DOM iterator остановился после 6001 обращения, не выполнил input и не выдал
nodes/ui. **Live нового scan/bootstrap ещё нет.** Пределы требуют реального
прогона, browser root/filter и виртуализация остаются открытыми: большой UI
пока явно отклоняется, а не читается по областям. Далее live bootstrap/palette,
root-scoped readUi и дальнейшие P2/P3. Активных Hermes нет.

## P2: read-only bootstrap — 5 сентября 2026

В workspace.observe добавлен scope=bootstrap до dock_prepare. Runtime читает
только origin/build, признаки login/avatar и количество видимых dialogs/masks.
Нет перехода на URL, входа, создания черновика, чтения значений/текста полей
или включения archive capture. Другой origin не сканируется. Walk ограничен
4000 элементами/75 мс; incomplete scan возвращает indeterminate вместо ready.
Само чтение не выдаёт action refs и не меняет workspaceReady.

159 client tests прошли, включая serialized browser code, budget exhaustion,
запрет чтения value/textContent и настоящий MCP bridge: bootstrap разрешён,
graph до prepare отклонён, session archive/readiness не изменены.
Это локальная реализация, **live acceptance bootstrap пока отсутствует**.
Обычный подробный readUi всё ещё требует ограничения scan и дальнейших P2
drivers; bounded bootstrap не закрывает это требование. Runtime inputs остаются
45, но source pin изменился. Следующее: live bootstrap + bounded readUi,
затем P3 цепочка с данными; полный graph regression остаётся незакрытым.

## P2 regression: rename восстановлен, полная цель не принята — 5 сентября

Run `20260905-152418-34f63a02`, runtime `7eaebd2e…`, Hermes Luna/medium/ChatGPT:
**35/39 frozen FAIL**, audit SHA
`a4b9768815bc980e3bad0c9f219a9d788b936a100d702dee625c2e75fefb2c06`.
Доставка automatic E2E/Help, продолжение, единственное создание источника и
rename UI repair прошли независимую проверку, включая compact receipt matching.
Вся задача не принята: malformed tool_call без name; параллельно запрошены
мутации; лишние входы после удаления автосвязи и двух link.create через Add;
сохранена связь на неправильный вход и продолжены мутации после save/reopen.
Стандартная pending-защита не дала повторному созданию источника примениться.
Не повышать результат до PASS из-за успешных rename и package.save_as.
Прогон завершён, активных Hermes нет. Это внутренние пробелы исполнения цели,
не внешний блокер. Старый отчёт не изменять.

После прогона исправлено scope metadata: исключённые dialogs/masks/messages/
table_cells и отфильтрованные controls отмечаются truncated; пустой массив
вне выбранной области больше не выглядит доказательством отсутствия объекта.
Локально 156 client tests; runtime после этой правки отличается от проверенного.
Далее — bounded browser scan/правдивая доступность targets и прочие P2 драйверы;
полный goal regression остаётся открытым. Не сводить P2–P9 к повторению graph smoke.

## P2 pages: реальная palette-приёмка — 5 сентября 2026

Runtime `7eaebd2ef60d3c8204b5f844c674d43c337717095349e2b459f2e15abf81f9ea`,
45 inputs, commit `3b2bb372`; independent auditor `52029fc4`.
Hermes/ChatGPT/openai-codex/gpt-5.6-luna/medium, run
`20260905-151931-7698def0`: **24/24 frozen PASS**. Audit SHA
`28451c53e483ce2ebfb332f78a30861f87ae34f5166c02eb5c9fde5d85693f84`.
Получены страницы без spillover, отдельный graph scope до/после подтвердил
пустой наблюдаемый граф; агент использовал только наблюдаемые группы.
Локально: 155 client / 72 Python / 10 packaging checks.

Curated inventory `executor/inventory/palette-2026-09-05.json`: 12 групп,
77 компонентов; 77 строк coverage связаны с presence-only evidence.
Выполнение_узла из E2E связано с фактическим названием «Выполнение узла» и
его точным tid. Tableau не наблюдался; это не доказательство отсутствия
компонента или лицензии. Все component pipeline statuses остаются planned.

Аудитор теперь требует graph evidence до и после мутаций, отвергает refs из
будущих страниц/после предыдущей мутации и смешение revision одного ID.
Проверка rename умеет независимо сопоставлять первую all-page с raw receipt;
её живой regression run с новым runtime ещё предстоит. Digest страницы в этой
проверке является correlation token, не доказанным DOM epoch.
Следующее: rename/E2E/Help/save-reopen regression, затем bounded browser scan,
bootstrap и остальные P2/P3 пункты. Прогон завершён, активных Hermes нет.

## P2: компактные страницы наблюдения — 5 сентября 2026

Добавлен `client/lib/observation-pages.mjs`: public output до 12000 байт,
до 32 записей на страницу; scopes all/palette/graph/dialogs, opaque cursors,
проверка digest свежего снимка перед продолжением. Полные guard snapshots
остаются внутри runtime; uiAct принимает только refs, выданные на прочитанных
страницах. Изменение снимка, eviction и clear делают cursor недействительным.
UI signature/geometry сокращены только в ответе, внутренние проверки сохранены.
Recovery содержит outcome_summary с указанием dock_operation_inspect;
gesture_applied/verification_required сохранены. Ошибка упаковки после жеста
не превращается в ложный pre-action rejection. Runtime inputs: 45.
Локально прошли 155 client tests, 68 Python acceptance tests и 10 packaging
checks, включая полный клиентский suite из изолированного staged source.

Это **часть P2**, без live acceptance: существующий browser scan пока не
ограничен по работе, root/type filters, virtualization/scroll и epoch для ABA
ещё не реализованы. Hash проверяет совпадение захваченного состояния, а не
отсутствие любых промежуточных изменений. full_dom_complete всегда false.
Перед следующим Hermes запуском необходимо адаптировать независимый аудитор:
строго связать compact projection с неизменённой исходной UI-квитанцией,
учесть несколько страниц одного observation_id и требовать отдельное полное
наблюдение пустого графа для palette goal. Не менять старые отчёты FAIL.
Hermes не запускался; публичный клиент и серверная сборка не менялись.

## P1 effects и реальная палитра — 5 сентября 2026

`4743d427`: семь effect contracts (create/save/configure/delete/execute/inspect/
transfer), pre/postcondition/reconciliation/ownership в ABI и локальном модуле.
Validator больше не ограничен create/save; каждый исполняемый action по-прежнему
требует отдельного local handler и совпадения kind/resource. Неизвестный action
с допустимым новым effect не становится исполняемым. 150 client tests и
10 packaging checks прошли; новый runtime input effect-contracts.mjs (44 inputs).

`3c735d01`: по pinned E2E selectors:272/279/286 в наблюдение добавлены palette
TreeText/TreeExpander spans. Поддерживаемый goal palette-inventory и независимый
аудитор принимают только работу с наблюдаемыми группами и пустым графом.
151 client / 68 Python checks прошли. Inventory audit изначально не объявляет
полноту скрытых/виртуализированных компонентов, даже если сбор наблюдений принят.

Реальный Hermes run `20260905-145533-e12491a5` завершился: **18/23 FAIL**,
SHA отчёта `449fb27ab63fc3e160db499ab7db2c01db11c3b6780a61a99f7af18bbb40e904`.
Два workspace.observe дали по 102492 символа; Hermes заменил каждый результат
persisted-output preview с путём spillover и предложением read_file. Такой
инструмент отсутствует в разрешённом toolset Dock, и реальный агент не получил
полного наблюдения/observation_id. Два последующих UI requests отклонены как
stale observation. Не восстанавливать PASS чтением spillover за агента.
Это **внутренний пробел наблюдения**, не внешний блокер и не причина менять
Hermes/ChatGPT/Luna/medium или открывать модели raw filesystem tools.

**Далее:** начать необходимую для P1 inventory часть P2: compact public observation,
сохранение полного guard snapshot внутри клиента, scope/filter/pagination с
проверкой revision и ограничениями работы scan. Не ограничиваться увеличением
порога Hermes или уменьшением одного cap до удобного значения. Затем повторить
palette-inventory и завершить реестр. P1 ещё не закрыт целиком.

В coverage дополнительно привязаны 77 Help документов к конкретному commit/SHA,
добавлены документированные разделы, пять режимов Слияния и режимы SONN.
Для Quality Help содержит визуализатор, не доказан эквивалентный processor:
различие сохранено явно. Это source map, а не live acceptance этих компонентов.
Активных Hermes процессов от текущей работы нет; последний run terminal/audited.


## P1: раздельный outcome verification — 5 сентября 2026

В commit `f9f80a21` добавлен отдельный `dock_outcome_verification` v1,
связанный с неизменённой квитанцией по operation/action/SHA. Поля жеста,
предметного эффекта, полноты наблюдения, настроек, данных и цели разделены.
Клиент доказывает domain effect только с локальным contract/output schema,
cleanup и postcondition trace; Save дополнительно требует reopened evidence.
Успех UI-жеста не является domain success; bounded DOM не объявляется полным
графом или dataset. Settings/data пока not_checked, goal not_verified.
Недоступность записи verification не стирает исходную operation receipt.

148 client / 66 Python acceptance / 10 packaging tests прошли. Экспорт
сохраняет verification отдельным полем; --require-verification добавляет
независимую проверку доставки, границ claims и связи с journal. Граница SHA
проверки отдельно описана в executor-contracts.md.
Runtime `e9027c5b8ad672c1601c35be917207e30d1aff8180c310e0af85985d47832ad0`,
43 inputs. **Live run принят: 30/30 frozen PASS**:
`20260905-144056-ad856011`, basic-graph без fault, --require-verification,
Hermes / ChatGPT / openai-codex / gpt-5.6-luna / medium.
Audit SHA `22b9b83815298bc57eef675ecc449acbc8d0deebced4f432e328832a80fcc11c`;
`.dock/post-mvp-p0/runs/20260905-144056-ad856011/audit.json`.
Доставка раздельных claims/journal и точный save/reopen подтверждены.
Прогон завершён, активных Hermes нет. Прошлый 34/34 не подменяет этот proof.
P1 ещё требует live/Help inventory и завершения effect/расширяемого proof
контракта перед переходом к P2. Публичная поставка не менялась.


## P1: registry/schema/recovery — реальная приёмка 5 сентября 2026

Commit `78b0a103` добавил локальный registry action/capability/handler/effect,
согласованные tool enums и admission, явную таблицу handlers в serialized body.
Перепутанные известные capabilities и неизвестный JSON action отклоняются до
browser call. Publisher сверяется с ABI, а contract suite проверяет его
согласованность с registry. Обновлён session pin: 42 runtime inputs.

Next steps дают реальные tools, обязательные поля и роли IDs. Recovery options
содержат только действительные strategies. Schema subset проверяет keyword
placement, типы и границы, enum и собственные поля объектов. Outcome envelope
проверяет identity/phase/effect/output/error и запрещает ошибку при SUCCEEDED
либо неподтверждённый goal_verified=true. NOT_APPLIED не означает отсутствие
UI-жеста (например, диалог мог быть открыт и отменён).

145 client / 10 packaging checks прошли. Run `20260905-142903-f1cc2e29`:
**34/34 frozen PASS**, rename fault, доставлены E2E/Help, исправление и точный
save/reopen. Hermes 0.21.0 / ChatGPT subscription / openai-codex /
gpt-5.6-luna / medium; runtime
`96043954375ceceb21669fe01682a340b20ba8d24b0a76851c05f93b2b3ee410`.
Audit `.dock/post-mvp-p0/runs/20260905-142903-f1cc2e29/audit.json`, SHA
`d80639df64ce113b89a0efcc718f3b927137fdeff2b9dc006fd5215ba50f2e5b`.
Индекс `.dock/post-mvp-p0/evidence-index-p1-registry.json` — 26 attempts /
11 PASS, SHA `bc037bfc9187194d7e471703a23fef4343c3e0111fa5c0d4b169c4613d71c5d0`.
P1 runtime ещё не собран/не опубликован: серверные комплекты P0 имеют предыдущий
pin `7160fdac…`. Production и пользовательская установка не менялись.

Coverage содержит 78 именованных компонентов E2E + 68 общих операций.
Дополнительно собран приватный title-only индекс 190 Help документов на commit
`353e506ba04b77a2926d8ddf8472b36c684b67fd` — не проверка всех режимов.
P1 **не завершён**: дополнить live/Help inventory, реализовать versioned
раздельный proof gesture/domain/settings/data/completeness/goal, закрепить
новые effect contracts в расширяемом ABI. Затем P2–P9 в порядке плана.
Последний run завершён и проаудирован; запущенных нами Hermes процессов нет.


## P0 завершён — чистые исходники и серверная сборка, 5 сентября 2026

MVP runtime зафиксирован в `cb2bc041`, поддерживаемая приёмка/packaging/docs —
в `28657479e7b2286b362e5574d6b3fc8358f2cc7e`. Чистый detached checkout прошёл
139 client, 64 Python acceptance и 10 packaging tests. Источники не зависят
от private evidence; зависимости закреплены lock и установлены отдельно.

161 build input совпал с commit побайтно и по режимам. Source archive SHA:
`ee9d3e4b9847fabe3e29a154f13bfd2f54b41220cf5d6ab62d345ad027deb2e7`;
inventory `1185ef105aac39904918b7f6a99cb5c4dc4cdaaac46c80e61a3d93834cac208b`.
На VPS в `/opt/loginom-dock/client-build/p0-clean-28657479/` собраны два
внутренних комплекта с `sourceDirty=false`; builder проверил Git objects из
переданного bundle и повторно staged inputs. Linux bundle SHA
`78d04faa11c8ec6fbf1426b00be0b1c78718763c328a7a82b45a0def5bfc561c`,
macOS bundle SHA `8b64cb03cc864f919e6b0278decea2b17eaa54fcfae7ec194f868399954acf9c`.
Linux-комплект прошёл 139 tests. macOS `0.1.0-rc.4-1827e732e026`
скачан, проверены все 3975 файлов; Node/dependencies из него использованы
для 139 client tests и реального прогона из чистого checkout. Это проверка
чистого source runtime с серверными dependencies, не native install/cutover.

Run `20260905-141558-dad96a91`: **29/29 frozen PASS**, Hermes 0.21.0,
подписка ChatGPT / `openai-codex` / `gpt-5.6-luna` / medium; goal basic-graph,
без инъекции сбоя. Runtime `7160fdac190c2279b8e23d2be4908c5fa3ebef02d144b9220576dbeacccdce9f`.
Audit SHA `216e3a570676437c1ac949308c197c437e1d3cdcae7672d2368a4c7431ecf8d2`;
место хранения `.dock/post-mvp-p0/runs/20260905-141558-dad96a91/audit.json`.
Цель и сохранённый/повторно открытый точный граф подтверждены независимо.
Production/current/catalog и публичный rc.2 не изменялись.

Следующий этап P1 начат в основной рабочей копии отдельно от замороженного
checkout P0: единый registry action/capability/handler/effect и проверка допуска.
Изменения P1 ещё не приняты live и не входят в указанные hashes P0.


## Фиксация исходников P0 — 5 сентября 2026

Клиентский MVP зафиксирован отдельно в `cb2bc041`: runtime, каталоги/schema,
контрактные тесты, native skills и publisher. При review исправлено оставшееся
требование Xiaomi/MiMo в допуске каталога: теперь клиент, publisher и schema
требуют Hermes / `openai-codex` / `gpt-5.6-luna` / `reasoning_effort=medium`.
Отсутствующий либо другой effort, другая модель/провайдер отклоняются.
139 client tests прошли на Node 24.19.0; 64 Python / 11 JS acceptance checks
и 10 packaging checks прошли. Новый runtime pin:
`7160fdac190c2279b8e23d2be4908c5fa3ebef02d144b9220576dbeacccdce9f`.
Прежние live PASS относятся к прежним pins. Чистая серверная сборка и новая
базовая приёмка окончательного состава ещё предстоят. Публичный выпуск не изменён.


Обновлено: 5 сентября 2026 года. База первоначального этапа: `bbc1f9bab00e8255e8d73b138607126c595dde06`.
Канонический [план](../plans/2026-09-02-loginom-dock-implementation-plan.md)
содержит историю MVP E2E-исполнителя и подробную дорожную карту полной версии
(§§13–21). Этот журнал сохраняет историю
первого выпуска и отделяет изменения в исходниках от live-приёмки.
Текущий результат: клиент `0.1.0-rc.2` опубликован для macOS Apple Silicon,
Linux x64 и Windows 11 x64; полные сценарии Codex и Hermes проверены. Отдельный
русскоязычный лендинг доступен на `loginom-dock.duckdns.org`;
Studio перенаправляет пользователей на него.
Предыдущий внутренний кандидат `0.1.0-rc.3` собран на VPS и прошёл изолированную
установку, откат и повторный live-сценарий. Новый внутренний `0.1.0-rc.4` собран
на VPS: агентное наблюдение и исправление ошибок работают в той же сессии.
Публичная поставка этих кандидатов не выполнена.

Начало следующей задачи: [памятка агенту](agent-handoff.md).
Текущие серверные пути, образы и команды: [operations.md](operations.md).
Разделы ниже — хронология; ранние номера образов и промежуточные ограничения
не заменяют последнюю проверку и наблюдаемое состояние сервера.

## Завершённый export/rename-after-abandon contract: 5 сентября

Run `20260905-135741-5c45f2f3` прошёл **34/34 frozen checks**, audit SHA
`03af458a7b22ef1ad8b6b72df039f4a3a8954a839372c8962eeb682884d8286e`.
Hermes 0.21.0, подписка ChatGPT, `openai-codex` / `gpt-5.6-luna` / medium;
28 API calls, completed=true, failed=false, returncode=0, без timeout.

Агент выбрал abandon_operation (строка 25), затем переименовал существующий
узел через UI. Принят строгий proof ввода/Enter и сохранности портов, со сверкой
журнала с учётом только host observation metadata. E2E/Help доставлены до
продолжения. Обычный save/close/reopen и финальный снимок подтвердили точную цель
`/user/data/packages/Dock-acceptance-20260905-135741-5c45f2f3.lgp`.
Исходный node.add после abandon не превращается в SUCCEEDED; успех цели
подтверждается отдельно. Этот run завершил ранее незакрытый live proof
rename-after-abandon. Новый экспорт сохранил однозначные связи вызовов/ответов.
Реальные 24 storage copies проверены отдельным предыдущим run 135148;
его общий результат остаётся 33/34 FAIL, не повышен поздним пересчётом.

Прошли **64 Python tests**. Клиентский runtime не менялся:
`a97afec80301781a98c136316d605e8fe4b5a3f0f026726c7ed7fc2cad5e0827`;
manifest SHA `290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
Индекс `.dock/post-mvp-p0/evidence-index-history-occurrences.json`:
24 попытки / 9 PASS, SHA
`a7e3bc3402f2030cf597af546b02ed90f401c568706a440bb1a35b6738ac89ea`.
`git diff --check` чистый. Production, установленный клиент и Git HEAD не менялись.

В P0 завершён перенос поддерживаемых harness/goals/fault wrappers/auditors,
документирование preflight/run/audit и индексов новых/исторических evidence.
Остаются review и отдельная фиксация исходников MVP, проверка чистого checkout,
а затем source-clean сборка на VPS с приёмкой окончательного состава. Все
исторические pins сохраняются; результаты другого runtime не переносятся
автоматически на новый. Сам P0 ещё не завершён.

## Экспорт истории Hermes: различение копий и попыток, 5 сентября

Разобрана исходная Hermes DB проблемного run `20260905-131822-165a251b`.
Повторы создавались при сжатии/замене истории: старые строки active=0,
новые строки сохраняют исходные timestamp и provider tool_call_id, часть
полных tool replies заменена generic summary. Это не доказательство повторного
исполнения инструмента. Изучены установленные Hermes 0.21.0
`run_agent.py`, `hermes_state.py`, `agent/context_compressor.py`.

`evidence.export_history` читает вызовы и ответы в одной read-only транзакции.
У каждой попытки есть уникальный ключ из исходного ID/строки/индекса и отдельный
`provider_tool_call_id`. Ответ сопоставляется с последним однозначным предыдущим
вызовом того же ID в той же сессии. Точные копии архивированных строк с тем же
временем и подтверждённой границей сжатия сохраняются как `storage_copies` со
ссылками на строки. Generic summary признаётся копией только при точном
совпадении со строкой, вычисленной из исходных аргументов и длины полного ответа.
Другие времена/аргументы/конфликтующие ответы не объединяются. Неоднозначная
связь остаётся ошибкой; строковые ответы не превращаются в SUCCEEDED.
Тела assistant/system/summary и reasoning не читаются.

Run `20260905-135148-6fa2b372` подтвердил экспорт в реальной задаче: сохранены
24 копии строк, все вызовы/ответы сопоставлены. Frozen audit **33/34 FAIL**,
SHA `0eb05e2915a64ae8876d865f0fada2f8705c7587f9d21f636141b180423684ab`:
единственный отказ — rename-after-abandon proof. Причина сравнения журнала:
после записи UI receipt клиент добавляет observation_id и нормализует origin
(`http://host/` → `http://host`). В rename_effect учтены только эти два
преобразования; граф, trace и остальные поля по-прежнему сравниваются строго.
Поздняя диагностика не повышает прежний отчёт до PASS.

Прошли 64 Python tests: отдельные случаи хранения копий, реального повтора ID,
конфликтующего ответа, отсутствующей границы сжатия и изменённого графа.
Runtime `a97afec8…` не менялся; исправления относятся к operator harness.

## Переименование на новом runtime: 35/35, 5 сентября

Run `20260905-132537-623287bf` через Hermes 0.21.0 / подписку ChatGPT /
`openai-codex` / `gpt-5.6-luna` / medium прошёл **35/35 frozen checks**.
Audit SHA `eb1ab58d71b8e1beb118f1e3d227913cfd5fc64ef316b178a9bdbd27e88f114f`.
Использованы `--fault rename --allow-manual-reopen --require-delivered-context`.
Runtime `a97afec80301781a98c136316d605e8fe4b5a3f0f026726c7ed7fc2cad5e0827`,
manifest SHA `290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.

Подтверждён именно связанный UI-ремонт: на ответах 23/25 редактор оставался
открыт, исходная операция — pending/AMBIGUOUS с причиной
`node rename editor is still open`; после Enter (ответ 29) — resolved/SUCCEEDED.
Созданный источник не создавался повторно. E2E/Help доставлены до продолжения.
Save/close/reopen и финальный снимок подтвердили точный граф в
`/user/data/packages/Dock-acceptance-20260905-132537-623287bf.lgp`.
Путь rename-after-abandon в этом успешном run не выполнялся; для него есть
усиленный source proof и unit tests, но отдельный frozen live PASS не заявляется.

Прошли 139 client и 58 Python tests. Индекс
`.dock/post-mvp-p0/evidence-index-rename-editor.json`: 22 попытки / 8 PASS,
SHA `200ed05da3ec2436a0464cc98bb5965f0820acf698b3223c5b8cac8857466c2b`.
`git diff --check` чистый; production и установленный клиент не менялись.

Дополнительный run `20260905-131822-165a251b` завершил цель с ручным reopen,
но получил 21/23 FAIL, audit SHA
`8bb9e3cd99a5fea10a117dc5264eead8559d2bf16eb2f60e470c55b138101bb3`.
В Hermes DB повторялись tool_call_id, часть повторных ответов была строковой;
экспорт/аудит не обеспечили однозначное сопоставление. Не дедуплицировать это
как успешные действия и не повышать отчёт. Следующий пробел P0 — поддержать
повторные IDs/отклонённые вызовы доказуемым сопоставлением отдельных попыток,
затем завершить review/фиксацию исходников и чистую поставку на VPS.

## Переименование: исправление ложного NOT_APPLIED, 5 сентября

Реальный rename-fault run `20260905-130906-c5a21708` на Hermes/подписке
ChatGPT/Luna medium сохранил правильную цель, но получил **32/38 FAIL**:
журнал не подтверждал завершение исходного node.add. Audit SHA
`7a69c3082df1a6239d32721d46ea5ce1275f1ca3a72a588335371dc6594d3446`.
Причина в runtime: при открытом inline-редакторе Loginom скрывает label,
`graphNodes` возвращает прежний пустой набор и reconcile ошибочно возвращал
NOT_APPLIED. Это снимало pending guard до fill/Enter.

В `reconcileNode` добавлена проверка видимого textarea в workflow.graph:
пока редактор открыт, результат AMBIGUOUS. Тест реального сериализованного
обработчика моделирует скрытую подпись, проверяет блокировку нового node.add
и завершение исходной операции после Enter. Прошли все **139 client tests**.
Новый runtime pin:
`a97afec80301781a98c136316d605e8fe4b5a3f0f026726c7ed7fc2cad5e0827`.

Аудитор усилен отдельным `rename_effect.py`: одного снимка с новым именем
недостаточно для пути после abandon. Нужны наблюдаемые ввод имени/Enter,
точный редактор, журнал UI-жестов и сохранение портов/рабочей области относительно
последнего полного снимка до открытия редактора. Другие мутации между этими
снимками не допускаются. Hash proof закрепляется до старта.
Для связанного UI-ремонта принимается подтверждённая журналом reconciliation
в самом UI-ответе: повторный inspect не обязателен. Это также учитывается
в проверке pending guard. Прошли **58 Python tests**.

Промежуточный run `20260905-131708-0bf7cf5e` остановлен оператором до мутаций
из-за выявленного unit-тестом пробела pending-аудита; причина в operator-stop.json.
Его отчёт сохранён (11/18 FAIL), не является live-приёмкой исправления.
Production и установленный клиент не обновлены. Прежние приёмки на `f5d42a18…`
остаются доказательствами прежнего runtime, не новой версии автоматически.

## Manual reopen на Luna: приёмка завершена 5 сентября

Run `20260905-125931-a3a46bef` с `--fault save_reopen --allow-manual-reopen
--require-delivered-context --timeout 2400` прошёл **28/28 frozen checks**.
Audit SHA `e62c02fb9378cc983d89185d4b47d8635a8d4c5a3e24d63582373da494620935`.
Hermes usage подтвердил provider `openai-codex`, model `gpt-5.6-luna`, 24 API calls,
completed=true, failed=false, returncode=0, без timeout. Reasoning `medium`
закреплён в CLI/config/request. Использована существующая подписка ChatGPT.

Настоящий operator fault сработал после сохранения и закрытия пакета. Агент
получил проверенный E2E/Help-контекст, наблюдал пустой workspace, выполнил
связанный abandon и через UI открыл исходный файл
`/user/data/packages/Dock-acceptance-20260905-125931-a3a46bef.lgp`.
Новый workflow ref и точный граф двух узлов, трёх входов объединения и одной
связи с третьим входом подтверждены финальным наблюдением. Исходная квитанция
Save As осталась AMBIGUOUS и совпала с журналом. Запрос со старым observation
был отклонён без эффекта; перед действием агент получил новое наблюдение.
Это PASS заранее объявленного automatic-delivery/manual-reopen контракта;
самостоятельный поиск модели не является отдельной принятой серией.

Runtime прежний `f5d42a18ae493f24c0dfc1d1be94ebda903584e1fe391e009be7f1c6021c0c90`,
candidate manifest SHA `290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
Прошли 53 Python tests; `git diff --check` чистый. Индекс
`.dock/post-mvp-p0/evidence-index-luna-manual-reopen.json`: 18 попыток / 7 PASS,
SHA `5006eebfbf050c0b258bd5576bc4d8604c1594760848c3345c281a2d514becb6`.
Прежние FAIL и остановка пользователем сохранены. Дальше P0 требует review
остальных recovery proofs, фиксации исходников и проверки чистой поставки
на VPS. Production и установленный клиент не менялись; коммитов не было.

## Новая конфигурация Hermes: 5 сентября

Пользователь разрешил продолжить работу и заменил модель для отладки и
тестирования Hermes: **подписка ChatGPT, GPT-5.6 Luna, reasoning medium**.
Identifiers установленного Hermes 0.21.0: `openai-codex` / `gpt-5.6-luna` /
`medium`. Правило согласовано в плане, AGENTS и handoff; оно заменяет прежнюю
MiMo-конфигурацию. Исторические отчёты и серверные модели не изменены.

Launcher использует только существующий ChatGPT provider state Hermes в
защищённом private auth.json отдельного прогона. Другие провайдеры и личные
настройки не переносятся; секреты не входят в request/evidence. До запуска
проверяется срок действия access token более 4200 секунд. Аудитор требует
новые provider/model, medium в закреплённом запросе и экспортированной настройке;
фактические provider/model сверяет с usage Hermes. Прошли 53 Python tests,
включая отказ на чужой модели/провайдере/reasoning и некорректном подключении.
Source-only preflight новой конфигурации прошёл. Это ещё не live PASS.

## Ручное открытие после AMBIGUOUS Save As: 5 сентября

В поддерживаемый harness перенесён `manual_reopen.py`; добавлены явный
`--allow-manual-reopen` и operator-only `--fault save_reopen`. Сбой прерывает
реальный код после сохранения и закрытия пакета; фактическая AMBIGUOUS-квитанция
остаётся неизменной. Независимый proof требует пустого наблюдаемого workspace,
подтверждённого cleanup и связанного с наблюдением abandon. Затем проверяются
UI-жесты открытия через меню или кнопку начальной страницы, ввод исходного пути
и новое наблюдение пакета с другим workflow ref. Исходный Save As не становится
SUCCEEDED; точный граф до сохранения и после открытия проверяется отдельно.
Hash аудитора и зависимого proof закрепляются до запуска модели.

Первая попытка `20260905-121349-46e1ee7e` завершилась до модели: новый variant
отсутствовал в allowlist fault-launcher. После исправления запуск
`20260905-121430-be40080a` открыл пакет через кнопку начальной страницы, но
заранее закреплённый proof принимал только меню: **19/21 FAIL**, audit SHA
`4eb43275413fab0502130ba19a18470dd2218c751919c9716635fb91891e019a`.
Этот результат сохранён. Поздняя диагностика с расширенным UI-proof не повышает
его до PASS. Добавлены оба штатных маршрута и отрицательные tests для неверного
пути, отсутствующего закрытия/checkpoint, неподтверждённого abandon, чужого ref,
неприменённого жеста, лишнего действия и отсутствующего нового workflow.

Повтор `20260905-122550-f8253f76` с поддержкой обеих кнопок дошёл до открытия,
но завершился по лимиту 1200 секунд до финального наблюдения: **18/21 FAIL**,
audit SHA `e09ae8017a7e52dfaf9aec1db69959c6c6389124d919ba8c182cb09f1cb08908`.
При ошибках связи и Save As доставлены оба источника E2E/Help. Устаревшие
UI-запросы отклонены; агент обновлял наблюдение. Эти факты не заменяют итоговую
проверку графа и завершение процесса модели.

Запуск `20260905-124638-9c9e11ff` с timeout 2400 остановлен **по прямому запросу
пользователя** до mutating calls (только пустой draft и описания операций).
Группа процессов завершена; evidence экспортированы, `operator-stop.json`
фиксирует причину. Audit 6/8 FAIL, SHA
`8cf56325e339e2a435327e9d4a7b1f3380e824bc40d1739e45d5804d27b34722`;
это прерванная приёмка, не подтверждение продуктовой ошибки.
Frozen live PASS manual reopen пока отсутствует. Индекс на остановке:
`.dock/post-mvp-p0/evidence-index-user-stop.json`, 17 попыток / 6 PASS,
SHA `0b2dfe19f758e2bbf6ce51dae0152b4dfa8777990b08f663e1b8dbc9a2febe35`.
Точная команда/условия следующего запуска — в разделе остановки handoff.
Работа не возобновляется автоматически.

Локально прошли **50 Python tests и 11 JS fault-wrapper tests**.
Runtime `f5d42a18ae493f24c0dfc1d1be94ebda903584e1fe391e009be7f1c6021c0c90`
не менялся. Production и установленный клиент не обновлялись.

## Автоматические связи: поддерживаемая приёмка 5 сентября

В `run.py` добавлен выбор `--goal basic-graph|auto-link-retain|auto-link-remove`.
Сохранены прежние goal-only тексты; hash выбранного задания закрепляется до
старта. Auto-link goals допустимы только без fault injection. Аудитор выбирает
точную ожидаемую структуру: два входа/первый связан для retain, три входа/третий
связан для remove. Перенесён `auto_link_delete.py` и отрицательные unit tests.
Его hash также проверяется вместе с заранее закреплённым контрактом аудитора.

Реальные попытки Hermes 0.21.0 / Xiaomi `mimo-v2.5`:

| Goal / run | Frozen audit | Audit SHA |
| --- | --- | --- |
| retain / `20260905-115815-03d1d051` | **32/32 PASS** | `8a45ebc0013d632e9258af4f922a429e486a87198abffd3bb126c342da652e6a` |
| remove / `20260905-120159-69f00baa` | **32/32 PASS** | `a0e3c49ea0c868c3f6f29f1119625643a3182eff0d1deddddac3cd85cbf0d306` |

В обоих случаях node.add действительно сообщил одну штатную связь с первым
входом, с `goal_verified: false`, и ответ совпал с журналом. Retain сохранил её
без повторного создания/ремонта. Remove подтвердил удаление одной связи через
привязанный к наблюдению UI-жест и точный diff при сохранённых узлах/портах,
затем создал связь с третьим входом. Сохранение/закрытие/открытие подтвердили
требуемую структуру каждого пакета в `/user/data/packages/Dock-acceptance-<run>.lgp`.

Runtime остался `f5d42a18ae493f24c0dfc1d1be94ebda903584e1fe391e009be7f1c6021c0c90`,
candidate manifest — `290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
44 локальных Python tests прошли, `git diff --check` чистый. Новый индекс
`.dock/post-mvp-p0/evidence-index-auto-link.json`: 13 попыток / 6 PASS;
SHA `d6f388458166df4e2865217a4fedfebdabe26fd5bbc42858f71a7e9a384465f1`.

Manual reopen после AMBIGUOUS Save As ещё не перенесён. Обычный подтверждённый
save/close/reopen этих двух задач его не заменяет. P0 также требует review/фиксации
исходников и чистой поставки; production и установленный клиент не менялись.

## Смещение узла: приёмка 5 сентября

Перенесён поддерживаемый `--fault position` и независимый proof реального drop,
сдвинутого ровно на 24px, при неизменном checkpoint. Проверяются настоящий
AMBIGUOUS с cleanup, соответствие ответа журналу, единственное создание источника
и явная успешная сверка исправления либо подтверждённый abandon исходной цели.
Basic-graph goal не задаёт абсолютных координат: abandon не превращается в успех
исходного node.add; точный состав графа/save/reopen проверяется отдельно.
Proof не заявляет проверку координат после reopen.

Реальный run `20260905-114717-ed0c4c7d` через Hermes 0.21.0 / Xiaomi `mimo-v2.5`
с `--fault position --require-delivered-context` прошёл **35/35 frozen checks**,
audit SHA `753577197104425cf8defb1908b94ae50ea15ebd5769515444655b8bff2f9635`.
17 API calls, без timeout и подмены модели. После наблюдения агент выполнил
abandon_operation, сохранив исходную AMBIGUOUS-квитанцию, затем продолжил задачу.
Повторного создания источника не было. Контекст E2E/Help доставлен до продолжения.
Точная структура двух узлов/трёх входов/одной связи подтверждена save/close/reopen
`/user/data/packages/Dock-acceptance-20260905-114717-ed0c4c7d.lgp`.
Runtime не менялся: `f5d42a18ae493f24c0dfc1d1be94ebda903584e1fe391e009be7f1c6021c0c90`;
candidate manifest — `290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
Локально прошли 36 Python tests, включая отрицательные геометрические proofs;
`git diff --check` чистый. Индекс: `.dock/post-mvp-p0/evidence-index-position.json`.
Остались auto-link/manual-reopen контракты, review/фиксация MVP и чистая поставка
P0. Production и установленный клиент не обновлены.

## Частично созданная связь: перенос приёмки 5 сентября

В поддерживаемом harness открыт `--fault partial_link`. Новый proof сверяет
фактическую квитанцию AMBIGUOUS с ответом агенту и журналом, точное удаление
единственной новой связи, сохранность узлов и созданного порта. Требуется один
запрос Input_Add, восстановление complete_link к тому же порту, trace
`creates_port: false`, совпадение recovery receipt с журналом и обычные проверки
точного графа/save/reopen. Ручной UI-ремонт вместо complete_link пока вне этого
контракта; такая попытка не получает PASS автоматически.

Локально прошли 34 Python acceptance tests и 9 fault-wrapper tests. Новый
аудитор тестируется на сохранённом порту, поддельной квитанции, лишнем запросе
Input_Add, отсутствующей записи журнала и изменённом составе портов.
Runtime клиента и production этой правкой не менялись.

Реальная попытка `20260905-112721-45b852c3` запущена через Hermes 0.21.0 /
Xiaomi `mimo-v2.5`, `--fault partial_link --require-delivered-context`.
Frozen audit: **35/35 PASS**, SHA
`7aaaaaf31e03422c39407abc020228c5998b57895ad14fc0aec4d2b902eaa1e3`.
Runtime pin остался
`f5d42a18ae493f24c0dfc1d1be94ebda903584e1fe391e009be7f1c6021c0c90`,
candidate manifest — `290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
Модель выполнила 16 API calls, без timeout и смены провайдера. После ошибочного
обращения к отсутствующему третьему входу агент наблюдал граф и использовал
Input_Add. Сбой действительно удалил только новую связь, сохранив вход;
после inspect агент вызвал complete_link исходной операции и восстановил связь.
Повторного Input_Add не было. Контекст E2E/Help доставлен; точный граф с тремя
входами подтверждён при save/close/reopen пакета
`/user/data/packages/Dock-acceptance-20260905-112721-45b852c3.lgp`.
Индекс сохранён в `.dock/post-mvp-p0/evidence-index-partial-link.json`.
Остались position, auto-link/manual-reopen контракты и воспроизводимый чистый
выпуск P0; production и установленный клиент не обновлялись.

## Автоматическая доставка контекста: приёмка 5 сентября

После четырёх попыток без чтения источников добавлен малый клиентский адаптер
`client/lib/recovery-context.mjs`. Он читает pinned E2E-helper через штатный MCP
read и проверяет полные байты по catalog SHA; Help получает через scoped grep/find
и read. В ответ FAILED/AMBIGUOUS передаются очищенные фрагменты с URI и hashes,
отдельно от неизменённой квитанции операции. Тот же блок сохраняется в журнале.
Сервер не исполняет задачу и не получает пользовательские метки/ошибки как запросы
поиска. Ограничения доставки описаны в architecture; Help version не считается
проверенной. Для произвольного UI-жеста без pinned helper возможен частичный контекст.

Проверена реальная доставка с последующим исправлением и сохранением:

- Run: `20260905-080210-c36a7f7b`, неизменённая basic-graph goal-only задача,
  `--fault lost_receipt --require-delivered-context`, 15 API calls, без timeout.
- Hermes 0.21.0 / Xiaomi `mimo-v2.5`, source runtime с 41 input:
  `f5d42a18ae493f24c0dfc1d1be94ebda903584e1fe391e009be7f1c6021c0c90`.
- Catalog `2026.09.05-agent.2-candidate`, manifest SHA
  `290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
- Frozen независимый audit: **35/35 PASS**, SHA
  `520d5ab0a386433dfb64cbfe5e39ded1709c973a92d72fd61b7fcc8ca01dbe7a`.
- Первый контекст (reply row 14) содержал E2E `bg/helpers/workflow/node.ts`
  и Help `data/workflow/hotkeys.md`; source operation восстановлена по квитанции.
- Затем попытка связи с отсутствующим третьим входом вернула FAILED (row 24).
  До продолжения агент получил E2E `bg/helpers/workflow/links.ts` с логикой
  `Input_Add` и Help `data/workflow/ports/README.md`. После наблюдения запрос
  изменён с `target_port: {kind: data, index: 2}` на `{kind: add}` (row 27).
  Связь создана, итоговый узел имеет ровно три входа и единственную нужную связь.
- Save/close/reopen подтвердили точный граф в
  `/user/data/packages/Dock-acceptance-20260905-080210-c36a7f7b.lgp`.

Это **автоматическая доставка клиентом** (`delivery: client_automatic`), а не
собственные вызовы find/read от модели. Прежний `--require-knowledge-recovery`
сохранён без ослабления; его прежние failed reports не повышены. Новый отдельный
контракт проверяет совпадение блока в ответе и журнале, E2E URI/SHA/commit с
описанием action, целостность фрагментов, продолжение после доставки и обычную
приёмку цели. Внутреннюю причинность решения модели он не доказывает; фактический
порядок получения источников и исправления виден в tool evidence.

Локально прошли 139/139 клиентских tests, 30/30 Python acceptance tests,
10/10 packaging tests, включая изолированную копию исходников. В packaging test
обновлено ожидание 40 → 41 input и проверено включение нового адаптера в pin.
Индекс `.dock/post-mvp-p0/evidence-index-delivered-context.json`: 8 попыток,
2 PASS (прежняя baseline и новый контракт доставки), SHA
`74f4f68d73ee1fa051d8533909cb356bebfa087b42175079af1c7b9c761e3333`.

Изменения остаются source-only: production, установленный клиент и серверный
skill не обновлены. P0 целиком не закрыт; native release и прочие fault/auto-link
контракты по-прежнему требуют своей приёмки. Эта проверка заменяет прежнюю
неопределённость именно о доставке E2E и Help при поддержанном сбое.

## Контекст E2E и Help при восстановлении: 5 сентября

По запросу пользователя исправлено ограничение приёмки: `audit.py` допускает
read-only инструменты знаний в явных корнях Dock, а `evidence.py` сохраняет их
очищенные ответы, включая function-call transport, и связывает вызовы с ответами.
Записи/личная память и поиск без явного корня не допускаются этим контрактом.
Добавлен `--require-knowledge-recovery`: наблюдаемая ошибка, поиск и чтение
найденных файлов из обоих источников после ошибки, успешное продолжение и
обычные проверки точной цели/save/reopen. Статус не повышается за одни ссылки,
поисковые abstracts или текст модели. Влияние знаний на внутреннее решение
не доказуемо порядком вызовов; релевантность источников требует отдельного review.

Общее правило добавлено в подготовку клиента, отдельный блок ответа
FAILED/AMBIGUOUS, исходник полного skill и native skills Codex/Hermes.
Квитанция runtime сохраняется отдельно и не меняется от добавления рекомендации.
Harness теперь копирует закреплённый native skill в изолированный Hermes home
и загружает через `--skills loginom`; SHA сравнивается с runtime pin и копией после
завершения. Это не приёмка установки plugin/hooks. Серверный skill не опубликован,
установленный клиент и production не изменены.

Текущий source runtime pin после этих правок:
`e572f603d9f1e92dc3a9202f1648cad1d5906fd59463be9b5770ee54fc9ad3b7`.
Catalog остаётся `2026.09.05-agent.2-candidate`, manifest
`290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
Четыре новые goal-only попытки выполнены на Mac через Hermes 0.21.0 /
Xiaomi `mimo-v2.5`, без смены модели и без подсказки fault/стратегии в задании:

| Run | Условия | Frozen audit | Наблюдение |
| --- | --- | --- | --- |
| `20260905-042920-8a8d794a` | lost_receipt, правило в prepare | 33/36, FAIL | Квитанция восстановлена, цель сохранена/reopen; знания не запрошены |
| `20260905-043301-af9ea3ba` | lost_receipt, дополнительно правило в ответе о сбое | 33/36, FAIL | Цель сохранена/reopen; знания не запрошены |
| `20260905-043624-ad4a2bfb` | lost_receipt, дополнительно native skill preload | 33/36, FAIL | Native pin проверен, цель сохранена/reopen; знания не запрошены |
| `20260905-044041-9c22d037` | rename, тот же preload/runtime | 19/25, FAIL | Поиск Help только до сбоя, без read/E2E; исправление после abandon не покрыто узким rename proof |

В четвёртой попытке два glob-вызова передали полный URI в pattern, но не задали
`uri` (фактический default сервера — `viking://`), поэтому scoped-проверка
обоснованно не прошла. Find с явным Help root нашёл описание Union; сам файл агент
не прочитал. Live schemas проверены отдельным read-only MCP list_tools.

Для rename перенесён CLI и строгий proof: настоящий drop/cleanup, единственный
source apply, связанный UI-ремонт и успешный inspect/reconcile исходной операции.
Путь после abandon требует отдельного аудитора. Исправлено раннее прекращение
диагностики при отсутствии inspect: остальные проверки цели теперь выполняются,
но recovery остаётся FAIL. Исходный frozen report не изменён. Поздний
`.dock/post-mvp-p0/knowledge-rename-diagnostic.json` подтвердил точный граф до/после
сохранения и совпадение save receipt с журналом; это **не новый PASS** и не
подтверждение всех переходов восстановления.

Проверки окончательных исходников: 136/136 client tests, 27/27 Python
contract tests и 9/9 fault-wrapper tests; `git diff --check` чистый.
Индекс `.dock/post-mvp-p0/evidence-index-knowledge.json`: 7 попыток, 1 прежний PASS,
SHA `784740aa737aa0cf2337c48d8f64f2fb685bb52f44ab504636d926de8d4f1392`.

**Полный цикл с фактическим чтением E2E и Help пока не подтверждён.**
Доступ к знаниям и корректная фиксация доказательств реализованы; одни инструкции
не обеспечили их использование текущей моделью. Следующая работа должна решать
именно доставку/использование контекста, а не ослаблять критерий или повторять
одинаковые запуски. P0 целиком не закрыт; выпуск и активация каталога не выполнены.

## План выхода из MVP: документация 5 сентября

По запросу пользователя в [план](../plans/2026-09-02-loginom-dock-implementation-plan.md#post-mvp-scope)
добавлена самостоятельная инструкция следующему агенту: проверенная исходная
точка, целевой объём, карта кода, нюансы UI/портов/автосвязей и recovery, этапы
P0–P9 с зависимостями и критериями завершения, порядок добавления capability,
независимая goal-only приёмка, совместимость runtime/catalog/full skill,
native-поставка и откат. Новые этапы оставлены невыполненными; начало — P0.

Добавлена [карта E2E-источников](e2e-source-map.md) по 14 областям. 46 выбранных
файлов локального `e2e-tests` побайтно сверены с pinned commit `2cad560…`, хотя
HEAD checkout — `986c871…`; проверены 50 прямых ссылок. Описаны неявный запуск
при open/settings, работа с пустым результатом, file upload, code/SQL editors,
variables и подмодели. Исходники E2E использованы для анализа; E2E не запускались.

Это изменение документации. Продуктовый код, runtime pins, каталоги, полный skill,
сервер и установленный клиент в этой задаче не изменялись; модели, браузер,
сборки и live-приёмка не запускались. Ранее полученные 136/136, 119/119 и 65/65
сохраняют прежние границы применимости, не считаются новыми проверками дорожной карты.

## Выход из MVP: fault wrappers и индекс старой приёмки P0, 5 сентября

В `tools/loginom-acceptance/` перенесены четыре операторских wrapper:
`rename-client.mjs`, `partial-link-client.mjs`, `position-client.mjs`,
`lost-receipt-client.mjs`. Общий `fault-launcher.mjs` проверяет exact run/state,
заявленный variant и совпадение executor SHA между preflight, окружением MCP
и исходниками. Не допускает symlink directories, сохраняет очищенную реальную
квитанцию один раз. Исправлять сценарий должен Hermes; wrappers не входят в
client source snapshot/bundle, что проверено составом упаковки.

CLI `run.py --fault lost_receipt` и `audit.py` поддерживают потерю одного
успешного ответа браузера после cleanup. Другие три wrapper пока доступны для
local tests; их CLI-запуск закрыт до переноса соответствующих auditors.
Исходное basic-graph задание не содержит подсказки о fault/recovery. Отдельно
перенесены неизменённые auto-link goals:

- `goals/auto-link-retain.txt`: SHA `6565a6dbc657585fa15100a48a0c822a7b27da6dd90773fb3b210fa02048c779`;
- `goals/auto-link-remove.txt`: SHA `867da219d320e20d36b563ff4def2db3b0cb133f4bda697723d5c0e732f8a796`.

Локальные проверки: **9/9 JS wrapper tests** и **17/17 Python tests**.
Негативные fixtures отвергают неверный source SHA/variant/state, поддельную
или изменённую receipt, незавершённый cleanup, повторный source apply, отсутствие
receipt_recovered в журнале, восстановление после следующего apply и неверную
привязку recovery ID. Поддержаны три пути reconciliation: inspect, recover,
а также автоматическое восстановление внутри runtime **до** нового physical apply
после наблюдения модели. Ни один путь не заменяет доказательство правильного
конечного графа и save/reopen. Подсчёт успешных вызовов инструмента недостаточен.

Проведены **две fault-попытки**, обе на текущем Mac через существующие
Hermes 0.21.0 / Xiaomi `mimo-v2.5`, без смены runtime
`ca4b9f4cdbf6d46358235147d445a45428b224046cf0074cae16a241d3bdc016` и candidate
`290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
Каждый run имел заранее записанные goal/pins/harness hashes и бюджет 60 turns /
1200 секунд. Оба завершились с returncode 0 без timeout, но frozen audits
**не получили PASS**:

| Run | Исходный аудит | SHA audit.json | Причина |
| --- | --- | --- | --- |
| `20260905-040404-fe2aacda` | 29/30, FAIL | `6fcd927327c4ba8ab2fabde1b7b7a11eda1e9ba768de1c126d4a80dcff4fb68d` | Узкий критерий требовал inspect, хотя recover возвратил ту же реальную receipt с привязанным recovery ID. Остальные проверки цели прошли. |
| `20260905-040748-b18c3b34` | 27/36, FAIL | `08fa181dac67d5a1783df498014e860ccd0e9d3e5231587404d7d7ef30b7c2a6` | Помимо неучтённого автоматического reconciliation, сохранён/открыт граф с **четырьмя** data inputs вместо трёх. После этого был ещё один успешный UI-клик без нового наблюдения. |

Второй run потребовал 43 API calls, неоднократно исправлял связи/порты.
Точная связь после reopen направлена на третий вход, но четвёртый лишний вход
сохранился — это самостоятельное основание FAIL. Последний клик не доказывает
изменение графа; утверждается только отсутствие новой проверки после UI-действия.

После наблюдения обоих штатных путей runtime исправлен **аудитор**, добавлены
regression fixtures. Старые frozen reports не перезаписывались и не повышались.
Диагностический пересчёт новым аудитором отдельно подтвердил восстановление
исходной receipt без повторного создания источника в обоих runs. Для первого
других failed checks нет; для второго остаются неверный сохранённый граф и UI
после saved proof. Это retrospective diagnostic, а не новая frozen acceptance:
`.dock/post-mvp-p0/fault-auditor-diagnostics.json`, SHA
`908dbe0da1c86b683c6ae5f5218c288b554caccc261ebbf068475c42411a6911`.

Обновлённый индекс новых runs содержит **3 попытки / 1 PASS**: прежний no-fault
baseline и два новых fault FAIL. Файл
`.dock/post-mvp-p0/evidence-index-after-faults.json`, SHA
`a4f03ef9c53b0b584f0a0a6251ede99fc610b747603b4e2fb198ac41cb04e7f7`.

Добавлен `index-legacy-evidence.py`: найдены **41 прежний каталог с result.json**,
**31 audit report**, у всех 31 совпали hashes явно перечисленных ими inputs;
10 каталогов не имели audit report. Metadata сохранены в
`.dock/post-mvp-p0/legacy-evidence-index.json`, SHA
`2990fabba20eb3999a9ce9680d4e269dce0e513efa8fba8b73e8dddcbc07ac73`.
SQLite/transcripts/reasoning/browser profiles не копировались. Сохранность
перечисленных файлов не подтверждает неуказанные зависимости старого аудитора
и не объединяет разные runtime pins в текущую приёмку.

**Осталось P0:** перенести остальные recovery/manual-reopen/auto-link auditors,
повторить fault-приёмку с окончательным заранее закреплённым контрактом, затем
review/фиксация MVP и проверка чистого выпуска на VPS. Текущий результат не
разрешает production activation. Product runtime, сервер, установленный клиент
и production pointers не менялись.

## Выход из MVP: archive provenance и source-clean gate P0, 5 сентября

Устранён непроверяемый флаг `--source-clean` в builder. Добавлен общий
`deploy/loginom-dock/client-source-inventory.py`: его используют source preflight,
упаковщик и VPS builder. В source snapshot теперь входят сам упаковщик и общий
inventory module; build-only scripts не добавляются в поставляемый runtime.

Упаковщик фиксирует пофайловый SHA/size/mode, точный Git commit, inventory digest,
различия с commit и SHA архива в `<archive>.manifest.json`. `--require-clean`
отклоняет dirty inputs до записи output. Архив проверяется по фактически
прочитанным байтам, затем исходники повторно сверяются с исходным inventory;
symlinks и изменение inputs останавливают упаковку. Новые output пути обязательны,
готовые архивы не перезаписываются. Gzip header и tar metadata нормализованы:
два архива одинаковых inputs побайтно совпали независимо от имени output.

Builder с `--source-clean` требует точного полного commit SHA и доступного
доверенного Git object database (`--source-repository`, по умолчанию `--source`).
Распакованные inputs сравниваются с Git blobs, включая набор файлов и executable
bit, **до создания output**. После staging проверка повторяется до добавления
Node/dependencies и платформенных преобразований. В release manifest добавлен
`sourceInventorySha256`. Sidecar-флаг сам по себе не считается доказательством
чистоты. Внутренние сборки без флага остаются `sourceDirty=true`.

Проверки: **10/10 packaging tests**, включая полный последовательный клиентский
suite из временного чистого checkout; **11/11 acceptance tooling tests**.
Подтверждены чистый source/staging относительно временного Git commit, отказ
изменённым/добавленным inputs, короткому ref вместо точного SHA, недоступным Git
objects, дубликатам в архиве и dirty-упаковке с `--require-clean`. Отказ builder
проверен до создания output, без запуска production build. `git diff --check` прошёл.

Проверен фактический source archive текущей рабочей копии:

| Артефакт | SHA-256 |
| --- | --- |
| `.dock/post-mvp-p0/source-with-provenance-final.tar.gz` | `80b00db646b2bd2cb1fe641a27d4a70a5c121c9f1afad0af28bc590ab66e857e` |
| `.dock/post-mvp-p0/source-with-provenance-final.tar.gz.manifest.json` | `5db3dc1e64eed577ca1868f8491364e041ae5b05e2aa0521f14387ade16855ab` |
| Inventory digest, 159 файлов | `0c6616a625fcb8fd02c71f96e6d36de840b02ab2b947c3da669229c5b6334608` |

Архив 396788 байт; `build_inputs_match_commit=false`: 19 файлов изменены и
28 отсутствуют в HEAD `9a9a0bbc43c46685e2dd0af5753bfcc9374700ca`. Добавление
упаковщика и inventory module объясняет рост состава со 157 до 159 файлов.
Это проверенный dirty source snapshot, не чистый release. Основной checkout
не коммитился; source-clean gate пока подтверждён на временном тестовом commit.
Runtime code, сервер, installed client и production pointers не менялись.
Новая модельная приёмка и production build не запускались; предыдущие 25/25
остаются доказательством своего записанного harness/runtime, а не новым прогоном.

Продолжение P0: перенести fault wrappers и расширенные recovery auditors,
индексировать старые evidence, просмотреть/зафиксировать MVP и проверить
окончательный чистый выпуск на VPS. Самостоятельная проверка архивного состава
реализована, но P0 целиком ещё не закрыт.

## Выход из MVP: поддерживаемая базовая приёмка P0, 5 сентября

Перенесены в `tools/loginom-acceptance/`:

- `run.py`, `runtime-check.mjs`, `check-tools.mjs`: отдельный source/live preflight
  и явный запуск базовой задачи в новых Hermes/Dock/browser states. Подключение
  Xiaomi существующее, model fallback отсутствует, credentials в request/config
  не копируются. Бюджет и pins фиксируются перед запуском.
- `evidence.py`: экспорт только tool replies/function-call metadata и очищенных
  событий Dock; сырой Hermes home остаётся в приватном `private/` каждого run.
  Аудит не читает SQLite, reasoning, системные prompts и вывод модели.
- `audit.py`: независимая проверка basic-graph по точным pins, исходной цели,
  actual components/ports/graph, Save As checkpoint, save/close/reopen trace и
  квитанции в журнале. Данные, fault variants, manual UI reopen и native lifecycle
  этим аудитором не принимаются.
- `index-evidence.py`: индекс всех новых попыток в выбранном runs-root; перед
  PASS заново сверяет hashes audit inputs. Неполные/неудачные/недоступные попытки
  не удаляются из индекса. Исторические private runs пока не перенесены.
- `verify-sources.py`, `sources/e2e.json`, `sources/ui-probes.json`: переносимые
  hashes и минимальные source assertions без полных исходников Loginom/Ext JS.

Локальные проверки — **11/11 unittest**, включая 12 отрицательных вариантов
evidence, успех-текст без apply, изменённый goal prompt, неполный graph snapshot,
redaction/SQLite export, изоляцию окружения, запрет перезаписи, повреждение
source locator/hash, audit input integrity и preflight без MCP/browser/model.
Первый настоящий preflight остановился до модели из-за ошибочного распознавания
`v0.21.0`; исправлен разбор префикса версии, добавлена проверка этого формата.
Повторный preflight подтвердил Hermes **0.21.0**, Node **24.19.0**, SDK **1.30.0**,
Playwright MCP **0.0.80**, Playwright **1.63.0-alpha-2026-08-31**, Chromium **1243**.

Проведена **одна модельная попытка из одной запланированной**, без fault injection:
`20260905-033045-aabbf011`. До запуска закреплены исходный goal prompt, 60 turns /
1200 секунд, candidate manifest `290c59ed…d36d4b3` и runtime
`ca4b9f4cdbf6d46358235147d445a45428b224046cf0074cae16a241d3bdc016`.
Фактический usage подтвердил provider `xiaomi`, model `mimo-v2.5`, 11 API calls,
returncode 0 и отсутствие timeout. Получены 10 ответов Dock, 13 function calls,
9 journal events. Аудит **25/25 PASS**, включая byte-for-byte совпадение исходного
задания и auditor hash, заданных до запуска, и неизменность runtime/harness.

Пакет `/user/data/packages/Dock-acceptance-20260905-033045-aabbf011.lgp` сохранён
и реально открыт заново. Подтверждены «Источник» типа `imports.text`,
«Объединение» типа `transform.union_data`, ровно три входа данных и одна связь
с выходом «Источника» на третий вход. Граф до Save As и после reopen совпал;
посторонние узлы/порты/связи отсутствуют. Импорт данных и выполнение не требовались.

Evidence и hashes:

| Артефакт | SHA-256 |
| --- | --- |
| `.dock/post-mvp-p0/runs/20260905-033045-aabbf011/audit.json` | `9a30c47bb615f31269ce098a0bd2fcde4d0af1c759725105c3492480999a808c` |
| `.dock/post-mvp-p0/evidence-index.json` — 1 попытка, 1 PASS | `d1e73499143d963c8a9240bf5efdac2d1bcd4fd59f10578050327c657ce1a9f8` |
| `.dock/post-mvp-p0/source-probes.json` — 46 E2E / 3 UI | `80055b6f866cbf93f7de25c487d3b4310f2611f94a6208da24e12c4951046fc0` |

Все 46 E2E-файлов повторно побайтно совпали с blobs
`2cad5602158fd2e4836d821d644a2b8d92f571a2`. Mask.js, Lock.js и ext-all-debug.js
заново прочитаны из целевого Loginom; hashes совпали с §16.2 плана. Зафиксированы
точные номера строк и символы для element mask ownership, default loading text,
MessageBox Button и anchor/href rendering. Это static verification, а не новый
live hit-test и не доказательство версии серверного бинарника.

**P0 не закрыт:** впереди перенос fault wrappers и расширенных recovery auditors,
индекс старых evidence, review и фиксация MVP в основном Git, привязка inventory
к source archive и проверка `--source-clean` builder. Новая базовая source-задача
не заменяет повтор всех fault cases и не разрешает публикацию. Product runtime,
production pointers, сервер и установленный клиент не менялись.

## Выход из MVP: начало P0, 5 сентября

Сверены корневой AGENTS, handoff, план §§13–21, architecture, журнал и состав
рабочей копии. Scoped OpenViking lookup по `viking://resources/loginom-dock`
вернул пустой результат; работа опиралась на исходники. Прежние изменения
сохранены, основной checkout не сбрасывался и не коммитился.

Добавлен операторский `tools/loginom-acceptance/preflight.py` и его README.
Он использует общее с `package-client-source.py` правило выбора inputs,
создаёт пофайловый SHA-256/size/mode inventory, сверяет байты, режимы и набор
файлов с точным commit, вычисляет runtime digest из literal list `session.mjs`
и проверяет включение всех runtime inputs в упаковку. Symlinks, динамический
или дублированный список, отсутствующие обязательные inputs отклоняются.
`--require-clean` при dirty-составе возвращает 1 с отчётом; существующее evidence
не перезаписывается. Ни credentials, ни модель для source preflight не нужны.

В `goals/basic-graph.txt` перенесена исходная базовая goal-only задача без
изменения текста; SHA-256
`f4aa5db8007275559e35cda147c0f9649a20495e912b418219b8bd6161b38158`.
Приватные launcher/SQLite/transcripts/profiles не копировались.

Проверки: `python3 tests/unit/test_dock_client_packaging.py` — **7/7**, без
пропусков, включая полный последовательный клиентский suite из staging
временного чистого Git checkout. Использованы установленные закреплённые
зависимости и Node, без production build. Проверены отрицательные случаи
изменённого/удалённого/нового файла, executable bit, symlink, динамического
и повторного runtime input, неупакованного input, повторной записи отчёта.
`git diff --check` прошёл. Это source/contract checks, не live-приёмка.

Фактический preflight основной рабочей копии: 157 build inputs, 40 runtime
inputs, 18 изменённых файлов и 27 отсутствующих в основном HEAD
`9a9a0bbc43c46685e2dd0af5753bfcc9374700ca`. Runtime digest остался
`ca4b9f4cdbf6d46358235147d445a45428b224046cf0074cae16a241d3bdc016`.
Отчёт: `.dock/post-mvp-p0/source-preflight-final.json`, SHA-256
`01f47b43748e88aa92505b921159e9401b1218fdc50ed57003d7362ed5d886bd`.
Код 1 от `--require-clean` — ожидаемое подтверждение dirty inputs. Временный
тестовый commit не означает фиксацию MVP в основном репозитории.

**P0 продолжается.** Требуются review/фиксация MVP, перенос live-preflight/run/audit
и fault wrappers, очищенный индекс evidence, E2E/probe verification, привязка
inventory к source archive и реальная базовая задача через Hermes/Xiaomi MiMo 2.5.
Новая команда пока не проверяет effective provider/model и не запускает приёмку;
её имя preflight относится только к source scope. Флаг builder `--source-clean`
ещё не связан с этой проверкой. Сервер, каталоги, skill, установленный клиент и
production pointers в этой итерации не менялись.

## E2E-исполнитель: локальный MVP-кандидат 4 сентября

В исходниках начата новая итерация из активного плана. Добавлены JSON schemas
action/selector catalog и session manifest, capability ABI 1, три E2E-backed
definitions (`node.add`, `link.create`, `package.save_as`), selector symbols с
точными provenance и dependency graph для импортированной ревизии `e2e-tests`
`2cad5602158fd2e4836d821d644a2b8d92f571a2`.

Локальный клиент получил закрепляемый при старте режим `executor-preview`. До
публикации tools он читает серверный `current.json`, проверяет manifest и SHA-256
всех файлов, production status, E2E commit, capability ABI и минимальную ревизию
executor. В режиме отсутствуют raw browser tools и `dock_clipboard_transfer`;
UI могут менять только `dock_action_describe` и `dock_action_run`. Существующий
`classic` оставлен режимом по умолчанию, `research` выбирается только параметром
нового процесса. Режим нельзя изменить через tool, definition или ответ сервера.

Capability-ядро реализует свежий resolve `data-tid` в выбранной workspace tab,
cardinality/visibility/enabled/geometry проверки, общий deadline, bounded retry,
reconciliation, graph/port/link diff и четыре типизированных исхода. Для
`package.save_as` разрешён только корень `/user/data/packages`, conflict policy
явна, а успех требует закрыть и повторно открыть пакет с проверкой активной вкладки.
Definitions не содержат исполняемый код и raw CSS/XPath; неизвестные поля,
capabilities, `stale` и повреждённые digests отклоняются до browser call.

Сборщик создаёт детерминированный immutable release. При изменении E2E source
manifest dependency graph помечает `stale` только затронутые действия и формирует
неактивируемый candidate. Скрипт публикации перед записью повторно сверяет живой
E2E manifest. Режим `--stage` создаёт только неизменяемый candidate и не меняет
`current.json`; `--activate` допускает только production и переключает указатель
отдельной операцией после записи release.

Для безопасной live-приёмки добавлен operator-only `executor-replay`: он требует
точные URI и SHA-256 candidate manifest при старте, принимает `candidate`, но не
`stale`, и публикует тот же ограниченный набор action tools без browser/clipboard.
Модель не может выбрать manifest или включить replay внутри активной сессии.

Локально прошли синтаксические проверки, deterministic production/candidate build
и все 41 клиентский unit/contract тест. В том числе проверены
tampering/stale/unknown capability,
нулевое число browser calls при невалидных параметрах, selective invalidation и
отсутствие browser/clipboard tools в `executor-preview`. Первичный sandbox-прогон
не смог открыть loopback-порт четырёх прежних тестов; полный повтор в разрешённой
локальной среде прошёл: **41 из 41**.

Перед live-replay выполнен отдельный фактический smoke-вызов Hermes 0.21.0 с
явными provider/model overrides без изменения постоянной конфигурации: effective
provider `xiaomi`, model `mimo-v2.5`, один API-вызов завершился успешно, fallback
не настроен. Credentials и provider URL в evidence не сохранялись.

Кандидат ещё не опубликован и не считается live-принятым. Не выполнены обязательные
replay и реальные проверки трёх действий на текущем Mac через Hermes с Xiaomi
MiMo 2.5, серверная сборка выпуска, установка, rollback и переключение catalog
`current.json`. До этих проверок чекбоксы live-приёмки и выпуска не закрывать.

## Продолжение MVP после архитектурного разбора 4 сентября

По запросу пользователя рекомендации внесены в раздел 0.1 канонического плана.
MVP сохраняет три встроенных доменных обработчика: серверные данные задают
селекторы, контракты и поддержанные настройки, а изменение алгоритма требует
нового клиентского runtime. Универсальная композиция действий отложена.

В исходниках исправлены проверка результата `link.create`, остановка повторов при
частично созданном динамическом порте и восстановление временного состояния.
Операции получают `operation_id`; повтор того же запроса использует его прежний
результат. Очищенный журнал с синхронизацией на диск записывается до отправки
мутации. При потере ответа дальнейшие изменения блокируются до подтверждённого
reconciliation; отмена запроса не освобождает очередь браузера раньше завершения
действия и cleanup. Этот журнал независим от native-архива беседы.

Подготовка обычной executor-сессии и replay объединена в `dock_prepare`.
Готовность публикуется после проверки target, записи свидетельства и сохранения
сессии. Ошибка подготовки или незавершённая операция не разрешает новые мутации.
Добавлен `dock_workspace_observe` с типизированными ссылками на workflow/узлы и
наблюдаемыми портами/связями. В модели по-прежнему нет raw browser tools.

Сборка каталога по умолчанию создаёт candidate; повторная обработка сохраняет
`stale`. Проверяются полное замыкание зависимостей и равенство provenance SHA.
Production-допуск теперь хранится отдельной replay attestation, связанной с точным
manifest SHA, runtime, сборкой Loginom и обязательными результатами. Проверенные
байты каталога при допуске не переписываются. Все файлы читаются обратно перед
переключением указателя. Это уточняет раннее описание публикации выше.

Точный профиль первого MVP закреплён на frontend
`7.5.0-alpha+build.49202`, macOS и Chromium. Версия подтверждена цепочкой
публичных ресурсов страницы и реальным `dock_prepare`; это версия веб-клиента,
а не отдельное подтверждение версии серверного бинарного файла Loginom.

После интеграции прошли **74/74** локальных клиентских теста на закреплённом
Node.js 24.19.0 и **3/3** проверки состава server-build source snapshot, включая
полный запуск клиентских тестов из изолированного снимка. Это промежуточный
результат до последующих исправлений координат и identity пакета; окончательный
прогон и live-результаты фиксируются отдельно.

Новый чистый replay `20260904-232618-35918ae9` действительно выполнялся через
Hermes 0.21.0 / Xiaomi `mimo-v2.5` и общий `dock_prepare`. Первый `node.add`
создал и переименовал единственный узел, но завершился `AMBIGUOUS`: проверка
ошибочно сравнивала экранные координаты workarea с координатами диаграммы.
Hermes остановил зависимые мутации, затем прочитал фактический граф. Этот прогон
не считается успешной приёмкой. Ошибка потребовала пересчёта origin, scroll,
масштаба и сетки по исходникам Loginom; расширение допуска не использовалось.

Кандидат `2026.09.04-mvp.2-candidate` собран на VPS и прочитан обратно с manifest
SHA-256 `b8fd27f6ce02d925ce903b6a4e2e1dca867e98bf9cb2f7225cd859697685dd3e`.
Он не активирован; изменения контракта проверки пакета требуют нового candidate.
Исходники клиента готовятся как `0.1.0-rc.3`. Публичный выпуск и лендинг пока
остаются на `0.1.0-rc.2`, установленный runtime не переключался.

### Итог приёмки 4–5 сентября

Геометрия `node.add` теперь проверяется в координатах SVG с учётом реального
`cntDiagram`, прокрутки, масштаба и сетки. Для сохранения используется полный
cached `PackageFileName` активного пакета: подпись «Сценарий» является только
диагностикой. Сохраняемые порты могут менять runtime-номера после открытия;
сравнение графа сохраняет направление, вид, количество и числовой ordinal внутри
вида, затем тем же отображением переводит концы связей. Потеря порта, лишний порт,
другая связь или другой ordinal не скрываются нормализацией. Сравнивается
структура графа, а не данные и настройки внутри узлов. Исходники и SHA probes
приведены в [отдельной справке](pinned-ui-probes.md).

По замечанию пользователя о возможном промахе проверены фактические порты.
У нового «Объединения» было два входа данных. `Input_Add` добавил один третий
вход и одну связь к нему; после открытия осталось три входа и одна связь.
Новый trace сохраняет полный baseline/current/delta портов и связей после
каждой попытки, при дополнительном ожидании и перед повтором. В проверенном
прогоне первая попытка не изменила наблюдаемый граф в 562, 738 и 750 мс; после
второй в 2025 мс добавились ровно один порт и одна правильная связь. Это
подтверждение по снимкам, а не вывод из текста ответа Hermes.

Все завершённые прогоны использовали текущий Mac, Hermes 0.21.0,
provider `xiaomi`, model `mimo-v2.5`, frontend `7.5.0-alpha+build.49202`,
Chromium revision `1243`, Playwright `1.63.0-alpha-2026-08-31`.
Общий `clientRevision`, независимо пересчитанный по 39 исходным файлам:
`dc4b8aebcb96efd4d56d5afadd691098520e9cfafc2b247e8e2137653b7611f8`.

| Прогон | Проверенный результат |
| --- | --- |
| `20260904-234810-2e8d5d2f` | Чистый `node.add ×2 → Input_Add → save/close/reopen`; все действия успешны, точный путь и структура подтверждены независимым пересчётом |
| `20260904-234954-ab1da05a` | Стандартная связь, распознавание существующей связи без нового drag, два отказа до эффекта, отказ перезаписи с cleanup и разрешённая замена собственного тестового файла с reopen |
| `20260904-235012-787938db` | Реальный `node.add` успешен; его ответ искусственно потерян; два запроса с одним ID получили `AMBIGUOUS`, в UI остался один узел |
| `20260904-235402-1fb5aa7e` | Два настоящих одинаковых успешных запроса с одним ID, полностью одинаковый результат, один browser apply и один узел |
| `20260904-235147-3e892bf9` | Настоящая MCP-отмена во время apply, завершение действия и mouse cleanup; Hermes отправил запросы последовательно, поэтому конкурентное поступление здесь не проверено |
| `20260905-000205-ba0a5b4c` | Настоящая отмена при одновременно поступивших запросах; максимум один apply, следующий дождался completion/cleanup, оба узла по одному, процесс завершился штатно |
| `20260905-000512-1f3d4c40` | Полный положительный сценарий именно из установленного серверного `rc.3` с его Node и файлами; все действия `SUCCEEDED`, пакет открыт повторно |

В standard-прогоне первый запрос Hermes ошибочно вложил `operation_id` внутрь
`parameters`; запрос отклонён до UI. Затем Hermes пропустил требуемый повтор
успешного ID, поэтому этот пункт был проверен отдельным dedup-прогоном, а не
засчитан по его финальному ответу. В первом cancellation-прогоне финальный ответ
модели задержался после окончания браузерных действий; процесс в итоге завершился
сам с кодом 0, принудительный сигнал не отправлялся. Во втором прогоне первым
фактически пришёл `cancel-node-002`: очередь проверяется по времени поступления,
а не по предполагаемому порядку ID.

Локально и в серверном комплекте прошли **79/79** клиентских тестов. Проверка
состава изолированного source snapshot прошла **3/3** до последнего дополнения
trace; итоговый серверный набор повторно выполнил все актуальные клиентские тесты.
Серверный source snapshot:
`e0a0f243dcf2b64367119227da59b3b4be808f7c7f6936a7aae215eefff2ada3`.
Catalog `2026.09.04-mvp.3-candidate` staged/readback, manifest SHA:
`b0686dee91fe5ed5a748692ebbce9cfc03b704d7a37c7138997b7bdb708c2d09`.

Mac-комплект собран на VPS в
`/opt/loginom-dock/client-build/executor-mvp/candidate-rc3-e0a0f243dcf2/`.
Release ID — `0.1.0-rc.3-743676bf253a`, 3967 файлов, 46 987 977 байт в архиве,
SHA-256 `063b2fa4f04f47e5e40274cb9cee8e37e084b0c6c70620b8a736d6763392b75b`.
Снимок имеет `sourceDirty=true`, базовый commit
`9a9a0bbc43c46685e2dd0af5753bfcc9374700ca`. Все файлы проверены на VPS и повторно
после скачивания. Кратковременный отказ SSH был разрешён повторной проверкой
чтения; способ авторизации и серверные настройки не менялись.

В приватном `runtime-rc3` выполнен настоящий цикл мастера
`rc.2 → rc.3 → rollback rc.2 → rc.3`. Проверены current/previous, неизменность
конфигурации, отдельного постороннего файла состояния и личных файлов настроек
Codex/Hermes. Browser cache скопирован в отдельный каталог перед установкой.
Native-регистрация при этом отключена; личный Dock pointer остался прежним.

Доказательства — в `.dock/executor-mvp-acceptance/`: `positive-audit.json`,
`checks-audit.json`, `cancellation-audit.json`, `bundle-audit.json`,
`install-cycle-report.json`, `server-built/rc3/build-report.json` и очищенные
результаты каждого run. Сводный `acceptance-summary.json` связывает их SHA-256
и фиксирует 83/83 пройденных утверждения независимых аудитов; это локальный итог
приёмки кандидата, а не production attestation.
Они не содержат перенесённых reasoning/system prompts
или browser profiles. Raw Hermes state остаётся только в приватной тестовой среде.

Внутренний executor-кандидат принят. Публичный native release, опубликованный
полный skill и production `current.json` не обновлялись. Для публичного выпуска
требуются чистая ревизия, native-приёмка и допуск точного выпуска; результаты
runtime-only приёмки не подменяют эти шаги.

## Агентное восстановление: итерация 5 сентября

По запросу пользователя три готовых действия дополнены циклом наблюдения,
анализа и исправления. `dock_workspace_observe` возвращает текущие узлы, порты,
связи, диалоги, сообщения и доступные UI controls с временными ссылками.
`dock_ui_action` выполняет один проверяемый жест; `dock_operation_inspect` и
`dock_operation_recover` позволяют разбирать частичный результат и продолжать
работу в исходной сессии. Успех отдельного жеста не подтверждает цель сценария.

Потерянный ответ восстанавливается из фактической квитанции завершённого вызова
на объекте браузерной страницы. Без подтверждения завершения и cleanup другие
изменения не разрешаются. Частичный `Input_Add` можно завершить на уже появившемся
входе, не добавляя ещё один. Общий UI допускает явное принятие проверенного
наблюдения с `goal_verified:false`; постусловия готового domain action таким
способом обойти нельзя. Повтор ID возвращает прежнюю квитанцию.

Уточнение пользователя: автоматическое соединение близко добавленных узлов —
штатное поведение Loginom. `node.add` revision 2 возвращает `SUCCEEDED` с
`auto_created_links`, если проверены один новый узел, имя, координаты и
неизменность прежнего графа. Новые связи допустимы только с участием созданного
узла. Агент сопоставляет их с задачей: сохраняет полезные или удаляет ненужные
обычным UI. Посторонние изменения остаются `AMBIGUOUS`. Новый контракт требует
executor `1.1.0`; старый каталог получает прежнюю схему ответа и не принимает
автосвязь молча.

Для сменившейся цели добавлен `abandon_operation`. После подтверждённого
завершения браузерного вызова и cleanup агент читает свежий UI и явно прекращает
добиваться исходного результата. Повторное чтение сверяет также identity пакета.
Исходная операция остаётся `AMBIGUOUS` с `resolution:abandoned_after_observation`
и `goal_verified:false`; успех recovery подтверждает только запись этого решения.
Эффекты не отменяются, старый ID не исполняется повторно, новая корректировка
выполняется отдельным запросом. Неизвестное завершение, устаревший снимок или
ошибка журнала сохраняют блокировку.

Локально и в промежуточном серверном комплекте прошли **127/127** клиентских
тестов; проверка комплектации — **3/3**.
Включены actual MCP contract, serialized browser capabilities, потерянные
квитанции, частичный порт, исправление имени, stale UI refs, журнал и cleanup,
полезные/ненужные автосвязи, посторонний graph diff и совместимость старого
каталога. Дополнительно проверены удаление связи, попавшей на неправильный вход,
и оставшийся лишний порт после удаления нового узла: такой остаток не считается
`NOT_APPLIED`. UI использует одну DOM-систему измерения геометрии и проверенную
точку клика для SVG. Runtime pin содержит 40 файлов, включая новый
`workspace-ui.mjs`.

Предварительная живая проверка `20260905-005841-c4db84ad` прошла **18/18**
независимых утверждений. Hermes/Xiaomi MiMo 2.5 получил только цель сценария.
После настоящего `Input_Add` операторская вставка удалила только созданную связь,
оставив новый порт. Hermes наблюдал состояние, выполнил UI drag на существующий
вход и сохранил пакет с повторным открытием: два узла, ровно три входа, одна
связь на третий вход. Это подтверждает ремонт в одной сессии. Прогон относится
к промежуточной ревизии до окончательного контракта автосвязей; его нельзя
считать приёмкой финального `rc.4`. Несколько ранних запусков выявили ошибки
доступности tool schemas и были остановлены для исправления; они не засчитаны.

Промежуточный runtime SHA:
`eb20bd90964d45733e94d51a9a53b16c52e108b3689972685e5bb831e05d61bc`.
Catalog `2026.09.05-agent.2-candidate` staged/readback; manifest SHA:
`290c59ed4af9d0861a158d4758ed849e5159a715ff7b1d4d659826b9df36d4b3`.
Он содержит `node.add` revision 2 и требует executor `1.1.0`.

| Живой прогон на промежуточном runtime `eb20…` | Независимый результат |
| --- | --- |
| `20260905-013016-e16f9fa5` | 18/18: частичный Input_Add, осмотр, complete_link на существующем входе, save/reopen |
| `20260905-013016-26d3843a` | 19/19: прерванное имя исправлено через наблюдаемый UI, затем save/reopen |
| `20260905-013019-e2fa63fc` | 19/19: потерянный ответ восстановлен по фактической квитанции, без повторного apply; save/reopen |

Приёмка даёт Hermes цель, не последовательность инструментов. Финальное
наблюдение берётся из отдельного observe либо фактического
`reopened_package_observed` в trace после закрытия и открытия. Предсказание модели
не заменяет наблюдение. Лишние запросы отдельно проверяются по журналу:
preflight-отказ до эффекта не является вторым browser apply.

Раннее ТЗ содержало неоднозначное «с таким же названием». В трёх промежуточных
прогонах Hermes переименовал «Объединение» в «Источник»; это объяснимо формулировкой
операторского задания и **не доказывает ошибку модели**. Задание исправлено на
два явных разных имени; старые prompt SHA, результаты и неуспешные audits сохранены
в `prompt-clarification.json` и истории агрегата. После исправления все три
повторных прогона достигли заданной структуры.

Mac-комплект `0.1.0-rc.4-f59fda764b21` собран на VPS из снимка
`7a2acb1702991e4daafdf9d44377dc024dc5ad9a25fcb977c878c1e7bb378d24`.
Базовый commit `9a9a0bbc43c46685e2dd0af5753bfcc9374700ca`, `sourceDirty=true`.
Архив: 47 029 576 байт, SHA
`ea19c01c4b69582eea0c4a7538598a6bf462905131debcf9b0938372711358f1`;
3973 файла проверены на VPS и после скачивания. Первая серверная проверка
выявила привязку тестовой Mac fixture к ОС хоста; исправлен только тест,
продуктовый запрет неподдерживаемой платформы сохранён. Окончательный suite
прошёл 127/127.

В изолированном `runtime-rc4` выполнен цикл
`rc.2 → rc.4 → rollback rc.2 → rc.4`. Конфигурация, посторонний файл состояния,
личные настройки Codex/Hermes и личный Dock pointer сохранились.
Из установленного комплекта прошли `20260905-013453-ee28aeb2` и
`20260905-013452-12a4881d` — по 22/22 независимых утверждения. Второй прогон
сохранил полезную автосвязь. Когда автоматическое повторное открытие после
сохранения не удалось, Hermes явно выполнил `abandon_operation`, открыл точный
сохранённый файл через наблюдаемый UI и проверил граф. Исходная квитанция
`package.save_as` осталась `AMBIGUOUS`; успех цели подтверждён отдельным наблюдением.

Проверка `20260905-013217-dc9e977c` остановилась на удалении ненужной автосвязи:
центр рамки изогнутой SVG-линии оказался вне самой линии. Исправлен выбор
точки по фактической геометрии SVG с обязательной проверкой принадлежности
точному элементу. Клики сквозь перекрывающий элемент запрещены.
На runtime `540b7389a2d599d59f94941b00e3bf83644d36e11fb005540b55fddd13bd5f8c`
прошли 131/131 тестов и повторные полные сценарии частичной связи
(`20260905-020202-5cf46a41`, 20/20), переименования
(`20260905-020201-3f89bdf5`, 21/21) и потерянного ответа
(`20260905-020202-c35ab595`, 21/21).

Прогон `20260905-020201-f32c778e` подтвердил выбор автосвязи и открытие
подтверждения удаления, но выявил следующий пробел: кнопки штатного messagebox
не попадали в наблюдаемые controls, а фоновая маска блокировала диалог.
Hermes завершился на разрешённой модели, однако цель не достигнута; этот
результат не засчитан. Исправление доступности кнопок и последующая приёмка
зафиксированы ниже.

### Промежуточный кандидат с исправлением диалогов

Добавлено обнаружение кнопок штатного messagebox; сообщения масок читаются
из `bg-mask-text`, а не из текста закрытой ими рабочей области. Явно пустая
фоновая маска допускает только controls верхнего диалога. Настоящая загрузка,
перекрытая кнопка, нижний диалог и фон остаются заблокированными. Исходники
Loginom подтвердили разметку messagebox и отсутствие `href` у штатных кнопок;
защита от навигационных ссылок сохранена. Независимый review не нашёл блокирующих
замечаний в этих границах.

Runtime SHA:
`2cf92bf6d1cce8c25f830584478c02248fa0e20043c66be1fb8c6795fb73fdb1`.
Локально и в серверном комплекте прошли **136/136** тестов, включая **22/22**
проверки ограниченного UI. SHA локального полного отчёта:
`53ab372e164014ebba3a624781938e0db1897604900e7cb89669dcd2071cbab5`.
Catalog `2026.09.05-agent.2-candidate` и его manifest SHA выше не менялись.

Mac-комплект `0.1.0-rc.4-87be3b17d6c1` собран на VPS из снимка
`dc03889d69315864d7931d79caf4b8e684b73ca9fb56b080d3f3ef8b514f9ab1`.
Базовый commit `9a9a0bbc43c46685e2dd0af5753bfcc9374700ca`, `sourceDirty=true`.
Архив: 47 033 925 байт, SHA
`69ea627e8b5428256b54c9d0abe952af6019ff4028bc8441c739d0a8f7bf4ca8`;
release manifest SHA
`87be3b17d6c1e75cb2a3006e77d90c1fbae43b015e6f30b3b96a10399af7b743`.
Все 3973 файла проверены на VPS и после скачивания на текущий Mac.

Из этого комплекта прошли установка/обновление/откат и две полные задачи:
`20260905-022317-742419c7` (22/22, обычный сценарий) и
`20260905-022317-b7d7d6fe` (22/22, сохранение полезной автосвязи).
На том же runtime прошёл явный отказ от прежней цели при несовпадении координат
`20260905-021859-dc0ddd3d` (24/24) с достижением полной цели; частичная связь
`20260905-021900-13e54433` (20/20) и потерянный ответ
`20260905-021859-590b53ac` (21/21) также подтверждены.

Ветви удаления ненужной автосвязи выявили реальный контрпример: фоновая маска
подтверждения может содержать стандартное «Загрузка». Поэтому ограничение
«только пустой текст» ошибочно. Source rename `20260905-021859-32e7810f`
завершился без достижения всей цели (16/21); installed auto-delete
`20260905-022317-f4c24e38` остановлен оператором после доказанного препятствия
(17/27). Эти отрицательные результаты сохранены и не переклассифицированы.

### Исправление штатной фоновой маски

Runtime SHA:
`ca4b9f4cdbf6d46358235147d445a45428b224046cf0074cae16a241d3bdc016`.
Маска теперь сопоставляется с верхним диалогом по DOM, независимо от текста.
Если она принадлежит фону, агент может действовать только внутри этого диалога.
Маска внутри диалога, его маскированный предок и реальное перекрытие точки
нажатия запрещают действие. Штатный default «Загрузка» подтверждён исходниками
Loginom; текст сохраняется в наблюдении. Независимый review проверил эти границы.

Полный локальный suite прошёл **136/136** при последовательном запуске,
SHA отчёта `2e643f20808b5589f7652ceedd65c1e3c5f10dd5e594f559ca87d223725b37c1`.
Предыдущий параллельный запуск завершился SIGSEGV процесса Node в UI test file,
без assertion failure; немедленная отдельная проверка этого файла прошла 22/22.
Исходный журнал сохранён, причина сбоя процесса не установлена; тесты не менялись
для его обхода. Проверка в серверной сборке фиксируется отдельно.

Source goal-only проверка `20260905-022717-affbc8b8` уже выполнила настоящее
удаление автосвязи через подтверждение с текстом фоновой маски «Загрузка»,
создала нужное соединение и сохранила пакет с повторным открытием.
Независимый audit — **22/22**. Проверены исходная `auto_created_links`,
нажатие точной кнопки подтверждения по наблюдаемой ссылке, удаление только
этого ребра без изменения узлов и портов и сохранённый граф с тремя входами,
из которых связан только третий. Прогон исправления имени
`20260905-022716-ec871407` также прошёл **21/21** до сохранения и открытия пакета.

Проверка применимости результатов `2cf92…` к текущему коду выполнена отдельно:
из 40 runtime inputs изменён только `workspace-ui.mjs`, ветка классификации маски
относительно верхнего диалога. Остальные 39 файлов побайтно совпадают. В
сохранённых наблюдениях трёх успешных fault-прогонов (`position`, `partial-link`,
`lost-response`) масок и диалогов нет; изменённая ветка там не задействована.
Это анализ применимости, а не заявление о повторном запуске этих прогонов на
`ca4b…`. Затронутые UI-ветви проверены заново на текущей ревизии.

Текущий Mac-комплект **`0.1.0-rc.4-551644cb00b6`** собран на VPS:

| Свойство | Проверенное значение |
| --- | --- |
| Снимок исходников | `504c3f7f74fe97ebfb278e7c5f21914a176c64912ff62cacfbc689a59ed698f0` |
| Базовый commit | `9a9a0bbc43c46685e2dd0af5753bfcc9374700ca`, `sourceDirty=true` |
| Архив | 47 034 170 байт; SHA `4da3dbc7ea0511f49b4f25cdcd42b9120bb0797b7074620cbf01d8fc7751552f` |
| Release manifest SHA | `551644cb00b6082649682b4f1dde36f82fd37f7aef3b5ee859c39f4f3203a705` |
| Содержимое | 3973 файла проверены на VPS и после скачивания |
| Проверки внутри серверного комплекта | 136/136, без пропусков и отмен |
| Изолированная установка | `rc.2 → rc.4 → rollback rc.2 → rc.4`; настройки и личный Dock pointer сохранены |

Итоговые live-проверки из установленного `runtime-rc4-modal` прошли:

| Прогон | Независимый результат |
| --- | --- |
| `20260905-023332-2f8ccc7a` | 22/22: два узла, три входа, одна связь на третий вход, сохранение и повторное открытие |
| `20260905-023333-f1f2dcfc` | 27/27: полезная штатная автосвязь сохранена, два входа без лишнего порта, save/reopen |
| `20260905-023332-9a5f13c9` | 27/27: ненужная автосвязь удалена через обычный UI, сохранены узлы/порты, создана единственная связь на третий вход, save/reopen |

Все прогоны использовали Hermes 0.21.0 с фактическими provider `xiaomi` и model
`mimo-v2.5` на текущем Mac, Loginom `7.5.0-alpha+build.49202`. Задания задавали
цель, а не последовательность tools. Audits отдельно проверили фактические Node,
entry point, runtime pin и все файлы установленного комплекта. На текущем pin
прошли пять полных задач: две source и три installed, **119/119** утверждений.
Три прежние source проверки восстановления дают ещё **65/65** утверждений на
`2cf92…`, с отдельным анализом применимости неизменённых механизмов к текущему коду.

Рекомендации и MVP-расширение реализованы: ошибка отдельного шага стала входом
для наблюдения и исправления агентом в той же сессии. Штатная автосвязь считается
наблюдаемым эффектом, который агент сопоставляет с целью. Это подтверждение
конкретных проверенных задач; неизвестное завершение или неподтверждённый cleanup
по-прежнему оставляют блокировку.

Приватный итог `independent-source-acceptance-summary.json` и его копия
`independent-final-acceptance-summary.json` имеют SHA
`5e2bdc6f977234bc9425f5d0987ab89544ff5846c5dacbe2f4c94b66e83b1f17`.
Он связывает hashes аудитов, серверной сборки, установки и тестов; ранние
неуспешные результаты сохранены отдельно. Финальная сверка подтвердила
совпадение 157 файлов снимка с текущими build inputs и всех 40 runtime inputs
между рабочей копией и установленным комплектом. Runtime-only кандидат готов для дальнейшей подготовки
публичного выпуска. Новый native release, полный server skill и production
`current.json` не опубликованы; публичный клиент остаётся `0.1.0-rc.2`.
Приватные доказательства находятся в `.dock/agent-recovery-acceptance/`.
Native release, публикация полного skill и production `current.json` не выполнялись.

## Реализовано в исходниках

- Этап 1: добавлены `AGENTS.md`, архитектура, README Dock и руководство разработки.
  Исходный README, AGPL-3.0 и upstream copyright сохранены.
- Studio: название Dock в оболочке, локализациях, вкладке браузера и PWA;
  новый SVG-значок и браузерные иконки; ссылки на проект Dock, атрибуция OpenViking.
- API/MCP: изменены продуктовые метаданные; сохранены все 15 MCP tool signatures,
  API-маршруты, внутренние имена и заголовки.
- Compose: сборка собственного образа из checkout, строгий lock-файл, OCI-метаданные,
  отдельное хранилище Dock и локальный proxy. Личный `~/.openviking` не монтируется.
- Credentials и локальный state исключены из Git и Docker build context.
- Этап 2 завершён: штатные Assets catalog/manifest, фиксированные `to` URI,
  явные обновления (`watch_interval: 0`) и полный аудит трёх импортированных репозиториев.

Upstream memory plugins остаются примерами: native-пакеты Dock с отдельным
credential namespace и активацией архива создаются в этапах 3–6. Их брендирование
и релизные артефакты не считаются завершёнными на этапе базового интерфейса.

## Проверки

- Production-сборка Studio с base `/studio/` прошла.
- Браузерная проверка подтвердила заголовок Loginom Dock, значок, навигацию,
  атрибуцию и ссылки в существующей тёмной теме; API-сервер при этом не подключался.
- Проверены синтаксис Compose, shell bootstrap и Python-файлов; `git diff --check`.
- Статическое сравнение MCP до/после подтвердило сохранение 15 сигнатур tools.
- Первый запуск Studio suites: 265 из 268 тестов прошли; три теста столкнулись с
  конфликтом экспериментального Node.js Web Storage и jsdom. Повтор этих трёх
  с `NODE_OPTIONS=--no-experimental-webstorage` прошёл, без изменений тестов.
  Затем полный повтор: **58 файлов, 268 тестов — все прошли**.

## Сервер: проверенный результат

По указанию пользователя сборка выполнена на VPS **82.22.23.10**, локальная
контейнерная сборка остановлена. Пользователь разрешил установку всех необходимых
компонентов. Read-only preflight подтвердил Ubuntu 24.04.4, x86_64, 3 CPU,
около 4 GiB RAM, исходно 94 GiB свободного диска и отсутствие Docker/других сервисов.

Установлены Docker Engine **29.7.2**, Compose **5.5.0**, Buildx **0.36.1** из
официального репозитория; Docker запускается автоматически. Для нативной компиляции
добавлен swap 4 GiB. Password-based SSH не менялся на ключевой доступ.

Первый снимок `dfce78ad` успешно собрал Rust, C++ и Studio. Итоговый образ дополнен
Git LFS и OpenSSH client; повторная сборка использовала кэш нативных компонентов.

| Артефакт | Проверенное значение |
| --- | --- |
| Снимок исходников | `/opt/loginom-dock/releases/20260902-stage1-e725ed87/src` |
| SHA-256 архива (4019 файлов) | `e725ed878cba5d07b90b61417c80d4cc979dadf38194bc5b05fedf7af6471b43` |
| Образ | `loginom-dock:stage1-e725ed87` |
| Image ID | `sha256:26963f30bf34ee2251de390e754fba52307f72856a5622b29438459d93d28c52` |
| OCI revision | `bbc1f9bab00e8255e8d73b138607126c595dde06-dirty-e725ed87` |
| Версия разработки | `0.1.0.dev0` — не опубликованный релиз |
| Studio | <https://loginom.duckdns.org/studio/> |
| MCP | <https://loginom.duckdns.org/mcp> |

В снимок не попали `.env`, `.dock`, `.git`, локальные зависимости и credentials.
Позднее добавленные эксплуатационные проверки и backup-скрипт развёрнуты отдельно
в `/opt/loginom-dock/tools`; они не меняют код собранного приложения.

Запущены приложение, Caddy и Ollama. Наружу открыты 80/443; API опубликован на
loopback, Ollama — только внутри Docker-сети. Caddy получил действующий сертификат
Let's Encrypt. Образы Caddy и Ollama закреплены digest в конфигурации.

Создан отдельный конфиг `/opt/loginom-dock/config/ov.conf` (0600) и новый root key.
Параметры моделей прочитаны из активного OpenViking на `151.244.228.56` через
существующее подключение XPipe. Перенесены только параметры провайдеров, без
личного хранилища, истории и ключей сервера исходного OpenViking.

| Компонент | Проверенная модель |
| --- | --- |
| Embedding | `voyageai/voyage-4`, 1024 измерения, OpenRouter |
| VLM | `qwen/qwen3.7-flash`, OpenRouter |
| Rerank | `voyageai/rerank-2.5-lite`, OpenRouter |
| Query planner | `guoxuter/ov_intent_analysis_sft:v7_q8`, Ollama, model ID `5e0d6bb12290` |

Все четыре компонента ответили на реальные запросы с VPS. Запрос планировщика
с отключённым thinking и лимитом 256 токенов занял около 36 секунд; это проверка
доступности, а не приёмка качества планирования или нагрузки.

Общий account/user — **loginom-dock**, клиент имеет роль **user**. Его ключ
сохранён в защищённом серверном `client.json` и локальном `.dock/client.json`.
Root/admin key клиенту не выдаётся. Повторный bootstrap не изменил байты клиентского
файла. Политика клиента разрешает events/experiences (включая cases/trajectories),
без profile/identity/preferences и working memory. У технического `dock-admin`
выключено извлечение памяти. На этом раннем этапе клиентский архив и `dock_prepare` ещё не были реализованы; текущая приёмка приведена ниже.

В ходе live-проверки обнаружена особенность upstream: AGFS readiness без контекста
использует штатную default identity. Поэтому внутренние `default_account`/
`default_user` сохранены со стандартными значениями; общий аккаунт выбирается
клиентским ключом. После коррекции конфигурации `/ready` вернул 200: AGFS,
VectorDB, key manager, embedding и Ollama работают. Root key в режиме `api_key`
не допускается к tenant data; импорт выполняется ключом администратора аккаунта.

Подтверждены:

- HTTPS, readiness, обычные права клиента, запрет admin API для клиента,
  отказ без ключа и с неверным ключом, MCP initialization и **15 tools**.
- Сервер отдаёт HTML Studio и SVG-значок по HTTPS. Встроенный браузер Codex
  заблокировал открытие домена (`ERR_BLOCKED_BY_CLIENT`); серверная визуальная
  проверка не засчитывается. Локальная визуальная проверка той же Studio прошла ранее.
- Git LFS 3.6.1 и системный smudge filter присутствуют внутри образа.
- Синтетический документ импортирован в
  `viking://resources/loginom-dock/verification/server-smoke`: одна semantic-задача,
  три embedding-задачи, без ошибок. Клиент нашёл исходный файл и прочитал текст.
  Это диагностический fixture, не доказательство полноты импорта Git-источников.
- Сессия `dock-deployment-03562533265b` создана обычным клиентом, сообщение записано
  и прочитано. Извлечение памяти в этой диагностической сессии отключено.
- Холодная копия данных и конфигов создана в
  `/opt/loginom-dock/backups/20260902T165140Z`; контрольные суммы проверены.
  В отдельном контейнере без внешних портов восстановлены identity, исходный
  документ, поиск по индексу и сессия. Проверочный контейнер остановлен.
  Основной сервер после backup/start снова прошёл полную проверку API/MCP.

## Источники: завершённая live-приёмка

С машины с VPN проверен Git-доступ к всем трём репозиториям через существующие
Git credentials. Не менялись права GitLab или способ авторизации. Наблюдаемые
ревизии `master`:

- ai-skills: `51ce567d1e7c168f87277bc24fa48c522e333356`;
- e2e-tests: `2cad5602158fd2e4836d821d644a2b8d92f571a2`;
- loginom-help: `353e506ba04b77a2926d8ddf8472b36c684b67fd`.

Продолжение этапа 2: закрытый reverse SSH-маршрут поднят через Unix socket. Caddy
во внутренней Docker-сети предоставляет HTTPS `git.basegroup.ru`; доверие к его CA
настроено явно. Авторизация осталась существующей username/password через штатный
`args.auth_config`. Из контейнера подтверждён `ls-remote` всех трёх репозиториев.
LFS batch и фактическая загрузка двух объектов проверены по SHA-256. Старый GitLab
возвращал HTTP download URL; транспортный адаптер исправляет только origin на тот
же проверенный HTTPS-хост. Gateway не публикует сетевые порты.

Подготовлено сохранение оригиналов в `.source/` и `.source-manifest.json` внутри
штатного ресурса, включая dotfiles, двоичные, пустые и большие файлы без изменения
кодировок. Обычное поисковое представление сохраняется отдельно. Для Dock расширения
`.lgp`, `.lgd`, `.svg`, `.ai`, `.sketch` исключаются только из текстовой индексации.
Узкое дополнение синхронизации переносит скрытые оригиналы при обновлении ресурса.
**70 серверных тестов и 3 теста LFS-адаптера прошли.**

Независимый inventory из актуальных Git objects выбранных commits содержит:
11 файлов ai-skills, 2872 файла e2e-tests (818 LFS), 3007 файлов справки (142 LFS).
Всего 623 481 609 байт оригиналов. В e2e-tests также зафиксирован Git link `ci/common`
на `bbdd0ab231f2e0f007d75a2583e0e22c08b2ef85`; содержимое отдельного CI-репозитория
не является файлами текущей ревизии e2e-tests и автоматически не импортируется.
Обычный клиент скачал **все 5 890 файлов / 623 481 609 байт**, включая **960 LFS**,
и SHA-256 каждого файла совпал с независимым baseline. Отчёт сохранён в
`/opt/loginom-dock/assets/source-audit.json`; итоговый импорт завершился с кодом 0.

Образ, завершивший этап 2, — **`loginom-dock:stage2-lfs-da77d862`**, image ID
`sha256:e7cc06e94dd12985ca6d4f016b85d14e104679908a0d1f9b7640fcbb3882e00d`.
Снимок исходников: `/opt/loginom-dock/releases/20260902-stage1-da77d862/src`,
4 043 файла, SHA-256 архива
`da77d8620d08396292dfc57cf79db8419ee9f7acd140faf0846a628a9f84508d`.
Исторический префикс `stage1` — соглашение упаковщика, не номер готового этапа.
Образ собран на VPS поверх проверенного `loginom-dock:stage2-b2975a94` с заменой
только GitAccessor; нативные компоненты и Studio не менялись. SHA файла внутри
образа сверён со снимком исходников. Старые образы сохранены для отката.

Две особенности Git LFS исправлены по наблюдаемым отказам:

- Git extraHeader и GitLab download action дублировали Authorization. Собственный
  gitconfig сбрасывает extraHeader только для точных LFS object-путей трёх репозиториев.
  Git и batch сохраняют авторизацию; системные LFS filters сохранены.
- В справке 10 `.PNG` не соответствовали нижнему регистру в `.gitattributes`.
  В режиме сохранения оригиналов GitAccessor получает список native `git lfs ls-files`,
  временно добавляет точные нераскрытые пути в `.git/info/attributes`, выполняет
  native `git lfs pull` и восстанавливает локальный attributes. Коммитнутые файлы
  не меняются. Снимок исходников дополнительно отклоняет оставшиеся pointers.

**87 тестов GitAccessor прошли**, включая настоящий Git/LFS fixture, специальные
символы в пути и восстановление attributes. Ruff и `git diff --check` прошли.
Для справки использован точечный повтор через тот же Assets importer и стабильный
URI. У него собственный native State; основной State обновит этот источник при
следующем полном импорте. Отдельного импортёра или ручного редактирования State нет.
Повторная синхронизация ai-skills проверена, но live-обновление изменённого Git commit
со скрытым файлом пока не проверялось.

Туннель GitLab закрыт после импорта. При недоступном gateway (502) прошли две
естественные поисковые задачи (связь портов и вычисление полей), точный grep
`nodeLabel` и полное чтение четырёх исходников. Natural-language результаты
содержат правильный helper/раздел первым; точный поиск идентификатора проверяется
штатным grep. Широкий semantic search может ранжировать примеры выше каталога.
Отчёт: `/opt/loginom-dock/assets/offline-source-search.json`.

Новая холодная копия `/opt/loginom-dock/backups/20260902T190800Z` содержит данные,
конфигурацию и Assets. Контрольные суммы архивов проверены. В отдельный volume
восстановлены общий аккаунт, диагностическая сессия, **все 5 890 файлов с повторной
проверкой хешей**, поиск и чтение. Отчёты находятся в `restore-check/source-audit.json`
и `restore-check/source-search.json` внутри копии. Проверочный контейнер
`loginom-dock-restore-sources` остановлен. Основной сервер после backup/start
прошёл API/MCP-проверку. Это не полная аварийная копия VPS: Docker layers, модель
Ollama, ACME и исходники эксплуатационных инструментов требуют отдельного восстановления.

## Локальный клиент и реальный Loginom

В `client/` реализован общий MCP SDK server: HTTPS Dock, дочерний Playwright MCP,
проверка коллизий и закреплённый каталог. Credentials читаются только из явного
защищённого конфига Dock. Каждый запуск получает собственные UUID, профиль и
артефакты; фиксируются runtime, adapter, клиентский SHA-256 и каталог tools.

Проверенный комплект: Node 22.22.2 (ранний прототип; текущий runtime 24.19.0), MCP SDK 1.30.0, Playwright MCP 0.0.80,
Playwright 1.63.0-alpha-2026-08-31, Chromium 153.0.8010.12 (revision 1243).
Browser/runtime размещены в каталоге Dock. В каталоге прототипа подтверждены
**15 tools Dock + 30 browser tools + диагностика + clipboard transfer = 47**.
После добавления `dock_prepare` живой SDK-клиент подтвердил **48 инструментов**.

`dock_clipboard_transfer` удерживает общую для Dock-клиентов машины kernel-блокировку
(локальный порт 46419) от copy до подтверждённого paste. При неопределённом
завершении браузерной операции она сохраняется до остановки браузера; отмена
ожидающего клиента не снимает чужую блокировку. **9 исходных клиентских тестов прошли**,
включая межпроцессную конкуренцию и аварийное освобождение. Два одновременно
запущенных Chromium с разными профилями перенесли разные строки через настоящий
системный clipboard без перемешивания.

На `dev-test.bg.local` через клиент Dock в видимом окне подтверждены:

- Добавление двух калькуляторов из палитры настоящими mouse move/down/up.
  Мгновенный drag tool не создавал узел; промежуточные шаги мыши работают.
- Реальная связь выходного и входного портов, подтверждённая DOM и изображением.
- Save As `Dock-prototype-20260902-1839.lgp`, закрытие и повторное открытие с
  сохранёнными узлами и связью. ID узлов после открытия изменились, как ожидается.
- Копирование калькулятора из сохранённого источника в отдельный черновик через
  `dock_clipboard_transfer`, с подтверждением целевого DOM. Кнопки выбираются
  по точному префиксу вкладки: неактивный DOM тоже может считаться visible.

Это SDK-клиенты с явным типом агента, а не полноценная приёмка двух native-агентов.
Калькуляторы в данном сценарии не настраивались и не выполнялись. Загрузка малого
fixture, настройка, вычисление, preview и дополнительные диалоги остаются в приёмке.

## Адаптированный skill и подготовка сессии

Общая адаптация хранится в `skills/loginom-automation`: основной skill и четыре
reference-файла. Убраны обязательные локальные checkout и Context7; добавлены
scoped поиск, exact lookup, исходные URI/commit, активная вкладка, проверенный drag,
общая clipboard-операция и Save As с повторным открытием/скачиванием. Валидатор
skill прошёл. Оригинальный ресурс ai-skills сохранён.

`dock_prepare` использует существующие Skills API и content/download. Полный пакет
проверяется по manifest/revision/SHA-256/размерам и безопасным путям, загружается в
временный собственный каталог, проверяется повторным manifest и активируется
атомарно. Основные инструкции возвращаются прямо в текущий контекст. Повторный
вызов сохраняет ревизию и проверяет локальную целостность. Пять дополнительных
тестов проверяют повреждение, гонку обновления, traversal/case collisions,
symlink/tampering, ограничения загрузки; **всего 14 клиентских тестов прошли**.
Публикация и live-доставка обычному клиенту прошли: 8 manifest entries, 5 исходных
файлов. Ревизия `713eecf5b937619a072e8efb8805fc154d8aa0704a61dac65777093c4c011b21`,
SHA-256 ZIP `92c66ef07aaf921a3d6ca6af2ab242e9bd791094ba80abaf8f5cd1c04ff82a64`.
Skills API штатно форматирует YAML-заголовок и крайние пробелы основного файла;
заголовок и весь body сверены по содержанию, references — по точным хешам.
Клиент проверяет точные хеши опубликованного пакета. Повторный prepare сохранил
ревизию, чтение источников и запуск Chromium после подготовки прошли.

Созданы native-оболочки Codex/Hermes с bootstrap skills и hooks, добавлена запись
Dock в repository marketplace. Каталог форка называется `loginom-dock`, чтобы
не подменять уже установленный upstream-каталог `openviking`; upstream-запись сохранена. Оба пакета установлены штатными менеджерами агентов и подключены к собственному
runtime Dock; результаты первичной приёмки приведены ниже. У Hermes проверены
register_skill/register_system_prompt_section/register_hook в установленной ревизии
`1cb3ab617363ffab9e55239a7d2ab0d6f9c10473`; личный memory.provider не менялся.

Реализованы собственная SQLite-очередь, очистка до записи и перед HTTP, повтор с
теми же delivery identities, ограниченный retry worker и commit после завершения
хода. Hooks сверяют подготовку с локальным session manifest и читают только
активированную историю; Hermes compression lineage проверяется через read-only DB.
Нативная интеграция пока не прошла полный сценарий на двух агентах.
**21 клиентский тест прошёл** на Node 24.19.0, включая hooks, очистку, повторную
доставку, атомарное обновление и откат runtime. SDK smoke с этой версией Node
получил 48 tools, полный skill, прочитал серверный источник и запустил Chromium.
Для API сообщений добавлен необязательный `deduplication_key`: дедупликация под
существующей session/commit блокировкой, включая архивные сообщения, без изменения
формата Message/storage. Новые проверки конкуренции, commit/retry, отдельных
сессий и split tool results прошли. В полном серверном файле — 49 passed, 5 failed;
те же пять падений воспроизведены на неизменённых Python-файлах прежнего образа:
legacy URI и четыре ожидания прежних auto-commit defaults. Они не вызваны доставкой.

Первая серверная версия архива собрана на VPS и развёрнута:
`loginom-dock:archive-82187966`, image ID
`sha256:0955a9fccfc36b189dabd3ed04e21f448d9f354285319c6940b1b2c75d3d7279`.
Проверки HTTPS, ролей, аутентификации и 15 удалённых MCP tools прошли.
Диагностическая сессия `dock-177e6a9685fb90f05db3dbfbd967ed71c510ca3d7785ff19`
содержит одно очищенное сообщение. Четыре одновременных повтора и повтор после
commit добавили 0 сообщений. Очередь пуста; контрольный секрет отсутствует
в исходном серверном `messages.jsonl`. `.done` подтверждает окончание серверной
обработки. Это проверка транспорта, а не архив настоящей задачи агента.

Live-проверка выявила прежний 404 в API просмотра завершённого архива при
`working_memory.enabled=false`: сообщения сохранены, но обязательная сводка
ошибочно требовалась при чтении. Исправление развёрнуто; проверки архива с
включённой/выключенной рабочей памятью и доставки дали **5 passed**. Дополнительно
проверена неизменность группы split tool results при повторе с другим числом частей.
Текущий образ — `loginom-dock:archive-66f72724`, image ID
`sha256:b3b3c7d17578cf3fe1a44ca7ccb4aa479064f265a7c2c101ba88d77501512675`.
Обычный клиент прочитал завершённый архив через исправленный API.

Мастер и упаковщик самостоятельных пакетов macOS arm64/Linux x64 подготовлены.
Официальный Linux Node 24.19.0 получен из закреплённого Docker image
`node@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`;
macOS Node той же версии взят из установленной среды Codex, проверен запуском и
отсутствием Homebrew-зависимостей. Сборка комплектов выполняется на VPS. Первая
попытка обнаружила исключение `client/lib` общим Git-ignore правилом `lib/`;
для исходников клиента добавлено точное исключение. Пакеты пока не опубликованы.

## Первичная приёмка native-плагинов

На macOS штатно установлен Codex plugin `loginom-dock@loginom-dock`; пользователь
подтвердил все шесть обработчиков, `hooks/list` показал `trusted`. Решения о доверии
не изменялись программно. Подключение вернуло 48 инструментов. Новая задача
`01a063e3-ddd7-72b1-a2fa-9f83627afe0a` выполнила prepare, чтение ресурса,
диагностику и запуск браузера; `archiveActive=true`.

Hermes 0.21.0 установил native-пакет из отдельного локального Git-fixture с SHA
`b606515d80ed412ea768c6203bae2277eb5c1de5` и зарегистрировал одно MCP-подключение.
Это проверка штатного pinned/subdirectory механизма, ещё не публичный релиз.
`plugins doctor` прошёл без предупреждений. Сравнение конфигурации подтвердило
сохранение всех не относящихся к Dock параметров и `memory.provider`.
В сессии `20260902_235115_c70ad3` prepare/read/browser прошли, архив активировался.
Модель `qwen/qwen3.7-flash` задавалась только для приёмочного запуска: сохранённая
модель Hermes отсутствовала, из-за чего первый запуск получил ошибку провайдера.

Проверка выявила два отличия реального транспорта от fixtures: Hermes оборачивает
результат MCP и соединяет текстовые блоки; повторное создание серверной сессии
возвращает HTTP 409. Парсер receipt учитывает обёртку, доставка проверяет точную
существующую сессию и её политику. Штатное раскрытие `experiences` в `cases` и
`trajectories` учтено; личные типы памяти не разрешаются. Все **40 событий** двух
первых native-проверок доставлены, очередь и ожидающие commit опустели.

Runtime устанавливается в `~/.loginom-dock/releases`, credentials и browser cache —
в собственных каталогах Dock. Chromium действительно загружен установщиком.
Сервер собрал кандидаты macOS arm64/Linux x64; файловые manifest и 21 тест прошли
на обеих платформах. Установленные кандидаты имеют признак dirty source и пока
не являются опубликованными версиями. Архивы обеих smoke-сессий дополнительно прочитаны с сервера обычным ключом:
18 сообщений Hermes и 22 сообщения Codex, один завершённый архив на каждую,
уникальные ID и правильная политика памяти. Контрольные строки следующих
native-задач отсутствуют в SQLite до отправки.

Полный Loginom-сценарий проверяется отдельно. Первый запуск обоих агентов дошёл
до формы входа; уточнён штатный тестовый вход из исходного skill. Добавлена
маршрутизация hooks в immutable runtime подготовленной сессии при обновлении;
повреждённая или подменённая версия не исполняется. 22 клиентских теста прошли
на macOS/Linux. Live-проверка обновления посреди сессии Codex подтвердила сохранение прежней
версии `0.1.0-dev.0-fedde70e4162` при новой активной установке
`0.1.0-dev.0-b94945a6ff8b`; capture и доставка продолжились.

Текущий кандидат клиента построен из `1af32a61473f918ec127dd40093456aa48018cecdc5644626022f9969f4cb4cf`:
macOS SHA-256 `7fdef69d6d978182d1d6516d41476437985879cce6517735039a4c7644fa85df`,
Linux SHA-256 `a4de8e8d80d9f8e54bb3f2a395952978c1c0ca2966cede7483d34f184bb44374`.
**24 теста прошли на обеих платформах.** Новая диагностика проверила live сервер,
три manifests источников, целостность skill и HTTP-доступность Loginom; проверка
страницы явно не выдаётся за авторизацию. Мастер проверяет версию агента и убирает
временный credential-файл при ошибке. Native-пакет Hermes обновлён через менеджер
из тестового SHA `ea6952c123c06c152a7ae5692bf2bab351e73366`: добавлены примеры
Tool Search arguments и указание сохранять браузер Dock. Личные настройки не менялись.

Флаг Hermes `-z` в этой версии запускает отдельный oneshot и не передаёт resume:
проверка настоящего resume перенесена на `hermes chat --resume … --query-file -`.
Один из запусков остановлен после попытки модели использовать личный Browser Use;
такой запуск не засчитывается как успешная сквозная приёмка. Следующая проверка
ограничена tools Dock/file/skills только на этот процесс.

Codex завершил полный native-сценарий в сессии `01a063e9-7854-7e62-8f66-8044d0a29138`:
CSV импортирован, реальный drag создал связь, вычислены три значения 20/15/28,
пакет `Dock-codex-acceptance-20260903.lgp` сохранён и повторно открыт.
Повторная проверка исправила подпись поля: имя и подпись — `amount`. Пакет снова
сохранён и открыт; финальный скриншот вручную проверен и подтверждает 20/15/28.
Hermes аналогичную полную приёмку пока не прошёл. Уточнены правила выбора канвы,
проверки узлов по data-tid и копирования fixture в разрешённые artifacts.
Опубликованный skill проверен через manifest/read-back: ревизия
`afa295bf48dc48da5d3c995665a06ef2190ff620bae3243d46557e0371536790`,
ZIP SHA-256 `648b6893d10db335869e2f0eb2b84a5c0e6b30ef66a968bd37da6b213a014f11`.
Добавлены последовательное выполнение зависимых UI-действий, работа с активной
вкладкой и подтверждение выбора файла после загрузки.

Мастер устраняет конфликт Codex marketplace при обновлении, регистрирует Hermes
через штатный config CLI, откатывает native-регистрацию и удаляет только Dock.
28 клиентских тестов прошли локально. Реальные команды Codex update/restore/uninstall
проверены в отдельном профиле, update/rollback — также в основной установке.
Все шесть hooks остались доверенными. Hermes install/update/rollback/uninstall
прошли в отдельном профиле с двумя закреплёнными local Git revisions; личная память,
чужое MCP-подключение и plugin flags сохранены. Проверка выявила сообщение
`config get` об отсутствующем ключе в stderr; обработчик и регрессионный тест исправлены.
Установленный runtime `0.1.0-dev.0-a3d6cfc53a49` построен на VPS из снимка
`0097d259916107cb417b7c923a9d13343464796f40b69045934b80de57dd12b6`;
последующие исправления и диагностика возраста очереди собираются отдельно.

## Страница подключения и эксплуатационные дополнения

Подготовлена `/studio/connect`: выбор Codex/Hermes, шаги мастера, адрес Dock,
объяснение общей истории и локальных профилей. Пока release manifest пуст,
страница показывает приёмочный статус и не предлагает несуществующие загрузки.
Серверная production-сборка и визуальная проверка переключения Codex/Hermes прошли.
Образ `loginom-dock:studio-e868ec34` имеет ID
`sha256:42aa2150f07fbbc636547606e92be8d7ae7408bf0c733de17dee8cca5c9ebfc9`;
он переключён в production; HTTPS, readiness, обычный ключ и 15 серверных MCP tools проверены после переключения. Кандидат проверен в локальном preview именно
серверных assets, без локальной повторной сборки.

Подготовлены системные таймеры мониторинга (5 минут) и копирования (05:00 Москва),
а также расширение backup на образы Docker, Ollama, Caddy, исходники и инструменты.
Монитор установлен и включён; живые проверки API, очередей, моделей, файловой системы и диска прошли. Ежедневный backup timer установлен и включён на 05:00 Europe/Moscow.

Полная холодная копия `/opt/loginom-dock/backups/20260902T220114Z` включает пять
томов, четыре уникальных Docker image, credentials/config, assets, исходники и
инструменты. Из неё восстановлены пять сервисов и пять томов в изолированной
среде `dock-restore-full-20260903`, только на loopback-портах. Проверены:

- действующий HTTPS-сертификат, роли, неверный ключ, 15 MCP tools;
- все 5890 исходных файлов и 960 LFS-объектов по SHA-256;
- поиск, точное чтение и архивы Codex/Hermes без повторяющихся ID;
- реальный ответ восстановленной Ollama (32 токена);
- возврат к предыдущему `archive-66f72724`, API/MCP и чтение архива, затем
  возвращение текущего образа. Все действия ограничивались восстановленной средой.

Пять проверочных контейнеров остановлены; тома оставлены для диагностики.
Внешняя копия получена на Mac: `.dock/backups/20260902T220114Z.tar`, 5195182080 байт,
права 0600, SHA-256 `6c31ab612e3ea79d076aba7da361b31e45963d0970e99af06e34015598feffcf`.
Её полная контрольная сумма совпала с серверной.

## Проверки продолжения 3 сентября

Кандидат клиента `ff6089c38ea5e8ae874f838943a28c4958be1171fec84a47c93d57a516912063`
собран на VPS, по 3940 файлов в комплекте. Все 28 тестов прошли на Linux x64 и
macOS arm64; macOS установлен как `0.1.0-dev.0-b484ede3e746`. SHA-256 комплектов:

- macOS: `e0b9ab7d6748d387791eaca8f0fd38e921582f346c8bc6dc64e2dbc01f8c10de`;
- Linux: `5b41247824ec5e4474576762949787e1f7261da870e6ef0483b3fcc67d0de85e`.

После обновления все шесть Codex hooks остались `trusted`; повторное разрешение
не требовалось. Диагностика подтвердила Dock, три источника, skill и страницу Loginom.

Hermes `20260903_012802_cb3686` создал отдельный пакет
`Dock-hermes-acceptance-final-0129.lgp`, загрузил CSV и подтвердил preview трёх
строк. Завершение мастера, калькулятор, drag-связь, выполнение и save/reopen не
подтверждены. После ошибки удалённого чтения при перезапуске сервера и повторных
таймаутов скрытой кнопки Hermes включил временную блокировку MCP после трёх
ошибок. Этот запуск не засчитывается как полный успех. При следующей проверке
нужно дождаться восстановления подключения и заново снять состояние активной
вкладки; не повторять клик по скрытому DOM. Приёмочные процессы завершились.

Встроенное извлечение памяти ошибочно представило требования к Hermes как уже
выполненные действия. Запись `loginom_dock_acceptance_test.md` прочитана, исправлена
через native content API и проверена чтением и поиском; добавлена ссылка на архив
проверяемой сессии. Удаления памяти не выполнялись. Через штатный
`memory.custom_templates_dir` включён Dock-шаблон events с разделением требований,
блокеров и наблюдаемых результатов и ID исходных сообщений. Тип, поля и URI
OpenViking сохранены; четыре template tests прошли на сервере.

Live-регрессия `dock-memory-regression-05c1b95bf979` дала одну запись
`memoryprobe_acceptance_blocked.md`: запрос импорта/вычисления/сохранения и следующий
отказ записаны как заблокированная работа без ложного успеха, с обоими исходными
сообщениями. Это проверка конкретного примера; память всё равно требует сверки
с источниками и UI. Персональные типы памяти не включались.

Для запуска Hermes временно использован предоставленный пользователем OpenRouter
ключ через аргумент Python entry point в памяти процесса; личный `.env` и модель
Hermes не менялись, ключ не помещался в OS command arguments или prompt. На ключе
установлен лимит $5; запрошено увеличение бюджета, остаток сохранён для Dock.
Публичная публикация отдельно ожидает восстановления GitHub CLI авторизации.

После resume и реального compaction Codex сервер отдал 485 сообщений в 7 архивах;
две последние сессии Hermes — 256 сообщений в 4 архивах и 140 в 2. Все 881 события
доставлены, ID уникальны, обычный ключ читает архивы, контрольные секреты отсутствуют.
Сравнение серверного числа сообщений с локальной очередью совпало для каждой сессии.

Hermes `20260903_014032_f81bc8` отдельно прошёл проверку общей памяти: через
своё native-подключение нашёл и прочитал `codex_package_saved.md`, затем обнаружил
фактический `history/archive_007/messages.jsonl` сессии Codex и прочитал его.
Отчёт подтверждает `own_agent=hermes`, `observed_source_agent=codex`, оба чтения
успешны, препятствий нет. Чтение чужого результата не засчитано как выполнение
сценария Hermes. Личная память не использовалась.

Linux x64 отдельно проверен в одноразовом контейнере: установлены системные
библиотеки и Chromium revision 1243, открыт `about:blank`, получена версия
153.0.8010.12, браузер штатно закрыт. Задачи Loginom на сервере не выполнялись.
Установщик дополнен реальным запуском Chromium после загрузки и сообщением о
недостающих Linux-библиотеках. Диагностика отдельно проверяет графическое окружение
Linux, не приравнивая DISPLAY/Wayland к успешной авторизации или запуску UI.

Дополнительно устранено преждевременное освобождение clipboard lock при ответе
браузера без подтверждения paste: блокировка теперь остаётся до завершения браузера,
дальнейшие browser-действия запрещены, а транспортный и прикладной сбой ведут себя
одинаково. Проверка ядровой блокировки охватывает отсутствие подтверждения,
`isError`, обрыв транспорта и успешное подтверждение.

Последняя ограниченная попытка Hermes на `qwen/qwen3.7-flash`
(`20260903_014316_0fa481`) получила skill, начала вход в Loginom и завершилась
ошибкой провайдера: `APITimeoutError: Request timed out` после трёх повторов.
Native CLI вернул 1. Это не успешная приёмка и не подтверждённая ошибка сервера Dock.
Повторные платные браузерные попытки остановлены до доступного бюджета/провайдера;
сохранённого GitHub токена также пока недостаточно для публикации (401).

Кандидат `67f917f057597ca0af65b3ef7a89317a473d0d03a6d78885caa5aa7183c3b204`
прошёл 29 тестов на macOS/Linux и установлен как `0.1.0-dev.0-90bc7071f85f`.
Реальный MCP проверил неподтверждённую вставку: host lock удержан, следующая
browser-операция отклонена, закрытие клиента освободило lock. Повторная проверка
понадобилась из-за наблюдаемого `TypeError: fetch failed` на инициализации удалённого
MCP. Для этой временной ошибки добавлен один повтор с новым client/transport и
таймаутом 25 секунд; 401 не повторяется, постоянный сбой завершается после двух
попыток. Дополнительная проверка покрыла очистку первого соединения и границы retry.

Итоговый кандидат продолжения собран из
`f6d24927136b166cdaa08261d2a1977ae23640edb154f49d5fe8e2c43b5f14be`, 3940 файлов
на платформу. Linux: 30 тестов прошли; SHA-256
`7cb51c0155b969165d43ac69b003594db468b400774f522151b216713c19d394`.
macOS SHA-256: `1d1c10fdc86e34123b54259fba1890f052515d4b122ccd31de5a91aa03498a4c`.
Все 30 тестов прошли и на macOS. Проверка создания bridge с живым сервером прошла;
отдельные попытки по-прежнему фиксировали сетевой `fetch failed`, поэтому абсолютная
устойчивость внешнего соединения не заявляется.
Кандидат установлен как `0.1.0-dev.0-038fefe35353`; мастер подтвердил реальный
запуск браузера, графическое окружение, Dock, источники, skill и страницу Loginom.

## Промежуточная проверка 3 сентября, 11:29 МСК

Рабочий контейнер `loginom-dock-openviking-1` (`studio-e868ec34`) имеет статус
healthy. HTTPS, readiness, права обычного клиента, отклонение неверного ключа и
каталог из 15 MCP tools прошли живую проверку. Observer не обнаружил ошибок
очередей, моделей, VectorDB, поиска, блокировок и файловой системы. Свободно
около 27,3 GB диска; возраст последней серверной копии — около 6,4 часа.

Короткие запросы выполнены из рабочего контейнера только к моделям из активного
`ov.conf`, без изменения конфигурации:

| Компонент | Модель | Наблюдаемый результат |
| --- | --- | --- |
| Embedding | `voyageai/voyage-4` | 1024 конечных числовых значения, 0,25 с |
| LLM/VLM | `qwen/qwen3.7-flash` | Правильный текстовый ответ на 2 + 2, 0,58 с |
| Rerank | `voyageai/rerank-2.5-lite` | Релевантный документ на первом месте, 0,29 с |
| Query planner | `ollama/guoxuter/ov_intent_analysis_sft:v7_q8` | Непустой ответ через Ollama, 4,39 с |

Это подтверждает текущую доступность четырёх моделей, но не устойчивость длинных
сессий Hermes, обработку изображений или качество полного планирования поиска.
OpenRouter сообщил лимит ключа $10 и остаток около $6,35; прежний остаток $1,35
больше не актуален. Значения ключей не выводились и не сохранялись в отчёт.

Старый тестовый контейнер `loginom-dock-stage2-qa` остаётся запущенным со статусом
unhealthy. У него нет опубликованного порта и общего тома данных рабочего Dock;
его состояние не является статусом рабочего сервиса. В ходе проверки контейнеры
и настройки не менялись.

## Подготовка кандидата 0.1.0-rc.1

Из чистого commit `7ff258f26c3375eee2924b798a905f754683be2c` на VPS собраны
два клиентских комплекта `0.1.0-rc.1` (3941 файл каждый). Все 125 файлов снимка
сверены с Git tree этого commit; SHA-256 снимка —
`de3bc6290060272f2db0ac24f98ff663373738099c01a0768e447bb34cb8144d`.
Серверный каталог: `/opt/loginom-dock/client-build/rc1-7ff258f2`.

| Платформа | SHA-256 архива |
| --- | --- |
| macOS arm64 | `f8c0f587446f5f129a12bdbde89cc050e9e6c579a2df1bbc88a3c1fdd7f5082d` |
| Linux x64 | `fb4eba0534c0ff1f190135c7dda0580824ff30074b28f6fff7d4e510195b3a4f` |

Linux: 30 тестов прошли. macOS: 26 прошли сразу, четыре проверки локальных
соединений были заблокированы песочницей (`listen EPERM 127.0.0.1`); все четыре
прошли при повторе с разрешёнными локальными соединениями. Manifest обоих
комплектов проверен, скачанные архивы совпали с серверными контрольными суммами.
Добавлены пользовательская инструкция `client/INSTALL.md` и порядок выпуска
`docs/loginom-dock/releasing.md`. Архивы, `SHA256SUMS`, инструкция и отчёт проверки
подготовлены в `.dock/releases/v0.1.0-rc.1/`.

Кандидат опубликован 3 сентября в 13:01 МСК как предварительный
[релиз `0.1.0-rc.1`](https://github.com/kartamyshev-dev/loginom-dock/releases/tag/loginom-dock%400.1.0-rc.1).
После повторного входа пользователя GitHub
подтвердил аккаунт `kartamyshev-dev` и права ADMIN на публичный репозиторий
`kartamyshev-dev/loginom-dock`. Тег клиента — `loginom-dock@0.1.0-rc.1`.
Известные действующие credentials проекта не обнаружены в Git tree исходного
commit и обоих архивах; 19 файлов `client/bin` и `client/lib` совпадают с текущей
установкой, на которой выполнена native-приёмка. Ссылка на скачивание добавлена
в исходники Studio commit `108b7e84cab652019c153f9022ee30efed871aa1`.
Кандидат не устанавливался в основной профиль.

## Полная приёмка Hermes через подписку ChatGPT

Hermes завершил сценарий в native-сессии `20260903_115841_b832d7` через существующее
подключение `openai-codex`, модель `gpt-5.6-sol`. Метаданные подтвердили
`billing_mode=subscription_included`; личная конфигурация, провайдер памяти и модели
серверного Dock не менялись. Серверные функции продолжали использовать активный
конфиг Dock. Ключ OpenRouter для выполнения сценария Hermes не использовался.

Через Dock получены исходники импорта, калькулятора и файловых диалогов. CSV из трёх
строк импортирован, связь портов создана реальными движениями мыши, выражение
`quantity*price` выполнено. Имя и подпись поля — `amount`, результат — **20, 15, 28**.
Итоговый файл `/user/Dock-hermes-chatgpt-acceptance-20260903-425f40f1-verified.lgp`
открыт с сервера в новой браузерной сессии `da60b64f-dd21-434d-b8d6-36c482752ce6`:
узлы и связь сохранились, повторное выполнение подтвердило ту же таблицу.
Итоговый скриншот просмотрен; полный отчёт — `.dock/native-hermes-chatgpt-result.json`.
Дополнительное пустое поле `Expr1` осталось в тестовом пакете и не мешает расчёту.

Ранние промежуточные результаты не засчитаны как успех: первый запуск достиг
лимита итераций; после возобновления исправлена удвоенная подпись поля. Проверка
формулы сначала прочитала служебное `xxxxxxxxxx` из области измерений CodeMirror.
Корректное чтение видимых `.CodeMirror-code pre`, исключающее `.CodeMirror-measure`,
подтвердило `quantity*price`. Последняя проверка отдельно открыла именно исправленный
файл, а не перенесла признак успешного открытия с предыдущей копии.

После трёх возобновлений и двух реальных сокращений контекста все **815 событий**
доставлены в **10 серверных архивов** сессии
`dock-035d3fde64a1c3ac2b5426bdecd31045364d3dbcaf79bf8e`.
Обычный клиент прочитал все архивы: число сообщений совпало с локальной очередью,
ID уникальны, недоставленных событий и ожидающих commit нет, клиентский ключ
в содержимом отсутствует. Политика разрешает собственные events/experiences
(с раскрытием cases/trajectories), без peer и working memory.
Отчёт проверки — `.dock/hermes-chatgpt-archive-verification.json`.

## Публикация и обновление Studio: 3 сентября, 13:06 МСК

Релиз `loginom-dock@0.1.0-rc.1` закреплён на исходном commit `7ff258f2` и содержит
оба архива, `SHA256SUMS` и `INSTALL.md`. Все четыре файла скачаны после публикации
без авторизации GitHub; размер и SHA-256 каждого совпали с серверными сборками.
Отчёт — `.dock/releases/v0.1.0-rc.1/public-download-verification.json`.

Studio собрана на VPS из чистого commit
`108b7e84cab652019c153f9022ee30efed871aa1`. Снимок из 4097 файлов имеет SHA-256
`a7ef0ddda3a7ddcd716180f64a2d3e00acf60f54d38a3fee805d105b9a4cdd30`,
каталог — `/opt/loginom-dock/releases/20260902-stage1-a7ef0ddd`.
Рабочий образ — `loginom-dock:studio-rc1-108b7e84`, image ID
`sha256:82f1bd148c924798640852de7c1637534da4b32f9c42ad08ff13c151c1118958`.
Он заменяет только собранную Studio поверх проверенного серверного образа;
файлы обработки сессий совпали с исходниками. Предыдущий образ и конфигурация
развёртывания сохранены для отката, текущая ссылка переключена после проверок.

После обновления прошли HTTPS/readiness, аутентификация, права обычного клиента
и проверка 15 серверных MCP tools. Живая
[страница подключения](https://loginom.duckdns.org/studio/connect) открылась
во встроенном браузере: выбор Codex/Hermes меняет инструкции, кнопка
`Download 0.1.0-rc.1` открывает опубликованный GitHub-релиз. Визуальная проверка
прошла, ошибок консоли нет. Скриншот — `.dock/releases/v0.1.0-rc.1/studio-live.png`.
Проверка на публичном сайте в этом продолжении прошла; прежний отказ встроенного
браузера, записанный в истории первоначального развёртывания, не повторился.

## Отдельный русскоязычный лендинг: 3 сентября

По новому запросу пользователя опубликован [лендинг Loginom Dock](https://loginom-dock.duckdns.org/).
Он содержит описание продукта, выбор Codex/Hermes и macOS/Linux, загрузку
комплектов `0.1.0-rc.1`, контрольные суммы, команды мастера, первые шаги, три
примера запросов, CSV из трёх строк, ответы на вопросы и описание общей базы.
Палитра и локальные шрифты Source Sans Pro взяты из официального брендбука Loginom;
лицензия шрифта сохранена. Сайт не принимает ключи или другие данные пользователя.

DNS нового домена уже указывал на VPS, изменение записей не потребовалось.
Статический сайт и обновлённая Studio собраны на сервере из commit
`70411dfe7317a5dd222c075a55e1158a05dbd465`. Снимок из 4114 файлов имеет SHA-256
`db787b90828a3b08787270bc1e4d6c41f433d6fea34d8860573749d909731844`;
текущий каталог — `/opt/loginom-dock/releases/20260902-stage1-db787b90`.

| Компонент | Развёрнутый образ | Image ID |
| --- | --- | --- |
| Лендинг и Caddy | `loginom-dock:landing-70411dfe` | `sha256:fe9b84a23ea952a60b824d84766d5cac120297bbe0ab0746f4b080aaa55de313` |
| Приложение и Studio | `loginom-dock:studio-landing-70411dfe` | `sha256:291a9afdde3696ef84cb5ea674c93f5c09bfa4268cd59978cca7cf7d52ff6066` |

Caddy обслуживает новый домен по HTTPS. Статика входит в его образ и тем самым
в существующую резервную копию образов; новые тома или серверные зависимости
не добавлялись. API/MCP остаются на `loginom.duckdns.org`. Прямые запросы к
`/studio/connect` и `/studio/connect/` возвращают 302 на лендинг `/#install`;
переход по Connect внутри Studio также проверен в браузере.

Проверки:

- Два теста в существующей клиентской suite проверили согласованность архива,
  контрольной суммы и команд для четырёх сочетаний агента/системы, а также отказ
  от неподдерживаемого выбора. Проверены синтаксис JS и чистота diff.
- Обе серверные сборки и `caddy validate` прошли. Отдельный временный контейнер
  подтвердил маршруты, MIME-типы, правила кеширования и 404; после проверки он удалён.
- Публичный HTTPS подтвердил страницу, JS/CSS, шрифты, CSV, robots/sitemap,
  пользовательскую 404 и оба перенаправления. `/mcp` нового домена возвращает 404.
- В живом браузере проверены все четыре набора инструкций, копирование команд,
  переключение примеров и переход из Studio. Ошибок консоли на лендинге нет.
  Просмотрены экраны шириной 1280, 390 и 320 px; горизонтального переполнения нет.
  Мобильное меню и разворачивание FAQ проверены на серверной сборке в предпросмотре.
- После обновления прошли readiness, аутентификация, права обычного клиента и
  каталог 15 серверных MCP tools. Файлы обработки сессий в образе совпали с
  исходниками; настройки моделей и credentials не менялись, запросы к моделям
  для этой задачи не выполнялись.

Первая публикация автоматически откатилась из-за конфликта Cache-Control у
шрифтов. Правила страницы и шрифтов разделены, проверены в отдельном контейнере
и на публичном домене; повторное развёртывание прошло. Предыдущие образы и
конфигурация сохранены для отката, ссылка `current` переключена после проверок.
Отчёты и просмотренные скриншоты — `.dock/landing-preview/`; сборочная ревизия
закреплена выше, последующее обновление документации не меняет образы.

## Передача контекста следующему агенту: 3 сентября

Добавлены `agent-handoff.md` и `operations.md`, ссылки на них закреплены в
`AGENTS.md` и README. Карта кода, домены, модели, источники, клиентские каталоги,
правила сборки, точный production Compose, откат и резервирование описаны отдельно
от исторического журнала. Устаревшие инструкции о неполной копии и обновлении
релизных ссылок через Studio исправлены.

Read-only проверка сервера подтвердила релиз `70411dfe`, пять работающих сервисов,
действительные mounts и активные таймеры мониторинга/backup. HTTPS, readiness,
аутентификация, роль user и 15 серверных MCP tools прошли проверку. Активные имена
моделей прочитаны без credentials; запросы к моделям не запускались. Работающая
установка клиента на этой машине указывает на `0.1.0-dev.0-038fefe35353`; опубликованный
`0.1.0-rc.1` не устанавливался повторно. Production и клиент не изменялись.

Выявлен дефект для следующего клиентского выпуска: `client/test/landing.test.mjs`
включается в клиентский снимок, но импортируемый им `landing/` упаковщики не включают.
Изолированная проверка этой структуры подтвердила `ERR_MODULE_NOT_FOUND`. В текущем
опубликованном выпуске этого теста ещё нет. Проблема и необходимая проверка комплекта
зафиксированы в памятке и руководстве выпуска; исправление вошло в следующий
Windows-кандидат, описанный ниже. Проверены 56 локальных Markdown-ссылок, синтаксис
17 блоков команд и отсутствие известных credentials в 12 обновлённых документах;
`git diff --check` прошёл. CI не менялся, копии документов во внешнюю память
не публиковались.

## Результат текущего объёма

Текущий согласованный объём завершён: приёмка Hermes через подписку ChatGPT,
серверная сборка и публикация клиента, отдельный русскоязычный лендинг,
обновление Studio и проверка подключения.
Изменения CI не требовались; условие о синхронизации его документации с OpenViking
остаётся правилом для будущих изменений, а не незавершённой публикацией этого выпуска.

## Выпуск и приёмка Windows x64: 4 сентября

Клиент `0.1.0-rc.2` для Windows 11 x64 собран на VPS из чистого commit
`a00ea54642bda9f2f8bbbe1a60a2a1054656fd69`. Общая логика MCP, архива, сессий и
браузера сохранена; платформенный слой добавляет `node.exe`, `loginom-dock.cmd`,
PowerShell-мастер, защищённые ACL и атомарные pointer-файлы релизов без требования
Developer Mode. Codex hooks используют `commandWindows`, Hermes выбирает Windows
launcher, серверный сборщик формирует ZIP `win32-x64`.

На сервере прошли все 34 клиентских теста. На реальной Windows 11 x64 прошла
установка опубликованного комплекта и 31 применимая native-проверка. Hermes 0.21.0
использовал уже подключённую подписку ChatGPT: provider `openai-codex`, модель
`gpt-5.6-sol`. Проверка MCP увидела 48 инструментов Dock; `dock_prepare` успешно
подключил полный skill. Другие модели для этой приёмки не использовались.

В видимом браузере Hermes импортировал CSV из трёх строк, создал связь между
узлами, настроил поле `amount` с выражением `quantity*price`, выполнил сценарий и
получил значения **20, 15, 28**. Пакет
`Dock-hermes-windows-x64-acceptance-20260903-complete.lgp` был сохранён и повторно
открыт. Источниками служили справка Loginom и загруженные Dock материалы E2E для
импорта текста, калькулятора, файловых диалогов и хранения пакета. Пользователь
подтвердил результат скилла и разрешил считать проверку успешной.

Доказательства сохранены в `.dock/releases/v0.1.0-rc.2/evidence/`:
`windows-result.json` и `loginom-windows-x64-acceptance-complete.png`. SHA-256
скриншота — `c603ed3028442025acdcae33651d54b137106639e7220075ba370d3391aaae5d`.
Временные записи hosts, планировщик проверки и reverse SSH-туннели HTTP/WebSocket
после приёмки удалены. Windows-машина не получила постоянный VPN-доступ; для новой
live-проверки нужен штатный VPN либо заново созданный явный мост к обоим портам.

Три серверных комплекта содержат по 3946 файлов. Опубликован prerelease
[`loginom-dock@0.1.0-rc.2`](https://github.com/kartamyshev-dev/loginom-dock/releases/tag/loginom-dock%400.1.0-rc.2):

| Платформа | Размер | SHA-256 |
| --- | ---: | --- |
| macOS Apple Silicon | 46 933 128 | `7d86bde4ac6dd54d0f75bddf3c2424e49748980a8f11b5da5aefb27c0905c9e2` |
| Linux x64 | 52 069 836 | `95a8e76c20dac151a9f3336dfce85e3ac9b5bfbbe0173382b763739324b20828` |
| Windows 11 x64 | 44 296 700 | `aae2265b30b3c4dd2025a066cb39306fbfb0e01a46b758cc15a80fc4eaa283a2` |

Все опубликованные архивы скачаны повторно и сверены с `SHA256SUMS`. Инструкция
Windows дополнительно исправлена и проверена с фактическим синтаксисом мастера
`install.ps1 --agent ...`. Известный дефект состава снимка устранён:
`landing/instructions.mjs` и `landing/release.json` входят в bundle, поэтому тесты
лендинга выполняются из изолированного комплекта.

После проверки GitHub assets актуальный лендинг собран на VPS из commit
`8b14da6f40f75befd537c8b4d48e705ffdfeb0f9` и опубликован отдельным образом
`loginom-dock:landing-8b14da6f`, image ID
`sha256:f25630732c4dd50c94e82ea49f2411125b19bf9ada7e7ac245b193ff7756a4d5`.
Снимок сервера имеет SHA-256
`cfb7fc954f64bae119079781d52ec4661705935d59fa3201396af9f9d5a9c851`.
API и Studio не пересобирались. После переключения прошли readiness основного
домена, аутентификация, роль user, 15 серверных MCP tools, 302 старого маршрута,
404 `/mcp` на домене лендинга и загрузка Windows ZIP. В браузере проверены выбор
Hermes/Windows, размер и URL ZIP, команды установки, проверки суммы, обновления,
отката и удаления; ошибок консоли нет.

Первая попытка переключения безопасно откатилась из-за ошибочного ожидания
`/ready` на домене лендинга. Этот домен намеренно возвращает 404 для `/ready` и
`/mcp`; readiness проверяется на `loginom.duckdns.org`. После исправления самой
проверки повторное переключение прошло. Настройки моделей и credentials не
менялись, запросы к моделям при обновлении лендинга не выполнялись.

## Обновление ключа OpenRouter

По запросу пользователя ключ заменён в активном серверном `ov.conf` для embedding,
VLM и rerank, а также в локальном `.env` (`OPENROUTER_API_KEY`, права 0600).
Контейнер пересоздан с обновлённым конфигом; реальные запросы ко всем трём моделям
прошли. Сервер готов к работе. Значение ключа
в документацию и Git не включено.

## Обновление примера аналитической задачи: 4 сентября

Пример первой задачи на лендинге заменён на анализ выручки по товарам и регионам.
Учебный `sales.csv` теперь содержит 12 продаж, четыре региона и три товара. Запрос
просит рассчитать выручку каждой продажи, отдельно сгруппировать данные по товарам
и регионам и отсортировать обе таблицы по убыванию. Ответ задачи и контрольные
значения на публичной странице не приводятся.

Сценарий проверен в реальном Loginom через Loginom Dock: CSV импортирован,
выражение `quantity*price` выполнено, две группировки и две сортировки отработали,
а итоговые таблицы сверены с контрольным расчётом. Пакет
`/user/Dock-landing-sales-analysis-20260904.lgp` сохранён, закрыт и успешно открыт
повторно. Локальная сборка лендинга прошла; все 34 клиентских теста успешны.
Страница просмотрена при ширине 1280 и 390 px, горизонтального переполнения и
ошибок консоли не обнаружено, переключение примеров сохраняет правильную
доступность файла `sales.csv`.

Лендинг собран на VPS из чистого commit
`03019de70e45bd769dd6ecea0d408dee440e4b0d` и опубликован из каталога
`/opt/loginom-dock/releases/20260904-landing-03019de7`. SHA-256 серверного снимка —
`541c625547f34c0990b88e206e88626bd204d91796966d1b1015f6591af4da00`.
Рабочий образ `loginom-dock:landing-03019de7` имеет image ID
`sha256:088f7cb04f4c09dc969a8b88b605a5f28ff3267db16adbd961d395b5d738ba35`.

После адресного обновления Caddy прошли readiness основного домена, HTTPS,
аутентификация, роль user и проверка 15 MCP-инструментов. Публичный лендинг и
CSV возвращают актуальное содержимое, прежний маршрут Studio перенаправляет на
установку, а `/mcp` и `/ready` на домене лендинга по-прежнему возвращают 404.
Опубликованная страница повторно просмотрена при ширине 1280 и 390 px: ошибок
консоли и горизонтального переполнения нет, ожидаемый ответ задачи не показан.
API, Studio, модели и credentials не изменялись; запросы к моделям не выполнялись.

Формулировка примера дополнительно упрощена для пользователей: из запроса и
иллюстрации убраны технические указания о разделителе CSV и выражении с именами
полей. Аналитическая цель, группировки, сортировка, сохранение и повторное открытие
пакета сохранены.

Упрощённый вариант собран на VPS из commit
`434d9eaa0bc7057db434d18403b71ecae9d2ef26` и опубликован из каталога
`/opt/loginom-dock/releases/20260904-landing-434d9eaa`. SHA-256 снимка —
`0b0af2a48da8f329a970b9d22c7367bc58d641d6171fcfe528b1c7a4afb84e1f`, образ —
`loginom-dock:landing-434d9eaa`, image ID —
`sha256:45f7c1f2bc26ee6d667514eb545aaa43624cd5c2c9fc9260516d35f52c7c7c78`.
После переключения повторно прошли серверная проверка и публичный просмотр на
экранах 1280 и 390 px; технические формулировки отсутствуют, ошибок консоли и
горизонтального переполнения нет.

Из Open Graph-описания лендинга удалено уточнение «на русском языке». Обновление
собрано на VPS из commit `8db5ae82d1cf3c4fd9434303d7caea1349e4225b` и
опубликовано из каталога `/opt/loginom-dock/releases/20260904-landing-8db5ae82`.
SHA-256 снимка —
`a60d2d0c4676418f432e412cab600251e05d578941de1e427336b3b3a206bcd3`, образ —
`loginom-dock:landing-8db5ae82`, image ID —
`sha256:593a17b3542ea10800427bd382b969a351066e85cd4342481951b3a97aec387d`.
Серверная проверка и чтение метатега в публичном браузере прошли, ошибок консоли
нет. API, Studio, модели и credentials не изменялись.

Описание настройки Hermes на лендинге заменено на технический вариант без
упоминания конкретного провайдера или подписки. Раздел требований теперь указывает
на совместимую модель с поддержкой инструментов, а FAQ объясняет, что Dock
использует конфигурацию модели, выбранную в Codex или Hermes.

Обновление собрано на VPS из commit
`7b7118468353eacab83551a3570efb4de76b6b2f` и опубликовано из каталога
`/opt/loginom-dock/releases/20260904-landing-7b711846`. SHA-256 снимка —
`5880b4593c04f0da412f461d5c8fcf432827279e93b0650e718ce3e8ecf1b963`, образ —
`loginom-dock:landing-7b711846`, image ID —
`sha256:2fa556e22e2c9084186b129885d3f8319f5584045b968e61295a57655003baf5`.
До переключения проверены сборка страницы и конфигурация Caddy. После публикации
прошли HTTPS, readiness, аутентификация, роль user, каталог из 15 MCP-инструментов,
редирект Studio и изоляция `/mcp` на домене лендинга. API, Studio, модели и
credentials не изменялись.
