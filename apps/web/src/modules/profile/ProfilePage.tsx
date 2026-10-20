import { useEffect, useRef, useState, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Fingerprint,
  Pencil,
  Phone,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { passwordPattern, type AuthUser } from '@tyde/shared';
import { UserAvatar } from '@/components/UserAvatar';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/shared/FormField';
import AuthPasswordInput from '@/components/ui/shared/AuthPasswordInput';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SESSION_KEY } from '@/hooks/useSession';
import { api, type ProfilePreviewInput } from '@/services/api';
import { ProfileCharts } from './ProfileCharts';

type ProfileValues = { idCardNo: string; bio: string };

/** 以本人资料为侧栏，概览仅为获准的图表提供明确标注的示例数据。 */
export function ProfilePage({ user }: { user: AuthUser }) {
  const name = user.nickname || user.realName;
  const [section, setSection] = useState('overview');
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const created = formatProfileDate(user.createdAt);
  const lastLogin = user.lastLoginAt ? formatProfileDate(user.lastLoginAt) : null;

  return (
    <div className="mx-auto max-w-[1200px]">
      <Tabs
        value={section}
        onValueChange={(value) => {
          setSection(value);
          setEditing(false);
        }}
        className="grid min-w-0 items-start gap-[32px] lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-[40px]"
      >
        <aside aria-label="个人资料摘要" className="min-w-0">
          <div className="flex min-w-0 items-center gap-[20px] lg:flex-col lg:items-start">
            <UserAvatar
              url={user.avatarUrl}
              name={name}
              className="size-[104px] rounded-full border border-border text-[42px] sm:size-[128px] lg:size-[224px] lg:text-[88px]"
            />
            <div className="min-w-0 flex-1">
              <h1 className="m-0 break-words text-[24px] leading-[32px] font-semibold tracking-normal">
                {name}
              </h1>
              {user.realName !== name && (
                <p className="mt-[4px] break-words text-[16px] leading-[24px] text-[var(--color-neutral-strong)]">
                  {user.realName}
                </p>
              )}
              <div className="mt-[12px] flex flex-wrap gap-[8px] text-[12px] leading-[20px]">
                <span className="rounded-[6px] border bg-card px-[8px] py-[2px] text-[var(--color-neutral-strong)]">
                  {user.accountType === 'ORGANIZATION' ? '组织账号' : '个人账号'}
                </span>
                <span className="inline-flex items-center gap-[4px] rounded-[6px] bg-accent px-[8px] py-[2px] text-[var(--color-primary-strong)]">
                  <BadgeCheck className="size-[14px]" aria-hidden />
                  执行专家
                </span>
              </div>
            </div>
          </div>
          <Button
            ref={editButton}
            variant="outline"
            size="settings"
            disabled={editing}
            className="mt-[20px] w-full text-foreground"
            onClick={() => {
              setSection('profile');
              setEditing(true);
            }}
          >
            <Pencil className="size-[16px]" aria-hidden />
            {editing ? '正在编辑' : '编辑资料'}
          </Button>
          {user.bio?.trim() && (
            <p className="mt-[20px] break-words whitespace-pre-wrap text-[14px] leading-[24px]">
              {user.bio}
            </p>
          )}
          <dl className="mt-[20px] flex flex-col gap-[12px] text-[13px] leading-[20px]">
            <div className="flex items-start gap-[8px]">
              <Phone
                className="mt-[2px] size-[16px] shrink-0 text-[var(--color-neutral-strong)]"
                aria-hidden
              />
              <dt className="sr-only">绑定手机</dt>
              <dd className="break-all font-mono">{user.phone}</dd>
            </div>
            <div className="flex items-start gap-[8px]">
              <Fingerprint
                className="mt-[2px] size-[16px] shrink-0 text-[var(--color-neutral-strong)]"
                aria-hidden
              />
              <dt className="sr-only">用户编号</dt>
              <dd className="break-all font-mono">{user.uid}</dd>
            </div>
            {user.idCardNo && (
              <div className="flex items-start gap-[8px]">
                <ShieldCheck
                  className="mt-[2px] size-[16px] shrink-0 text-[var(--color-neutral-strong)]"
                  aria-hidden
                />
                <dt className="sr-only">身份证号</dt>
                <dd className="break-all font-mono">{user.idCardNo}</dd>
              </div>
            )}
            {created && (
              <div className="flex items-start gap-[8px]">
                <CalendarDays
                  className="mt-[2px] size-[16px] shrink-0 text-[var(--color-neutral-strong)]"
                  aria-hidden
                />
                <dt className="sr-only">注册时间</dt>
                <dd>注册于 {created}</dd>
              </div>
            )}
            {lastLogin && (
              <div className="flex items-start gap-[8px]">
                <UserRound
                  className="mt-[2px] size-[16px] shrink-0 text-[var(--color-neutral-strong)]"
                  aria-hidden
                />
                <dt className="sr-only">最近登录</dt>
                <dd>最近登录 {lastLogin}</dd>
              </div>
            )}
          </dl>
          <ProfileOrganization organization={user.organization} />
        </aside>
        <div className="min-w-0">
          <TabsList
            aria-label="个人中心设置"
            className="mb-[24px] flex h-auto w-full justify-start gap-[16px] rounded-none border-b bg-transparent p-0"
          >
            <TabsTrigger
              value="overview"
              className="h-[48px] gap-[8px] rounded-none border-b-2 border-transparent px-[8px] text-[13px] text-[var(--color-neutral-strong)] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              <BookOpen className="size-[17px]" aria-hidden />
              概览
            </TabsTrigger>
            <TabsTrigger
              value="profile"
              className="h-[48px] gap-[8px] rounded-none border-b-2 border-transparent px-[8px] text-[13px] text-[var(--color-neutral-strong)] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              <UserRound className="size-[17px]" aria-hidden />
              个人资料
            </TabsTrigger>
            <TabsTrigger
              value="security"
              className="h-[48px] gap-[8px] rounded-none border-b-2 border-transparent px-[8px] text-[13px] text-[var(--color-neutral-strong)] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              <ShieldCheck className="size-[17px]" aria-hidden />
              账户安全
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="m-0">
            <ProfileCharts />
          </TabsContent>
          <TabsContent value="profile" className="m-0 flex-col gap-[20px] data-[state=active]:flex">
            <ProfilePreviewNotice />
            <div className="rounded-[8px] border bg-card p-[20px] sm:p-[24px]">
              <ProfileDetails
                user={user}
                editing={editing}
                setEditing={setEditing}
                editButton={editButton}
              />
            </div>
          </TabsContent>
          <TabsContent
            value="security"
            className="m-0 flex-col gap-[20px] data-[state=active]:flex"
          >
            <ProfilePreviewNotice />
            <div className="rounded-[8px] border bg-card p-[20px] sm:p-[24px]">
              <PasswordSettings user={user} />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function formatProfileDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date)
    : null;
}

