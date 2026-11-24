import { CoreError } from '@/core/crypto/errors';
import { withReader } from '@/platform/file-io';
import { nativePlatform } from '@/platform/native';

jest.mock('@/platform/native', () => ({
  nativePlatform: jest.fn(),
  nativeCall: async (invoke: (native: unknown) => unknown) =>
    invoke(jest.requireMock('@/platform/native').nativePlatform()),
}));

test('a rejected reader close preserves the operation error for native rollback', async () => {
  const closeReader = jest.fn(async () => {
    throw new CoreError('IO_ERROR');
  });
  jest.mocked(nativePlatform).mockReturnValue({
    openSource: async () => 11,
    closeReader,
  } as unknown as ReturnType<typeof nativePlatform>);
  await expect(
    withReader(4, 'content://fixture', async () => {
      throw new CoreError('SOURCE_CHANGED');
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  expect(closeReader).toHaveBeenCalledWith(4, 11);
  await expect(
    withReader(4, 'content://fixture', async () => true),
  ).rejects.toMatchObject({
    code: 'IO_ERROR',
  });
});
