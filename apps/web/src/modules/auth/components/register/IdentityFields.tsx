/** 渲染 React Hook Form 注册身份信息，不请求姓名或昵称校验接口。 */
import { useWatch } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import type { RegisterFormController } from '../../types';
import { registerInputClassName } from '../../styles';
import { FormSection } from '../RegisterFormParts';

/** 渲染个人实名、昵称、身份证号及邮箱字段。 */
export default function IdentityFields({
  controller,
  inputNameSuffix,
}: {
  controller: RegisterFormController;
  inputNameSuffix: string;
}) {
  const { form } = controller;
  const realName = useWatch({ control: form.control, name: 'realName' }) ?? '';
  const { errors } = form.formState;
  const realNameId = `register-real-name-${inputNameSuffix}`;
  const nicknameId = `register-nickname-${inputNameSuffix}`;
  const idCardId = `register-id-card-${inputNameSuffix}`;
  const realNameField = form.register('realName', {
    required: '请输入姓名',
    validate: (value) =>
      /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\-·]{0,63}$/.test(value.trim()) ||
      '姓名仅支持中英文、连字符与间隔号，最多 64 字符',
  });
  const nicknameField = form.register('nickname');

  return (
    <FormSection number="2" title="个人信息">
      <AuthFormField
        htmlFor={realNameId}
        label={
          <span>
            姓名 <em>*</em>
          </span>
        }
        error={errors.realName}
      >
        <Input
          id={realNameId}
          size="authRegister"
          className={registerInputClassName}
          autoComplete="off"
          maxLength={64}
          placeholder="必须与身份证保持一致"
          aria-invalid={Boolean(errors.realName)}
          {...realNameField}
        />
      </AuthFormField>
      <AuthFormField
        htmlFor={nicknameId}
        label={
          <span>
            昵称 <small>（选填）</small>
          </span>
        }
        error={errors.nickname}
      >
        <Input
          id={nicknameId}
          size="authRegister"
          className={registerInputClassName}
          autoComplete="off"
          maxLength={64}
          placeholder={realName || '默认展示真实姓名'}
          aria-invalid={Boolean(errors.nickname)}
          {...nicknameField}
        />
      </AuthFormField>
      <AuthFormField
        htmlFor={idCardId}
        label={
          <span>
            身份证号 <small>（选填）</small>
          </span>
        }
        error={errors.idCardNo}
      >
        <Input
          id={idCardId}
          size="authRegister"
          className={registerInputClassName}
          autoComplete="off"
          maxLength={18}
          placeholder="15或18位身份证（选填）"
          aria-invalid={Boolean(errors.idCardNo)}
          {...form.register('idCardNo', {
            validate: (value) =>
              !value?.trim() ||
              /^(\d{15}|\d{17}[0-9X])$/.test(value.trim().toUpperCase()) ||
              '请输入 15 位或 18 位身份证号',
          })}
        />
      </AuthFormField>
      <AuthFormField
        htmlFor="email"
        label={
          <span>
            邮箱 <small>（选填）</small>
          </span>
        }
        error={errors.email}
      >
        <Input
          id="email"
          size="authRegister"
          className={registerInputClassName}
          type="email"
          autoComplete="off"
          maxLength={128}
          placeholder="用于备用通知"
          aria-invalid={Boolean(errors.email)}
          {...form.register('email', {
            pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: '请输入有效邮箱' },
          })}
        />
      </AuthFormField>
    </FormSection>
  );
}
