import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OrganizationPageHeaderProps {
  title: string;
  description: string;
  backToOrganization?: boolean;
  actions?: ReactNode;
}

/** 组织首页与创建页共用的页头，避免全局标题外边距撑开布局。 */
export function OrganizationPageHeader({
  title,
  description,
  backToOrganization = false,
  actions,
}: OrganizationPageHeaderProps) {
  return (
    <header className="py-[4px]">
      {backToOrganization && (
        <Button
          asChild
          variant="ghost"
          size="account"
          className="-ml-[12px] h-[44px] text-[14px] sm:h-[32px]"
        >
          <Link to="/organization">
            <ArrowLeft className="size-[17px]" aria-hidden />
            返回我的组织
          </Link>
        </Button>
      )}
      <div
        className={`flex flex-col items-start gap-[16px] min-[900px]:flex-row min-[900px]:items-center ${backToOrganization ? 'mt-[12px]' : ''}`}
      >
        <div className="w-full min-w-0 min-[900px]:flex-1">
          <div className="min-w-0">
            <h1 className="m-0 flex items-center gap-[10px] text-[24px] leading-[34px] font-semibold tracking-tight">
              <Building2 className="size-[22px] text-[var(--color-primary-strong)]" aria-hidden />
              {title}
            </h1>
            <p className="mt-[5px] max-w-[680px] text-[13px] leading-[21px] text-[var(--color-neutral-strong)]">
              {description}
            </p>
          </div>
        </div>
        {actions && (
          <div className="flex w-full flex-wrap gap-[8px] min-[900px]:ml-auto min-[900px]:w-auto">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
