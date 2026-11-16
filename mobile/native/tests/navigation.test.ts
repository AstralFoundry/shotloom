import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

// Exercise the real App tree; only platform rendering, navigation and network are fixtures.
const platform = `
const React=require('react');
const state=globalThis.__nativeUi={mounts:0,back:null,navigate:null,goBack:null};
const names=['ActivityIndicator','FlatList','KeyboardAvoidingView','Modal','Pressable','ScrollView','StatusBar','Text','TextInput','View','Switch'];
for(const name of names) exports[name]=name;
exports.FlatList=({data=[],renderItem,ListHeaderComponent,ListEmptyComponent,...props})=>React.createElement('FlatList',props,ListHeaderComponent,data.length?data.map((item,index)=>React.createElement(React.Fragment,{key:item.id||index},renderItem({item,index}))):ListEmptyComponent);
exports.ScrollView='ScrollView'; exports.RefreshControl='RefreshControl';
exports.Modal=({visible,children})=>visible?React.createElement('Modal',null,children):null;
exports.StyleSheet={create:x=>x,absoluteFillObject:{}}; exports.Platform={OS:'android'};
exports.AppState={addEventListener:()=>({remove(){}})};
exports.BackHandler={addEventListener:(_,fn)=>{state.back=fn;return {remove(){if(state.back===fn)state.back=null}}}};
exports.Alert={alert(){}};
exports.WebView=React.forwardRef((props,ref)=>{React.useEffect(()=>{if(props.source?.uri?.includes('project='))state.mounts++;},[]);React.useImperativeHandle(ref,()=>({injectJavaScript(){},reload(){}}));return React.createElement('WebView',props)});
exports.SafeAreaProvider=exports.SafeAreaView=({children,...props})=>React.createElement('View',props,children);
exports.SvgXml='SvgXml'; exports.getLocales=()=>[{languageCode:'en'}]; exports.randomUUID=()=> '11111111-1111-4111-8111-111111111111';
exports.NavigationContainer=({children})=>children; exports.useFocusEffect=fn=>React.useEffect(fn,[fn]);
exports.createNativeStackNavigator=()=>({Screen:()=>null,Navigator:({children})=>{
 const [routes,setRoutes]=React.useState([{name:'Home'}]);const specs=React.Children.toArray(children);
 const navigation=React.useMemo(()=>({navigate(name,params){setRoutes(old=>[...old,{name,params}])},replace(name,params){setRoutes(old=>[...old.slice(0,-1),{name,params}])},goBack(){setRoutes(old=>old.slice(0,-1))}}),[]);
 state.navigate=navigation.navigate;state.goBack=navigation.goBack;
 return routes.map((route,index)=>{const spec=specs.find(x=>x.props.name===route.name);return React.createElement(spec.props.component,{key:index,route,navigation})});
}});
exports.NativeApi=class {disconnect(){} receive(){} async request(path){if(path==='/projects')return [{id:'22222222-2222-4222-8222-222222222222',name:'Fixture project'}];if(path==='/library-folders')return [];if(path.startsWith('/catalog/'))return {skills:[]};return {items:[],total:0,unread:0,asOf:'2026-11-16T00:00:00Z'}}};
exports.getDocumentAsync=async()=>({canceled:true});exports.isAvailableAsync=async()=>true;exports.shareAsync=async()=>{};
exports.File=class {};exports.Paths={cache:'cache'};
`;

test('returning to the same canvas preserves the WebView instead of rechecking login and bootstrapping again', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const result = await build({ entryPoints: ['src/App.tsx'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], define: { __DEV__: 'false' }, plugins: [{ name: 'native-test-platform', setup(builder) {
    builder.onResolve({ filter: /^(react-native|react-native-webview|react-native-safe-area-context|react-native-svg|@react-navigation\/native|@react-navigation\/native-stack|expo-crypto|expo-localization|expo-document-picker|expo-file-system|expo-sharing)$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
    builder.onResolve({ filter: /^\.\/api$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: platform, loader: 'js' }));
  } }] });
  const module = { exports: {} as { default: React.ComponentType } };
  new Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(import.meta.url),module,module.exports);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree=create(React.createElement(module.exports.default)); });
  const bridge=tree.root.findAllByType('WebView' as any).find(x=>x.props.source.uri.endsWith('/native'))!;
  await act(async()=>bridge.props.onMessage({nativeEvent:{url:'https://shotloom.0xfiang.com',data:JSON.stringify({type:'ready',userId:'fixture-user',locale:'en-US'})}}));
  const open=async()=>{const card=tree.root.findAllByType('Pressable' as any).find(x=>x.findAllByType('Text' as any).some(t=>t.props.children==='Fixture project'))!;assert.ok(card,'project card available');await act(async()=>card.props.onPress());};
  const state=(globalThis as any).__nativeUi;
  await open();assert.equal(state.mounts,1);
  await act(async()=>{if(!state.back?.())state.goBack();});
  await open();
  assert.equal(state.mounts,1,'same canvas WebView must survive return and reopen');
  await act(async()=>tree.unmount());
});
