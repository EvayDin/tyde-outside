/** 提供输入框、分段选择和日期选择共用的语义尺寸与尺寸类名。 */

/** 公共输入控件的语义尺寸。 */
export type InputSize =
  'sm' | 'compact' | 'md' | 'formControl' | 'authRegister' | 'auth' | 'profile' | 'lg';

/** 将语义尺寸映射为控件高度、水平间距和字体大小。 */
export const inputSizeClassNames: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-[12px]',
  compact: 'h-[34px] px-3 text-[12px]',
  md: 'h-9 px-3 text-[12px]',
  formControl: 'h-[38px] px-3 text-[13px]',
  authRegister: 'h-[32px] px-3 text-[13px]',
  auth: 'h-[40px] px-3 text-[13px]',
  profile: 'h-[40px] px-[12px] text-[13px] max-[640px]:h-[44px]',
  lg: 'h-11 px-3.5 text-[13px]',
};
