import { randomInt, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type User, type Organization } from '@prisma/client';
import type {
  AuthUser,
  LoginInput,
  LoginResponse,
  SmsSendInput,
  SmsLoginInput,
  SmsRegisterInput,
  PasswordResetInput,
} from '@tyde/shared';
import type { Config } from '../../config/index.js';
import { AuthError } from './auth.error.js';
import {
  codeDigest,
  digest,
  matchesDigest,
  MOCK_CODE,
  newToken,
  SESSION_DAYS,
  type ClientType,
} from './security.js';
import { hashPassword, verifyPassword } from './password.js';
import { MockSmsProvider, type SmsProvider } from './sms.js';
import { FileRegistryService } from '../files/file-registry.service.js';
import { createObjectStorage } from '../files/object-storage.js';
type Tx = Prisma.TransactionClient;
type Profile = User & { organization?: Organization | null };
// 服务端业务身份；角色只表示登录身份，业务权限和数据范围仍由各模块检查。
export interface AuthPrincipal {
  userId: string;
  uid: string;
  sessionId: string;
  role: 'EXPERT';
  clientType: ClientType;
}
const invalid = (message: string) => new AuthError(400, 'VALIDATION_ERROR', message);
const unauthorized = () => new AuthError(401, 'UNAUTHENTICATED', '登录已过期，请重新登录');
function phoneNumber(phone: string): string {
  return `+86${phone}`;
}
async function lock(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}
function publicUser(user: Profile, current = false): AuthUser {
  const org = user.organization;
  return {
    id: user.id,
    uid: user.uid,
    accountType: user.accountType as AuthUser['accountType'],
    phone: user.phoneE164.slice(3).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
    nickname: user.displayName,
    realName: user.realName ?? user.displayName,
    idCardNo: user.idCardNo
      ? `${user.idCardNo.slice(0, 3)}${'*'.repeat(user.idCardNo.length - 7)}${user.idCardNo.slice(-4)}`
      : null,
    idVerified: 0,
    avatarUrl: null,
    bio: null,
    role: 'EXPERT',
    roles: ['EXPERT'],
    selectedRole: current ? 'EXPERT' : null,
    hasExpertManagementRole: Boolean(
      current && org && ['OWNER', 'ADMIN'].includes(user.orgPosition ?? ''),
    ),
    status: user.status,
    creditScore: 100,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastLoginIp: user.lastLoginIp,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    organization: org
      ? {
          id: org.id,
          name: org.name,
          unifiedCreditCode: org.unifiedCreditCode,
          description: org.description,
          businessLicenseUrl: org.businessLicenseKey ?? null,
          logoUrl: org.logoUrl,
          expertiseTags: org.expertiseTags,
          verifyStatus: 'PENDING',
          status: 'ACTIVE',
          position: user.orgPosition,
          joinStatus: 'ACTIVE',
          createdAt: org.createdAt.toISOString(),
        }
      : null,
  };
}
export class AuthService {
  constructor(
    readonly db: PrismaClient,
    private readonly config: Config,
    private readonly sms: SmsProvider = new MockSmsProvider(),
    private readonly files = new FileRegistryService(
      db,
      createObjectStorage(config.files),
      config.files,
    ),
  ) {}
  private async rate(entries: { key: string; max: number; seconds: number }[]) {
    const now = Date.now();
    const limited = await this.db.$transaction(async (tx) => {
      let retry = 0;
      for (const e of [...entries].sort((a, b) => a.key.localeCompare(b.key))) {
        const window = Math.floor(now / (e.seconds * 1000));
        const expiresAt = new Date((window + 1) * e.seconds * 1000);
        const row = await tx.authRateLimit.upsert({
          where: { key: `${e.key}:${window}` },
          create: { key: `${e.key}:${window}`, count: 1, expiresAt },
          update: { count: { increment: 1 } },
        });
        if (row.count > e.max)
          retry = Math.max(retry, Math.ceil((expiresAt.getTime() - now) / 1000));
      }
      return retry;
    });
    if (limited) throw new AuthError(429, 'RATE_LIMITED', '操作过于频繁，请稍后重试', limited);
  }
  async sendCode(input: SmsSendInput, ip: string) {
    const phone = phoneNumber(input.phone);
    await this.rate([
      { key: `send-phone:${phone}`, max: 5, seconds: 900 },
      { key: `send-ip:${digest(ip)}`, max: 30, seconds: 900 },
    ]);
    const result = await this.db.$transaction(
      async (tx) => {
        await lock(tx, phone);
        const now = new Date();
        const recent = await tx.verificationChallenge.findFirst({
          where: { phoneE164: phone },
          orderBy: { createdAt: 'desc' },
        });
        const wait = recent
          ? Math.ceil((recent.createdAt.getTime() + 60_000 - now.getTime()) / 1000)
          : 0;
        if (wait > 0) return new AuthError(429, 'RATE_LIMITED', '请等待后重新获取验证码', wait);
        const id = randomUUID();
        const code =
          this.sms.mode === 'mock' ? MOCK_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
        await tx.verificationChallenge.updateMany({
          where: { phoneE164: phone, purpose: input.scene, consumedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
        await tx.verificationChallenge.create({
          data: {
            id,
            phoneE164: phone,
            purpose: input.scene,
            codeDigest: codeDigest(this.config.codeSecret, id, phone, code, input.scene),
            expiresAt: new Date(now.getTime() + 300_000),
          },
        });
        await this.sms.send(phone, code, id);
        return '验证码已发送，请注意查收';
      },
      { timeout: 10_000 },
    );
    if (result instanceof AuthError) throw result;
    return result;
  }
  private async consume(
    tx: Tx,
    phone: string,
    scene: string,
    code: string,
  ): Promise<AuthError | undefined> {
    const row = await tx.verificationChallenge.findFirst({
      where: { phoneE164: phone, purpose: scene },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    if (!row || row.expiresAt <= now || row.consumedAt || row.invalidatedAt)
      return invalid('验证码错误或已过期');
    if (row.failedAttempts >= 5)
      return new AuthError(
        429,
        'CODE_ATTEMPTS_EXCEEDED',
        '验证码尝试次数已用尽，请重新获取',
        Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000)),
      );
    if (
      !matchesDigest(row.codeDigest, codeDigest(this.config.codeSecret, row.id, phone, code, scene))
    ) {
      await tx.verificationChallenge.update({
        where: { id: row.id },
        data: { failedAttempts: { increment: 1 } },
      });
      return invalid('验证码错误或已过期');
    }
    await tx.verificationChallenge.update({ where: { id: row.id }, data: { consumedAt: now } });
  }
  private async issue(tx: Tx, user: User, client: ClientType, ip?: string): Promise<LoginResponse> {
    if (user.status !== 'ACTIVE')
      throw new AuthError(403, 'FORBIDDEN', '账户已被禁用，请联系平台运营');
    if (ip !== undefined)
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lastLoginIp: ip },
      });
    const accessToken = newToken(),
      refreshToken = newToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await tx.session.create({
      data: {
        tokenDigest: digest(accessToken),
        refreshDigest: digest(refreshToken),
        refreshExpiresAt: expiresAt,
        userId: user.id,
        clientType: client,
        expiresAt,
      },
    });
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: SESSION_DAYS * 86_400 };
  }
  async register(input: SmsRegisterInput, ip: string): Promise<AuthUser> {
    if (input.password !== input.confirmPassword) throw invalid('两次输入的密码不一致');
    const realName = input.realName.trim();
    if (!/^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\-·]{0,63}$/.test(realName))
      throw invalid('姓名格式不正确，仅支持中英文、连字符与间隔号');
    const idCardNo = input.idCardNo?.trim().toUpperCase() || null;
    if (idCardNo && !/^(\d{15}|\d{17}[0-9X])$/.test(idCardNo)) throw invalid('身份证号格式不正确');
    const email = input.email?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('邮箱格式不正确');
    const org = input.accountType === 'ORGANIZATION' ? input.organization : undefined;
    if (input.accountType === 'ORGANIZATION' && !org?.name.trim())
      throw invalid('组织账号需填写组织信息');
    const passwordHash = await hashPassword(input.password);
    await this.rate([{ key: `register-ip:${digest(ip)}`, max: 100, seconds: 900 }]);
    try {
      const result = await this.db.$transaction(async (tx) => {
        const phone = phoneNumber(input.phone);
        await lock(tx, phone);
        const error = await this.consume(tx, phone, 'register', input.code);
        if (error) return error;
        const organization = org
          ? await tx.organization.create({
              data: {
                name: org.name.trim(),
                unifiedCreditCode: org.unifiedCreditCode?.trim() || null,
                description: org.description?.trim() || null,
                logoUrl: org.logoUrl?.trim() || null,
                expertiseTags: org.expertiseTags ?? [],
              },
            })
          : null;
        if (organization && org?.businessLicense) {
          const file = await this.files.claimForOrganizationRegistration(
            tx,
            org.businessLicense.objectKey,
            org.businessLicense.uploadToken,
            organization.id,
          );
          organization.businessLicenseKey = file.objectKey;
          await tx.organization.update({
            where: { id: organization.id },
            data: { businessLicenseKey: file.objectKey },
          });
        }
        const uid = randomUUID().replaceAll('-', '');
        const user = await tx.user.create({
          data: {
            uid,
            // 初始迁移要求 username 以字母开头且不超过 32 字符；uid 保留完整 UUID。
            username: `u${uid.slice(1)}`,
            phoneE164: phone,
            phoneRegion: 'CN',
            displayName: input.nickname?.trim() || realName,
            realName,
            passwordHash,
            email,
            idCardNo,
            accountType: input.accountType,
            role: 'EXPERT',
            organizationId: organization?.id,
            orgPosition: organization ? (input.orgPosition ?? 'OWNER') : null,
          },
          include: { organization: true },
        });
        return publicUser(user);
      });
      if (result instanceof AuthError) throw result;
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AuthError(409, 'DUPLICATE', '手机号/邮箱/身份证/组织信息已被占用，请更换后重试');
      throw error;
    }
  }
  async login(input: LoginInput, ip: string, client: ClientType) {
    const account = input.account.trim().toLowerCase();
    await this.rate([
      { key: `login-ip:${digest(ip)}`, max: 100, seconds: 900 },
      { key: `login-account:${digest(account)}`, max: 10, seconds: 900 },
    ]);
    const user = await this.db.user.findFirst({
      where: { OR: [{ phoneE164: phoneNumber(account) }, { email: account }, { uid: account }] },
    });
    if (!(await verifyPassword(input.password, user?.passwordHash ?? null)) || !user)
      throw new AuthError(401, 'BAD_CREDENTIALS', '账号或密码错误');
    return this.db.$transaction(async (tx) => {
      await lock(tx, user.phoneE164);
      // Re-read under the password-reset lock so old passwords cannot create new sessions after reset.
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (current.passwordHash !== user.passwordHash)
        throw new AuthError(401, 'BAD_CREDENTIALS', '账号或密码错误');
      return this.issue(tx, current, client, ip);
    });
  }
  async loginBySms(input: SmsLoginInput, ip: string, client: ClientType) {
    await this.rate([{ key: `verify-ip:${digest(ip)}`, max: 100, seconds: 900 }]);
    const result = await this.db.$transaction(async (tx) => {
      const phone = phoneNumber(input.phone);
      await lock(tx, phone);
      const error = await this.consume(tx, phone, 'login', input.code);
      if (error) return error;
      const user = await tx.user.findUnique({ where: { phoneE164: phone } });
      if (!user) return new AuthError(401, 'UNAUTHENTICATED', '手机号未注册，请先注册');
      return this.issue(tx, user, client, ip);
    });
    if (result instanceof AuthError) throw result;
    return result;
  }
  async resetPassword(input: PasswordResetInput, ip: string) {
    await this.rate([{ key: `reset-ip:${digest(ip)}`, max: 100, seconds: 900 }]);
    const passwordHash = await hashPassword(input.newPassword);
    const result = await this.db.$transaction(async (tx) => {
      const phone = phoneNumber(input.phone);
      await lock(tx, phone);
      const error = await this.consume(tx, phone, 'reset_password', input.code);
      if (error) return error;
      const user = await tx.user.findUnique({ where: { phoneE164: phone } });
      if (!user) return new AuthError(404, 'NOT_FOUND', '手机号未注册');
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    if (result instanceof AuthError) throw result;
  }
  async refresh(refreshToken: string, client: ClientType) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) throw unauthorized();
    const initial = await this.db.session.findUnique({
      where: { refreshDigest: digest(refreshToken) },
      include: { user: true },
    });
    if (!initial) throw unauthorized();
    return this.db.$transaction(async (tx) => {
      await lock(tx, initial.user.phoneE164);
      const now = new Date();
      const used = await tx.session.updateMany({
        where: {
          id: initial.id,
          revokedAt: null,
          clientType: client,
          refreshExpiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      if (used.count !== 1) throw unauthorized();
      const user = await tx.user.findUniqueOrThrow({ where: { id: initial.userId } });
      return this.issue(tx, user, client);
    });
  }
  private async requireSession(token: string | undefined, client: ClientType) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
    const session = await this.db.session.findUnique({
      where: { tokenDigest: digest(token) },
      include: { user: { include: { organization: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.clientType !== client ||
      session.user.status !== 'ACTIVE'
    )
      throw unauthorized();
    return session;
  }
  async authenticate(token: string | undefined, client: ClientType): Promise<AuthPrincipal> {
    const session = await this.requireSession(token, client);
    return {
      userId: session.userId,
      uid: session.user.uid,
      sessionId: session.id,
      role: 'EXPERT',
      clientType: client,
    };
  }
  async me(token: string | undefined, client: ClientType) {
    const session = await this.requireSession(token, client);
    return publicUser(session.user, true);
  }
  async logout(token: string | undefined) {
    if (token)
      await this.db.session.updateMany({
        where: { tokenDigest: digest(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
  }
}
