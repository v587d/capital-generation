import { DatasetStoreError } from './data-collector/store.js';
/** 取调用方 session；缺失即响亮失败（`session_unavailable`）。 */
export function callerSession(exec) {
    const session = exec.agent?.session;
    if (!session || typeof session.id !== 'string') {
        throw new DatasetStoreError('session_unavailable', 'the calling agent session was not provided');
    }
    return session;
}
/** 取调用方 session，并要求它是**被委派的**子 Agent（有 parentSession）。 */
export function delegatedSession(exec, toolName) {
    const session = callerSession(exec);
    if (typeof session.header?.parentSession !== 'string' || session.header.parentSession.length === 0) {
        throw new DatasetStoreError('dataset_session_mismatch', `${toolName} is restricted to delegated data agents; the main Agent must delegate this request`);
    }
    return session;
}
