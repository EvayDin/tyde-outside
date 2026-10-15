/** 渲染组织账号注册资料，并将输入边界接入 React Hook Form 与 shadcn 组件。 */
import { Controller } from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import AuthFormField from '@/components/ui/shared/AuthFormField';
import { FileUploadField } from '@/components/ui/shared/FileUploadField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleCheckboxGroup } from '@/components/ui/shared/ToggleCheckboxGroup';
import { ORG_POSITIONS, ORG_POSITION_LABEL } from '../../types';
import type { OrgPosition } from '../../types';
import type { RegisterFormController } from '../../types';
import { registerInputClassName } from '../../styles';
import { FormSection } from '../RegisterFormParts';

interface OrganizationPositionSelectProps {
  /** React Hook Form 提供的当前组织岗位。 */
  value?: OrgPosition;
  /** 将 shadcn Select 的值变化写回 React Hook Form。 */
  onChange?: (value: OrgPosition) => void;
  /** Select Trigger 的标签关联 ID。 */
  id?: string;
  /** 当前字段是否存在校验错误。 */
  invalid?: boolean;
}

/** 将组织岗位值域收窄后写回 React Hook Form 字段。 */
export function OrganizationPositionSelect({
  value,
  onChange,
  id,
  invalid,
}: OrganizationPositionSelectProps) {
  return (
    <Select
      value={value}
      disabled
      onValueChange={(nextValue) => {
        const position = ORG_POSITIONS.find((option) => option === nextValue);
        if (position) onChange?.(position);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label="组织内角色"
        aria-invalid={invalid}
        className="h-[32px] rounded-[6px] bg-muted text-[13px] leading-[1.4] text-foreground shadow-xs [font-family:inherit] disabled:cursor-default disabled:opacity-100"
      >
        <SelectValue placeholder="请选择组织内角色" />
      </SelectTrigger>
      <SelectContent>
        {ORG_POSITIONS.map((position) => (
          <SelectItem key={position} value={position}>
            {ORG_POSITION_LABEL[position]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 渲染组织注册资料、认证材料上传与能力标签字段。 */
export default function OrganizationFields({
  controller,
  inputNameSuffix,
}: {
  controller: RegisterFormController;
  inputNameSuffix: string;
}) {
  const { form, upload } = controller;
  const { errors } = form.formState;
  const orgNameId = `register-org-name-${inputNameSuffix}`;
  const creditCodeId = `register-credit-code-${inputNameSuffix}`;
  const positionId = `register-org-position-${inputNameSuffix}`;
  const descriptionId = `register-org-description-${inputNameSuffix}`;

  return (
    <FormSection number="1" title="组织信息">
      <AuthFormField
        htmlFor={orgNameId}
        className="col-span-full max-[580px]:col-auto"
        label={
          <span>
            组织名称 <em>*</em>
          </span>
        }
        error={errors.orgName}
      >
        <Input
          id={orgNameId}
          size="authRegister"
          className={registerInputClassName}
          autoComplete="off"
          maxLength={128}
          placeholder="例如：中国海洋科学开发有限公司"
          aria-invalid={Boolean(errors.orgName)}
          {...form.register('orgName', {
            required: '请输入组织名称',
            validate: (value) => Boolean(value?.trim()) || '请输入组织名称',
          })}
        />
      </AuthFormField>
      <AuthFormField
        htmlFor={creditCodeId}
        label={
          <span>
            统一社会信用代码 <small>（选填）</small>
          </span>
        }
        error={errors.unifiedCreditCode}
      >
        <Input
          id={creditCodeId}
          size="authRegister"
          className={registerInputClassName}
          autoComplete="off"
          maxLength={18}
          placeholder="18位统一社会信用代码"
          aria-invalid={Boolean(errors.unifiedCreditCode)}
          {...form.register('unifiedCreditCode')}
        />
      </AuthFormField>
      <Controller
        control={form.control}
        name="orgPosition"
        render={({ field, fieldState }) => (
          <AuthFormField
            htmlFor={positionId}
            label={
              <span>
                组织内角色 <em>*</em>
              </span>
            }
            error={fieldState.error}
          >
            <OrganizationPositionSelect
              id={positionId}
              value={field.value}
              onChange={field.onChange}
              invalid={fieldState.invalid}
            />
          </AuthFormField>
        )}
      />
      <AuthFormField
        htmlFor={descriptionId}
        className="col-span-full max-[580px]:col-auto"
        label={
          <span>
            组织简介 <small>（选填）</small>
          </span>
        }
        error={errors.orgDescription}
      >
        <Textarea
          id={descriptionId}
          className="min-h-[76px] resize-y rounded-[6px] text-[13px] leading-[1.4] [font-family:inherit] placeholder:text-[13px] placeholder:text-[#a6b4bf]"
          rows={3}
          maxLength={1024}
          placeholder="请简述组织的业务专长与海洋协调协作领域..."
          aria-invalid={Boolean(errors.orgDescription)}
          {...form.register('orgDescription')}
        />
      </AuthFormField>
      <div className="col-span-full grid grid-cols-2 gap-[12px] max-[580px]:col-auto max-[580px]:grid-cols-1">
        <OrganizationUpload
          label="营业执照照片"
          alt="营业执照预览"
          emptyText="选择营业执照照片"
          type="businessLicense"
          preview={
            upload.businessLicenseAsset ? { fileName: upload.businessLicenseAsset.fileName } : null
          }
          upload={upload}
        />
        <OrganizationUpload
          label="组织 Logo"
          alt="组织 Logo 预览"
          emptyText="选择组织 Logo 图片"
          type="orgLogo"
          preview={upload.orgLogoUrl ? { url: upload.orgLogoUrl } : null}
          upload={upload}
        />
      </div>
      <Controller
        control={form.control}
        name="expertiseTags"
        render={({ field, fieldState }) => (
          <Field
            data-invalid={fieldState.invalid}
            className="col-span-full gap-[5px] max-[580px]:col-auto"
          >
            <FieldLabel className="text-[12px] font-[650] text-[#3b5262]">
              擅长领域 <small className="text-[inherit] text-[#91a1ae]">（可多选）</small>
            </FieldLabel>
            <ToggleCheckboxGroup
              value={field.value}
              onChange={field.onChange}
              variant="pill"
              ariaLabel="擅长领域"
              options={['数据标注', '潮汐预测', '航线规划', '质量审核', '项目管理', '海洋数据']}
            />
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
          </Field>
        )}
      />
    </FormSection>
  );
}

/** 仅展示本地选中的图片预览或文件名，不包含上传凭证。 */
type OrganizationUploadPreview = { url: string } | { fileName: string } | null;

/** 保留原版材料选择外观，文件只在本地内存中展示。 */
function OrganizationUpload({
  label,
  alt,
  emptyText,
  type,
  preview,
  upload,
}: {
  label: string;
  alt: string;
  emptyText: string;
  type: 'businessLicense' | 'orgLogo';
  preview: OrganizationUploadPreview;
  upload: RegisterFormController['upload'];
}) {
  return (
    <div className="relative min-w-0">
      <span className="mb-[7px] block text-[12px] font-[650] text-[#3b5262]">
        {label} <small className="text-[inherit] text-[#91a1ae]">（选填）</small>
      </span>
      <FileUploadField
        aria-label={emptyText}
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={upload.uploadingFile !== null}
        onFilesSelected={(files) => upload.selectFile(files[0], type)}
        contentClassName="min-h-[105px] w-full flex-col items-center justify-center gap-[7px] rounded-[7px] border border-dashed border-[#bbced9] bg-[#fbfdfe] font-medium text-[#2698b0]"
      >
        {preview && 'url' in preview ? (
          <img
            className="h-[103px] w-full rounded-[6px] object-contain"
            src={preview.url}
            alt={alt}
          />
        ) : preview ? (
          <span className="max-w-full truncate px-[12px]">{preview.fileName}</span>
        ) : (
          <>
            <b className="text-[29px] leading-none font-normal">↥</b>
            <span>{upload.uploadingFile === type ? '上传中...' : emptyText}</span>
          </>
        )}
      </FileUploadField>
    </div>
  );
}
