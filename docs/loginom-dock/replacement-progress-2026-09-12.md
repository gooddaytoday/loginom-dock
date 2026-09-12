# Узел11 «Замена»: source-разработка

Статус: исследование UI; обработчик пока не реализован. Ветка
`codex/node-11-replacement`, база `a3b419bde8a660e1905284ee62a46362d5a49e09`.
Автономная приёмка Hermes и ревью не запускались.

## Допуск и pins

Собственный classic MCP: Node24.19.0, Playwright1.63.0-alpha-2026-08-31,
MCP0.0.80, Chromium153.0.8010.12/revision1243. Source revision
`c475d504d9d81f54807c6a3b272351b6fbbe0959d434465e384dc3e0caca190a`:
все элементы clientSourceManifest сверены с файлами этой ветки.

Первичная сессия `f451c7ae-3f1e-46ac-bc74-a880740d30ab`; собственные config/state,
profile/artifacts лежат в `.dock/stream-runtime`. Полный skill получен через
`dock_prepare`, revision `afa295bf48dc48da5d3c995665a06ef2190ff620bae3243d46557e0371536790`.
OpenViking health успешен, actor retrieval выполнен без обращения к Peer main.
Loginom7.4.2, вход test-2 и личный каталог /test-2 подтверждены UI.
Окно1508×949, viewport:null, доступная область1512×949; launch --start-maximized.
`archiveActive=false`; отсутствие исполнения всех глобальных hooks не доказано.
Безопасный приватный допуск: `.dock/stream-preflight.json`.

## Диагностические пакеты

- `/test-2/Node11-Diagnostic-20260912-f451c7ae.lgp`: первичное создание узла.
- `/test-2/Node11-Source-0e808ea9.lgp`: сохранённый импорт шести строк; повторное
  открытие подтвердило наличие узла. Открылся readonly после завершения старой
  сессии; старый браузерный процесс отсутствовал. Для продолжения сделана копия.
- `/test-2/Node11-Rules-88e87e25.lgp`: собственная редактируемая копия, исследование
  строковых и вещественных правил; текущие последующие правки ещё требуют сохранения.

Harness `.dock/replacement/harness.mjs` создаёт полный source bridge, вызывает
`dock_prepare` и pinActionCatalog, затем публичный MCP wire существующего executor.
Рабочая сессия `88e87e25-0f56-476d-a4dc-dcaa1273141e`; её `prepare.json`,
`remote-pins.json`, `browser-*.json` и именованные результаты — приватные evidence.
Повторные старты имеют собственные профили. Для текущей сессии выставлен settle:0.

Неизменяемый каталог `2026.09.11-parallel-pilot.1-candidate`, digest
`4ac827fc9e0cefa609bf2cb8fd7d3d79318dd3fe92999decc7e385fae51fc6e2`, прошёл
проверку хешей/ABI/profile. Селекторы и действия add/link/import совпали с базой;
save-действия отличаются revision/effect (разрешены test-1/test-2/test-3).
Это только основа диагностики, не допуск нового узла или новой автономной приёмки.
Новый candidate-каталог потребуется отдельно; серверные каталоги не менялись.

## Наблюдения реального UI

Help substitution/{README,exact-match,other-match}.md и E2E sReplace.ts,
packages.ts, filedialog.ts, replace_helpers.ts, variant_value_editor.ts прочитаны
через Dock. Начальная palette содержит «Трансформация → Замена»; иконка
`vendors/replacecolumns.svg`.

- grdDataList: Ext.data.Store / bg.ext.CollectionProxy, имена и типы полей,
  ReplaceMode0=не заменять,1=ввод вручную. Новые поля по умолчанию mode0.
- grdReplaceItems: Ext.data.Store / bg.ext.CollectionListProxy. totalCount бывает
  0 при непустой таблице; имеются пустые placeholder records по группам.
  Реальные записи имеют CollectionID0, Index, DataValueType, ReplaceByType,
  ValueRender и ReplaceRender. CollectionID1 относится к regex.
