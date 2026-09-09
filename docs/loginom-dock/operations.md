## 8 сентября 2026 — staged-каталог полного node.apply

На VPS собран и staged/read-back `2026.09.08-node-apply.1-candidate`; activated=false.
Release: `/opt/loginom-dock/releases/20260908-catalog-node-apply1-5b48f9d8/`.
Manifest URI:
`viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.08-node-apply.1-candidate/manifest.json`,
SHA256 `936ef73d933e85bfd8429b8b0f2b515c543ca415a2b22ba57e108232c54ddf44`.
`package.save_as` и `package.save_checkpoint` revision2, allowed_roots `/user/dock-p3`;
compatibility loginom-7.4.2-macos-chromium-ru; stale_actions=[].

Сборка выполнена в существующем node:24.19.0-bookworm-slim без сети.
Source archive SHA `1704b9de16b923c31070aa283847825313852c330caee47873f583f714aec532`;
252 отобранных файла, base commit b203ad1bfd9abed9352278c520ac2373ff056588,
**build_inputs_match_commit=false**: это зафиксированный dirty-worktree snapshot,
а не объявление коммита с этими изменениями. source.tar.gz.manifest.json сохранён
рядом с архивом на VPS. Stage report: stage-report.json в том же release.
Настоящий bridge подтвердил новый каталог и обе persistence actions; браузерные
действия/модель в precheck не выполнялись. Production current.json и контейнеры
не переключались. Приёмка Hermes полного Подплана03 пока не выполнена.

## 7 сентября 2026 — staged-каталог пилота импорта

На VPS собран кандидат `2026.09.07-node-import.1-candidate` из явно отобранных
исходников в `/opt/loginom-dock/releases/20260907-catalog-node-import1`.
Stage и read-back выполнены; `activated=false`. URI:
`viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.07-node-import.1-candidate/manifest.json`,
SHA256 `dcef4bc665c53185eca66e674b126b21fae3b21077bc5cdc293769afc053321f`.
Кандидат использован в отдельной source-приёмке импорта (54/54 PASS,
`20260907-170150-12a754e8`); это не production admission полного каталога.
Публичный клиент этой работой не переустанавливался. Runtime источников и пределы
пилота закреплены сверху [implementation-status.md](implementation-status.md).

# Сервер, конфигурация и развёртывание

## Обновление публичного клиента и Caddy — 7 сентября 2026

Опубликован `0.1.0-rc.2-fix`, source `487ada8e3bdfe99d827033a519d6be610c707d91`.
Текущий Caddy: `loginom-dock:landing-rc2-fix-f9549670`, image ID
`sha256:7718912a50c5975bb5d99e48e2af7ccce82338bda8b6fb0e9509386ebc84dcb1`.
Source лендинга: `f954967097832960863dd858185cb9c99972a762`.
API/MCP-контейнер не пересоздавался. current/server source остались прежними;
исторические caddy-image.* в старом каталоге не описывают этот новый образ.
Точные inputs, image.* и backup конфигурации:
`/opt/loginom-dock/client-build/rc2-fix-487ada8e/landing/`.
Для отката сайта брать `deploy.env.rc2-baseline`, а не промежуточный rc.5,
который удалён из GitHub по запросу пользователя. Подробнее:
[windows-agent-install.md](windows-agent-install.md).
Остальные записи ниже сохраняют свои даты применимости.

Сначала прочитать [памятку агенту](agent-handoff.md). Инвентаризация ниже сверена
с сервером 4 сентября 2026 года; перед изменениями повторить read-only проверки.
Секреты здесь намеренно не приводятся. Документационная задача не является
поводом перезапускать сервисы, переустанавливать клиента или запускать модели.

## Стенд Loginom для тестирования и отладки

С 7 сентября2026 по явному выбору пользователя использовать
`http://logi-test-plan.bg.local/app/?testable=true`, account `user` без пароля.
Живой вход и просмотр `/user` проверены; отображаемая версия7.4.2.
По уточнению пользователя 7 сентября 2026 целевой Loginom развёрнут на Linux,
Excel на этом стенде не поддерживается и исключён из текущего плана реализации.
Это адрес целевого Loginom, отдельно от VPS/API/MCP Dock ниже. Production Dock
и установленный клиент этой проверкой не изменялись. Перед новой приёмкой
нужны соответствующие origin/build pins и проверенные storage allowed roots.

