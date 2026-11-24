// Host-only mock for the Nitro boundary. Android vectors run in the device harness.
jest.mock('react-native-quick-crypto', () => {
  const crypto =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    Buffer:
      jest.requireActual<typeof import('node:buffer')>('node:buffer').Buffer,
    createCipheriv: crypto.createCipheriv,
    createDecipheriv: crypto.createDecipheriv,
    scrypt: jest.fn(crypto.scrypt),
  };
});
