import { useState } from 'react';
import { Button, Spin } from 'antd';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError } from '@tyde-outside/shared';
import { AuthLayout } from '../layouts/AuthLayout';
import { useSession } from '../hooks/useSession';
import { LoginPage, type PendingRegistration } from '../modules/auth/LoginPage';
import { RegisterPage } from '../modules/auth/RegisterPage';
import { WelcomePage } from '../modules/auth/WelcomePage';
import { ErrorNotice } from '../components/ErrorNotice';
export function App() {
  const session = useSession();
  const [grant, setGrant] = useState<PendingRegistration>();
  const unauthorized = session.error instanceof ApiError && session.error.status === 401;
  return (
    <HashRouter>
      <AuthLayout>
        {session.isPending ? (
          <div className="loading">
            <Spin />
            <p>正在恢复登录状态…</p>
          </div>
        ) : session.error && !unauthorized ? (
          <>
            <ErrorNotice error={session.error} />
            <Button
              className="submit"
              block
              loading={session.isFetching}
              onClick={() => void session.refetch()}
            >
              重新连接
            </Button>
          </>
        ) : (
          <Routes>
            <Route
              path="/"
              element={
                session.data ? (
                  <WelcomePage session={session.data} />
                ) : (
                  <Navigate to="/auth" replace />
                )
              }
            />
            <Route
              path="/auth"
              element={
                session.data ? <Navigate to="/" replace /> : <LoginPage onRegistration={setGrant} />
              }
            />
            <Route
              path="/register"
              element={
                session.data ? (
                  <Navigate to="/" replace />
                ) : grant ? (
                  <RegisterPage grant={grant} clearGrant={() => setGrant(undefined)} />
                ) : (
                  <Navigate to="/auth" replace />
                )
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </AuthLayout>
    </HashRouter>
  );
}