## Доступ и расположение

VPS Dock — **82.22.23.10**, Ubuntu 24.04, Docker/Compose уже установлены.
Публичные порты — 80/443, SSH — из конфигурации проекта. API на хосте слушает
`127.0.0.1:1933`; Ollama доступна внутри Docker-сети. DNS обоих доменов указывает
на этот VPS. Сертификатами управляет Caddy.

На машине разработки checkout находится в `/Users/kartamyshev/Git/loginom-dock`.
Локальный `.env` содержит `LOGINOM_DOCK_SSH_HOST`, `LOGINOM_DOCK_SSH_PORT`,
`LOGINOM_DOCK_SSH_USER`, `LOGINOM_DOCK_SSH_PASSWORD`, `LOGINOM_DOCK_DOMAIN`,
`LOGINOM_TARGET_URL` и `OPENROUTER_API_KEY`. Проверенный SSH host key хранится в
`.dock/known_hosts`. Содержимое `.env` не исполнять через `source` и не печатать.

Для неинтерактивного SSH уже используется `sshpass -e`: пароль передаётся только
через окружение дочернего процесса. Пример **read-only** проверки из корня checkout:

```python
import os, pathlib, shlex, subprocess

root = pathlib.Path.cwd()
config = {}
for line in (root / '.env').read_text().splitlines():
    if '=' not in line or line.lstrip().startswith('#'):
        continue
    key, value = line.split('=', 1)
    words = shlex.split(value, comments=True)
    config[key.strip()] = words[0] if words else ''
env = dict(os.environ, SSHPASS=config['LOGINOM_DOCK_SSH_PASSWORD'])
ssh = ['sshpass', '-e', 'ssh', '-p', config.get('LOGINOM_DOCK_SSH_PORT', '22'),
       '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no',
       '-o', 'StrictHostKeyChecking=yes',
       '-o', f'UserKnownHostsFile={root / ".dock/known_hosts"}',
       '-o', 'ConnectTimeout=30',
       f'{config["LOGINOM_DOCK_SSH_USER"]}@{config["LOGINOM_DOCK_SSH_HOST"]}']
subprocess.run(ssh + ['python3 /opt/loginom-dock/tools/verify-server.py'],
               env=env, check=True)
```

При отсутствии `.env`, `known_hosts` или сетевого доступа остановить только
зависящие от них операции и сообщить, чего не хватает. Не заменять SSH-аутентификацию
или проверку host key. Временные `/private/tmp/loginom-dock-*.py/.sh` использовались
в прежних задачах, но не входят в репозиторий и не являются обязательным инструментом.
Для нового сценария можно передавать проверенный shell-файл в `ssh ... bash -s`
через stdin; пароль и текст конфигов не должны попадать в команды или вывод.

### Пути на VPS

Все следующие пути относятся к `/opt/loginom-dock`, если не указано иначе.

| Путь | Назначение |
| --- | --- |
| `current` | Symlink на проверенный текущий серверный релиз |
| `releases/<id>/src/` | Снимок исходников для конкретной сборки |
| `releases/<id>/source.tar.gz`, `source.commit` | Архив исходников и полный commit; архив требуется backup-скрипту |
| `releases/<id>/image.name`, `image.id` | Образ приложения и проверенный Docker image ID |
| `releases/<id>/caddy-image.name`, `caddy-image.id` | Образ Caddy с лендингом и его ID |
| `releases/<id>/previous-release`, `deploy.env.before` | Предыдущий релиз и защищённая конфигурация для отката, если подготовлены при развёртывании |
| `prepared-release` | Кандидат для сборки; не доказывает, что этот релиз работает |
| `config/deploy.env` | Переменные production Compose: образы, ревизия, основной домен и публичный origin |
| `config/ov.conf` | Активные модели, auth и workspace сервера; mount в `/app/.openviking/ov.conf` |
| `config/client.json` | Обычный клиентский ключ общего аккаунта |
| `config/admin.json` | Ключ администратора аккаунта Dock для ресурсов/skill; отличается от server root key |
| `config/ovcli.conf`, `ovcli.settings.conf` | Собственные endpoint/ключ и язык CLI внутри контейнера |
| `config/assets-credentials.json` | Credentials GitLab для штатного Assets importer |
| `config/ca-bundle.crt`, `gitconfig`, `Caddyfile.gitlab` | Доверие внутреннему HTTPS gateway и настройки Git/LFS |
| `assets/` | Рабочие catalog, manifests, Assets State, baseline/audit, skill ZIP и memory templates |
| `tools/` | Установленные эксплуатационные скрипты из `deploy/loginom-dock/`; checkout сам их не обновляет |
| `deploy-stage2/compose.gitlab.yaml`, `gitlab-lfs-proxy.py` | Действующее дополнение Compose и код LFS proxy |
| `tunnel/gitlab.sock` | Unix socket временного reverse SSH-туннеля с машины под VPN |
| `client-build/` | Серверные входные файлы, клиентские комплекты и извлечённые предпросмотры |
| `backups/`, `latest-backup` | Полные локальные копии, архивы образов и указатель последней успешной копии |
| `monitoring/health.json` | Последний ограниченный отчёт состояния без provider messages/credentials |

