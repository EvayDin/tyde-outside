import type { PropsWithChildren } from 'react';
import { TideIcon } from '@/components/icons';
import AuthIllustration from '@/modules/auth/components/AuthIllustration';

/** 直接复用 tyde-web 的认证页视觉外壳，双端保持同一布局。 */
export function AuthLayout({
  children,
  registration = false,
}: PropsWithChildren<{ registration?: boolean }>) {
  const mode = registration ? 'register' : 'login';
  return (
    <div className="auth-page box-border grid h-screen grid-cols-[51.4%_48.6%] overflow-hidden border-t-4 border-transparent bg-white text-left text-[#173443] [border-image:linear-gradient(90deg,#4eb1c3,#0097a9_55%,#003c44)_1] [&_*]:box-border max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:grid-cols-1 max-[900px]:overflow-visible">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        跳转到主要内容
      </a>
      <aside className="relative h-[calc(100vh-4px)] overflow-hidden bg-[#eff8fb] [background-image:radial-gradient(circle_at_8%_24%,rgba(113,205,221,0.23),transparent_22%),radial-gradient(circle_at_85%_83%,rgba(117,199,210,0.14),transparent_18%)] px-[16px] pt-[35px] pb-[16px] after:absolute after:top-[2%] after:right-[5%] after:h-[210px] after:w-[210px] after:rounded-full after:bg-[rgba(255,255,255,0.38)] after:blur-[15px] after:[content:''] max-[900px]:h-[300px] max-[900px]:min-h-[300px] max-[900px]:p-[24px] max-[580px]:h-[220px] max-[580px]:min-h-[220px]">
        <header className="relative z-[2] flex items-center gap-[12px]">
          <span className="grid h-[42px] w-[42px] place-items-center rounded-[11px] bg-[#2fa9be] text-white shadow-[0_7px_14px_rgba(29,132,153,0.22)]">
            <TideIcon className="h-[27px] w-[27px] fill-none stroke-current [stroke-linecap:round] [stroke-width:2]" />
          </span>
          <div>
            <div className="text-[21px] leading-[1.1] font-[650] text-[#0c3542]">
              Tyde{' '}
              <span className="ml-[5px] inline-block translate-y-[-3px] rounded-[8px] bg-[#db9cab] px-[6px] py-[3px] text-[12px] text-white">
                潮汐
              </span>
            </div>
            <div className="mt-[6px] font-mono text-[12px] leading-[1.2] tracking-[1px] text-[#3ca2b8]">
              MARITIME RESOURCE COORDINATION
            </div>
          </div>
        </header>

        <div className="absolute top-[26%] left-1/2 z-[1] w-[470px] -translate-x-1/2 text-center max-[900px]:top-[82px] max-[900px]:origin-top max-[900px]:scale-[0.65] max-[580px]:top-[65px] max-[580px]:scale-[0.46]">
          <AuthIllustration />
          <h2 className="mt-[32px] mb-[10px] text-[18px] font-[750] tracking-[1px] text-[#153844] max-[900px]:hidden">
            潮汐流转，智领航向
          </h2>
          <p className="text-[12px] leading-[1.8] text-[#7d91a5] max-[900px]:hidden">
            连接领航员 · 策略官 · 执行专家，构建以潮汐为节奏的高效
            <br />
            协作闭环
          </p>
        </div>
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        className={`flex h-[calc(100vh-4px)] min-h-0 justify-center overflow-hidden bg-white px-[7%] pt-[60px] pb-[32px] max-[900px]:h-auto max-[900px]:min-h-0 max-[900px]:overflow-visible max-[900px]:px-[24px] max-[900px]:pt-[45px] max-[900px]:pb-[60px] max-[580px]:px-[18px] max-[580px]:pt-[35px] max-[580px]:pb-[50px] ${mode === 'login' ? 'items-center' : 'items-stretch'}`}
      >
        {children}
      </main>
    </div>
  );
}
