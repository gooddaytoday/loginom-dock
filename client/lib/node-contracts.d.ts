/** Shared 02/03 contract. Runtime publication of node.apply belongs to 03. */
export type NodeType = 'imports.text' | 'transform.calculator' | 'transform.reform_columns'
  | 'transform.filter_data' | 'transform.group_data' | 'transform.sorting'
  | 'transform.join_data' | 'transform.union_data';
export interface WorkflowRef { workflow_id: string; tab_tid: string; prefix: string; navigation_path: {tid: string; label: string}[] }
export interface NodeRef { document_id: string; workflow_id: string; node_id: string }
export interface Position { x: number; y: number }
export type NodeTarget<T extends NodeType = NodeType> =
  | {kind: 'new'; type: T; label?: string; position: Position}
  | {kind: 'existing'; type: T; ref: NodeRef; label?: string; position?: Position};
export interface InputLink { source: NodeRef; output: number; input: number }
export interface NodeTargetRequest<T extends NodeType = NodeType> {
  document_id: string; workflow_ref: WorkflowRef; target: NodeTarget<T>; inputs: InputLink[];
}
export interface FieldRef { schema_id: string; field_id: string }
export interface PortMapping {
  direction: 'input' | 'output'; port: number; autosync?: boolean;
  fields?: {source: FieldRef; name?: string; label?: string; excluded?: boolean}[];
}
/** Each handler binds and validates P through its pinned local JSON schema. */
export interface NodeApplyRequest<T extends NodeType, P> extends NodeTargetRequest<T> {
  operation_id: string; contract_revision: string; mode: string; parameters: P;
  mappings: PortMapping[]; finish: 'done' | 'execute';
  read: {ports: number[]; sample_rows: number; require_exact_numbers: boolean};
  budgets: {configure_ms: number; execute_ms: number; total_ms: number};
}
export interface NodeHandler<T extends NodeType, P> {
  type: T; revision: string; modes: readonly string[]; parameter_schema: object;
  /** Must reject invalid/unsupported parameters before the graph phase. */
  validate(parameters: unknown, mode: string): P;
  /** Runs inside the caller's gate, journal, deadline and cancellation scope. */
  configure(context: NodeProcedureContext, parameters: P): Promise<void>;
}
export interface NodeProcedureContext {
  operation_id: string; document_id: string; workflow_ref: WorkflowRef;
  node: NodeRef; deadline: number; signal: AbortSignal;
}
export type PhaseName = 'validate' | 'target' | 'input_mapping' | 'configure'
  | 'output_mapping' | 'finish' | 'execute' | 'read';
export interface PhaseReceipt { phase: PhaseName; receipt_id: string; status: 'pending' | 'verified' | 'not_requested'; effect_possible: boolean }
export interface NodeApplyResult {
  operation_id: string; status: 'SUCCEEDED' | 'NOT_APPLIED' | 'AMBIGUOUS';
  phases: PhaseReceipt[]; node: NodeRef | null;
  execution: {status: 'not_requested' | 'pending' | 'completed'; execution_id: string | null};
  output: {status: 'not_refreshed' | 'partial' | 'complete'; evidence_ref: string | null};
  package_saved: boolean; warnings: string[];
}
export const NODE_CONTRACT_REVISION: string;
export const NODE_TYPES: Readonly<Record<NodeType, {type: NodeType; title: string; tabular_inputs: number; tabular_outputs: number; additional_tabular_inputs: boolean; modes: readonly string[]}>>;
export function validateNodeReference(ref: unknown): void;
export function validateNodeTargetRequest(request: unknown): NodeTargetRequest;
export function describeNodeTypes(types: NodeType[], pins?: object, actions?: Map<string, object>): object[];