- ValueRender сохраняет тип: string, number либо null. Null и пустая строка
  различаются. Проверены North→N, Null→Missing, пустая→Empty, null→Literal;
  вещественная1.25→9.125. Подменять эти поля удалёнными proxy getters нельзя.
- Row data-tid дублируется summary-строкой; выбирать реальные tr.x-grid-row,
  исключая .x-grid-row-summary, и связывать с record identity.
- Добавление точной пары не открывает редактор. Нужен double-click реальной строки;
  commit через roweditorbuttons;update и ожидание закрытия. String editor txt,
  real editor num (русский десятичный ввод). Null задаётся trg_SetNullTrigger.
  Локальный Controller.FVariantEditor имеет FValueIsNull и FDataType.
- Other combo:0=сохранить,1=Null,2=явное значение,3=regex. Checkbox case_sensitive
  подтверждён getValue=true после клика DisplayEl. Одного press Space было
  недостаточно для доказательства изменения.
- Выходной мастер DerivedDataSourceMappingEngineOutputPortWizard:
  btnProduceType cycle dptDefault/dptSupplement/dptReplace. Supplement сохраняет
  исходные поля, добавляет *_Replace и boolean *_Replaced. Переключение режима
  сохраняет предыдущий порядок target mapping и дописывает новые поля в конец;
  порядок источников и выхода поэтому различается.
- После Execute автоматическая метка стала «Замена: Category, Amount»; data-tid
  изменился. Ссылки нужно перечитывать по GUID. Повторное открытие активного узла
  требует адресного подтверждения деактивации.
- Ручной quick preview6×9 подтвердил отдельные строковые Null/empty/null и
  сохранение1.2501 при точности0 (flag=false). Quick preview округляет real:
  полноточная приёмка требует Table и независимого expected.

## Диагностическое ограничение

Первая операция импорта `node11-import` в сессии `0e808ea9-…` вернула AMBIGUOUS
на read: закончился общий300-секундный бюджет при восстановлении формата Table.
Настройка и execution подтверждены; UI показал все6 строк и закрытый формат.
Первое ожидание «Table format dialog closed» прошло за1.65с, повторное остановлено
остатком общего deadline (~0.56с). Операция не повторялась, её статус не подменён.
Classic settle создавал накладные задержки; следующий harness использует settle:0.
Код продукта для этой причины не менялся.

### Продолжение: native reader и черновик handler

- После штатного восстановления разорванной сессии подтверждён integer editor
  `Int64Field`: пара `1 → 9223372036854775807`. Локальный `ReplaceRender` содержит
  BigInt для большого значения; reader сериализует integer десятичной строкой.
- Native `FIconCls` узла подтверждён: `bg-vendor-icon-replacecolumns`.
- Ручной пакет `/test-2/Node11-Rules-88e87e25.lgp` выполнен и сохранён штатной
  кнопкой Save. Имеет Category/Code/Amount, supplement; это диагностический
  пример, не acceptance expected. Отдельное reopen-readback ещё впереди.
- Добавлены черновые parameters/context/procedure/output/readback/node и
  регистрация `transform.replace_columns`, `mode=exact`; workspace observation
  привязывает поле/пару к record ID. Native reader проверен на Category и Code.
  Handler целиком ещё НЕ проверен; production/admission не объявлены.
- Переключение поля обновляет таблицу асинхронно: сразу после выбора Category
  reader отверг прежнюю integer-таблицу, после обновления прочёл четыре пары.
  Procedure ожидает смены record IDs; нужны дополнительные проверки однотипных
  полей и отсутствия устаревшего readback.
- Следующий шаг: свежий source harness для новых ревизий модулей, проверка
  `node.apply` и исправление контролов редактора/inline output на живом UI.

### Первое подключение handler

