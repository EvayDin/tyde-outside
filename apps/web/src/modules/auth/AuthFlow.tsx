import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { RegistrationRequired } from '@tyde/shared';

export interface RegistrationDraft extends RegistrationRequired {
  phone: string;
}

interface LoginFeedback {
  phone: string;
  message: string;
}

interface AuthFlow {
  registration: RegistrationDraft | null;
  loginFeedback: LoginFeedback | null;
  startRegistration: (draft: RegistrationDraft) => void;
  clearRegistration: () => void;
  registrationComplete: (phone: string) => void;
  passwordChanged: () => void;
  clearLoginFeedback: () => void;
}

const AuthFlowContext = createContext<AuthFlow | null>(null);

/** 注册凭证及注册、改密成功提示仅跨当前页面导航保留，刷新后清空。 */
export function AuthFlowProvider({ children }: PropsWithChildren) {
  const [registration, setRegistration] = useState<RegistrationDraft | null>(null);
  const [loginFeedback, setLoginFeedback] = useState<LoginFeedback | null>(null);
  const clearRegistration = useCallback(() => setRegistration(null), []);
  const clearLoginFeedback = useCallback(() => setLoginFeedback(null), []);
  const registrationComplete = useCallback((phone: string) => {
    setRegistration(null);
    setLoginFeedback({ phone, message: '注册成功，请使用密码登录。' });
  }, []);
  const passwordChanged = useCallback(() => {
    setRegistration(null);
    setLoginFeedback({ phone: '', message: '密码修改成功，全部设备需重新登录。' });
  }, []);
  const value = useMemo(
    () => ({
      registration,
      loginFeedback,
      startRegistration: setRegistration,
      clearRegistration,
      registrationComplete,
      passwordChanged,
      clearLoginFeedback,
    }),
    [
      registration,
      loginFeedback,
      clearRegistration,
      registrationComplete,
      passwordChanged,
      clearLoginFeedback,
    ],
  );
  return <AuthFlowContext.Provider value={value}>{children}</AuthFlowContext.Provider>;
}

export function useAuthFlow() {
  const flow = useContext(AuthFlowContext);
  if (!flow) throw new Error('认证页面缺少流程上下文');
  return flow;
}
