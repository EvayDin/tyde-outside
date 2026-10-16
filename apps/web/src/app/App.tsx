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
import { ErrorNotice } from '../components/ErrorNotice';
import { Button } from '../components/ui/button';

/** 统一验证码入口与个人资料步骤共用同一认证布局。 */
function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const registration = pathname === '/register';
  return (
    <AuthLayout registration={registration}>
      <div className="flex min-w-0 flex-col">
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
        <Outlet />
      </div>
    </AuthLayout>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <Navigate to="/auth" replace />,
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
  component: () => <Navigate to="/auth" replace />,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: LoginPage,
});
const registrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
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

/** Web 与 Electron 共用同一份前端入口；API 适配保留供后续联调。 */
export function App() {
  return <RouterProvider router={router} />;
}
