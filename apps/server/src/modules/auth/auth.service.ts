import { randomInt, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type User as DbUser } from '@prisma/client';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type {
  Authenticated,
  PhoneInput,
  RegisterInput,
  User,
  VerifyInput,
  VerifyResult,
} from '@tyde/shared';
import type { Config } from '../../config/index.js';
import { AuthError } from './auth.error.js';
import {
  codeDigest,
  digest,
  matchesDigest,
  MOCK_CODE,
  newToken,
  normalizeProfile,
  SESSION_DAYS,
  type ClientType,
} from './security.js';
import { MockSmsProvider, type SmsProvider } from './sms.js';

type Tx = Prisma.TransactionClient;
export type ServerAuthResult = VerifyResult & { sessionToken?: string };
function publicUser(user: DbUser): User {
  return {
    id: user.id,
    phoneE164: user.phoneE164,
    phoneRegion: user.phoneRegion,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}
function canonical(input: PhoneInput): string {
  const phone = parsePhoneNumberFromString(input.phone.trim(), 'CN');
  if (
    input.region !== 'CN' ||
    !phone?.isValid() ||
    phone.country !== 'CN' ||
    phone.getType() !== 'MOBILE'
  )
    throw new AuthError(400, 'VALIDATION_ERROR', '请输入有效的中国大陆手机号码');
  return phone.number;
}
async function lockPhone(tx: Tx, phone: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${phone}, 0))::text`;
}
export class AuthService {
  constructor(
    readonly db: PrismaClient,
    private readonly config: Config,
    private readonly sms: SmsProvider = new MockSmsProvider(),
  ) {}

  private async rate(entries: { key: string; max: number; seconds: number }[]): Promise<void> {
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

  async sendCode(input: PhoneInput, ip: string) {
    const phone = canonical(input);
    await this.rate([
      { key: `send-phone:${phone}`, max: 5, seconds: 900 },
      { key: `send-ip:${digest(ip)}`, max: 30, seconds: 900 },
    ]);
    const result = await this.db.$transaction(
      async (tx) => {
        await lockPhone(tx, phone);
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
        const expiresAt = new Date(now.getTime() + 300_000);
        await tx.verificationChallenge.updateMany({
          where: { phoneE164: phone, consumedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
        await tx.verificationChallenge.create({
          data: {
            id,
            phoneE164: phone,
            codeDigest: codeDigest(this.config.codeSecret, id, phone, code),
            expiresAt,
          },
        });
        await this.sms.send(phone, code, id);
        return {
          challengeId: id,
          expiresAt: expiresAt.toISOString(),
          resendAfterSeconds: 60,
          mode: this.sms.mode,
        };
      },
      { timeout: 10_000 },
    );
    if (result instanceof AuthError) throw result;
    return result;
  }

  private async createSession(
    tx: Tx,
    user: DbUser,
    client: ClientType,
  ): Promise<Authenticated & { sessionToken: string }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await tx.session.create({
      data: { tokenDigest: digest(token), userId: user.id, clientType: client, expiresAt },
    });
    return {
      status: 'authenticated',
      user: publicUser(user),
      sessionExpiresAt: expiresAt.toISOString(),
      sessionToken: token,
    };
  }

  async verify(input: VerifyInput, ip: string, client: ClientType): Promise<ServerAuthResult> {
    const phone = canonical(input);
    await this.rate([{ key: `verify-ip:${digest(ip)}`, max: 100, seconds: 900 }]);
    const result = await this.db.$transaction(async (tx) => {
      await lockPhone(tx, phone);
      const row = await tx.verificationChallenge.findUnique({ where: { id: input.challengeId } });
      const now = new Date();
      if (!row || row.phoneE164 !== phone)
        return new AuthError(400, 'CODE_INVALID', '验证码或验证请求不正确');
      if (row.expiresAt <= now || row.consumedAt || row.invalidatedAt)
        return new AuthError(410, 'CODE_EXPIRED', '验证码已失效，请重新获取');
      if (row.failedAttempts >= 5)
        return new AuthError(
          429,
          'CODE_ATTEMPTS_EXCEEDED',
          '验证码尝试次数已用尽，请重新获取',
          Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000)),
        );
      if (
        !matchesDigest(
          row.codeDigest,
          codeDigest(this.config.codeSecret, row.id, phone, input.code),
        )
      ) {
        await tx.verificationChallenge.update({
          where: { id: row.id },
          data: { failedAttempts: { increment: 1 } },
        });
        return new AuthError(400, 'CODE_INVALID', '验证码不正确');
      }
      await tx.verificationChallenge.update({ where: { id: row.id }, data: { consumedAt: now } });
      const user = await tx.user.findUnique({ where: { phoneE164: phone } });
      if (user) return this.createSession(tx, user, client);
      const token = newToken();
      const expiresAt = new Date(now.getTime() + 600_000);
      await tx.registrationGrant.create({
        data: {
          tokenDigest: digest(token),
          phoneE164: phone,
          phoneRegion: input.region,
          expiresAt,
        },
      });
      return {
        status: 'registration_required' as const,
        registrationToken: token,
        expiresAt: expiresAt.toISOString(),
      };
    });
    if (result instanceof AuthError) throw result;
    return result;
  }

  async register(
    input: RegisterInput,
    client: ClientType,
  ): Promise<Authenticated & { sessionToken: string }> {
    let profile: ReturnType<typeof normalizeProfile>;
    try {
      profile = normalizeProfile(input.username, input.displayName);
    } catch (error) {
      throw new AuthError(400, 'VALIDATION_ERROR', (error as Error).message);
    }
    try {
      return await this.db.$transaction(async (tx) => {
        const tokenDigest = digest(input.registrationToken);
        const initial = await tx.registrationGrant.findUnique({ where: { tokenDigest } });
        if (!initial)
          throw new AuthError(410, 'REGISTRATION_EXPIRED', '注册验证已失效，请重新验证手机号');
        await lockPhone(tx, initial.phoneE164);
        const grant = await tx.registrationGrant.findUnique({ where: { tokenDigest } });
        const now = new Date();
        if (!grant || grant.consumedAt || grant.expiresAt <= now)
          throw new AuthError(410, 'REGISTRATION_EXPIRED', '注册验证已失效，请重新验证手机号');
        if (await tx.user.findUnique({ where: { phoneE164: grant.phoneE164 } }))
          throw new AuthError(409, 'PHONE_ALREADY_REGISTERED', '手机号已注册，请返回登录');
        const user = await tx.user.create({
          data: { ...profile, phoneE164: grant.phoneE164, phoneRegion: grant.phoneRegion },
        });
        await tx.registrationGrant.update({ where: { id: grant.id }, data: { consumedAt: now } });
        return this.createSession(tx, user, client);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AuthError(409, 'USERNAME_TAKEN', '用户名已被使用，请换一个');
      throw error;
    }
  }

  async me(token: string | undefined, client: ClientType) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AuthError(401, 'UNAUTHENTICATED', '请先登录');
    const session = await this.db.session.findUnique({
      where: { tokenDigest: digest(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.clientType !== client
    )
      throw new AuthError(401, 'UNAUTHENTICATED', '登录已过期，请重新登录');
    return { user: publicUser(session.user), sessionExpiresAt: session.expiresAt.toISOString() };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token)
      await this.db.session.updateMany({
        where: { tokenDigest: digest(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
  }
}
