import { ApiError, type AuthApi, type BridgeResult, type DesktopBridge } from '@tyde/shared';
async function unwrap<T>(request: Promise<BridgeResult<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new ApiError(result.status, result.error, result.retryAfter);
  return result.data;
}
export function electronAuth(bridge: DesktopBridge): AuthApi {
  return {
    health: () => unwrap(bridge.health()),
    sendCode: (input) => unwrap(bridge.sendCode(input)),
    verifyCode: (input) => unwrap(bridge.verifyCode(input)),
    completeRegistration: (input) => unwrap(bridge.completeRegistration(input)),
    getCurrentUser: () => unwrap(bridge.getCurrentUser()),
    logout: () => unwrap(bridge.logout()),
  };
}