Новая source session `90de4e18-8195-4201-b457-b11a86cac8c8`, геометрия
1508×862/1508×949, viewport null. Пакет `/test-2/Node11-Handler-90de4e18.lgp`
создан копией сохранённого источника. У источника GUID
`e767562b-c17a-4e0f-a243-425fcf46c6a8`, у нового узла
`d319aa17-0f0d-4700-8c7b-c99f2658eef7`.

Первый `node11-handler-1` создал/связал узел и остановился на input_mapping:
после Save As breadcrumbs ещё имели старые tids, обновившиеся при открытии
мастера. Узел не дублировали. После ручного Done входного mapping выполнили
новый workspace.prepare `node11-prepare2`; новый workflow ref заканчивается
`-2`. `node11-handler-existing-1` подтвердил input_mapping/open и остановился
на недоступном AddButton. Обе ошибки сохранены как AMBIGUOUS, не PASS.

Прямая Codex-диагностика загружает свежие source-модули в отдельный debug channel
в текущем браузере; это не неизменяемая ревизия MCP и не автономная приёмка.
Перед итоговым полным node.apply требуется новый source session с pin всех
окончательных модулей. Через debug channel уже подтверждена настройка
North→N, case-sensitive, other keep, остальные поля без изменений.
Исправлены выдача AddButton/roweditorbuttons и точные Int64 значения.

Обнаружено, что новый inline output открывается в режиме «Связи»; до полного
native mapping read требуется переключить его в «Таблица». Меню produce mode
также отдельный portal; добавлен узкий выбор его root. Полный выход ещё в работе.

Проверки: replacement parameters 6/6; node-procedure + sorting-context + эти
parameters 71/71; workspace-ui + node-api + node-mapping-context 287/287.
Последние изменения menu-root после этих 287 тестов ещё не перепроверены.

### Ограничение реального редактора «остальные → значение»

Через обычный UI введено `-5.125` в `edtReplaceOtherFloat`; после commit
прочитаны `getValue=-5.13`, raw `-5,13`. Локальный контрол
`Ext.form.field.Number` имеет `decimalPrecision=2`, `allowExponential=true`,
menu=false. Обычная exact-пара `1.25 → 9.125` сохраняет все знаки.
Это разные контролы. В parameters добавлен ранний отказ other/value real,
которые меняет округление до двух десятичных знаков. Ограничение передано
координатору; нативные свойства контрола не изменялись. Для оставшихся QA
выбрано точное значение `-5.25`.

Через direct debug успешно пройдены inline output add и отдельный output
с загрузкой полного source schema. Порядок по умолчанию Loginom проверен,
намеренный output mapping/order ещё нуждается в QA. Добавлены четыре
отрицательные/identity native-reader проверки (4/4); общий replacement набор
до добавления ограничения other/value был 10/10.

### Checkpoint перед свежим полным прогоном

`direct-multi-5` подтвердил все три набора правил: Category четыре типизированные
пары + other Null/case true; Code 1→Int64 max + keep; Amount 1.25→9.125 +
other -5.25/precision0. `multi-inline` подтвердил supplement 11 полей.
Мастер завершён Done, выполнен UI Save и закрытие пакета. Source harness
`90de4e18-8195-4201-b457-b11a86cac8c8` закрыт штатно, exit0.

Новый нюанс: после повторной загрузки `ReplaceRender` большого Int64 — локальная
структура `{lo,hi}`. Reader теперь декодирует её через BigInt без методов объекта,
с проверкой собственных data descriptors и 32-битных границ. На текущий момент
replacement unit-набор 12/12. В `fixtures/replacement/` созданы CSV и независимый
ручной expected-multi (6 строк, 11 колонок в явно заданном порядке). Это ещё не
сверка с выполненным результатом.

