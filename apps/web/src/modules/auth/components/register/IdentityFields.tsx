/** 渲染 React Hook Form 注册身份信息，不请求姓名或昵称校验接口。 */
import { useWatch } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import type { RegisterFormController } from '../../types';
import { registerInputClassName } from '../../styles';
import { FormSection } from '../RegisterFormParts';

/** 渲染个人实名、昵称及身份证号字段。 */
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
    validate: (value) => Boolean(value.trim()) || '请输入姓名',
  });
  const nicknameField = form.register('nickname');

  return (
    <FormSection number="2" title="身份信息">
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
          {...form.register('idCardNo')}
        />
      </AuthFormField>
    </FormSection>
  );
}
