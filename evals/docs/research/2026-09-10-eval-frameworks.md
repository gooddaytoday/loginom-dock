# Готовые средства для Loginom benchmark: исследование 2026-09-10

Статус: исследование документации и исходников, без установки, запуска eval, изменения SUT или обращения к приватной памяти. Прочитан `rl-benchmark.md`. Сведения ниже проверены 2026-09-10 через официальную документацию, GitHub Web и read-only GitHub API. Возможности Loginom и локального клиента проверяются в отдельной части исследования. Трудоёмкость — инженерная оценка, не измеренное время.

## Рекомендация

Для первой недели рекомендован небольшой TypeScript supervisor: он владеет заранее объявленным списком попыток, запускает существующий CLI в проверенной внешней изоляции, передаёт сохранённый пакет независимому verifier и строит отчёт из неизменяемых JSON. Самостоятельно реализуются только специфичные для Loginom контракты и состояния, готовое средство изоляции переиспользуется. Это не рекомендация писать собственную платформу eval или трассировки.

Главный компромисс: локальный отчёт и протокол попытки пишутся в проекте, зато не требуется согласовывать семантику повторов, семи исходов, отказоустойчивости и сохранения пакетов с чужой платформой. Готовые платформы не устраняют эту специфичную работу. Резерв для первого сквозного цикла — тот же JSON-протокол и Markdown/CSV вместо HTML-графиков; достоверность и независимый verifier не сокращаются.

Наиболее подходящая готовая альтернатива — **promptfoo 0.123.0** с внешним TypeScript provider. Рассмотреть после первого цикла или вместо собственного отчёта, если одно ограниченное исследование адаптера подтвердит экономию времени. **Harbor 0.22.0** — полноценный третий архитектурный вариант с готовыми контейнерными trial; он сильнее по инфраструктуре, но увеличивает поверхность интеграции. Inspect и Langfuse в недельный критический путь не включать.

## Сравнение кандидатов

