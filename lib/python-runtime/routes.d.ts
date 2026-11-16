import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PythonRuntimeManager } from './manager.js';
type Authorize = (req: IncomingMessage) => number | undefined | null;
/** HTTP surface for the settings card and CLI-like clients. */
export declare function createPythonRuntimeHandler(manager: PythonRuntimeManager, authorize?: Authorize): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export {};
