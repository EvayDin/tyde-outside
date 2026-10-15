import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import RegisterFormPanel from './components/RegisterFormPanel';
import type {
  RegisterAccountType,
  RegisterFormController,
  RegisterFormValues,
  RegisterUploadType,
} from './types';

/** 注册表单保留源项目外观；输入和组织材料只留在当前页面内存中。 */
export function RegisterPage() {
  const [accountType, setAccountType] = useState<RegisterAccountType>('personal');
  const [notice, setNotice] = useState('');
  const [businessLicenseAsset, setBusinessLicenseAsset] = useState<{ fileName: string } | null>(
    null,
  );
  const [orgLogoUrl, setOrgLogoUrl] = useState('');
  const logoReader = useRef<FileReader | null>(null);
  const selectionVersion = useRef(0);
  const form = useForm<RegisterFormValues>({
    defaultValues: {
      roles: ['领航员'],
      phone: '',
      code: '',
      password: '',
      confirmPassword: '',
      realName: '',
      nickname: '',
      idCardNo: '',
      email: '',
      orgName: '',
      unifiedCreditCode: '',
      orgPosition: 'OWNER',
      orgDescription: '',
      expertiseTags: [],
    },
    mode: 'onBlur',
    shouldUnregister: true,
  });

  useEffect(
    () => () => {
      selectionVersion.current += 1;
      logoReader.current?.abort();
    },
    [],
  );

  const changeAccountType = (type: RegisterAccountType) => {
    if (type === accountType) return;
    selectionVersion.current += 1;
    logoReader.current?.abort();
    setBusinessLicenseAsset(null);
    setOrgLogoUrl('');
    setNotice('');
    form.reset({
      ...form.getValues(),
      roles: type === 'org' ? ['执行专家'] : ['领航员'],
      orgName: '',
      unifiedCreditCode: '',
      orgPosition: 'OWNER',
      orgDescription: '',
      expertiseTags: [],
    });
    setAccountType(type);
  };

  const selectFile = (file: File | undefined, type: RegisterUploadType) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setNotice('请选择 JPG、PNG、WebP 或 GIF 图片。');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setNotice('请选择不超过 10 MB 的图片。');
      return;
    }
    if (type === 'businessLicense') {
      setBusinessLicenseAsset({ fileName: file.name });
      setNotice('文件仅在本地选择，尚未上传。');
      return;
    }
    selectionVersion.current += 1;
    logoReader.current?.abort();
    const version = selectionVersion.current;
    const reader = new FileReader();
    logoReader.current = reader;
    reader.onload = () => {
      if (selectionVersion.current !== version || typeof reader.result !== 'string') return;
      setOrgLogoUrl(reader.result);
      setNotice('文件仅在本地选择，尚未上传。');
    };
    reader.onerror = () => {
      if (selectionVersion.current === version) setNotice('无法读取图片，请重新选择。');
    };
    reader.readAsDataURL(file);
  };

  const controller: RegisterFormController = {
    form,
    accountType,
    registering: false,
    upload: {
      businessLicenseAsset,
      orgLogoUrl,
      uploadingFile: null,
      selectFile,
    },
    sms: {
      sending: false,
      countdown: 0,
      send: () => setNotice('验证码功能暂未开放。'),
    },
    actions: {
      changeAccountType,
      realNameBlur: () => undefined,
      nicknameBlur: () => undefined,
      finish: () => setNotice('注册功能暂未开放，填写的信息尚未提交。'),
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[8px]">
      {notice && (
        <p
          role="status"
          aria-label="操作提示"
          className="flex-none rounded-[8px] bg-[#eef8fa] px-[12px] py-[10px] text-[13px] leading-[1.5] text-[#236578]"
        >
          {notice}
        </p>
      )}
      <RegisterFormPanel controller={controller} />
    </div>
  );
}
