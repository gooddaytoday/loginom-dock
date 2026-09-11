# Проверка диагностического Playwright MCP для Loginom

Дата: 2026-09-10. Последняя фиксация: 2026-09-11. Назначение: доступ к реальному Loginom UI для исследования
benchmark. Это диагностика выбранных UI-переходов, не измеряемая попытка SUT
и не автономная приёмка.

## Результат установки и регистрации

По отдельному требованию пользователя установлен `@playwright/mcp` и добавлено
проектное подключение `playwright-chrome` в `.codex/config.toml`. Исходное
подключение `openviking-memory` сохранено. Зависимости и браузерные настройки
размещены в `evals/`; клиентский runtime Loginom Dock не изменялся.

| Компонент | Проверенное значение |
| --- | --- |
| Codex CLI | `0.153.4` |
| MCP package | `@playwright/mcp` `0.0.80` |
| MCP client SDK | `@modelcontextprotocol/sdk` `1.30.0` |
| Transitive Playwright / playwright-core | `1.63.0-alpha-2026-08-31`, закреплены package-lock |
| Node диагностического MCP | `22.16.0`, `/home/kiselev/.nvm/versions/node/v22.16.0/bin/node` |
| Браузер диагностики | Google Chrome `131.0.6778.204`, `/usr/bin/google-chrome` |
| Dependency manifest | `evals/.tools/playwright-mcp/package.json` |
| Lockfile | `evals/.tools/playwright-mcp/package-lock.json`, lockfileVersion 3 |
| Browser config | `evals/tools/playwright-mcp.chrome.json` |
| Native Codex registration | `playwright-chrome`, enabled, **30 tools** |

Локальные package manifests и lockfile независимо прочитаны: версии установленных
MCP, SDK, Playwright и playwright-core совпадают с lockfile. Содержимое credentials,
browser profiles и сырые журналы в эту заметку не включались.

Отдельная проверка native Codex выполнила только `initialize`, `initialized`,
`config/read` с cwd проекта и `mcpServerStatus/list(detail="toolsAndAuthOnly")`.
Codex действительно зарегистрировал 30 инструментов `playwright-chrome`, включая
`browser_snapshot`, `browser_navigate`, `browser_click`, `browser_evaluate` и
`browser_run_code_unsafe`. `authStatus="unsupported"` здесь относится к отсутствию
OAuth у STDIO server и не означает ошибку загрузки. OpenViking также зарегистрирован
с 15 tools. Проверка не вызывала `thread/start`, `turn/start` или `browser_*`.

Из sandbox текущей задачи app-server сначала не смог открыть SQLite runtime
в `~/.codex`; временный override также не завершил initialize. После разрешённого
автоматической проверкой доступа native app-server успешно проверен с обычными
user/project settings, без overrides. Затем его stdin закрыт и процесс завершён.
Временное состояние проб удалено, `evals/.tmp/` исключено из Git.

## Наблюдения реального UI

Живой smoke выполнил основной агент через официальный MCP SDK, STDIO transport
и установленный `@playwright/mcp`. Это отдельная проверка от native Codex
registration, описанной выше.

Browser config использует `isolated: true`, `headless: false`,
`chromiumSandbox: true`, `--start-maximized`, `viewport: null`, capabilities
`core` и `vision`, `saveSession: false`. Фактически наблюдались:

- внутренний viewport `1920×961`;
- внешний размер окна `1920×1048`;
- доступный экран `1920×1048`.

Открыт `http://logi-test-plan.bg.local/app/?testable=true`. UI подтвердил
Loginom `7.4.2`. Для этой операторской диагностики использована документированная
identity `user` с пустым паролем; она не выведена из OS/SSH-имени и не становится
default benchmark account. Права доступа и изоляция файлов этой identity
не проверены.

В собственном несохранённом `Package1` проверены такие переходы:

1. Добавлен текстовый импорт перетаскиванием. Один `browser_mouse_drag_xy`
   не создал нужного эффекта; путь с 24+ промежуточными движениями указателя
   позволил добавить узел. Это наблюдение механики реального drag, а не
   готовый benchmark adapter.
2. Открыт мастер импорта. Наблюдались локальное хранилище, UTF-8, поле имени
   файла и настройка заголовка. Формат и семантика Null не настраивались
   и результат импорта не проверялся.
3. Добавлен Калькулятор; пройден переход input-columns → Next → редактор
   выражений. Мастер закрыт без сохранения.
4. Открыт раздел «Файлы», его заголовок подтверждён. Файлы и настройки
   хранилища не изменялись.

Данные не загружались, узлы не соединялись и не выполнялись. Пакет не сохранялся;
повторное открытие сохранённого пакета не проверялось. Ни схема, ни вычисленные
значения, ни independent verifier этим smoke не подтверждены.

Cleanup подтверждён: «Пакеты» → «Закрыть все...» → «Закрыть» → диалог
«Сохранить изменения в пакете Package1?» → «Не сохранять». Последующий snapshot
показал заголовок «Начало · Loginom» и отсутствие вкладки «Сценарий».
`browser_close` вернул `No open tabs`, затем `await pw.close()` завершился
сообщением `Diagnostic MCP closed`.

До успешного закрытия возник диалог «Обнаружен разрыв связи. Восстановить
сессию?», а попытка закрытия встретила `x-mask` и timeout. После нажатия
«Восстановить» новый snapshot подтвердил исчезновение диалога; только затем
закрытие повторили и получили описанное выше подтверждение. Это ограниченная
проблема наблюдавшейся сессии, а не свидетельство общей стабильности стенда.
В консоли зарегистрированы 0 errors и 17 warnings; предупреждения не разбирались.

## Значение для benchmark и ограничения

Прежняя ошибка CUA `ERR_BLOCKED_BY_CLIENT` описывала конкретный канал доступа.
Подключение запрошенного пользователем Playwright MCP позволило открыть стенд
и исследовать UI. Объявлять весь стенд недоступным по прежней ошибке нельзя.

Диагностический Chrome MCP отличается от pinned product runtime:
`client/.node-version` требует Node `24.19.0`, а продуктовая сессия дополнительно
проверяет свои версии MCP/Playwright/Chromium и runtime hashes. Chrome `131` и
Node `20.19.2` этой диагностики не подменяют product pins. В manifest будущей
серии должны попасть фактические выбранные версии; ручной smoke не доказывает
успех Codex/Hermes через штатный Loginom Dock.

В текущем diagnostic MCP есть произвольные browser evaluate/run-code инструменты.
Его инструментальный состав предназначен для исследования и не является
доказательством безопасной границы SUT. Fresh profile и isolated mode сами по
себе не закрывают network, host filesystem, shell, memory или чужие Loginom
пакеты. До измеряемой серии нужны отдельные isolation/knowledge/ACL preflight.

Из этого исследования подтверждены готовность диагностического MCP, native
Codex tool registration и ограниченные UI-наблюдения по импорту/Калькулятору.
Проверка вычислений, сохранения, fresh execution, скрытых эталонов и автономного
прохождения задачи остаётся отдельной работой.

Инструкция восстановления и пути: [evals/tools/README.md](../../tools/README.md).
