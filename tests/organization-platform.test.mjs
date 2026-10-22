import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpAuth } from '../packages/platform/src/web.ts';
import { OrganizationImportError } from '../packages/shared/dist/index.js';

const orgId = '00000000-0000-4000-8000-000000000002';
const memberId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000001';
const nodeId = '00000000-0000-4000-8000-000000000004';
const time = '2026-10-19T00:00:00.000Z';
const tokens = {
  accessToken: 'a'.repeat(43),
  refreshToken: 'r'.repeat(43),
  tokenType: 'Bearer',
  expiresIn: 1800,
};
const member = {
  memberId,
  userId,
  uid: 'TEST10001',
  realName: '测试成员',
  nickname: '潮汐测试员',
  phoneMasked: '138****5678',
  avatarUrl: null,
  userStatus: 'ACTIVE',
  employmentType: 'FULL_TIME',
  position: 'MEMBER',
  joinStatus: 'ACTIVE',
  joinedAt: time,
  plannedLeaveDate: null,
  leftAt: null,
  activeProjectCount: 2,
  versionNo: 3,
};
const summary = {
  flowNo: `OMX${'A'.repeat(40)}`,
  businessType: 'ORG_MEMBER_EXIT',
  businessId: memberId,
  businessNo: null,
  title: '测试成员退出组织',
  applicantName: '测试成员',
  applyReason: '个人安排',
  targetMemberId: memberId,
  targetMemberName: '测试成员',
  plannedLeaveDate: '2099-01-01',
  appliedAt: time,
};
const pending = {
  ...summary,
  nodeId,
  nodeVersionNo: 2,
  nodeName: '主管审批',
  flowVersionNo: 4,
  applicantId: userId,
  applicantOrgId: orgId,
  formData: { targetMemberId: memberId },
  dueAt: null,
};
const handled = {
  ...summary,
  nodeId,
  nodeSeq: 1,
  nodeCode: 'OWNER_APPROVAL',
  nodeName: '主管审批',
  nodeStatus: 'REJECTED',
  actionType: 'REJECT',
  operatorName: '测试主管',
  actionComment: '请补充安排',
  actionAt: time,
  applicantOrgName: '测试组织',
  flowStatus: 'REJECTED',
  finishedAt: time,
};
const imported = {
  sourceType: 'TEXT',
  textIgnored: false,
  totalCount: 1,
  validCount: 1,
  invalidCount: 0,
  createdCount: 1,
  rowErrors: [],
  members: [
    {
      memberId,
      userId,
      uid: 'TEST10001',
      accountType: 'INDIVIDUAL',
      phoneMasked: '138****5678',
      realName: '测试成员',
      position: 'MEMBER',
      employmentType: 'FULL_TIME',
      joinedAt: time,
      joinStatus: 'PENDING_ACTIVATION',
    },
  ],
  createdAt: time,
};
const invalidImport = {
  ...imported,
  validCount: 0,
  invalidCount: 1,
  createdCount: 0,
  members: [],
  createdAt: null,
  rowErrors: [
    {
      rowNo: 1,
      field: 'phone',
      value: '138****5678',
      errorCode: 'DUPLICATE_IN_BATCH',
      message: '手机号重复',
    },
  ],
};
const page = (row) => ({ total: 1, pages: 1, current: 1, size: 20, records: [row] });
const result = (data, status = 200) =>
  new Response(
    JSON.stringify({ code: status, message: status === 200 ? '操作成功' : '服务端错误', data }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
const template = (
  disposition = "attachment; filename*=UTF-8''%E6%88%90%E5%91%98%E6%A8%A1%E6%9D%BF.xlsx",
) =>
  new Response(new Uint8Array([80, 75, 3, 4]), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': disposition,
    },
  });
