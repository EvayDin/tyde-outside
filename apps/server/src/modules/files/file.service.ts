import { createHash, randomUUID } from 'node:crypto';
import { participatingStatuses } from '../organizations/organization.service.js';
import { AuthError } from '../auth/auth.error.js';
import type { AuthPrincipal } from '../auth/auth.service.js';
import { FileRegistryService } from './file-registry.service.js';
import { businesses, categories, type FileUploadResponse } from './file.types.js';
import { uploadPolicy, validateUpload, type UploadInput } from './file-validation.js';
import { validObjectKey } from './object-storage.js';

export class FileService {
  constructor(readonly registry: FileRegistryService) {}
  async upload(
    file: UploadInput,
    bizType?: string,
    category?: string,
    ownerUid: string | null = null,
  ): Promise<FileUploadResponse> {
    const policy = uploadPolicy(bizType, category);
    if (['PROJECT_ATTACHMENT', 'ENTRANCE_EXAM_ATTACHMENT'].includes(policy.bizType) && !ownerUid)
      throw new AuthError(401, 'UNAUTHORIZED', '业务附件必须登录后上传');
    const metadata = validateUpload(file, policy.category, this.registry.config.maxSize);
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const date = ['year', 'month', 'day']
      .map((type) => dateParts.find((part) => part.type === type)!.value)
      .join('/');
    const objectKey = `${policy.business.dir}/${date}/${randomUUID().replaceAll('-', '')}.${metadata.extension}`;
    const storage = this.registry.storage;
    await storage.put(objectKey, file.content, metadata.contentType);
    try {
      const url = policy.business.sensitive
        ? null
        : storage.accessUrl(
            objectKey,
            categories.IMAGE.extensions.split(' ').includes(metadata.extension)
              ? 2147483647
              : this.registry.config.urlExpireSeconds,
          );
      const fileHash = createHash('sha256').update(file.content).digest('hex');
      const { uploadToken } = await this.registry.register(
        { ...metadata, objectKey, fileSize: file.content.length, fileHash },
        policy.bizType,
        policy.category,
        ownerUid,
      );
      return {
        ...metadata,
        objectKey,
        uploadToken,
        url,
        sensitive: policy.business.sensitive,
        size: file.content.length,
        fileHash,
      };
    } catch (error) {
      // 外部对象与数据库不共享事务；失败时尽力删除，绝不覆盖原始错误。
      try {
        await storage.delete(objectKey);
      } catch {
        /* 后续运维对账清理无台账对象。 */
      }
      throw error;
    }
  }
  async accessUrl(key: string, seconds?: number) {
    key = validObjectKey(key);
    const biz = Object.values(businesses).find((x) => key.startsWith(x.dir + '/'));
    const record = await this.registry.db.uploadedFile.findUnique({ where: { objectKey: key } });
    if (biz?.sensitive || record?.sensitiveFlag)
      throw new AuthError(
        403,
        'FORBIDDEN',
        '敏感文件不支持直接获取访问链接，请通过文件查看接口访问',
      );
    if (!record || record.status === 'DELETED' || record.status === 'RELEASED')
      throw new AuthError(404, 'NOT_FOUND', '文件不存在');
    const expire =
      seconds && seconds > 0
        ? seconds
        : categories.IMAGE.extensions.split(' ').includes(record.extension)
          ? 2147483647
          : this.registry.config.urlExpireSeconds;
    return this.registry.storage.accessUrl(key, expire);
  }
  async open(key: string, principal: AuthPrincipal | null) {
    if (!principal) throw new AuthError(403, 'FORBIDDEN', '无权访问该文件');
    const record = await this.registry.db.uploadedFile.findUnique({
      where: { objectKey: validObjectKey(key) },
    });
    if (!record || !['UPLOADED', 'CLAIMED'].includes(record.status))
      throw new AuthError(403, 'FORBIDDEN', '无权访问该文件');
    const businessAttachment = ['PROJECT_ATTACHMENT', 'ENTRANCE_EXAM_ATTACHMENT'].includes(
      record.bizType,
    );
    if (businessAttachment && record.status === 'CLAIMED')
      throw new AuthError(403, 'FORBIDDEN', '业务附件访问权限尚未接入，请等待所属业务迁移');
    if (record.sensitiveFlag || businessAttachment) {
      let permitted = record.ownerUid === principal.uid;
      if (record.claimedBizType === 'ORGANIZATION_BUSINESS_LICENSE' && record.claimedBizId) {
        // 已认领营业执照只给本组织主管/管理员；不使用 hasExpertManagementRole 展示字段。
        permitted = Boolean(
          await this.registry.db.userOrgRel.findFirst({
            where: {
              userId: principal.userId,
              orgId: record.claimedBizId,
              position: { in: ['OWNER', 'ADMIN'] },
              joinStatus: { in: participatingStatuses },
              organization: { deleted: false },
            },
            select: { id: true },
          }),
        );
      }
      if (!permitted) throw new AuthError(403, 'FORBIDDEN', '无权访问该文件');
    }
    const object = await this.registry.storage.open(record.objectKey);
    return object;
  }
}
