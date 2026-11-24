import { AndroidHaptics, performAndroidHapticsAsync } from 'expo-haptics';

const feedback = {
  reveal: AndroidHaptics.Toggle_On,
  copy: AndroidHaptics.Confirm,
  success: AndroidHaptics.Confirm,
} as const;

export function playHaptic(action: keyof typeof feedback) {
  void performAndroidHapticsAsync(feedback[action]).catch(() => undefined);
}