function ProfilePreviewNotice() {
  return (
    <Alert className="text-[13px] leading-[22px]">
      当前为前端演示：资料修改仅在本次页面内生效，刷新后恢复；实际登录密码不会改变。
    </Alert>
  );
}

function ProfileOrganization({ organization }: { organization: AuthUser['organization'] }) {
  if (!organization || typeof organization.name !== 'string' || !organization.name.trim())
    return null;
  const name = organization.name.trim();
  const description =
    typeof organization.description === 'string' ? organization.description.trim() : '';
  const logo = typeof organization.logoUrl === 'string' ? organization.logoUrl : null;
  const position =
    organization.position === 'OWNER'
      ? '主管'
      : organization.position === 'ADMIN'
        ? '管理员'
        : organization.position === 'MEMBER'
          ? '成员'
          : undefined;
  const tags = Array.isArray(organization.expertiseTags)
    ? organization.expertiseTags.filter(
        (tag): tag is string => typeof tag === 'string' && !!tag.trim(),
      )
    : [];
  return (
    <section aria-label="所属组织" className="mt-[24px] border-t pt-[20px]">
      <h3 className="m-0 text-[14px] leading-[22px] font-semibold">所属组织</h3>
      <div className="mt-[12px] flex items-start gap-[10px]">
        <UserAvatar url={logo} name={name} className="size-[32px] rounded-[6px] text-[14px]" />
        <div className="min-w-0">
          <p className="break-words text-[13px] leading-[20px] font-medium">{name}</p>
          {position && (
            <p className="mt-[2px] text-[12px] leading-[18px] text-[var(--color-neutral-strong)]">
              {position}
            </p>
          )}
        </div>
      </div>
      {description && (
        <p className="mt-[12px] break-words text-[13px] leading-[22px] text-[var(--color-neutral-strong)]">
          {description}
        </p>
      )}
      {tags.length > 0 && (
        <div aria-label="组织领域" className="mt-[12px] flex flex-wrap gap-[6px]">
          {tags.map((tag, index) => (
            <span
              key={index}
              className="rounded-[5px] border bg-card px-[7px] py-[2px] text-[11px] leading-[18px] text-[var(--color-neutral-strong)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function ProfileDetails({
  user,
  editing,
  setEditing,
  editButton,
}: {
  user: AuthUser;
  editing: boolean;
  setEditing: (value: boolean) => void;
  editButton: RefObject<HTMLButtonElement | null>;
}) {
  const cache = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>();
  const [avatar, setAvatar] = useState<{ file: File; preview: string }>();
  const [clearAvatar, setClearAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useForm<ProfileValues>({
    defaultValues: { idCardNo: '', bio: user.bio ?? '' },
    mode: 'onBlur',
  });
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      form.reset({ idCardNo: '', bio: user.bio ?? '' });
      form.setFocus(user.idVerified === 1 ? 'bio' : 'idCardNo');
    }
    wasEditing.current = editing;
  }, [editing, form, user.bio, user.idVerified]);
  const preview = avatar?.preview;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function finishEditing() {
    setEditing(false);
    setAvatar(undefined);
    setClearAvatar(false);
    setAvatarError('');
    form.reset();
    requestAnimationFrame(() => editButton.current?.focus());
  }

  async function save(values: ProfileValues) {
    if (saving || avatarError) return;
    setSaving(true);
    setError(undefined);
    const input: ProfilePreviewInput = { bio: values.bio.trim() };
    if (values.idCardNo.trim()) input.idCardNo = values.idCardNo.trim().toUpperCase();
    if (avatar) input.avatar = avatar.file;
    else if (clearAvatar) input.avatar = null;
    try {
      await cache.cancelQueries({ queryKey: SESSION_KEY });
      const updated = await api.updateProfilePreview(user, input);
      cache.setQueryData(SESSION_KEY, updated);
      finishEditing();
      setNotice('个人资料已模拟保存，刷新页面后恢复。');
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="profile-details-title" className="flex flex-col gap-[24px]">
      <div className="flex items-center justify-between gap-[16px] border-b border-[var(--color-divider)] pb-[20px]">
        <div>
          <h2 id="profile-details-title" className="m-0 text-[17px] leading-[26px] font-semibold">
            基本信息
          </h2>
          <p className="mt-[4px] text-[13px] leading-[22px] text-[var(--color-neutral-strong)]">
            查看和完善你的账户信息。
          </p>
        </div>
      </div>
      {notice && <Alert>{notice}</Alert>}
      {editing ? (
        <form noValidate className="flex flex-col gap-[24px]" onSubmit={form.handleSubmit(save)}>
          <fieldset disabled={saving} className="m-0 min-w-0 space-y-[24px] border-0 p-0">
            <FormField
              labelClassName="text-[13px] leading-[20px] font-medium"
              controlId="profile-avatar"
              label="头像"
              error={avatarError}
              description="支持 JPG、PNG、GIF、BMP、WebP，大小不超过 2 MB。"
            >
              {({ invalid, describedBy }) => (
                <div className="flex flex-wrap items-center gap-[12px]">
                  <UserAvatar
                    url={avatar?.preview ?? (clearAvatar ? null : user.avatarUrl)}
                    name={user.nickname || user.realName}
                    className="size-[56px] rounded-[12px] text-[24px]"
                  />
                  <input
                    ref={fileInput}
                    id="profile-avatar"
                    aria-label="更换头像"
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/bmp,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      if (
                        ![
                          'image/jpeg',
                          'image/png',
                          'image/gif',
                          'image/bmp',
                          'image/webp',
                        ].includes(file.type)
                      ) {
                        setAvatarError('请选择 JPG、PNG、GIF、BMP 或 WebP 图片');
                        return;
                      }
                      if (!file.size || file.size > 2 * 1024 * 1024) {
                        setAvatarError('请选择非空且不超过 2 MB 的头像图片');
                        return;
                      }
                      setAvatarError('');
                      setAvatar({ file, preview: URL.createObjectURL(file) });
                      setClearAvatar(false);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="settings"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload className="size-[16px]" aria-hidden />
                    更换头像
                  </Button>
                  {(avatar || (!clearAvatar && user.avatarUrl)) && (
                    <Button
                      variant="ghost"
                      size="settings"
                      onClick={() => {
                        setAvatar(undefined);
                        setClearAvatar(true);
                        setAvatarError('');
                      }}
                    >
                      <Trash2 className="size-[16px]" aria-hidden />
                      清除头像
                    </Button>
                  )}
                </div>
              )}
            </FormField>
            <FormField
              labelClassName="text-[13px] leading-[20px] font-medium"
              controlId="profile-id-card"
              label="身份证号"
              error={form.formState.errors.idCardNo?.message}
              description={
                user.idVerified === 1
                  ? '已实名认证，身份证号不可修改。'
                  : `留空保留原值${user.idCardNo ? `（${user.idCardNo}）` : ''}，已有号码不会回填。`
              }
            >
              {({ invalid, describedBy }) => (
                <Input
                  id="profile-id-card"
                  size="profile"
                  className="rounded-[8px] bg-card shadow-none"
                  autoComplete="off"
                  maxLength={18}
                  placeholder="请输入 15 位或 18 位身份证号"
                  disabled={user.idVerified === 1}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  {...form.register('idCardNo', {
                    validate: (value) =>
                      !value.trim() ||
                      /^(\d{15}|\d{17}[0-9X])$/.test(value.trim().toUpperCase()) ||
                      '请输入 15 位或 18 位身份证号',
                  })}
                />
              )}
            </FormField>
            <FormField
              labelClassName="text-[13px] leading-[20px] font-medium"
              controlId="profile-bio"
              label="个人简介"
              error={form.formState.errors.bio?.message}
              description="选填，最多 200 个字符。"
            >
              {({ invalid, describedBy }) => (
                <Textarea
                  id="profile-bio"
                  className="min-h-[120px] rounded-[8px] bg-card px-[12px] py-[10px] text-[13px] leading-[22px] shadow-none"
                  maxLength={200}
                  placeholder="介绍你的专业背景、擅长领域或协作经验"
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  {...form.register('bio', {
                    maxLength: { value: 200, message: '个人简介不能超过 200 个字符' },
                  })}
                />
              )}
            </FormField>
          </fieldset>
          <ErrorNotice error={error} />
          <div className="flex gap-[12px] border-t border-[var(--color-divider)] pt-[20px]">
            <Button
              variant="outline"
              size="settings"
              disabled={saving}
              onClick={() => {
                finishEditing();
                setError(undefined);
              }}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="dark"
              size="settings"
              loading={saving}
              disabled={!!avatarError}
            >
              保存修改
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-x-[32px] gap-y-[24px] text-[13px] leading-[22px] sm:grid-cols-2">
          <div>
            <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">真实姓名</dt>
            <dd className="break-words">{user.realName}</dd>
          </div>
          <div>
            <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">系统角色</dt>
            <dd>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[12px] text-[var(--color-primary-strong)]">
                <BadgeCheck className="size-[16px]" aria-hidden />
                执行专家
              </span>
            </dd>
          </div>
          <div>
            <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">绑定手机</dt>
            <dd className="font-mono">{user.phone}</dd>
          </div>
          <div>
            <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">用户编号</dt>
            <dd className="break-all font-mono">{user.uid}</dd>
          </div>
          <div>
            <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">身份证号</dt>
            <dd className="break-all font-mono">{user.idCardNo || '未填写'}</dd>
          </div>
          <div>
            <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">实名认证</dt>
            <dd>{user.idVerified === 1 ? '已认证' : '未认证'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">个人简介</dt>
            <dd className="min-h-[44px] break-words whitespace-pre-wrap leading-[22px]">
              {user.bio || '还没有填写个人简介，点击编辑资料介绍一下自己吧。'}
            </dd>
          </div>
          {typeof user.organization?.name === 'string' && (
            <div className="sm:col-span-2">
              <dt className="mb-[6px] text-[12px] text-[var(--color-neutral-strong)]">所属组织</dt>
              <dd className="break-words">{user.organization.name}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function PasswordSettings({ user }: { user: AuthUser }) {
  const cache = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>();
  const form = useForm<{ newPassword: string; confirmNewPassword: string }>({
    defaultValues: { newPassword: '', confirmNewPassword: '' },
    mode: 'onBlur',
  });
  return (
    <section aria-labelledby="security-title" className="flex flex-col gap-[24px]">
      <div className="border-b border-[var(--color-divider)] pb-[20px]">
        <h2 id="security-title" className="m-0 text-[17px] leading-[26px] font-semibold">
          登录密码
        </h2>
        <p className="mt-[6px] text-[13px] leading-[22px] text-[var(--color-neutral-strong)]">
          当前仅演示密码修改，不改变实际登录密码或登录状态。
        </p>
      </div>
      {notice && <Alert>{notice}</Alert>}
      <form
        noValidate
        className="flex flex-col gap-[24px]"
        onSubmit={form.handleSubmit(async (values) => {
          if (saving) return;
          setSaving(true);
          setNotice('');
          setError(undefined);
          try {
            await cache.cancelQueries({ queryKey: SESSION_KEY });
            const updated = await api.updateProfilePreview(user, values);
            cache.setQueryData(SESSION_KEY, updated);
            form.reset();
            setNotice('已模拟修改，实际登录密码未改变');
          } catch (failure) {
            setError(failure);
          } finally {
            setSaving(false);
          }
        })}
      >
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user.uid}
          readOnly
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <fieldset disabled={saving} className="m-0 min-w-0 space-y-[24px] border-0 p-0">
          <FormField
            labelClassName="text-[13px] leading-[20px] font-medium"
            controlId="profile-password"
            label="新密码"
            required
            error={form.formState.errors.newPassword?.message}
            description="8～64 位，须同时包含字母和数字，不支持空格或中文。"
          >
            {({ invalid, describedBy }) => (
              <AuthPasswordInput
                id="profile-password"
                size="profile"
                className="rounded-[8px] bg-card shadow-none"
                maxLength={64}
                autoComplete="new-password"
                placeholder="请输入新密码"
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                {...form.register('newPassword', {
                  required: '请输入新密码',
                  validate: (value) =>
                    new RegExp(passwordPattern).test(value) ||
                    '请输入 8～64 位字母、数字及允许的特殊字符，不能含空格或中文',
                })}
              />
            )}
          </FormField>
          <FormField
            labelClassName="text-[13px] leading-[20px] font-medium"
            controlId="profile-confirm-password"
            label="确认新密码"
            required
            error={form.formState.errors.confirmNewPassword?.message}
          >
            {({ invalid, describedBy }) => (
              <AuthPasswordInput
                id="profile-confirm-password"
                size="profile"
                className="rounded-[8px] bg-card shadow-none"
                maxLength={64}
                autoComplete="new-password"
                placeholder="请再次输入新密码"
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                {...form.register('confirmNewPassword', {
                  required: '请再次输入新密码',
                  validate: (value) =>
                    value === form.getValues('newPassword') || '两次输入的新密码不一致',
                })}
              />
            )}
          </FormField>
        </fieldset>
        <ErrorNotice error={error} />
        <div>
          <Button type="submit" variant="dark" size="settings" loading={saving}>
            更新密码
          </Button>
        </div>
      </form>
    </section>
  );
}
