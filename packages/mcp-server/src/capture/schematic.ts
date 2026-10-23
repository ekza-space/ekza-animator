// The headless ViewCaptureService (MCP-SPEC §4.6, §5.15.4) over agent-tools' see helpers and schematic-render. D0
// stub; P5 implements.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ViewCaptureService } from '@ekza-studio/editor-core';

export function createSchematicCaptureService(): ViewCaptureService {
  throw new EkzaError('not-implemented', 'ekza-studio-mcp.createSchematicCaptureService');
}
