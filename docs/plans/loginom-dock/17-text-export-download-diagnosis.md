# Node17 — одна диагностика download

Assignment `node17:download-diagnosis:1:43a7d37f`.
Отдельный диагностический admission проверяет exact runtime/harness/goal/catalog
и не использует/не ослабляет component/full gates. Runtime155 не менялся.
В entry установлен внешний allowlist публичных операций до observer interceptor.
Private runner создаёт эксклюзивный one-shot marker задания до новой сессии.
Один prepare, одна доставка, source/original/reject, один replace-intent;
actual product replace запрещён в SDK непосредственно до actual-dispatch anchor
даже после успешного observer. Диагностическая остановка не является приёмкой.
Обычные acceptance gates остаются закрыты.

Проверки до живого запуска: 30 Node PASS, 20 Python PASS. В том числе
synthetic real SDK observer success/negative с actual-dispatch=0, cancellation
и incomplete через gate, запрет других публичных действий и повторов.
Отдельные safe received/decoded/failure receipts сохраняют поля ответа и
не подменяют отсутствие ответа синтетическим. Старый FAIL не изменяется.

Разрешена одна новая actual stdio user-v1 test-2 сессия по шести пунктам
[плана](17-text-export-download-evidence-fix.md). После результата — закрытие,
независимый аудит, без повторного запуска и без исправления причины на лету.
