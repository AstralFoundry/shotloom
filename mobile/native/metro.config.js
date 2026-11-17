const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
// The native package uses an isolated install rather than a root npm workspace.
config.watchFolders = [path.resolve(__dirname, '../../shared'), path.resolve(__dirname, '../../renderer/src/i18n/locales'), path.resolve(__dirname, '../../renderer/src/config')];
module.exports = config;
