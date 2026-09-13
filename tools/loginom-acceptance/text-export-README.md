# Native-проверка Text export

Это операторский стенд разработки, не инструкция Hermes и не автономная
приёмка. `text-export-live.mjs` создаёт отдельную source session, видимый
максимизированный Chromium и настоящий MCP wire. Он требует явно выбранные
Loginom account, storage и package. Не запускать одновременно с Hermes этого
потока; для нового source runtime завершить старый диагностический браузер.

Использовать закреплённый проектом Node 24.19.0:

```sh
node tools/loginom-acceptance/text-export-live.mjs \
  --loginom-url 'http://logi-test-plan.bg.local/app/?testable=true' \
  --loginom-user test-2 --storage /test-2 \
  --package /test-2/node17-handler-20260913-5.lgp
```

При read-only package остановиться или передать `--copy-to` с новым путём своей
диагностической копии. CLI сохраняет private evidence в `.dock/text-export/live-*`.
В интерактивный stdin подаётся `{"id":"case","file":"/absolute/operator.cjs"}`.
Операторский файл имеет контекст `ctx`: execute (прямое UI-наблюдение), prep,
session, runtime (публичные wire-вызовы), fs, dir. Закрытие —
`{"operator":"close"}`. Сначала явно выйти из Loginom через меню аккаунта и
подтвердить форму входа: закрытие браузера само по себе не снимает серверную
блокировку пакета.

Каждая новая проверка использует новый operation_id и отдельный destination;
повтор того же id применяется только для проверки идемпотентности. Reject по
умолчанию, explicit replace — только своего файла с известным baseline SHA.
Подготовка источников: малые Unicode CSV из тестовых данных, типизированный
импорт, 40 строковых полей и фильтр `row_number > 1000` над малой таблицей.
Пустой источник после reopen сначала выполнить и независимо проверить 0/5 строк
его выходов: ноль строк не означает отсутствующую схему.

Fixtures в `fixtures/text-export/` описывают **ожидаемые экспортные значения**,
не поддельные результаты Loginom. Для typed fixture дата в полночь имеет native
представление без времени. Аудитор ничего не записывает в native-file.
Настройки ожидания замораживаются из запрошенного случая до чтения результата;
для existing patch дополнить их проверенным сохранённым baseline.

Формат settings.json: delimiter (`;`, `,`, `\t`), header
(`names`, `labels`, `none`), bom (boolean), line_ending (`\n` или `\r\n`),
null_marker. Пример полного независимого аудита:

```sh
python3 tools/loginom-acceptance/audit-text-export.py \
  --receipt /absolute/case.json \
  --fixture tools/loginom-acceptance/fixtures/text-export/escaping.json \
  --settings /absolute/frozen-settings.json \
  --native-file /absolute/native-download.csv \
  --destination /test-2/assigned-case.csv \
  --events /absolute/execution-events.jsonl \
  --runtime EXACT_RECORDED_SOURCE_RUNTIME \
  --negative-checks
```

Receipt может быть прямым результатом или объектом `{request,result}`.
Аудитор сверяет все байты, свежесть receipt, формат, полную mapping schema,
источник и целевой GUID из complete graph, execution, phases/checkpoint,
привязку скачанного файла, origin/build/session/runtime и возврат в workflow.
Для запроса без inputs источник сравнивается с baseline существующего узла.
Девять отрицательных вариантов портят download, SHA-proof chain, session,
runtime, origin, source field, source GUID, readback и checkpoint.
Запускать обычным Python без `-O`, поскольку проверочные условия — assertions.

Отдельная проверка защит самого аудитора:

```sh
python3 -m unittest discover -s tools/loginom-acceptance -p test_audit_text_export.py
```

Done/Close дополнительно проверяются отсутствием файлов в полном обновлённом
native store (не только видимых строках), сохранением settings после reopen,
а reject — независимым повторным скачиванием старого файла. Save checkpoint
сам по себе не доказывает persistence: нужна новая сессия, reopen, destination-only
patch и полное повторное сравнение байтов/настроек/связей.

Завершённая матрица разработки и ограничения:
[план node17](../../docs/plans/loginom-dock/17-text-export.md),
[машиночитаемые доказательства](../../docs/plans/loginom-dock/17-text-export-evidence.json).
