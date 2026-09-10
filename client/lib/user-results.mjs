const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
export const userResultSchema = {
  type: 'object', required: ['result_version', 'operation_id'], additionalProperties: false,
  properties: {
    result_version: { type: 'string', const: 'user-v1' }, operation_id: { type: 'string', minLength: 1 },
    attempt: { type: 'integer', minimum: 1 }, state: { type: 'string', enum: ['running', 'settled'] },
    status: { type: 'string', enum: ['SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'NOT_APPLIED'] },
    action_key: { type: 'string' }, phase: { type: 'string' }, cancel_requested: { type: 'boolean' },
    server_stop_requested: { type: 'boolean' }, progress: { type: ['object', 'null'] },
    effect_possible: { type: 'boolean' }, cleanup_complete: { type: 'boolean' },
    node: { anyOf: [{ type: 'null' }, { type: 'object', required: ['document_id', 'workflow_id', 'node_id'], additionalProperties: false,
      properties: { document_id: { type: 'string' }, workflow_id: { type: 'string' }, node_id: { type: 'string' } } }] },
    execution: { type: ['object', 'null'] }, package_saved: { type: 'boolean' }, output: { type: 'object' },
    error: { type: ['object', 'null'] }, limitations: { type: 'array', items: { type: 'string' } },
  },
};

export function compactNodeResult(result) {
  const outcome = result.outcome, node = outcome?.output, data = node?.output;
  const output = data ? pick(data, ['status', 'evidence_ref', 'execution_id', 'no_output_requested']) : {};
  if (data?.ports) output.ports = data.ports.map(port => {
    const value = pick(port, ['port', 'port_guid', 'fresh', 'execution_id', 'schema', 'row_count', 'sample', 'sample_rows', 'sample_complete', 'precision', 'table']);
    value.schema = value.schema.map(column => pick(column, ['index', 'name', 'label', 'type', 'data_kind']));
    value.sample = value.sample.slice(0, 3).map(row => row.map(cell => {
      const compact = pick(cell, ['value', 'display_text', 'precision', 'is_null', 'timezone']);
      if (compact.value === compact.display_text) delete compact.display_text;
      return compact;
    }));
    value.sample_rows = value.sample.length;
    value.sample_complete = port.sample_complete && value.sample.length === port.sample.length;
    return value;
  });
  if (data?.format_restoration) output.format_restoration = pick(data.format_restoration, ['restored', 'table']);
  if (data?.workflow_return) output.workflow_returned = data.workflow_return.verified === true;
  // Delivery jobs carry their byte-verified destination in outcome directly.
  if (!node && outcome) Object.assign(output, outcome);
  return {
    result_version: 'user-v1', ...pick(result, ['operation_id', 'attempt', 'state', 'cancel_requested', 'server_stop_requested']),
    ...(result.state === 'running' ? { progress: result.progress } : {}),
    ...pick(outcome, ['status', 'action_key', 'phase', 'effect_possible', 'cleanup_complete']),
    ...pick(node, ['node', 'execution', 'package_saved']), output,
    error: result.error ?? outcome?.error ?? null,
    limitations: node?.warnings ?? [],
  };
}

export function compactActionResult(result) {
  // Keep continuation references and observed UI controls: removing these would
  // force another observation, or tempt clients to reuse stale references.
  const copy = structuredClone(result);
  delete copy.trace;
  if (copy.status === 'SUCCEEDED' && ['package.save_as', 'package.save_checkpoint'].includes(copy.action_key)) {
    copy.output = pick(copy.output, ['package_ref', 'reopened', 'workflow_preserved', 'save_completed', 'persisted_content_verified', 'workflow_continuations']);
    if (copy.output.workflow_continuations) copy.output.workflow_continuations = copy.output.workflow_continuations.map(item => pick(item, ['document_id', 'workflow_ref']));
  }
  return { ...copy, result_version: 'user-v1' };
}

export const userWorkflowInstructions = `Используй закреплённые описания операций и локальный кеш знаний всю сессию.
Построй граф и параметры по заданию. Четыре обработчика: текстовый импорт,
Калькулятор, Группировка, Сортировка; профиль ограничен Loginom 7.4.2.
Загрузи input_artifacts через dock_artifact_deliver, сохрани подтверждённую identity
источника для импорта. Каждый node.apply сам проверяет настройки и выполнение.
В dock_node_apply/resume передавай workflow_ref только как {workflow_id}, используя
выданные document_id и workflow_id. Длинный путь навигации клиент хранит локально;
не копируй и не восстанавливай tab_tid, prefix, navigation_path в запросе узла.
Не повторяй уже подтверждённые проверки. При running жди тот же operation_id;
при неопределённом результате сначала восстанови его, не начинай заменяющую операцию.
Ошибку параметров исправляй по установленной схеме. Дополнительные знания ищи,
если имеющегося описания и наблюдённого состояния недостаточно.
Для обычного чтения задавай require_exact_numbers:false: отображение не доказывает
точность числа. Точное чтение временно меняет формат и восстанавливает его.
Сохрани готовый пакет в конце через package.save_checkpoint, дождись квитанции.
Промежуточное сохранение — по просьбе пользователя или перед риском потери работы.
package.save_as с переоткрытием используй при запросе переоткрытия. package_saved:false
у узла описывает границы node.apply и не требует дополнительного сохранения.
Не приписывай данным валюту, если она не указана. Полные квитанции и диагностика
сохраняются локально; ограничения результата остаются обязательными для вывода.`;

export function compactKnowledgeBundle(description) {
  return {
    version: 'user-v1', session_manifest: description.session_manifest,
    actions: description.actions.map(action => pick(action, ['action_key', 'revision', 'description', 'input_schema', 'effect'])),
    node_types: description.node_types.map(node => pick(node, ['type', 'contract_revision', 'cache_key', 'candidate_node_apply_available',
      'candidate_apply_tool', 'configuration_handler', 'parameter_schema', 'modes', 'limitations'])),
  };
}
