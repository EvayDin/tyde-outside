/** 集中提供认证页与品牌区域使用的轻量 SVG 图标组件。 */
import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

const defaultProps = {
  'aria-hidden': true,
  focusable: false,
} as const;

/** 渲染品牌潮汐波纹图标。 */
export function TideIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" {...defaultProps} {...props}>
      <path d="M4 9c3-2.4 5.8-2.4 8.7 0s5.8 2.4 8.7 0 5.5-2.3 7.6-.6M4 16c3-2.4 5.8-2.4 8.7 0s5.8 2.4 8.7 0 5.5-2.3 7.6-.6M4 23c3-2.4 5.8-2.4 8.7 0s5.8 2.4 8.7 0 5.5-2.3 7.6-.6" />
    </svg>
  );
}

/** 渲染手机号输入场景使用的设备图标。 */
export function PhoneIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultProps} {...props}>
      <path d="M7 3h10a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3Z" />
      <path d="M10 18h4" />
    </svg>
  );
}

/** 渲染安全校验成功语义的盾牌图标。 */
export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultProps} {...props}>
      <path d="M12 3 5 6v5c0 4.6 2.9 8.2 7 10 4.1-1.8 7-5.4 7-10V6l-7-3Z" />
      <path d="m9.5 12 1.6 1.6 3.6-3.6" />
    </svg>
  );
}

/** 渲染密码输入场景使用的锁图标。 */
export function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...defaultProps} {...props}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