Credentials имеют права 0600, их каталоги — 0700. Оригинальные данные находятся
в Docker volume `loginom-dock_dock_data`, внутри приложения —
`/app/.openviking/workspace`. Не редактировать внутренние индексы напрямую.
Остальные тома: `loginom-dock_caddy_data`, `loginom-dock_caddy_config`,
`loginom-dock_ollama_data`, `loginom-dock_gitlab_tls`.

### Снимок работающей установки

Текущий релиз — `/opt/loginom-dock/releases/20260904-landing-7b711846`, исходный
commit `7b7118468353eacab83551a3570efb4de76b6b2f`.
SHA-256 `source.tar.gz`:
`5880b4593c04f0da412f461d5c8fcf432827279e93b0650e718ce3e8ecf1b963`.
Следующие коммиты документации в GitHub не требуют смены серверной ревизии.

| Контейнер | Работающий образ |
| --- | --- |
| `loginom-dock-openviking-1` | `loginom-dock:studio-landing-70411dfe` |
| `loginom-dock-caddy-1` | `loginom-dock:landing-7b711846` |
| `loginom-dock-ollama-1` | `ollama/ollama@sha256:020e4134285e2ef4d8fd801234176de3b4faadc992a3eb06c8e66a2f9d4c4ba2` |
| `loginom-dock-gitlab-gateway-1` | `caddy@sha256:df7f1c2fb114453b951de51a98efc010db1655a92c2e86be6706714e2417a78d` |
| `loginom-dock-gitlab-lfs-proxy-1` | `loginom-dock:stage2-b2975a94` |

Image ID приложения:
`sha256:291a9afdde3696ef84cb5ea674c93f5c09bfa4268cd59978cca7cf7d52ff6066`.
Image ID Caddy/лендинга:
`sha256:2fa556e22e2c9084186b129885d3f8319f5584045b968e61295a57655003baf5`.
Приложение и Studio не пересобирались при обновлении `0.1.0-rc.2`: они сохранены
на прежнем проверенном образе `loginom-dock:studio-landing-70411dfe`. Другие два
вспомогательных контейнера также сохранены на прежних проверенных образах.
Общий `compose up` может пересоздать их из новых значений переменных образов;
при адресном обновлении указывать нужные сервисы и `--no-deps`.

### Модели

Канонические **активные** значения находятся в `config/ov.conf`. Локальный
`OPENROUTER_API_KEY` — копия ключа для работы с проектом; изменение одного `.env`
само по себе не обновляет работающий сервер.

| Функция | Модель в проверенном конфиге | Провайдер |
| --- | --- | --- |
| Embedding | `voyageai/voyage-4` | OpenRouter, адаптер `openai` |
| VLM | `qwen/qwen3.7-flash` | OpenRouter, адаптер `openai` |
| Rerank | `voyageai/rerank-2.5-lite` | OpenRouter, адаптер `openai` |
| Query planner | `ollama/guoxuter/ov_intent_analysis_sft:v7_q8` | Локальная Ollama через `litellm` |

