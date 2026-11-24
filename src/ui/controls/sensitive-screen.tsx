import type { ReactNode } from 'react';

import { SensitiveContent } from '@/platform/screen-privacy';
import { UiText } from './text';

/** Keep the volatile flow state above this boundary so temporary blur preserves it. */
export function SensitiveScreen({
  focused,
  render,
}: {
  focused: boolean;
  render: () => ReactNode;
}) {
  if (!focused) return null;

  return (
    <SensitiveContent
      render={render}
      fallback={
        <UiText tone="mutedOnPage">Sensitive content is hidden.</UiText>
      }
    />
  );
}
