import { checkCapacity } from '@/platform/capacity';

const mib = 2 ** 20;
test('groups simultaneous cache and destination demand per volume', () => {
  const cache = { id: 'internal', available: 200 * mib };
  const other = { id: 'removable', available: 150 * mib };
  const demand = { bytes: 80 * mib };
  expect(
    checkCapacity([
      { ...demand, volume: cache },
      { ...demand, volume: other },
    ]).unknown,
  ).toBe(false);
  expect(() =>
    checkCapacity([
      { ...demand, volume: cache },
      { ...demand, volume: cache },
    ]),
  ).toThrow('NO_SPACE');
  expect(
    checkCapacity([
      { ...demand, volume: null },
      { ...demand, volume: cache },
    ]).unknown,
  ).toBe(true);
});

test('uses the lower capacity observation and rounds five percent up', () => {
  const bytes = 2_000_000_001;
  const available = bytes + 100_000_001;
  expect(
    checkCapacity([{ bytes, volume: { id: 'v', available } }]).unknown,
  ).toBe(false);
  expect(() =>
    checkCapacity([
      { bytes, volume: { id: 'v', available } },
      { bytes: 0, volume: { id: 'v', available: available - 1 } },
    ]),
  ).toThrow('NO_SPACE');
});
