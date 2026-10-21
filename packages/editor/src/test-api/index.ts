// The e2e test API's public surface (M6A-SPEC §4.8, §9.1; B0a): the contract types, the factory and the M6a owner
// groups. The API itself loads as a lazy chunk (`createTestApi`); importing this barrel is for tests and harnesses.
export { createTestApi, type TestApiHandle } from './createTestApi';
export type { IntegrationTestApi } from './m6a/integration';
export type { MeshRuntimeDocTestApi } from './m6a/mesh-runtime-doc';
export type { ModelContentTestApi } from './m6a/model-content';
export type { ModelOpsUiTestApi } from './m6a/model-ops-ui';
export type { ModelSelectUiTestApi } from './m6a/model-select-ui';
export type { ModelTransformToolsTestApi } from './m6a/model-transform-tools';
export type { ShellWorkspacesTestApi } from './m6a/shell-workspaces';
export type { M6aTestApiContext } from './m6a/support';
export type { EkzaStudioTestApi } from './types';
