export const offlineDisclosure =
  'X-Files makes no network connections itself; apps you choose to save to or share with may.';

export const partialFileDisclosure =
  'Verified parts of a file can be visible before the whole operation finishes. If X-Files is killed, a partial file may be left; delete it yourself.';

export const aboutDisclosures = [
  { title: 'Network and providers', text: offlineDisclosure },
  { title: 'Partial files', text: partialFileDisclosure },
  {
    title: 'Recovery material',
    text: 'Keys and shares shown on a result screen are held only in memory. If Android ends the X-Files process or you confirm leaving that screen, X-Files can never show them again. A lost key, a forgotten password, or too few shares can make a file unrecoverable.',
  },
  {
    title: 'Memory, storage and clipboard',
    text: 'Wiping JavaScript and native memory, deleting data from flash storage, and clearing copied secrets are best effort. Clipboard contents may outlive the app.',
  },
  {
    title: 'Share checks and device security',
    text: 'Checksums catch typos. Anyone with enough shares can decrypt, and a checksum may pass on a forged share. X-Files assumes the device and operating system are trusted.',
  },
] as const;
