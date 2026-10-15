/** 渲染注册账号主体类型和由 React Hook Form 管理的系统角色选择。 */
import { Controller } from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { SegmentedControl } from '@/components/ui/shared/SegmentedControl';
import { ToggleCheckboxGroup } from '@/components/ui/shared/ToggleCheckboxGroup';
import type { RegisterFormController } from '../../types';

interface RegisterAccountChoicesProps {
  /** 注册控制器提供账号类型与表单 control。 */
  controller: RegisterFormController;
  /** 切换个人或组织账号类型。 */
  changeAccountType: RegisterFormController['actions']['changeAccountType'];
}

/** 选择个人或组织注册类型，并展示相应角色约束。 */
export default function RegisterAccountChoices({
  controller,
  changeAccountType,
}: RegisterAccountChoicesProps) {
  const { accountType, form } = controller;

  return (
    <section className="mb-[22px] grid grid-cols-[1fr_1.05fr] gap-[16px] rounded-[17px] border border-[#edf0f4] bg-[#f8fafc] px-[17px] py-[16px] max-[580px]:grid-cols-1 max-[580px]:gap-[14px]">
      <div>
        <label className="mb-[7px] block text-[12px] font-[650] text-[#3b5262]">
          账号类型 <em className="not-italic text-[#e0474d]">*</em>
        </label>
        <SegmentedControl
          className="w-full"
          name="register-account-type"
          ariaLabel="账号类型"
          value={accountType}
          required
          options={[
            { value: 'personal', label: '个人' },
            { value: 'org', label: '组织' },
          ]}
          onValueChange={changeAccountType}
        />
      </div>
      <Controller
        control={form.control}
        name="roles"
        rules={{ validate: (roles) => roles.length > 0 || '请至少选择一个角色' }}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid} className="gap-[5px]">
            <FieldLabel className="mb-[2px] text-[12px] font-[650] text-[#3b5262]">
              角色选择
              <em className="not-italic text-[#e0474d]">*</em>
              <small className="text-[inherit] text-[#91a1ae]">（可多选）</small>
            </FieldLabel>
            <ToggleCheckboxGroup
              value={field.value}
              onChange={field.onChange}
              variant="button"
              ariaLabel="角色选择"
              required
              options={['领航员', '策略官', '执行专家']}
              disabledOptions={accountType === 'org' ? ['领航员', '策略官'] : []}
            />
            <FieldError
              errors={fieldState.error ? [fieldState.error] : undefined}
              className="text-[12px] leading-[1.5]"
            />
          </Field>
        )}
      />
    </section>
  );
}
