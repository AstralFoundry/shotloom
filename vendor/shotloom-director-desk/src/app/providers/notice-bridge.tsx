import { App } from 'antd';
import { useEffect } from 'react';
import { bindNotices } from '@/shared/ui/feedback.ts';

/** Registers antd's message API so non-React code can surface notices. */
export function NoticeBridge() {
    const { message } = App.useApp();
    useEffect(() => bindNotices(message), [message]);
    return null;
}
