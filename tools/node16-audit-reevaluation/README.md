# Node16: отдельная версия независимого аудитора

Разрешено координатором13.09.2026 для исходного run20260913-205733-a38816e5.
Это не изменение исходного frozen model harness. Его269 файлов проверяются
по request.json; runtime, модели, цель, fixtures и фактические calls не заменяются.
Исходные request/scenario/evidence/collapse-audit сверяются с сохранёнными SHA256.
Отчёт имеет отдельную версию и хеши verifier; original audit не переписывается.

Два обнаруженных ограничения старого verifier исправлены отдельно:

- Штатная user-v1 проекция исключает schema.header_tid и совпадающий с value
  display_text. Остальные поля/значения/типы/порядок сравниваются без нормализации.
  JSON-сравнение различает boolean и number.
- Только для явно указанной пары reconfigured/reconfigured-final подтверждается
  исходный no-effect, идентичный cached replay, отказ resume, выполнение того же
  источника между попытками, одинаковые цель/параметры и сохранение. Сырые ID
  не переименовываются; другие последовательности автоматически не допускаются.

15 отрицательных подмен проверяются на компактной копии реальных tool replies и
gate-relevant events; raw envelopes подмен согласованы с result, чтобы тестировать
именно семантическое сравнение. Полный отчёт читает полный неизменный export.

Run завершился FAIL/-15 на Close AMBIGUOUS/native schema fingerprint. Девять
случаев278cells подтверждены, но wide/fresh10/currentloss отсутствуют. Исправленный
verifier обязан сохранить full_goal=false. Это не основание принять Node16.

Запуск из корня исходного checkout (при изменении исходного runtime/harness
проверка намеренно откажет; для повторения нужен исходный execution checkout):

```sh
python3 tools/node16-audit-reevaluation/reevaluate.py .dock/node16/hermes-runs/20260913-205733-a38816e5 --output .dock/node16/hermes-runs/20260913-205733-a38816e5/versioned-full-reevaluation.json
python3 -m unittest discover -s tools/node16-audit-reevaluation -p test_reevaluation.py
```
