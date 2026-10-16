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
      <div
        className={`flex w-[min(568px,100%)] flex-col ${registration ? 'min-h-0' : 'flex-[0_1_auto]'} max-[900px]:min-h-0`}
      >
        <header className={`flex-none ${registration ? 'mb-0' : 'mb-[28px]'}`}>
          <h1 className="m-0 text-[30px] leading-[1.2] font-[760] tracking-[1px] text-[var(--color-primary)] max-[580px]:text-[25px]">
            欢迎使用 <span className="font-bold">Tyde 潮汐协作平台</span>
          </h1>
          <p className="mt-[6px] text-[12px] text-[#8aa0ad]">让每一次协作，都顺势而为</p>
          <h2 className="mt-[28px] text-[20px] font-semibold text-foreground">
            {registration ? '完善个人资料' : '登录 / 注册'}
          </h2>
          <p className="mt-[8px] text-[13px] leading-relaxed text-muted-foreground">
            {registration
              ? '首次使用时补充个人信息，已有账号无需重复填写。'
              : '使用手机号登录，新账号通过验证码注册。'}
          </p>
          {registration && (
            <Link
              to="/auth"
              className="mt-[12px] inline-flex min-h-11 items-center rounded-md text-[13px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
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
