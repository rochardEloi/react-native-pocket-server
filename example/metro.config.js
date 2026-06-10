// Metro config that lets the example app import 'react-native-pocket-server'
// straight from the repository root, so changes to ../src reload live.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the library source for changes
config.watchFolders = [workspaceRoot];

// Resolve the library name to the repo root, and all other modules
// (react, react-native-tcp-socket, ...) to the example's node_modules
config.resolver.extraNodeModules = {
  'react-native-pocket-server': workspaceRoot,
};
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
