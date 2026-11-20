import messages from './login-messages.generated.json';
import { getLocale } from './locale';
export function t(key: keyof typeof messages['zh-CN']): string {
  return messages[getLocale()][key];
}