При обновлении этой документации проверены настройки и readiness, **новые запросы
к моделям не выполнялись**. Результаты прежних реальных проверок — в журнале.
Применять ограничения моделей и исключение Hermes/ChatGPT из `AGENTS.md`.
После атомарной замены `ov.conf` нужно пересоздать приложение: простой `restart`
может оставить bind mount старого inode. Не менять upstream default account/user;
общий аккаунт клиентов выбирается ключом.

## Команды первичной проверки

Команды ниже выполняются **на VPS**. Они не выводят полные секретные конфиги.

```sh
readlink -f /opt/loginom-dock/current
cat /opt/loginom-dock/current/source.commit
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect loginom-dock-caddy-1 --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
python3 /opt/loginom-dock/tools/verify-server.py
systemctl list-timers --all --no-pager 'loginom-dock-*'
cat /opt/loginom-dock/monitoring/health.json
```

Не печатать полный `docker inspect`/`docker compose config`, `ov.conf`, `.env`,
`client.json` или истории агента: они могут содержать секреты. Для синтаксиса
Compose использовать `config --quiet`. `verify-server.py` проверяет HTTPS,
readiness, аутентификацию, права обычного клиента и каталог MCP; это не тест модели
или полного сценария Loginom.

### Точный production Compose

Выполнять из `src/` выбранного релиза. При проверке текущего стека:

```sh
cd /opt/loginom-dock/current/src
dock_compose() {
  docker compose --env-file /opt/loginom-dock/config/deploy.env \
    -f docker-compose.yml -f deploy/loginom-dock/compose.server.yaml \
    -f /opt/loginom-dock/deploy-stage2/compose.gitlab.yaml \
    --profile server "$@"
}
dock_compose config --quiet
dock_compose ps
```

Третий файл обязателен для существующего production: в нём mounts CLI/Assets,
GitLab CA и закрытая сеть. Не заменять его шаблоном из нового checkout вслепую.
При смене каталога релиза относительный путь Caddyfile тоже меняется; проверить
фактический mount. Не запускать `down -v`, не очищать Docker images/volumes как
часть обычного обновления.

## Подготовка и публикация изменения

### 1. Выбрать сборку

| Что изменено | Сборка на VPS | Что пересоздать после проверки |
| --- | --- | --- |
| Только документация | Не нужна | Ничего |
| Статика лендинга / Caddyfile | `Dockerfile.landing` | `caddy` |
| Только Studio | `Dockerfile.studio-update`, `BASE_IMAGE` из проверенного текущего приложения | `openviking` |
| Backend, Python/Rust/C++, серверные зависимости | Корневой `Dockerfile` | `openviking` и только действительно затронутые вспомогательные сервисы |
| Клиент/native plugins | [Выпуск клиентских комплектов](releasing.md) | Серверный образ сам по себе не обновляет клиент пользователя |
| Полный skill | Проверенный ZIP, `publish-skill.py`, manifest/read-back | Новая клиентская сессия; не пересборка сервера |

`Dockerfile.studio-update` заменяет **только** assets Studio в установленном
Python-пакете; он не переносит изменения backend. Исторические `Dockerfile.*-update`
также имеют узкий набор файлов и не являются универсальной сборкой.

### 2. Подготовить независимый каталог релиза

Зафиксировать проверенные исходники, убедиться в чистоте Git. Для полного снимка
можно использовать стандартный Git archive; временный старый упаковщик не требуется:

```sh
dock_revision=$(git rev-parse HEAD)
mkdir -p .dock
git archive --format=tar "$dock_revision" | gzip -n > ".dock/server-$dock_revision.tar.gz"
shasum -a 256 ".dock/server-$dock_revision.tar.gz"
```

Перед передачей проверить состав архива: только исходники, без credentials,
локальных зависимостей, профилей, `.dock` и build artifacts. Передать через SSH
в новый каталог `/opt/loginom-dock/releases/<уникальный-id>/source.tar.gz`;
проверить SHA-256 на VPS и распаковать в `src/`. Сохранить полный `source.commit`.
Не распаковывать поверх `current`. Наличие архива требуется последующим backup.

На VPS из нового `src/`, с явно заданными непустыми переменными:

