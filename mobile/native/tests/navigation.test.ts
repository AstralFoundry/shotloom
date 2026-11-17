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
const state=globalThis.__nativeUi={mounts:0,requests:[],writes:[],settings:{agentCanRunNodes:false},back:null,navigate:null,goBack:null};
const names=['ActivityIndicator','FlatList','KeyboardAvoidingView','Modal','Pressable','ScrollView','StatusBar','Text','TextInput','View','Switch'];
for(const name of names) exports[name]=name;
exports.FlatList=({data=[],renderItem,ListHeaderComponent,ListEmptyComponent,...props})=>React.createElement('FlatList',props,ListHeaderComponent,data.length?data.map((item,index)=>React.createElement(React.Fragment,{key:item.id||index},renderItem({item,index}))):ListEmptyComponent);
exports.ScrollView='ScrollView'; exports.RefreshControl='RefreshControl';
exports.Modal=({visible,children})=>visible?React.createElement('Modal',null,children):null;
exports.StyleSheet={create:x=>x,absoluteFillObject:{}}; exports.Platform={OS:'android'};
exports.AppState={addEventListener:()=>({remove(){}})};
exports.BackHandler={addEventListener:(_,fn)=>{state.back=fn;return {remove(){if(state.back===fn)state.back=null}}}};
exports.Alert={alert(){}};
exports.WebView=React.forwardRef((props,ref)=>{React.useEffect(()=>{if(props.source?.uri?.includes('project='))state.mounts++;},[]);React.useImperativeHandle(ref,()=>({injectJavaScript(script){state.send?.(script)},reload(){state.reload?.()}}));return React.createElement('WebView',props)});
exports.SafeAreaProvider=exports.SafeAreaView=({children,...props})=>React.createElement('View',props,children);
exports.SvgXml='SvgXml'; exports.getLocales=()=>[{languageCode:'en'}]; exports.randomUUID=()=> '11111111-1111-4111-8111-111111111111';
exports.NavigationContainer=({children})=>children; exports.useFocusEffect=fn=>React.useEffect(fn,[fn]);
exports.createNativeStackNavigator=()=>({Screen:()=>null,Navigator:({children})=>{
 const [routes,setRoutes]=React.useState([{name:'Home'}]);const specs=React.Children.toArray(children);
 const navigation=React.useMemo(()=>({navigate(name,params){setRoutes(old=>[...old,{name,params}])},replace(name,params){setRoutes(old=>[...old.slice(0,-1),{name,params}])},goBack(){setRoutes(old=>old.slice(0,-1))}}),[]);
 state.navigate=navigation.navigate;state.goBack=navigation.goBack;
 return routes.map((route,index)=>{const spec=specs.find(x=>x.props.name===route.name);return React.createElement(spec.props.component,{key:index,route,navigation})});
}});
exports.NativeApi=class {cache=new Map();cached(path){return this.cache.get(path)} invalidate(){this.cache.clear()} async read(path,force){if(!force&&this.cache.has(path))return this.cache.get(path);const value=await this.request(path);this.cache.set(path,value);return value} disconnect(){} pause(){} resume(){} receive(){} async request(path,method='GET',value){state.requests.push(path);if(method!=='GET')state.writes.push({path,method,value});if(path==='/settings/mobile'){if(state.failSave&&method==='PATCH')throw new Error('Save unavailable');if(method==='PATCH')Object.assign(state.settings,value);return {...state.settings};}if(path==='/models')return {publications:[]};if(path==='/projects')return [{id:'22222222-2222-4222-8222-222222222222',name:'Fixture project'}];if(path==='/library-folders')return [];if(path.startsWith('/catalog/'))return {skills:[]};return {items:[],total:0,unread:0,asOf:'2026-11-16T00:00:00Z'}}};
exports.getDocumentAsync=async()=>({canceled:true});exports.isAvailableAsync=async()=>true;exports.shareAsync=async()=>{};
exports.File=class {};exports.Paths={cache:'cache'};
`;

async function loadApp(realApi = false) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const result = await build({ entryPoints: ['src/App.tsx'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], define: { __DEV__: 'false' }, plugins: [{ name: 'native-test-platform', setup(builder) {
    builder.onResolve({ filter: /^(react-native|react-native-webview|react-native-safe-area-context|react-native-svg|@react-navigation\/native|@react-navigation\/native-stack|expo-crypto|expo-localization|expo-document-picker|expo-file-system|expo-sharing)$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
    if (!realApi) builder.onResolve({ filter: /^\.\/api$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: platform, loader: 'js' }));
  } }] });
  const module = { exports: {} as { default: React.ComponentType } };
  new Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(import.meta.url),module,module.exports);
  return module.exports.default;
}

test('returning to the same canvas preserves the WebView instead of rechecking login and bootstrapping again', async () => {
  const App = await loadApp();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree=create(React.createElement(App)); });
  const bridge=tree.root.findAllByType('WebView' as any).find(x=>x.props.source.uri.endsWith('/native'))!;
  await act(async()=>bridge.props.onMessage({nativeEvent:{url:'https://shotloom.0xfiang.com',data:JSON.stringify({type:'ready',userId:'fixture-user',locale:'en-US'})}}));
  const sessionSurface=()=>tree.root.findAllByType('View' as any).find(x=>x.props.pointerEvents && x.findAllByType('WebView' as any).some(w=>w.props.source.uri.endsWith('/native')))!;
  await act(async()=>bridge.props.onLoadStart({nativeEvent:{url:'https://shotloom.0xfiang.com/native'}}));
  assert.equal(sessionSurface().props.pointerEvents,'none','background session reload must not reveal the login checking screen');
  await act(async()=>bridge.props.onMessage({nativeEvent:{url:'https://shotloom.0xfiang.com',data:JSON.stringify({type:'ready',userId:'fixture-user',locale:'en-US'})}}));
  const open=async()=>{const card=tree.root.findAllByType('Pressable' as any).find(x=>x.findAllByType('Text' as any).some(t=>t.props.children==='Fixture project'))!;assert.ok(card,'project card available');await act(async()=>card.props.onPress());};
  const state=(globalThis as any).__nativeUi;
  await act(async()=>bridge.props.onError({nativeEvent:{description:'Network unavailable'}}));
  assert.equal(sessionSurface().props.pointerEvents,'none','network errors must not reveal login over an authenticated screen');
  await act(async()=>bridge.props.onMessage({nativeEvent:{url:'https://shotloom.0xfiang.com',data:JSON.stringify({type:'ready',userId:'fixture-user',locale:'en-US'})}}));
  const search=tree.root.findAllByType('TextInput' as any)[0]!;
  await act(async()=>search.props.onChangeText('Fixture'));
  await open();assert.equal(state.mounts,1);
  await act(async()=>{if(!state.back?.())state.goBack();});
  assert.equal(tree.root.findAllByType('TextInput' as any)[0]!.props.value,'Fixture','project search survives the tab roundtrip');
  await open();
  assert.equal(state.mounts,1,'same canvas WebView must survive return and reopen');
  assert.equal(state.requests.filter((x: string)=>x==='/projects').length,1,'returning to projects must reuse the loaded page');
  await act(async()=>bridge.props.onMessage({nativeEvent:{url:'https://shotloom.0xfiang.com',data:JSON.stringify({type:'login'})}}));
  assert.equal(sessionSurface().props.pointerEvents,'auto','confirmed session expiry must still require login');
  await act(async()=>bridge.props.onMessage({nativeEvent:{url:'https://shotloom.0xfiang.com',data:JSON.stringify({type:'ready',userId:'other-user',locale:'en-US'})}}));
  assert.equal(sessionSurface().props.pointerEvents,'auto','another account cannot unlock the existing workspace');
  await act(async()=>tree.unmount());
});

for (const outcome of ['login', 'success', 'failure', 'disconnect'] as const) test(`native logout handles ${outcome} and permits a fresh account only after logout`, async () => {
  const App = await loadApp(true);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  const bridge = () => tree.root.findAllByType('WebView' as any).find(x => x.props.source.uri.endsWith('/native'))!;
  const message = (value: unknown) => bridge().props.onMessage({ nativeEvent: { url: 'https://shotloom.0xfiang.com/native', data: JSON.stringify(value) } });
  const state = (globalThis as any).__nativeUi;
  let logoutCount = 0;
  let reply = outcome;
  state.send = (script: string) => {
    const request = JSON.parse(script.slice(script.indexOf('?.(') + 3, script.lastIndexOf('); true;')));
    if (request.path === '/auth/logout') {
      logoutCount++;
      if (reply === 'login') message({ type: 'login' });
      else if (reply === 'disconnect') state.reload();
      else message({ type: 'response', id: request.id, ...(reply === 'failure' ? { error: 'Logout failed', status: 502 } : { data: null }) });
      return;
    }
    const data = request.path === '/auth/account' ? { app_quota: 0, app_used_quota: 0 } : request.path === '/auth/me' ? { username: 'Fixture' } : request.path === '/auth/usage?page=1&page_size=10' ? { items: [], total: 0 } : [];
    message({ type: 'response', id: request.id, data });
  };
  state.reload = () => bridge().props.onLoadStart({ nativeEvent: { url: 'https://shotloom.0xfiang.com/native' } });
  try {
    await act(async () => message({ type: 'ready', userId: 'fixture-user', locale: 'en-US' }));
    const account = tree.root.findAllByType('Pressable' as any).filter(x => x.props.accessibilityRole === 'tab').at(-1)!;
    await act(async () => account.props.onPress());
    const logout = tree.root.findAllByType('Pressable' as any).find(x => x.findAllByType('Text' as any).some(t => t.props.children === 'Sign out'))!;
    assert.ok(logout, 'logout button available');
    await act(async () => logout.props.onPress());
    assert.equal(logoutCount, 1);
    if (outcome === 'failure' || outcome === 'disconnect') {
      const error = outcome === 'failure' ? 'Logout failed' : 'Connection interrupted. Please retry.';
      assert.ok(tree.root.findAllByType('Text' as any).some(x => x.props.children === error), 'real logout failures stay visible');
      assert.ok(tree.root.findAllByType('Pressable' as any).some(x => x.props.accessibilityRole === 'tab'), 'failure preserves the workspace');
      reply = 'success';
      await act(async () => message({ type: 'ready', userId: 'fixture-user', locale: 'en-US' }));
      await act(async () => logout.props.onPress());
      assert.equal(logoutCount, 2, 'failed logout can be retried');
    }
    assert.equal(tree.root.findAllByType('Text' as any).some(x => String(x.props.children).includes('Connection interrupted')), false);
    assert.equal(tree.root.findAllByType('View' as any).filter(x => x.props.accessibilityRole === 'alert').length, 0, 'successful logout clears stale failures');
    assert.equal(tree.root.findAllByType('Pressable' as any).filter(x => x.props.accessibilityRole === 'tab').length, 0, 'old workspace unmounted');
    await act(async () => message({ type: 'ready', userId: 'other-user', locale: 'en-US' }));
    assert.ok(tree.root.findAllByType('Pressable' as any).some(x => x.props.accessibilityRole === 'tab'), 'new account may open a fresh workspace');
  } finally { await act(async () => tree.unmount()); }
});


test('account settings uses native controls, saves one field, and keeps a failed edit unchanged', async () => {
  const App = await loadApp(); let tree!: ReturnType<typeof create>;
  await act(async()=>{tree=create(React.createElement(App));});
  const bridge=tree.root.findAllByType('WebView' as any)[0]!;
  await act(async()=>bridge.props.onMessage({nativeEvent:{url:'https://shotloom.0xfiang.com/native',data:JSON.stringify({type:'ready',userId:'fixture-user',locale:'en-US'})}}));
  const state=(globalThis as any).__nativeUi;
  await act(async()=>state.navigate('Settings'));
  assert.equal(tree.root.findAllByType('WebView' as any).length,1,'settings cannot create a visible WebView');
  const switches=()=>tree.root.findAllByType('Switch' as any);
  assert.equal(switches().length,3); assert.equal(switches()[0]!.props.value,false);
  await act(async()=>switches()[0]!.props.onValueChange(true));
  assert.deepEqual(state.writes.at(-1),{path:'/settings/mobile',method:'PATCH',value:{agentCanRunNodes:true}});
  assert.equal(switches()[0]!.props.value,true);
  state.failSave=true;
  await act(async()=>switches()[0]!.props.onValueChange(false));
  assert.equal(switches()[0]!.props.value,true,'failed save must preserve the confirmed setting');
  assert.ok(tree.root.findAllByType('Text' as any).some(x=>x.props.children==='Save unavailable'));
  await act(async()=>tree.unmount());
});
