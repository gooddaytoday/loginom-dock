# Инструменты исследования benchmark

`playwright-chrome` — диагностический MCP для исследования Loginom UI.
Он использует Google Chrome и отдельный ephemeral profile. Это не pinned
runtime Loginom Dock и не готовый runner измеряемых попыток.

## Зафиксированные зависимости

- `@playwright/mcp` `0.0.80` и `@modelcontextprotocol/sdk` `1.30.0`:
  `evals/.tools/playwright-mcp/package.json` и `package-lock.json`.
- Transitive Playwright / playwright-core: `1.63.0-alpha-2026-08-31`, по lockfile.
- Проверенная Node: `20.19.2`, путь `/home/george/.nvm/versions/node/v20.19.2/bin/node`.
- Проверенный Chrome: `131.0.6778.204`, `/usr/bin/google-chrome`.

Chrome установлен отдельно и не управляется npm lockfile. При переносе или
обновлении сначала сверить его версию; не считать другой browser той же средой.

## Восстановление зависимостей

Из корня `/home/george/git/loginom-dock`:

```bash
PATH="/home/george/.nvm/versions/node/v20.19.2/bin:$PATH" npm --prefix evals/.tools/playwright-mcp ci --cache /home/george/git/loginom-dock/evals/.cache/npm --ignore-scripts --no-audit --no-fund
```

Команда использует существующий lockfile и не устанавливает новый browser.
Для native MCP CLI Node должна быть доступна по пути из проектной конфигурации.
Перед использованием нужны установленный `/usr/bin/google-chrome` и доступная
графическая сессия Linux. Изменение версии Node/Chrome фиксируется отдельно.

## Подключение в Codex

Проектное подключение находится в `.codex/config.toml`, секция
`mcp_servers.playwright-chrome`. Оно запускает:

```text
/home/george/.nvm/versions/node/v20.19.2/bin/node
  /home/george/git/loginom-dock/evals/.tools/playwright-mcp/node_modules/@playwright/mcp/cli.js
  --config /home/george/git/loginom-dock/evals/tools/playwright-mcp.chrome.json
```

Startup timeout — 30 секунд, tool timeout — 120 секунд. Существующую секцию
`openviking-memory` сохранять. При переносе checkout привести эти абсолютные
пути и `outputDir` в browser config к фактическому каталогу; не менять личные
memory credentials или project identity ради браузера.

`playwright-mcp.chrome.json` задаёт headed Chrome, `isolated: true`,
`--start-maximized`, `viewport: null`, Chromium sandbox и отключённое сохранение
сессии. Артефакты направлены в `evals/.state/playwright-mcp/artifacts`.
После изменения подключения native Codex должен перечитать project MCP settings;
для проверки достаточно нового соединения app-server и `mcpServerStatus/list`,
без старта модели. Если активная задача ещё не видит новые tools, не считать
одну запись config доказательством регистрации.

На 2026-09-10 native Codex `0.153.4` зарегистрировал **30 tools** этого сервера.
Живой smoke отдельно выполнен через официальный SDK+STDIO. Результаты и границы
проверки: [playwright-mcp-check](../docs/research/2026-09-10-playwright-mcp-check.md).

В Git сохраняются manifests, lockfile, browser config и документация.
`node_modules`, `.state/`, `.cache/`, `.tmp/`, `runs/`, browser profiles, credentials
и сырые журналы не добавляются. Для диагностики используйте собственный черновик;
после неё закрывайте только принадлежащие этой работе browser/session ресурсы.
