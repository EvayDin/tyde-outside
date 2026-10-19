import { useEffect, type PropsWithChildren } from 'react';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router';
import { AuthLayout } from '../layouts/AuthLayout';
import { LoginPage } from '../modules/auth/LoginPage';
import { RegisterPage } from '../modules/auth/RegisterPage';
import { WelcomePage } from '../modules/auth/WelcomePage';
import { AuthFlowProvider, useAuthFlow } from '../modules/auth/AuthFlow';
import { useSession } from '../hooks/useSession';
import { ErrorNotice } from '../components/ErrorNotice';
import { Button } from '../components/ui/button';

/** 统一认证布局；离开资料页后销毁一次性注册凭证。 */
function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { clearRegistration } = useAuthFlow();
  const registration = pathname === '/register';
  useEffect(() => {
    if (!registration) clearRegistration();
  }, [registration, clearRegistration]);
  return (
    <AuthLayout registration={registration}>
      <div className="flex min-w-0 flex-col">
        {pathname !== '/' && (
          <header className={`flex-none ${registration ? 'mb-0' : 'mb-[28px]'}`}>
            <h1
              className={`m-0 font-semibold text-foreground ${registration ? 'text-[20px]' : 'text-[24px]'}`}
            >
              {registration ? '完善个人资料' : '登录 / 注册'}
            </h1>
            <p className="mt-[8px] text-[13px] leading-relaxed text-muted-foreground">
              {registration
                ? '请完善个人信息，完成账号注册。'
                : '使用手机号登录，新账号通过验证码注册。'}
            </p>
            {registration && (
              <Link
                to="/auth"
                className="mt-[4px] inline-flex min-h-[44px] items-center rounded-md text-[12px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                返回登录 / 注册
              </Link>
            )}
          </header>
        )}
        <Outlet />
      </div>
    </AuthLayout>
  );
}

/** 会话请求失败时保留错误和重试入口，仅 401 视为未登录。 */
function SessionBoundary({ children, guest = false }: PropsWithChildren<{ guest?: boolean }>) {
  const session = useSession();
  if (session.isPending) return <p role="status">正在恢复登录状态...</p>;
  if (session.isError)
    return (
      <div className="space-y-4">
        <ErrorNotice error={session.error} />
        <Button onClick={() => void session.refetch()} loading={session.isFetching}>
          重试
        </Button>
      </div>
    );
  if (guest && session.data) return <Navigate to="/" replace />;
  if (!guest && !session.data) return <Navigate to="/auth" replace />;
  return children;
}

function HomePage() {
  const session = useSession();
  return <SessionBoundary>{session.data && <WelcomePage user={session.data} />}</SessionBoundary>;
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <Navigate to="/" replace />,
  errorComponent: ({ error, reset }) => (
    <>
      <ErrorNotice error={error} />
      <Button onClick={reset}>重新加载</Button>
    </>
  ),
});
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: () => (
    <SessionBoundary guest>
      <LoginPage />
    </SessionBoundary>
  ),
});
const registrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: () => (
    <SessionBoundary guest>
      <RegisterPage />
    </SessionBoundary>
  ),
});
const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, loginRoute, registrationRoute]),
  history: createHashHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/** Web 与 Electron 共用登录、注册及会话恢复。 */
export function App() {
  return (
    <AuthFlowProvider>
      <RouterProvider router={router} />
    </AuthFlowProvider>
  );
}
