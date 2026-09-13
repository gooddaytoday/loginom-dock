# 17. Экспорт — Текстовый файл

Статус: разработка назначена в отдельной задаче потока1; live discovery и детальный подплан
ещё не выполнены. Код handler не разрабатывать до сверки реального мастера,
Help и E2E и фиксации подтверждённых границ ниже.

Component ID: `component.exports.Text`. Ветка `codex/node-17-text-export`,
постоянный worktree `.worktrees/node-17-text-export`, принятая база
`a3b419bde8a660e1905284ee62a46362d5a49e09`. Account test-2, storage /test-2.
Узел11 принят в своей ветке; его непрослитые исправления не входят в эту базу.
Модель разработчика/единственного review и fix — Astra medium.

## Начальный объём для проверки

Экспорт одной таблицы в новый CSV/TSV файл в явно выбранном хранилище; явные
кодировка, разделитель и заголовок. Реальные доступные опции, обработку NULL,
пустой строки, кавычек, разделителей и переводов строк сначала подтвердить
в Loginom7.4.2 и pinned Help/E2E. Не объявлять предложенные режимы поддержанными
до наблюдения. Перезапись существующего файла требует явной политики и отдельного
тестового файла; не использовать реальные пользовательские данные.

Source Help: data/integration/export/txt-csv.md в Dock knowledge;
`viking://resources/loginom-dock/sources/loginom-help/data/integration/export/txt-csv.md`.
Перед реализацией дополнить этот документ source/live evidence, точными public
parameters, scope/unsupported и независимой матрицей приёмки.

## Обязательные проверки

- Независимо прочитать фактические экспортированные bytes: путь, кодировка,
  размер/целостность, заголовок, все строки небольшого набора и escaping.
- Отдельно NULL/пустая строка, Unicode, числовые/дата значения согласно native
  экспортному контракту; пустая таблица и широкая таблица без обрезания данных.
- Владельцы входа/выхода, связи, finish Execute/Done/Close и идемпотентность
  в реально применимых режимах. Native export не подменять вручную записаннымCSV.
- Сохранение .lgp не доказывает экспорт данных: отдельно save/reopen/reexecute
  и чтение реально нового экспортированного файла.
- Штатный общий контракт, failure/cleanup/pending, отрицательные подмены
  независимого аудитора и финальный полный Hermes Sol/low с выделенным слотом.

Shared file-artifacts контракт принадлежит потоку1. Развивать существующие
хранилище/доставку, не создавать второй общий механизм. Новый транспорт либо
интеграцию чужих фиксов сначала представить конкретно координатору.

## Старт задачи

Подготовлены source MCP/свойDockHOME, read-only dependency symlinks и pending
memory registration7bdef4fd-e366-485d-a83f-51eef03085da. Проект добавлен штатным `codex app <worktree>`; создана отдельная bootstrap-задача
`01a09a36-695b-7da0-b7ca-1ec521afa17e`, project78f34082-0f13-45c6-b826-3892eb164556.
После completed координатор включает enrollment и проверяет actor health/find/read.
Только затем — live discovery/детализация и разработка.
Следовать [runbook](node-workflow-runbook.md). Main/merge/push/deploy/sharedplugin
не менять; следующий узелXLSX import получит свою новую задачу после приёмки17.

Старт подтверждён: bootstrap/enrollment и registered actor health/find/read прошли.
Разработка назначена ходом `01a09a3b-c47f-77e3-ae23-b20cbaeb16ff`, Astra medium.
Новое извлечение проектного знания проверить после содержательной фазы.

Координатор разрешил минимальный host-owned output lease поверх существующих
artifacts/download: точный destination/execution, свежий native file identity,
полные bytes/SHA и durable cleanup receipt. Input upload guards не ослаблять.
Нового транспорта/универсального downloader нет. Reject по умолчанию, replace
только явно для выделенного файла; реализацию и негативные проверки ведёт поток1.

## Решение: раскрытие невидимого компонента палитры

Координатор согласовал node17:palette-reveal-proposal:1: только exports.text,
один bounded owner-only scroll наблюдённого pnlVendors;tree внутри create-effect.
Не в read-only preflight. Точный TreeText/icon/root/owner и причина offscreen
проверяются; overlay/неоднозначность не обходятся. До scroll проверить drop, после
scroll полный graph должен совпасть с before; заново source/drop hit-test перед
drag. Отказ/отмена/неизвестный эффект не допускают повторного drag.
Scroll журналируется как UI effect, даже если узел не создан; cleanup не скрывает
остаточное состояние. Нужны focused negative tests и live test-2. Реализация
назначена в текущей фазе; успешное live выполнение ещё не подтверждено.
