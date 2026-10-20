import { platform } from '@tyde/platform';
import type { AuthApi, AuthUser } from '@tyde/shared';

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

export const api: AuthApi = {
  ...platform.auth,
  getCurrentUser: currentUser,
};
export const isDesktop = platform.isElectron;
export const capabilities = platform.capabilities;
