// Local, release-pinned admission registry. A server definition cannot add a
// handler or change which handler implements an action.
export const CAPABILITY_REGISTRY = Object.freeze([
  Object.freeze({ actionKey: 'node.add', capability: 'node.add.v1', handler: 'nodeAdd', effectKind: 'create' }),
  Object.freeze({ actionKey: 'link.create', capability: 'link.create.v1', handler: 'linkCreate', effectKind: 'create' }),
  Object.freeze({ actionKey: 'package.save_as', capability: 'package.save_as.v1', handler: 'packageSaveAs', effectKind: 'save' }),
]);
export const ACTION_KEYS = Object.freeze(CAPABILITY_REGISTRY.map(item => item.actionKey));
export const CAPABILITIES = Object.freeze(CAPABILITY_REGISTRY.map(item => item.capability));

export function requireCapability(action) {
  const entry = CAPABILITY_REGISTRY.find(item => item.actionKey === action?.action_key);
  if (!entry || action.capability !== entry.capability || action.effect?.kind !== entry.effectKind) {
    throw new Error('Action does not match a local capability handler and effect contract');
  }
  return entry;
}
