import { platform } from '@tyde/platform';
import { ApiError, passwordPattern, type AuthApi, type AuthUser } from '@tyde/shared';

/** 仅用于个人中心的前端演示，不代表已约定的后端 DTO。 */
export interface ProfilePreviewInput {
  idCardNo?: string;
  bio?: string;
  avatar?: File | null;
  newPassword?: string;
  confirmNewPassword?: string;
}

let preview: { userId: string; fields: Partial<AuthUser> } | undefined;
let avatarUrl: string | undefined;
function clearPreview() {
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = undefined;
  preview = undefined;
}
function invalid(message: string): never {
  throw new ApiError(400, { code: 'INVALID_PREVIEW', message });
}

/** 临时开发预览仅替换当前用户查询；设置 VITE_MOCK_CURRENT_USER=false 恢复真实请求。 */
async function currentUser(): Promise<AuthUser> {
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_CURRENT_USER !== 'false')
    return {
      id: 'dev-preview-user',
      uid: 'TYDE10001',
      accountType: 'INDIVIDUAL',
      phone: '138****0000',
      nickname: '前端预览',
      realName: '测试用户',
      idCardNo: null,
      idVerified: 0,
      avatarUrl: null,
      bio: '用于本地页面开发的测试资料。',
      role: 'EXPERT',
      roles: ['EXPERT'],
      selectedRole: 'EXPERT',
      hasExpertManagementRole: false,
      status: 'ACTIVE',
      creditScore: 100,
      lastLoginAt: null,
      lastLoginIp: null,
      organization: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  return platform.auth.getCurrentUser();
}

export const api: AuthApi & {
  updateProfilePreview(user: AuthUser, input: ProfilePreviewInput): Promise<AuthUser>;
} = {
  ...platform.auth,
  getCurrentUser: async () => {
    try {
      const user = await currentUser();
      if (preview && preview.userId !== user.id) clearPreview();
      return { ...user, ...preview?.fields };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearPreview();
      throw error;
    }
  },
  login: async (input) => {
    clearPreview();
    await platform.auth.login(input);
  },
  verifyCode: (input) => {
    clearPreview();
    return platform.auth.verifyCode(input);
  },
  logout: async () => {
    await platform.auth.logout();
    clearPreview();
  },
  /** 两端共用的临时内存 mock；不请求资料/上传接口，不保存或修改真实密码。 */
  updateProfilePreview: async (user, input) => {
    const idCardNo = input.idCardNo?.trim().toUpperCase();
    if (idCardNo && !/^(\d{15}|\d{17}[0-9X])$/.test(idCardNo)) invalid('身份证号格式不正确');
    const bio = input.bio?.trim();
    if (bio !== undefined && [...bio].length > 200) invalid('个人简介不能超过 200 字符');
    if (input.newPassword !== undefined || input.confirmNewPassword !== undefined) {
      if (!input.newPassword || input.newPassword !== input.confirmNewPassword)
        invalid('请填写一致的新密码和确认密码');
      if (!new RegExp(passwordPattern).test(input.newPassword))
        invalid('密码须为 8～64 位，且包含英文字母和数字');
    }
    if (input.avatar) {
      if (
        !['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'].includes(
          input.avatar.type,
        )
      )
        invalid('请选择 JPG、PNG、GIF、BMP 或 WebP 格式的图片');
      if (!input.avatar.size || input.avatar.size > 2 * 1024 * 1024)
        invalid('头像图片不能为空且不能超过 2 MiB');
    }
    if (preview?.userId !== user.id) clearPreview();
    const fields: Partial<AuthUser> = { ...preview?.fields, updatedAt: new Date().toISOString() };
    if (bio !== undefined) fields.bio = bio || null;
    if (idCardNo && user.idVerified !== 1)
      fields.idCardNo = idCardNo.slice(0, 3) + '*'.repeat(idCardNo.length - 6) + idCardNo.slice(-3);
    if (input.avatar !== undefined) {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
      avatarUrl = input.avatar ? URL.createObjectURL(input.avatar) : undefined;
      fields.avatarUrl = avatarUrl ?? null;
    }
    preview = { userId: user.id, fields };
    return { ...user, ...fields };
  },
};
export const isDesktop = platform.isElectron;
export const capabilities = platform.capabilities;