| Кандидат, проверенная версия | Локальная работа / лицензия | Runner, verifier, повторы | Traces без изменения SUT | Подписка ChatGPT без обязательного LLM API | Оценка добавочной интеграции |
| --- | --- | --- | --- | --- | --- |
| [promptfoo](https://github.com/promptfoo/promptfoo), [0.123.0](https://github.com/promptfoo/promptfoo/releases/tag/0.123.0), опубликован 2026-09-10 | Локальные CLI, библиотека и UI; MIT; Node >=22.22.0 | Подтверждены shell `exec:` и custom JS provider, async JS assertions, `repeat`, ограничение concurrency | Приём OTLP и получение traces из поддержанных хранилищ подтверждены; прямого импортера Dock/Hermes не найдено. Внешнее преобразование очищенных событий в OTLP — гипотеза адаптера | Custom provider может вызывать неизменённый уже авторизованный CLI. Это технический вывод из произвольного subprocess, интеграционного теста здесь не было. Не использовать стандартный OpenAI API provider | 0.5–1.5 дня сверх необходимых Loginom adapter/verifier/isolation; UI может окупить часть времени |
| [Harbor](https://github.com/harbor-framework/harbor), [v0.22.0](https://github.com/harbor-framework/harbor/releases/tag/v0.22.0), опубликован 2026-08-22 | Локальный Docker; Python >=3.12; Apache-2.0 | External/installed agents, собственный `tests/test.sh`, `n_attempts`, отдельное verifier environment. Браузер Loginom надо включить в environment и интегрировать отдельно | Собирает agent logs и trajectories. Стандартный Codex adapter также копирует полные session logs; это не готовый разрешённый архив Dock. Нужна отдельная фильтрация до benchmark persistence | **Подтверждено исходником:** Codex adapter принимает `CODEX_AUTH_JSON_PATH`; этот путь есть и в релизе v0.22.0. Опциональный `CODEX_FORCE_AUTH_JSON` использует домашний auth. Для проекта нужен явный путь к изолированному секрету | 1.5–3 дня сверх Loginom verifier: Python bridge, точная SUT-конфигурация, GUI/container, разрешённый capture и журнал исходов |
| [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai), commit `84d2c14b47f1137bfa0021674c12a9613122ce35` | Локально; Python >=3.10; MIT. GitHub `releases/latest` не дал релиз: pin — проверенный commit | Custom solvers/scorers, Docker sandbox, `epochs`, лимиты, rescore и log viewer | Автоматическая полноценная трасса Agent Bridge получается через перехват model calls. Импорт произвольной Dock-трассы не подтверждён; собственный converter/solver остаётся работой | Стандартный Agent Bridge направляет calls в Inspect provider и по умолчанию не передаёт reasoning/generation параметры. Такой путь не соответствует неизменной SUT. Независимый subprocess без bridge — возможный обход, требующий собственного адаптера | 1.5–3 дня; второе ядро на Python, bridge не подходит штатно |
| [Langfuse](https://github.com/langfuse/langfuse), [v4.33.0](https://github.com/langfuse/langfuse/releases/tag/v4.33.0), опубликован 2026-09-09 | Self-host подтверждён; MIT кроме `ee` каталогов. Требует сервисов хранения, включая ClickHouse | Это уже и observability, и SDK experiments: подтверждены JS/TS async `task`, evaluators, run evaluators, concurrency. Свой browser runner/изоляция остаются. Повторы можно объявлять отдельными dataset items/сериями; специальный параметр repetitions в изученной странице не найден | Подтверждён OTLP ingestion и перенос существующих observations со временем. Прямого Dock/Hermes importer нет: нужен внешний converter очищенных событий | Произвольный async task может вызвать CLI; сам self-host/детерминированный evaluator не требует платного model API. Совместимость конкретного CLI не проверялась | 1–2.5 дня сверх harness/verifier: self-host, SDK/ingestion, схема и correlation; для девяти попыток избыточно |
| [DeepEval](https://github.com/confident-ai/deepeval), добавлен 2026-09-11; TS release `typescript-v0.9.13`, SDK beta | Apache-2.0, локальные TS/Vitest/CLI и terminal viewer, также Python | Публичный BaseMetric допускает deterministic/no-model checks. TS повторы задаются списком run_id; lifecycle и семь outcomes остаются отдельным контрактом | Есть OTel/OpenInference и собственный Trace; готовый импорт Dock/Hermes не подтверждён | Внешний async тест может вызывать неизменённый CLI; judge API и Confident AI не обязательны. Конкретная подписка в этом адаптере не проверена | 0.5–1 день для metric/local-results adapter; полный trace converter дополнительно 0.5–1 день, необязателен |

DeepEval не входил в первоначальную четвёрку и не был заранее отвергнут.
После отдельного исследования признан технически пригодным дополнением
внешнего supervisor. Source/release pins, TS custom metric, локальная работа
и отличие от Confident AI web-платформы:
[подробное дополнение 2026-09-11](2026-09-11-deepeval-followup.md).

Оценки не складываются автоматически с недельным сроком: во всех вариантах общие необходимые затраты — изоляция реального агента, browser/Loginom storage, независимый verifier, фиксация SUT и тесты самого benchmark. Они не исчезают при установке платформы. Ни один кандидат не проверен в реальном Loginom в рамках этой заметки.

## Факты, влияющие на выбор

**promptfoo.** [Custom scripts](https://www.promptfoo.dev/docs/providers/custom-script/) допускает произвольную shell-команду, но её stdout становится строковым output; структурированный результат лучше передавать custom JS provider. [JS assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/) допускают асинхронный внешний verifier. [CLI](https://www.promptfoo.dev/docs/usage/command-line/) поддерживает `--repeat`, `--max-concurrency`, `--no-cache`, локальный output и просмотр. Для живого benchmark нужны concurrency=1 и отключённый cache. Команда `promptfoo retry` обновляет исходный eval на месте, поэтому не должна владеть канонической историей попыток: каждый повтор benchmark получает новый run_id. [Telemetry](https://www.promptfoo.dev/docs/configuration/telemetry/) отключается `PROMPTFOO_DISABLE_TELEMETRY=1`; SaaS sharing не использовать. [Tracing](https://www.promptfoo.dev/docs/tracing/) не заменяет очистку в нашем контуре: не все in-process spans проходят `redactAttributes`.

**Harbor.** [Tasks](https://www.harborframework.com/docs/tasks) подтверждает runtime-копирование tests и отдельный verifier environment; shared environment — значение по умолчанию, само по себе оно не удовлетворяет требуемой границе. [Agents](https://www.harborframework.com/docs/agents) поддерживает свои external/installed adapters. В [Codex adapter](https://github.com/harbor-framework/harbor/blob/191d1b989bbba1d77c2db23e17aec308d7c08046/src/harbor/agents/installed/codex.py) строки 1299–1394 выбирают auth.json или API key; релиз v0.22.0 также проверен на наличие этой ветки. Строки 1437 и далее добавляют собственные CLI flags, в том числе bypass sandbox, и копируют session logs. Поэтому встроенный adapter нельзя объявить эквивалентным продуктовой SUT без сверки эффективной конфигурации; контейнер обязан обеспечивать внешнюю границу. Наличие [n_attempts](https://github.com/harbor-framework/harbor/blob/191d1b989bbba1d77c2db23e17aec308d7c08046/src/harbor/models/job/config.py) подтверждено кодом, автоматические retries нужно отключить/явно ограничить согласно протоколу benchmark. Никакие credentials не читались.

**Inspect.** [Agent Bridge](https://inspect.aisi.org.uk/agent-bridge.html) подтверждает перенаправление вызовов в Inspect и изменение передачи generation config по умолчанию. Это существенное ограничение, а не отсутствие поддержки CLI. [Options](https://inspect.aisi.org.uk/options.html) подтверждает epochs, отдельный scoring, Docker и лимиты. Внешний solver, который запускает CLI, не используя bridge, мог бы сохранить подписку, однако это здесь проектное предположение, не готовая проверенная интеграция.

**Langfuse.** [SDK experiments](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk) — настоящий программный runner поверх task/evaluators, поэтому называть продукт только просмотрщиком traces уже неверно. Он не решает запуск нужного изолированного browser/CLI. [Self-host](https://langfuse.com/self-hosting), [OTLP ingestion](https://langfuse.com/integrations/native/opentelemetry/migration-to-v4) и [data migration](https://langfuse.com/guides/cookbook/example_data_migration) позволяют рассмотреть локальную загрузку готовых очищенных событий, сохраняя timestamps. Это добавочная проекция: canonical JSON benchmark должен остаться независим от схемы Langfuse.

### Уточнение Langfuse после ревью 2026-09-11

Langfuse технически подходит как engine experiments и интерфейс результатов;
он отложен по предполагаемой стоимости интеграции для первой недели, а не
из-за невозможности собственного verifier. SDK evaluator работает в нашем
процессе и может вызвать внешний verifier. Установку через готовый Docker Compose
саму по себе не следует считать многодневной работой: оценка 1–2.5 дня относится
ко всему подключению, очистке/сопоставлению событий и проверке отчёта, она не измерена.

[Self-host архитектура](https://langfuse.com/self-hosting) добавляет Web/Worker,
Postgres, ClickHouse, Redis/Valkey и S3-compatible storage. Это приемлемая
инфраструктура, если она уже доступна либо готовый UI нужен с первого цикла.
Наличие собственной изоляции и Loginom verifier требуется при любом выборе
платформы и не является уникальным недостатком Langfuse.

Нужно различать SDK evaluator и исполняемые внутри платформы
[Code evaluators](https://langfuse.com/docs/evaluation/evaluation-methods/code-evaluators):
у последних документированы 2 секунды, отсутствие network egress и сторонних
библиотек. Поэтому они не открывают Loginom через Playwright; готовый результат
нашего внешнего verifier можно отправить через
[Scores API/SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk),
включая categorical outcome. Семь исходов представимы; их классификацию и
правильные знаменатели задаёт протокол benchmark.

Для сравнения серий UI требуется проверить путь загрузки: у
[локальных datasets](https://langfuse.com/docs/evaluation/experiments/data-model)
документированы traces/scores без dataset runs. Для полноценного сравнения
использовать закреплённую копию dataset на локальном Langfuse, не изменяя её
внутри серии. Task adapter передаёт SUT только public input; expected output
и метаданные verifier остаются у доверенного runner.

Практический вариант: тот же TS lifecycle/verifier плюс необязательная
проекция очищенных результатов в self-hosted Langfuse. При приоритете
интерактивного анализа это обоснованный выбор; отказывать ему по принципу
«Langfuse умеет только traces» неправильно.

## Skills: источники, pins и решение

Выполнены попытки открыть [skills.sh ai](https://www.skills.sh/?q=ai) и [skills.sh eval](https://www.skills.sh/?q=eval): web tool вернул ошибку открытия query-страниц. Исследование продолжено поиском `ai evaluation`, `eval agent evaluation` с domain filter `skills.sh`, затем чтением конкретных карточек и исходных SKILL.md через GitHub. Запуск `npx skills add` и установка не выполнялись. Карточки могут отставать от upstream; подтверждение ниже относится к прочитанным исходникам.

1. **Применять обязательный [mattpocock/skills/tdd](https://www.skills.sh/mattpocock/skills/tdd) при последующей реализации внешнего контура.** Полностью прочитан [SKILL.md на commit `3cca18b368ae95cdbdebbff572ccafa662551015`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/tdd/SKILL.md), также `tests.md` и `mocking.md`. Отдельных runtime/API-зависимостей у этих текстовых инструкций нет. Польза: observable interfaces, самостоятельный RED, один вертикальный срез за раз, запрет ожиданий, которые повторяют реализацию. Тестовые публичные границы надо перечислить в дизайн-документе, чтобы ревью дизайна согласовало их без нового общего опроса. Актуальный upstream перенёс refactoring из цикла в review-stage; **промпт пользователя имеет приоритет** и явно требует RED → GREEN → refactoring, поэтому в дизайне фиксируется этот проектный процесс. Не вызывать code-review/codebase-design автоматически на этапе дизайна.
2. **[langfuse/skills/langfuse](https://www.skills.sh/langfuse/skills/langfuse) отложить вместе с Langfuse.** Полностью прочитан [SKILL.md на commit `e04f3ea7d0695cd903cf158db3c72916111f0978`](https://github.com/langfuse/skills/blob/e04f3ea7d0695cd903cf158db3c72916111f0978/skills/langfuse/SKILL.md). MIT. Это инструкции по docs-first, datasets, experiments, CLI и trace analysis; для работы с данными нужны Langfuse instance, проектные keys и `langfuse-cli` (Node/npx либо Bun). Для текущего собственного JSON-контура экономии нет. В SUT не добавлять, prompts не мигрировать, SDK не инструментировать.
3. **[borghei/claude-skills/agentic-evaluation-framework](https://www.skills.sh/borghei/claude-skills/agentic-evaluation-framework) не выбирать для MVP.** Полностью прочитан [SKILL.md на commit `ddca910e95580c63a236303fc1534054f0f14d4c`](https://github.com/borghei/Claude-Skills/blob/ddca910e95580c63a236303fc1534054f0f14d4c/engineering/agentic-evaluation-framework/SKILL.md), metadata version 1.0.0, **MIT + Commons Clause**. Скрипты заявлены Python stdlib-only и не вызывают модели; полезны для рубрик и смещений judge. Но основные workflows — LLM judges, weighted totals, Elo/Bradley–Terry, что не нужно первому измерению полного результата Loginom. Фраза о сведении качества/цены/времени в одно число противоречит промпту; переносить её нельзя. Runtime-скрипты не исполнялись и не аудировались, зависимостью не становятся.

Локальный `/home/george/.agents/skills/tdd/SKILL.md` прочитан полностью; SHA-256 `1d0a1439aefa3ebe6a8fe83b5bb4559610d75268edd0bd4ef7d391d841742fc5`. Его философия и vertical slices совпадают по смыслу, но текст **не совпадает** с выбранным upstream: локальная версия содержит отдельный Refactor, upstream — Seams и иной порядок refactoring. Нельзя заявлять проверку актуального upstream по одному имени локального skill. Установленные skills не изменялись.

## Pins, которые удалось проверить

| Источник | Проверенный ref | Назначение |
| --- | --- | --- |
| promptfoo | release `0.123.0`; source snapshot `78202a3a785655ef639658b0c0318daf628da2e5` | Альтернативный готовый engine/UI, не обязательная зависимость |
| Harbor | release `v0.22.0`; source snapshot `191d1b989bbba1d77c2db23e17aec308d7c08046` | Контейнерная альтернатива; auth branch сверена также с release |
| Inspect AI | `84d2c14b47f1137bfa0021674c12a9613122ce35` | Сравнение; номер package release отдельно не установлен |
| Langfuse | release `v4.33.0`; source snapshot `f733b5eb73b111548e6d061697a32acaea91dbd9` | Сравнение; SDK version отдельно не выбиралась |
| mattpocock/skills | `3cca18b368ae95cdbdebbff572ccafa662551015` | Выбранный текст TDD для следующего этапа с приоритетом промпта |
| langfuse/skills | `e04f3ea7d0695cd903cf158db3c72916111f0978` | Прочитан, отложен |
| borghei/Claude-Skills | `ddca910e95580c63a236303fc1534054f0f14d4c` | Прочитан, не выбран |

Source snapshot — точка проверки, а не утверждение, что tag указывает на тот же commit. Floating `main/latest` не должен попадать в итоговый манифест серии. Возможность авторизации, browser/clipboard и access boundaries в конкретном изолированном runtime остаётся отдельной живой проверкой; наличие Docker в описании платформы само её не доказывает.