Следующий source harness должен открыть `/test-2/Node11-Handler-90de4e18.lgp`
без Save As (чтобы не получить отложенную смену breadcrumb tids), выполнить
source import, затем node.apply на существующем GUID
`d319aa17-0f0d-4700-8c7b-c99f2658eef7`, с output mapping в порядке expected-multi.
После полного прохода требуются остальные cases, независимый auditor, negative
подмены, документы, финальные tests и локальный commit. Полный node.apply всё
ещё не был успешным, readiness не объявлена. Hermes не запускать.

### Полный multi и независимый flag probe

Свежая session `e1c4b3ce-424a-4a65-8fe5-25f4dbec6805` открыла пакет напрямую,
без read-only и без смены tids. `node11-complete-multi-1` внутренне SUCCEEDED:
11 фаз, 6/6 строк, 11 полей в явном порядке, exact numbers. Публичный MCP
ответ был отклонён из-за отсутствовавшего replacement readback в result schema;
вариант добавлен и проверен отдельным schema-тестом (общий файл 7/7).
Нужна свежая проверка публичного контракта; исходный transport error сохранён.

Независимый `replacement_configuration_evidence` по raw observations дал PASS.
Первый output audit дал FAIL ровно на Category_Replaced для north/Other:
ожидали false по pinned Help other-match, получили true. Help перечитан через
текущий source harness: пример действительно содержит false.

Для отдельной проверки создан `Node11 Flag Probe` (GUID
`39403e16-be7a-450c-a7a5-c4c7975cfa55`), операция `node11-null-flag-probe`:
пустая exact-таблица Category, case=true, other=null, add. Все 6 выходных значений
Null и все 6 флагов true, включая уже Null-вход. Вызов внутреннего source runtime
обходит только известную ошибку публичной result schema; не является новым
успешным MCP admission. Полный source handler прошёл и на новом узле.

Закреплена target-specific семантика Loginom 7.4.2: other keep unmatched=false;
other Null=true; other value=true. Флаг не равен «значение изменилось».
Expected-multi обновлён после отдельного probe для будущего проверочного прогона;
первый failed audit не переписан. Документированный пример Help расходится с
проверенным стендом. Нельзя выдавать это за поведение всех версий Loginom.

### Остановка живых проверок из-за подключения Dock

После закрытия диагностического браузера свежий source harness завершился до
подготовки: connect timeout к `loginom.duckdns.org:443`. Три последующих
read-only HTTPS проверки также завершились `SSL connection timeout`.
Подмена endpoint/provider/model и изменение сервера не выполнялись.
Последняя успешная session e1c4b3ce закрыта штатно; её пакет сохранён UI Save
после штатного восстановления разорванного соединения и закрыт.

Общий набор клиента: 1398 проверок, 1388 PASS, 1 SKIP, 9 ошибок EPERM при
открытии локальных сокетов в sandbox. Повтор четырёх соответствующих файлов
с разрешёнными локальными сокетами — 14/14 PASS. После дополнительных защит
уникальности output sources и присутствия produce_mode профильные tests — 21/21.
Independent audit после отдельного flag probe — PASS. Negative audit сначала
обнаружил пропущенную подмену имени схемы, затем после явной сверки returned
schema — 12/12 PASS; оба отчёта сохранены раздельно.

Новые файлы аудитора проверяют одну операцию. Они **не** заявляют source-byte
identity, package persistence или autonomous acceptance: эти внешние проверки
ещё предстоит завершить. Нужны новый публичный MCP прогон исправленной схемы,
full source/import proof, оставшаяся live-матрица и отдельный reopen/reexecute.
Координатору переданы сетевой блокер и ограничения. Узел14 исключён из будущей
очереди этого потока по сообщению координатора; текущий scope — только узел11.

Финальная локальная проверка после усиления выбранного record binding и
добавления Replacement в тест условного Next: `workspace-ui` 261/261 PASS.
`git diff --check` и компиляция трёх Python-аудиторов прошли. Исходная
bootstrap-правка `.gitignore` сохранена отдельно и не включается в commit узла.