function adapter(t, desktop, responder) {
  const original = globalThis.fetch;
  const calls = [];
  const origin = desktop ? 'https://api.example.test' : '';
  globalThis.fetch = async (url, options) => {
    const call = {
      url,
      path: url.slice(origin.length),
      ...options,
      data:
        options.body instanceof FormData
          ? options.body
          : options.body
            ? JSON.parse(options.body)
            : undefined,
    };
    calls.push(call);
    return responder(call);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return { api: createHttpAuth(async () => origin, desktop ? 'include' : 'same-origin'), calls };
}
function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

for (const desktop of [false, true]) {
  const mode = desktop ? 'Electron renderer' : 'Web';
  test(`${mode} creates an organization with Cookie transport and preserves duplicate errors`, async (t) => {
    const created = {
      id: orgId,
      name: '测试组织',
      unifiedCreditCode: null,
      description: '组织介绍',
      businessLicenseUrl: 'business-license/example.png',
      logoUrl: null,
      expertiseTags: ['图像标注'],
      verifyStatus: 'APPROVED',
      status: 'ACTIVE',
      position: 'OWNER',
      createdAt: time,
    };
    const input = {
      name: '测试组织',
      description: '组织介绍',
      expertiseTags: ['图像标注'],
      businessLicense: { objectKey: 'business-license/example.png', uploadToken: 'u'.repeat(43) },
    };
    let duplicate = false;
    const { api, calls } = adapter(t, desktop, () =>
      duplicate ? result(null, 409) : result(created),
    );
    assert.deepEqual(await api.createOrganization(input), created);
    duplicate = true;
    await assert.rejects(api.createOrganization(input), (error) => error.status === 409);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.path, '/api/v1/organizations');
      assert.equal(call.method, 'POST');
      assert.equal(call.credentials, desktop ? 'include' : 'same-origin');
      assert.equal(call.headers['X-Tyde-Client'], 'web');
      assert.equal(call.headers['Content-Type'], 'application/json');
      assert.equal(call.headers.Authorization, undefined);
      assert.deepEqual(call.data, input);
    }
  });

  test(`${mode} switches the real session role without treating the response as login tokens`, async (t) => {
    let response = result({ selectedRole: 'EXPERT', roles: ['NAVIGATOR', 'PM', 'EXPERT'] });
    const { api, calls } = adapter(t, desktop, () => response.clone());
    assert.deepEqual(await api.switchRole('EXPERT'), {
      selectedRole: 'EXPERT',
      roles: ['NAVIGATOR', 'PM', 'EXPERT'],
    });
    assert.equal(calls[0].path, '/api/v1/auth/switch-role');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].credentials, desktop ? 'include' : 'same-origin');
    assert.equal(calls[0].headers['X-Tyde-Client'], 'web');
    assert.deepEqual(calls[0].data, { role: 'EXPERT' });
    response = result({ selectedRole: 'PM', roles: ['NAVIGATOR', 'PM', 'EXPERT'] });
    await assert.rejects(api.switchRole('EXPERT'), (error) => error.code === 'INVALID_RESPONSE');
  });

  test(`${mode} uploads a sensitive business license for one-time organization claim`, async (t) => {
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'license.png', {
      type: 'image/png',
    });
    const uploaded = {
      objectKey: `business-license/2026/10/22/${'a'.repeat(32)}.png`,
      uploadToken: 'u'.repeat(43),
      url: null,
      sensitive: true,
      fileName: 'license.png',
      extension: 'png',
      size: file.size,
      contentType: 'image/png',
      fileHash: 'b'.repeat(64),
    };
    let response = result(uploaded);
    const { api, calls } = adapter(t, desktop, () => response.clone());
    assert.deepEqual(await api.uploadBusinessLicense(file), uploaded);
    const call = calls[0];
    assert.equal(call.path, '/api/v1/files/upload');
    assert.equal(call.credentials, desktop ? 'include' : 'same-origin');
    assert.equal(call.headers['X-Tyde-Client'], 'web');
    assert.equal(call.headers['Content-Type'], undefined);
    assert.equal(call.data.get('bizType'), 'BUSINESS_LICENSE');
    assert.equal(call.data.get('category'), 'IMAGE');
    assert.equal(call.data.get('file').name, 'license.png');
    response = result(null, 503);
    await assert.rejects(api.uploadBusinessLicense(file), (error) => error.status === 503);
    assert.equal(calls.length, 2);
    await assert.rejects(
      api.uploadBusinessLicense(new File(['text'], 'license.txt', { type: 'text/plain' })),
      (error) => error.status === 400,
    );
    assert.equal(calls.length, 2);
  });

  test(`${mode} organization operations preserve exact endpoints, member versions and approval versions`, async (t) => {
    const update = { id: orgId, description: '组织介绍', logoUrl: '', updatedAt: time };
    const memberUpdate = {
      memberId,
      userId,
      joinedAt: time,
      employmentType: 'PART_TIME',
      versionNo: 4,
      updatedAt: time,
    };
    const role = { memberId, beforePosition: 'MEMBER', position: 'ADMIN', updatedAt: time };
    const exit = {
      flowNo: summary.flowNo,
      businessType: 'ORG_MEMBER_EXIT',
      businessId: memberId,
      flowStatus: 'PENDING',
      memberId,
      joinStatus: 'EXIT_APPROVING',
      plannedLeaveDate: '2099-01-01',
      appliedAt: time,
    };
    const processed = {
      flowNo: summary.flowNo,
      nodeId,
      action: 'REJECT',
      nodeStatus: 'REJECTED',
      flowStatus: 'REJECTED',
      currentNode: null,
      joinStatus: 'ACTIVE',
      plannedLeaveDate: null,
      processedAt: time,
      finishedAt: time,
    };
    const responses = new Map([
      ['/organizations/update', update],
      ['/organizations/members', page(member)],
      ['/organizations/members/update', memberUpdate],
      ['/organizations/members/position', role],
      ['/organizations/members/exit-requests', exit],
      ['/organizations/approvals/pending', page(pending)],
      ['/organizations/approvals/records', page(handled)],
      ['/organizations/approvals/process', processed],
    ]);
    const { api, calls } = adapter(t, desktop, ({ path }) => {
      assert.ok(responses.has(path.slice('/api/v1'.length)), path);
      return result(responses.get(path.slice('/api/v1'.length)));
    });
    const query = {
      orgId,
      current: 1,
      size: 20,
      keyword: '测试',
      joinedStartDate: '2026-01-01',
      joinedEndDate: '2026-10-19',
      employmentType: 'FULL_TIME',
      position: 'MEMBER',
      joinStatus: 'ACTIVE',
      projectId: 21,
    };
    const memberInput = {
      orgId,
      memberId,
      versionNo: 3,
      joinedAt: '2026-10-19 08:00:00',
      employmentType: 'PART_TIME',
    };
    const processInput = {
      orgId,
      flowNo: summary.flowNo,
      nodeId,
      nodeVersionNo: 2,
      flowVersionNo: 4,
      action: 'REJECT',
      actionComment: '请补充安排',
    };
    assert.deepEqual(
      await api.updateOrganization({ orgId, description: '组织介绍', logoUrl: '' }),
      update,
    );
    assert.deepEqual(await api.listOrganizationMembers(query), page(member));
    assert.deepEqual(await api.updateOrganizationMember(memberInput), memberUpdate);
    assert.deepEqual(
      await api.changeOrganizationMemberRole({ orgId, memberId, position: 'ADMIN' }),
      role,
    );
    assert.deepEqual(
      await api.requestOrganizationDeparture(
        { orgId, reason: '个人安排', plannedLeaveDate: '2099-01-01' },
        'exit-draft-1',
      ),
      exit,
    );
    assert.deepEqual(
      await api.listPendingOrganizationApprovals({ orgId, current: 1, size: 20 }),
      page(pending),
    );
    assert.deepEqual(
      await api.listOrganizationApprovalRecords({
        orgId,
        status: 'REJECTED',
        startAt: '2026-10-01 00:00:00',
      }),
      page(handled),
    );
    assert.deepEqual(await api.processOrganizationApproval(processInput), processed);
    assert.deepEqual(calls[1].data, query);
    assert.deepEqual(calls[2].data, memberInput);
    assert.deepEqual(calls[3].data, { orgId, memberId, position: 'ADMIN' });
    assert.equal(calls[4].headers['Idempotency-Key'], 'exit-draft-1');
    assert.deepEqual(calls[7].data, processInput);
    assert.ok(
      calls.every(
        (call) =>
          call.method === 'POST' &&
          call.credentials === (desktop ? 'include' : 'same-origin') &&
          call.headers['X-Tyde-Client'] === 'web' &&
          call.headers['Content-Type'] === 'application/json',
      ),
    );
  });

  test(`${mode} organization writes propagate conflicts/server failures without retry or fake success`, async (t) => {
    let status = 409;
    const { api, calls } = adapter(t, desktop, () => result(null, status));
    await assert.rejects(
      api.updateOrganizationMember({ orgId, memberId, versionNo: 3, employmentType: 'PART_TIME' }),
      (error) => error.status === 409,
    );
    status = 503;
    await assert.rejects(
      api.processOrganizationApproval({
        orgId,
        flowNo: summary.flowNo,
        nodeId,
        flowVersionNo: 4,
        nodeVersionNo: 2,
        action: 'APPROVE',
      }),
      (error) => error.status === 503,
    );
    assert.equal(calls.length, 2);
    await assert.rejects(
      api.requestOrganizationDeparture(
        { orgId, reason: '测试', plannedLeaveDate: '2099-01-01' },
        '',
      ),
      (error) => error.status === 400,
    );
    assert.equal(calls.length, 2);
  });

  test(`${mode} multipart import preserves file fields, idempotency and 400 row errors`, async (t) => {
    let invalid = true;
    const { api, calls } = adapter(t, desktop, () =>
      result(invalid ? invalidImport : imported, invalid ? 400 : 200),
    );
    const file = new File(['测试成员,13812345678,全职'], 'members.csv', { type: 'text/csv' });
    const input = { orgId, memberText: '测试成员,13812345678,全职', file };
    await assert.rejects(api.importOrganizationMembers(input, 'import-draft-1'), (error) => {
      assert.ok(error instanceof OrganizationImportError);
      assert.equal(error.status, 400);
      assert.deepEqual(error.result, invalidImport);
      return true;
    });
    const call = calls[0];
    assert.equal(call.path, '/api/v1/organizations/member-imports/generate');
    assert.equal(call.headers['Idempotency-Key'], 'import-draft-1');
    assert.equal(call.headers['Content-Type'], undefined);
    assert.equal(call.headers['X-Tyde-Client'], 'web');
    assert.equal(call.data.get('orgId'), orgId);
    assert.equal(call.data.get('memberText'), input.memberText);
    assert.equal(call.data.get('csvFile').name, 'members.csv');
    assert.equal(await call.data.get('csvFile').text(), await file.text());
    assert.equal(calls.length, 1);
    invalid = false;
    assert.deepEqual(
      await api.importOrganizationMembers(
        { orgId, memberText: input.memberText },
        'import-draft-2',
      ),
      imported,
    );
    assert.equal(calls[1].headers['Idempotency-Key'], 'import-draft-2');
  });

  test(`${mode} template and multipart retry one 401 through shared Cookie refresh`, async (t) => {
    let refreshed = false;
    let initialImport = true;
    const { api, calls } = adapter(t, desktop, ({ path }) => {
      if (path.endsWith('/auth/login')) return result(tokens);
      if (path.endsWith('/auth/refresh')) {
        refreshed = true;
        return result({ ...tokens, refreshToken: 's'.repeat(43) });
      }
      if (path.endsWith('/template')) return refreshed ? template() : result(null, 401);
      if (path.endsWith('/generate')) {
        if (initialImport) {
          initialImport = false;
          return result(null, 401);
        }
        return result(imported);
      }
      throw new Error(`Unexpected endpoint ${path}`);
    });
    await api.login({ account: '13812345678', password: 'FixturePass123!' });
    const downloaded = await api.downloadOrganizationMemberTemplate('en');
    assert.equal(downloaded.fileName, '成员模板.xlsx');
    assert.equal(downloaded.blob.size, 4);
    assert.equal(calls.filter(({ path }) => path.endsWith('/template')).length, 2);
    assert.equal(
      calls.find(({ path }) => path.endsWith('/template')).headers['Accept-Language'],
      'en',
    );
    assert.equal(
      calls.find(({ path }) => path.endsWith('/template')).headers['X-Tyde-Client'],
      undefined,
    );
    const file = new File(['a,b,c'], 'members.csv', { type: 'text/csv' });
    assert.deepEqual(
      await api.importOrganizationMembers({ orgId, file }, 'refresh-import-key'),
      imported,
    );
    const uploads = calls.filter(({ path }) => path.endsWith('/generate'));
    assert.equal(uploads.length, 2);
    assert.ok(
      uploads.every(
        ({ headers, data }) =>
          headers['Idempotency-Key'] === 'refresh-import-key' &&
          data.get('csvFile').name === 'members.csv',
      ),
    );
    assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 2);
  });
}

