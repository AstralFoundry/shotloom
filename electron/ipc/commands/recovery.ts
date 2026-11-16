import { defineCommand } from '../registry';
import { recoveryStatus, updateRecoveryActivity } from '../../core/recovery';

/** 恢复日志：启动时写入、心跳更新、正常退出标记，命令只读当前状态。 */

defineCommand('recovery_status', () => recoveryStatus());

defineCommand('recovery_update_activity', (args) => {
  updateRecoveryActivity(args);
  return null;
});
