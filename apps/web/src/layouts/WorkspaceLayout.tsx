import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LayoutDashboard, LogOut, UserRound } from 'lucide-react';
import type { AuthUser } from '@tyde/shared';
import { TideIcon } from '@/components/icons';
import { UserAvatar } from '@/components/UserAvatar';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Button } from '@/components/ui/button';
import { SESSION_KEY } from '@/hooks/useSession';
import { api } from '@/services/api';

/** 登录后的公共顶栏，Web 与 Electron 使用相同导航和账户入口。 */
export function WorkspaceLayout({ user, children }: PropsWithChildren<{ user: AuthUser }>) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cache = useQueryClient();
  const navigate = useNavigate();
  const name = user.nickname || user.realName;
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await cache.cancelQueries();
      cache.clear();
      cache.setQueryData(SESSION_KEY, null);
      await navigate({ to: '/auth', replace: true });
    },
  });

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !logout.isPending) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open, logout.isPending]);

  return (
    <div className="min-h-svh bg-muted [&_*]:box-border">
      <a
        href="#workspace-main"
        className="sr-only z-50 focus:not-sr-only focus:fixed focus:top-[12px] focus:left-[12px] focus:rounded-[8px] focus:bg-card focus:p-[12px]"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('workspace-main')?.focus();
        }}
      >
        跳转到主要内容
      </a>
      <header className="sticky top-0 z-30 border-b bg-card">
        <div className="mx-auto flex h-[64px] max-w-[1280px] items-center gap-[24px] px-[16px] sm:gap-[40px] sm:px-[32px]">
          <Link
            to="/"
            aria-label="Tyde 首页"
            className="flex shrink-0 items-center gap-[8px] rounded-[8px] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="grid size-[32px] place-items-center rounded-[8px] bg-primary text-primary-foreground">
              <TideIcon className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-width:2]" />
            </span>
            <span className="text-[20px] font-semibold tracking-tight">Tyde</span>
            <span className="hidden border-l pl-[10px] text-[13px] text-[var(--color-neutral-strong)] sm:inline">
              潮汐
            </span>
          </Link>
          <nav aria-label="主导航" className="flex h-full items-center">
            <Link
              to="/"
              aria-current={pathname === '/' ? 'page' : undefined}
              className={`relative flex h-full items-center gap-[8px] px-[4px] text-[13px] font-medium outline-offset-4 transition-colors hover:text-[var(--color-primary-strong)] ${pathname === '/' ? 'text-[var(--color-primary-strong)] after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-t after:bg-primary' : 'text-[var(--color-neutral-strong)]'}`}
            >
              <LayoutDashboard className="hidden size-[18px] sm:block" aria-hidden />
              工作台
            </Link>
          </nav>
          <div ref={menu} className="relative ml-auto min-w-0">
            <Button
              ref={trigger}
              variant="ghost"
              size="account"
              className="gap-[8px] px-[8px]"
              aria-label="账户菜单"
              aria-expanded={open}
              aria-controls="account-menu"
              onClick={() => setOpen((current) => !current)}
            >
              <UserAvatar
                url={user.avatarUrl}
                name={name}
                className="size-[32px] rounded-full text-[13px]"
              />
              <span className="hidden max-w-[140px] truncate text-foreground sm:block">{name}</span>
              <ChevronDown
                className={`size-[18px] transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </Button>
            {open && (
              <nav
                id="account-menu"
                aria-label="账户选项"
                className="absolute right-0 top-[calc(100%+8px)] w-[248px] max-w-[calc(100vw-32px)] rounded-[12px] border bg-popover p-[6px] shadow-lg"
              >
                <div className="mb-[6px] border-b px-[12px] py-[12px]">
                  <p className="truncate text-[14px] font-semibold">{name}</p>
                  <p className="mt-[4px] text-[12px] text-[var(--color-neutral-strong)]">
                    {user.phone}
                  </p>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="account"
                  className="w-full justify-start gap-[12px] hover:bg-accent"
                >
                  <Link
                    to="/profile"
                    onClick={() => setOpen(false)}
                    aria-current={pathname === '/profile' ? 'page' : undefined}
                  >
                    <UserRound className="size-[18px]" aria-hidden />
                    个人中心
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="account"
                  className="w-full justify-start gap-[12px]"
                  loading={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  <LogOut className="size-[18px]" aria-hidden />
                  退出登录
                </Button>
                <ErrorNotice error={logout.error} />
              </nav>
            )}
          </div>
        </div>
      </header>
      <main
        id="workspace-main"
        tabIndex={-1}
        className={`mx-auto w-full max-w-[1280px] px-[16px] pb-[24px] outline-none sm:px-[32px] sm:pb-[32px] ${pathname === '/profile' ? 'pt-[16px]' : 'pt-[24px] sm:pt-[32px]'}`}
      >
        {children}
      </main>
    </div>
  );
}
