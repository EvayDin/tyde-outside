import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { api } from '@/services/api';
import { ErrorNotice } from '@/components/ErrorNotice';
import RegisterFormPanel from './components/RegisterFormPanel';
import { useAuthFlow } from './AuthFlow';
import type { RegisterFormController, RegisterFormValues } from './types';

/** 以短信验证返回的一次性凭证完成个人注册，不自动登录。 */
export function RegisterPage() {
  const navigate = useNavigate();
  const { registration, clearRegistration, registrationComplete } = useAuthFlow();
  const [error, setError] = useState<unknown>(null);
  const [registering, setRegistering] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const form = useForm<RegisterFormValues>({
    defaultValues: {
      password: '',
      confirmPassword: '',
      realName: '',
      nickname: '',
      idCardNo: '',
      email: '',
    },
    mode: 'onBlur',
    shouldUnregister: true,
  });
  const expiresAt = registration ? Date.parse(registration.expiresAt) : 0;
  const validRegistration =
    Boolean(registration) && Number.isFinite(expiresAt) && expiresAt > Date.now();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!validRegistration) return;
    const timer = window.setTimeout(clearRegistration, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [validRegistration, expiresAt, clearRegistration]);

  if (!registration || !validRegistration) return <Navigate to="/auth" replace />;

  const controller: RegisterFormController = {
    form,
    registering,
    actions: {
      finish: async (values) => {
        if (inFlight.current) return;
        if (expiresAt <= Date.now()) {
          clearRegistration();
          return;
        }
        inFlight.current = true;
        setRegistering(true);
        setError(null);
        try {
          await api.completeRegistration({
            ...values,
            accountType: 'INDIVIDUAL',
            phone: registration.phone,
            registrationToken: registration.registrationToken,
          });
          if (!mounted.current) return;
          registrationComplete(registration.phone);
          await navigate({ to: '/auth', replace: true });
        } catch (failure) {
          if (!mounted.current) return;
          setError(failure);
        } finally {
          inFlight.current = false;
          if (mounted.current) setRegistering(false);
        }
      },
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[8px]">
      {error != null && <ErrorNotice error={error} />}
      <RegisterFormPanel controller={controller} />
    </div>
  );
}