```sh
# dock_revision — полный commit; dock_caddy_image/dock_app_image — новые уникальные теги.
docker build -f deploy/loginom-dock/Dockerfile.landing \
  --build-arg LOGINOM_DOCK_REVISION="$dock_revision" -t "$dock_caddy_image" .

# Только при изменениях Studio; dock_base_image — проверенный текущий образ приложения.
docker build -f deploy/loginom-dock/Dockerfile.studio-update \
  --build-arg BASE_IMAGE="$dock_base_image" \
  --build-arg LOGINOM_DOCK_REVISION="$dock_revision" -t "$dock_app_image" .
```

Для полной серверной сборки вместо overlay использовать корневой Dockerfile с
`OPENVIKING_VERSION=0.1.0.dev0`, `UV_LOCK_STRATEGY=locked`,
`LOGINOM_DOCK_REVISION` и новым уникальным тегом. Не перезаписывать текущий тег.
Проверить image ID и сохранить `image.name/image.id`, `caddy-image.name/caddy-image.id`.
Если компонент не пересобирался, записать его фактический сохранённый образ.

### 3. Проверить до переключения

Для Caddy из нового `src/`:

```sh
docker run --rm --env LOGINOM_DOCK_DOMAIN=loginom.duckdns.org \
  -v "$PWD/deploy/loginom-dock/Caddyfile.server:/etc/caddy/Caddyfile:ro" \
  "$dock_caddy_image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Дополнительно проверить HTTP-ответы в отдельном временном контейнере на loopback
с тестовой копией Caddyfile и явно HTTP listener. Syntax validation не проверяет
итоговые заголовки. Для лендинга страницы/JS/CSS имеют `Cache-Control: no-cache`,
WOFF2 — `public, max-age=31536000, immutable`; соответствующие matchers не пересекаются.
Именно конфликт этих правил вызвал откат первой публикации лендинга.

Извлечь собранные файлы через `docker cp` для предпросмотра либо проверить кандидат
на сервере. Пройти четыре выбора агент/ОС, ссылки, копирование, примеры, FAQ,
широкий и узкий экран. Сайт не требует моделей. Контейнер проверки убрать после
завершения; production volumes к нему не подключать.

### 4. Переключить только нужные сервисы и проверить

До изменения `config/deploy.env` сохранить его защищённую копию в новом релизе и
путь прежнего `current`. Не перезаписывать исходную копию при повторе неудачного
развёртывания. Менять только нужные переменные образов и ревизию, сохраняя остальное.
`LOGINOM_DOCK_DOMAIN` остаётся `loginom.duckdns.org`; домен лендинга задан отдельно
в `Caddyfile.server`.

Из нового `src/` использовать функцию `dock_compose` выше, например:

```sh
# При обновлении и Studio, и лендинга; для одного компонента оставить только его имя.
dock_compose up -d --no-build --no-deps --force-recreate openviking caddy
python3 /opt/loginom-dock/tools/verify-server.py
```

Дождаться healthy/readiness и сертификата, проверить публичный лендинг, MCP старого
домена, 302 для обеих форм `/studio/connect`, переход внутри Studio, корректные
MIME-типы и 404 на `/mcp` нового домена. При backend-изменении добавить проверки
затронутого поведения. Только после успеха переключить `current` на новый релиз
и записать фактические образы/хеши/результаты в документацию.

При ошибке вернуть сохранённый `deploy.env`, выполнить Compose из **предыдущего**
`src/` и пересоздать те же затронутые сервисы. Вернуть `current`, если он уже менялся,
затем повторить проверку готовности. Для Caddy откатываются и образ, и Caddyfile.
Данные и серверные credentials при таком откате не восстанавливаются из старой копии.
Автоматический откат образа допустим только при совместимом формате данных;
для миграций хранилища нужен отдельный порядок восстановления.

## Источники и skill

Канонические URI трёх источников перечислены в [архитектуре](architecture.md).
В рабочем `assets/catalog.yaml` используются внутренний HTTPS origin и `auth_ref`;
репозиторный catalog сохраняет исходные locator. Не публиковать рабочие credentials
вместе с catalog. `.source/` хранит оригиналы, `.source-manifest.json` — контрольные
суммы; обычное поддерево используется для семантического поиска.

Для обновления нужен временный туннель с машины под VPN:

```sh
python3 deploy/loginom-dock/gitlab-tunnel.py --env-file .env --state-dir .dock
```

Он работает на переднем плане. Предварительно проверить host key, права и отсутствие
другого владельца socket. Импорт запускать установленным `tools/import-sources.sh`:
он сериализуется с backup и завершает работу полным аудитом. До запуска подготовить
baseline нужных ревизий. Порядок и адресный повтор — в [development.md](development.md).
Чтение уже импортированных данных не требует запуска туннеля или повторного импорта.

Полный skill публикуется из проверенного ZIP через `tools/publish-skill.py` с
явными `--archive`, `--admin`, `--report`. Сначала читать текущий manifest, затем
проверять результат и целостность. Отчёт — `assets/skill-publication.json`.
Не менять закреплённый skill текущей сессии. Полная процедура относится к изменению
skill, а не к каждой задаче через Dock.

## Клиент на машине пользователя

| Путь | Назначение |
| --- | --- |
| `~/.loginom-dock/config.json` | Активные endpoint, обычный клиентский ключ, Loginom URL; 0600 |
| `~/.loginom-dock/bin/` | Launchers, которые разрешают текущую установленную среду |
| `~/.loginom-dock/releases/`, `current`, `previous` | Проверенные среды, активная и предыдущая версии; на Windows `current`/`previous` — pointer-файлы |
| `~/.loginom-dock/current/runtime/node` | Закреплённый Node; на Windows путь разрешается через pointer и оканчивается `runtime\\node.exe` |
| `~/.loginom-dock/runtime/browsers/` | Управляемый Chromium |
| `~/.loginom-dock/sessions/<id>/session.json` | Реальные pins, пути, признак archive activation |
| `~/.loginom-dock/sessions/<id>/browser-profile/`, `artifacts/` | Изолированный браузер и результаты этой сессии |
| `~/.loginom-dock/archive/queue.sqlite` | Durable очередь, WAL/FULL; не очищать для устранения ошибки доставки |
| `~/.loginom-dock/registration-*` | Журнал native-регистрации и восстановления; может содержать credentials |
| `<checkout>/.dock/` | Приватные отчёты разработки, проверки и скачанные серверные артефакты |

На 4 сентября текущая установленная среда macOS этой машины —
`~/.loginom-dock/releases/0.1.0-dev.0-038fefe35353`. Не обновлять её молча ради
совпадения номеров версий. При диагностике смотреть `session.json` конкретной задачи.
Hermes должен использовать существующий выбранный профиль (`HERMES_HOME` или
явный `--hermes-home`) и уже подключённую подписку ChatGPT; личный memory provider
не менять. Полные transcript/config не выводить для поиска версии или имени профиля.

Релизные доказательства — `.dock/releases/v0.1.0-rc.2/`; Windows-результат и
скриншот — в его подкаталоге `evidence/`. Предыдущая приёмка Hermes —
`.dock/native-hermes-chatgpt-result.json` и `.dock/hermes-chatgpt-archive-verification.json`,
лендинг — `.dock/landing-preview/`. Эти файлы не входят в Git; новый checkout может
их не иметь. Подтверждённые выводы и хеши сохраняются в журнале.

### Windows-машина для live-проверок

Проверенная машина — `192.168.1.48`, Windows 11 x64, пользователь `POWERUP\\vskar`.
OpenSSH доступен из локальной сети по отдельному ключу разработки; этот доступ
явно разрешён пользователем. Не публиковать приватный ключ и не заменять настройки
доступа без отдельной задачи. На машине установлены Codex и Hermes 0.21.0. Для
создания сценариев Hermes использует существующую подписку ChatGPT, provider
`openai-codex` и модель `gpt-5.6-sol`; не переключать его на OpenRouter или другую
модель ради тестов.

У Windows-машины нет постоянного VPN к целевому Loginom. Приёмка `0.1.0-rc.2`
использовала временный reverse SSH-мост через машину разработки для HTTP и
WebSocket; запись hosts, туннели и временная задача планировщика после проверки
удалены. Для новой live-проверки сначала организовать штатный VPN либо заново
создать явный временный мост к обоим протоколам. Доступность только HTTP не
подтверждает работу Loginom: без WebSocket интерфейс не завершает подключение.

## Резервирование и мониторинг

`loginom-dock-monitor.timer` и `loginom-dock-backup.timer` включены и активны.
Первый запускается каждые пять минут; второй — в 05:00 **Europe/Moscow**, независимо
от часового пояса, которым `systemctl list-timers` отображает даты.

`tools/backup-server.sh` сохраняет пять томов, образы всех пяти контейнеров,
config, assets, source archive и эксплуатационные файлы. Он кратко останавливает
сервисы, сериализуется с импортом и возобновляет их при ошибке. Для переноса нужны
каталог копии и все файлы `backups/images`, на которые ссылается `image-checksums`.
Копии содержат credentials; права и закрытое хранение обязательны.

На момент проверки `latest-backup` указывает на `backups/20260903T020016Z`.
Восстановление выполняется `tools/restore-server.py --backup ... --name ... --root ...`
в отдельные сеть, тома и контейнеры; порты по умолчанию 19433/19443 только на loopback.
Проверить свободные порты, место и контрольные суммы до запуска. Оно не переключает
production DNS или публичные порты. Подробности — в [deploy README](../../deploy/loginom-dock/README.md).

Лендинг уже входит в Caddy image и существующий backup. Не считать `healthy` в
мониторинге проверкой всех сценариев, всех моделей или пригодности последней копии
к восстановлению без отдельной проверки.

## Корни сохранения пакетов в candidate-каталоге

`package.save_as` ограничивает пути данными `effect.allowed_roots` закреплённого
каталога. Старый `2026.09.05-agent.2-candidate` содержит `/user/data/packages`;
выбор Loginom account `test` и upload destination `/test` сам по себе эту
политику не меняет.

При сборке нового кандидата на VPS используйте явные параметры сборщика
`--version <новая-версия> --package-root /test/packages` для текущей разрешённой
приёмки. `--package-root` можно повторять для нескольких явно выбранных корней;
не выводите их из OS/SSH/Loginom username. Без параметра действуют корни исходного
каталога. Изменение политики требует новой версии и отдельного stage/readback,
а replay — новых manifest URI/SHA. Production activation по-прежнему требует
полной приёмки. Кандидат `2026.09.06-agent.3-candidate` собран на VPS и staged/readback 6 сентября:
manifest SHA `007465bf4d8fee5f238ef790db4584313d61373d27f92715f01388edfe413ae6`,
URI `viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.06-agent.3-candidate/manifest.json`.
Серверный build/report: `/opt/loginom-dock/releases/20260906-catalog-agent3-11f696c5/`.
Save revision 2 ограничен `/test/packages`. Production не активирован; live
сохранение и повторное открытие ещё должны пройти приёмку.

### Candidate для стенда Loginom7.4.2 (7 сентября2026)

`2026.09.07-agent.4-candidate`: build и stage/read-back выполнены на VPS в
`/opt/loginom-dock/releases/20260907-catalog-agent4-loginom742/` из предыдущего
серверного каталогаagent3. Profile loginom-7.4.2-macos-chromium-ru,
loginom_build7.4.2, save allowed root `/user/dock-p3/packages`.
Manifest URI `viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.07-agent.4-candidate/manifest.json`,
SHA `85ac2d532245d2da2c9428c499cfa74ba3cc0b3a6e0732c51e6b96cf9f96b0fa`.
Staged=true, activated=false. Это кандидат для проверки, не приёмка capability.
Каталоги `/user/dock-p3` и `/user/dock-p3/packages` созданы и повторно открыты
через UI под явно выбранным user; package save/reopen ещё не проверен.

### Candidate с «Параметрами полей» (7 сентября 2026)

`2026.09.07-agent.5-candidate` собран на VPS и staged/read-back в
`/opt/loginom-dock/releases/20260907-catalog-agent5-reform/`. Добавлен
`transform.reform_columns` в node.add revision3, с provenance
`bg/selectors.ts:370–374` того же E2E commit. Profile и save root сохранены
от agent4. Manifest SHA
`25c659669ace184ba27e7c8b0cea6c030997e29f2c7c89372d565f4bc8cdd4eb`, URI
`viking://resources/loginom-dock/catalogs/executor-preview/releases/2026.09.07-agent.5-candidate/manifest.json`.
Staged=true, activated=false; автономная приёмка нового узла ещё не выполнена.
Production current повторно проверен: `20260904-landing-7b711846`.
