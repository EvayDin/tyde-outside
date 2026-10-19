import { TypeRegistry, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// shared 的字符串枚举保留 JSON Schema enum 以供服务端和 Swagger 使用。
// Value.Check 需要显式处理 Unsafe Kind；只允许当前枚举形态，其他 Unsafe 一律拒绝。
TypeRegistry.Set<TSchema>(
  'Unsafe',
  (schema, value) =>
    schema.type === 'string' &&
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.enum.every((entry: unknown) => typeof entry === 'string') &&
    Object.keys(schema).every((key) => ['type', 'enum', 'description'].includes(key)) &&
    typeof value === 'string' &&
    schema.enum.includes(value),
);

export function checkIpcInput(schema: TSchema | undefined, input: unknown): boolean {
  if (!schema) return input === undefined;
  try {
    return Value.Check(schema, input);
  } catch {
    return false;
  }
}