test('organization parsers reject malformed nested data and binary template failures', async (t) => {
  let response = result(page({ ...member, versionNo: -1 }));
  const { api } = adapter(t, false, () => response.clone());
  await assert.rejects(
    api.listOrganizationMembers({ orgId }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  response = result({ ...imported, members: [{ ...imported.members[0], accountType: 'UNKNOWN' }] });
  await assert.rejects(
    api.importOrganizationMembers({ orgId, memberText: 'a,b,c' }, 'parser-key'),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  response = result(null, 403);
  await assert.rejects(api.downloadOrganizationMemberTemplate(), (error) => error.status === 403);
  response = new Response('gateway failure', { status: 502 });
  await assert.rejects(api.downloadOrganizationMemberTemplate(), (error) => error.status === 502);
  response = new Response('wrong body', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(
    api.downloadOrganizationMemberTemplate(),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  response = template("attachment; filename*=UTF-8''..%2Fmembers%00.xlsx");
  assert.equal((await api.downloadOrganizationMemberTemplate()).fileName, '.._members_.xlsx');
});

test('late organization response cannot repopulate the session after logout', async (t) => {
  const start = deferred();
  const finish = deferred();
  const { api } = adapter(t, false, async ({ path }) => {
    if (path.endsWith('/members')) {
      start.resolve();
      await finish.promise;
      return result(page(member));
    }
    if (path.endsWith('/logout')) return result(null);
    throw new Error('Unexpected endpoint');
  });
  const request = api.listOrganizationMembers({ orgId });
  await start.promise;
  await api.logout();
  finish.resolve();
  await assert.rejects(
    request,
    (error) => error.status === 401 && error.code === 'SESSION_CHANGED',
  );
});
