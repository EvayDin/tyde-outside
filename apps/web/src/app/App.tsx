import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { AuthLayout } from '../layouts/AuthLayout';
import { LoginPage } from '../modules/auth/LoginPage';
import { RegisterPage } from '../modules/auth/RegisterPage';
import { ErrorNotice } from '../components/ErrorNotice';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

const authModeTabClassName =
  "relative h-[23.328125px] rounded-none border-0 bg-transparent p-0 text-[14px] leading-[23.3333px] font-normal text-[var(--color-text-secondary)] shadow-none [font-family:Inter,ui-sans-serif,system-ui,'PingFang_SC',sans-serif] transition-none hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:font-[750] data-[state=active]:text-[var(--color-primary)] data-[state=active]:shadow-none";

/** 页面视觉沿用 tyde-web，页签通过共享 Hash 路由切换本地表单。 */
function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mode = pathname === '/register' ? 'register' : 'login';
  const navigate = useNavigate();
  return (
    <AuthLayout registration={mode === 'register'}>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          if (value === 'login' || value === 'register')
            void navigate({ to: value === 'register' ? '/register' : '/auth' });
        }}
        className={`flex w-[min(568px,100%)] flex-col ${mode === 'login' ? 'flex-[0_1_auto]' : 'min-h-0'} max-[900px]:min-h-0`}
      >
        <div
          className={`flex-none bg-white ${mode === 'login' ? 'border-b-0' : 'border-b border-[#eef2f4]'} max-[900px]:border-b-0`}
        >
          <div>
            <h1 className="m-0 text-[30px] leading-[1.2] font-[760] tracking-[1px] text-[var(--color-primary)] max-[580px]:text-[25px]">
              欢迎使用 <span className="font-bold">Tyde 潮汐协作平台</span>
            </h1>
            <p className="mt-[6px] text-[12px] text-[#8aa0ad]">让每一次协作，都顺势而为</p>
          </div>

          <TabsList
            aria-label="认证方式"
            className={cn(
              'mt-[12px] flex w-full justify-start rounded-none bg-transparent p-0 text-inherit',
              mode === 'login' ? 'mb-[33px] h-[23.328125px]' : 'mb-0 h-[41.328125px] pb-[18px]',
              'max-[900px]:mb-[33px] max-[900px]:h-[23.328125px] max-[900px]:pb-0',
            )}
          >
            <TabsTrigger value="login" className={authModeTabClassName}>
              登录
            </TabsTrigger>
            <TabsTrigger
              value="register"
              className={`${authModeTabClassName} ml-[27px] before:absolute before:top-1/2 before:left-[-14px] before:h-[13px] before:w-px before:-translate-y-1/2 before:bg-[#d3dee5] before:[content:'']`}
            >
              注册账号
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value={mode}
          className={cn('m-0', mode === 'register' && 'min-h-0 flex-1 data-[state=active]:flex')}
        >
          <Outlet />
        </TabsContent>
      </Tabs>
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
