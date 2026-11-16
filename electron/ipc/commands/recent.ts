import { defineCommand } from '../registry';
import { withDatabase, transaction } from '../../core/db';
import { localizedError } from '../../core/errors';
import { appDataFile } from '../../core/paths';
import { addRecent, recentList, removeRecent } from '../../core/storage';

defineCommand('recent_list', () => {
  return withDatabase(appDataFile('app.sqlite'), (db) => recentList(db));
});

defineCommand('recent_add', (args) => {
  return withDatabase(appDataFile('app.sqlite'), (db) => transaction(db, () => {
    addRecent(db, args.project);
    return recentList(db);
  }));
});

defineCommand('recent_remove', (args) => {
  const path = typeof args.path === 'string' ? args.path : undefined;
  if (!path) throw new Error(localizedError('native.error.1c35fef9cd', {}, '项目路径无效'));
  return withDatabase(appDataFile('app.sqlite'), (db) => transaction(db, () => {
    removeRecent(db, path);
    return recentList(db);
  }));
});
