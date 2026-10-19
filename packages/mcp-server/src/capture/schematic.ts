// The headless ViewCaptureService (MCP-SPEC §4.6, §5.15.4) over agent-tools' see helpers and schematic-render. D0
// stub; P5 implements.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ViewCaptureService } from '@ekza-animator/editor-core';

export function createSchematicCaptureService(): ViewCaptureService {
  throw new EkzaError('not-implemented', 'ekza-animator-mcp.createSchematicCaptureService');
}
