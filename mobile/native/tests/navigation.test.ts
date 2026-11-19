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
const state=globalThis.__nativeUi={mounts:0,requests:[],writes:[],session:{token:'fixture-token',userId:'fixture-user'},loginUser:'fixture-user',logins:0,settings:{agentCanRunNodes:false},back:null,navigate:null,goBack:null};
const names=['ActivityIndicator','Image','FlatList','KeyboardAvoidingView','Modal','Pressable','ScrollView','StatusBar','Text','TextInput','View','Switch'];
for(const name of names) exports[name]=name;
exports.FlatList=({data=[],renderItem,ListHeaderComponent,ListEmptyComponent,...props})=>React.createElement('FlatList',props,ListHeaderComponent,data.length?data.map((item,index)=>React.createElement(React.Fragment,{key:item.id||index},renderItem({item,index}))):ListEmptyComponent);
exports.ScrollView='ScrollView'; exports.RefreshControl='RefreshControl';
exports.Modal=({visible,children})=>visible?React.createElement('Modal',null,children):null;
exports.StyleSheet={create:x=>x,absoluteFillObject:{}}; exports.Platform={OS:'android'};
state.foreground=new Set();exports.AppState={currentState:'active',addEventListener:(_,fn)=>{state.foreground.add(fn);return {remove(){state.foreground.delete(fn)}}}};
exports.BackHandler={addEventListener:(_,fn)=>{state.back=fn;return {remove(){if(state.back===fn)state.back=null}}}};
exports.Alert={alert(){}};
exports.WebView=React.forwardRef((props,ref)=>{React.useEffect(()=>{if(props.source?.uri?.includes('project='))state.mounts++;if(props.source?.uri?.includes('native=prewarm')&&!state.holdWarmup)props.onMessage({nativeEvent:{url:props.source.uri,data:JSON.stringify({type:'workspace-session-ready',userId:state.session.userId})}});},[]);React.useImperativeHandle(ref,()=>({injectJavaScript(script){state.send?.(script)},reload(){state.reload?.()}}));return React.createElement('WebView',props)});
exports.SafeAreaProvider=exports.SafeAreaView=({children,...props})=>React.createElement('View',props,children);
exports.SvgXml='SvgXml'; exports.getLocales=()=>[{languageCode:'en'}]; exports.randomUUID=()=> '11111111-1111-4111-8111-111111111111';
exports.NavigationContainer=({children})=>children; exports.useFocusEffect=fn=>React.useEffect(fn,[fn]);
exports.createNativeStackNavigator=()=>({Screen:()=>null,Navigator:({children})=>{
 const [routes,setRoutes]=React.useState([{name:'Home'}]);const specs=React.Children.toArray(children);
 const navigation=React.useMemo(()=>({navigate(name,params){setRoutes(old=>[...old,{name,params}])},replace(name,params){setRoutes(old=>[...old.slice(0,-1),{name,params}])},goBack(){setRoutes(old=>old.slice(0,-1))}}),[]);
 state.navigate=navigation.navigate;state.goBack=navigation.goBack;
 return routes.map((route,index)=>{const spec=specs.find(x=>x.props.name===route.name);return React.createElement(spec.props.component,{key:index,route,navigation})});
}});
exports.NativeApi=class {cache=new Map();cached(path){return this.cache.get(path)} setCached(path,value){this.cache.set(path,value)} invalidate(paths){state.invalidated=paths;for(const key of this.cache.keys())if(!paths||paths.includes(key))this.cache.delete(key)} async read(path,force){if(!force&&this.cache.has(path))return this.cache.get(path);const value=await this.request(path);this.cache.set(path,value);return value} disconnect(){} pause(){} resume(){} receive(){} async request(path,method='GET',value){state.requests.push(path);if(method==='GET'&&state.responses?.[path])return state.responses[path];if(state.failLogout&&path==='/auth/logout')throw new Error('Logout failed');if(path==='/auth/me')return {id:state.session.userId};if(method!=='GET')state.writes.push({path,method,value});if(method!=='GET'&&state.writeResponses?.[path])return state.writeResponses[path];if(path==='/settings/mobile'){if(state.failSave&&method==='PATCH')throw new Error('Save unavailable');if(method==='PATCH')Object.assign(state.settings,value);return {...state.settings};}if(path==='/models')return {publications:[]};if(path==='/projects')return [{id:'22222222-2222-4222-8222-222222222222',name:'Fixture project'}];if(path==='/library-folders')return [];if(path.startsWith('/catalog/'))return {skills:[]};return {items:[],total:0,unread:0,asOf:'2026-11-16T00:00:00Z'}}};
exports.createNativeApi=(_origin,_token,_uuid,expired)=>{state.expire=expired;return new exports.NativeApi()};
const request=exports.NativeApi.prototype.request;exports.NativeApi.prototype.request=async function(...args){await state.beforeRequest?.(...args);return request.apply(this,args)};
exports.restoreSession=async()=>state.session;exports.clearSession=async()=>{state.session=null};exports.login=async(_origin,expected)=>{state.logins++;if(state.cancel)return null;if(expected&&expected!==state.loginUser)throw new Error('Account changed');return state.session={token:'fresh-token',userId:state.loginUser}};
exports.workspaceSource=async(_origin,_token,redirect)=>{(state.handoffs??=[]).push(redirect);return {uri:redirect,method:'POST',body:'code=one-time'}};
exports.getDocumentAsync=async()=>({canceled:true});exports.isAvailableAsync=async()=>true;exports.shareAsync=async()=>{};
exports.File=class {};exports.Paths={cache:'cache'};
`;

async function loadApp() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const result = await build({ entryPoints: ['src/App.tsx'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], loader: { '.png': 'dataurl' }, define: { __DEV__: 'false' }, plugins: [{ name: 'native-test-platform', setup(builder) {
    builder.onResolve({ filter: /^(react-native|react-native-webview|react-native-safe-area-context|react-native-svg|@react-navigation\/native|@react-navigation\/native-stack|expo-crypto|expo-localization|expo-document-picker|expo-file-system|expo-sharing)$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
    builder.onResolve({ filter: /^\.\/(api|session)$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: platform, loader: 'js' }));
  } }] });
  const module = { exports: {} as { default: React.ComponentType } };
  new Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(import.meta.url),module,module.exports);
  return module.exports.default;
}

test('native login has no WebView, supports cancellation, and restores a stored session', async () => {
  const App = await loadApp();
  const state = (globalThis as any).__nativeUi;
  state.session = null;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  const signIn = () => tree.root.findAllByType('Pressable' as any).find(x => x.findAllByType('Text' as any).some(t => t.props.children === 'Sign in with new-api'))!;
  try {
    assert.equal(tree.root.findAllByType('WebView' as any).length, 0);
    assert.ok(signIn(), 'native sign-in button is rendered');
    state.cancel = true;
    await act(async () => signIn().props.onPress());
    assert.equal(state.logins, 1);
    assert.ok(signIn(), 'cancelling leaves the native login screen available');
    state.cancel = false;
    await act(async () => signIn().props.onPress());
    assert.ok(tree.root.findAllByType('Pressable' as any).some(x => x.props.accessibilityRole === 'tab'));
    assert.equal(tree.root.findAllByType('WebView' as any).length, 0, 'native pages have no hidden session WebView');
  } finally { await act(async () => tree.unmount()); }
});

test('slow preferences do not block home; tab switches reuse the profile and foreground verifies it', async () => {
  const App = await loadApp();
  const state = (globalThis as any).__nativeUi;
  let release!: () => void;
  const settings = new Promise<void>(resolve => { release = resolve; });
  state.beforeRequest = (path: string) => path === '/settings/mobile' ? settings : undefined;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  try {
    const tabs = () => tree.root.findAllByType('Pressable' as any).filter(x => x.props.accessibilityRole === 'tab');
    assert.equal(tabs().length, 4, 'nonessential preferences must not gate the project page');
    for (const index of [3, 0, 3]) await act(async () => tabs()[index]!.props.onPress());
    assert.equal(state.requests.filter((path: string) => path === '/auth/me').length, 1);
    await act(async () => { for (const listener of [...state.foreground] as ((value: string) => void)[]) listener('background'); });
    await act(async () => { for (const listener of [...state.foreground] as ((value: string) => void)[]) listener('active'); });
    assert.ok(state.requests.filter((path: string) => path === '/auth/me').length > 1, 'foreground still checks the actual session');
  } finally { await act(async () => { release(); }); await act(async () => tree.unmount()); }
});

test('project search and the same canvas survive tab roundtrips without creating a session WebView', async () => {
  const App = await loadApp();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  const state = (globalThis as any).__nativeUi;
  try {
    assert.equal(tree.root.findAllByType('WebView' as any).length, 0);
    await act(async () => tree.root.findAllByType('TextInput' as any)[0]!.props.onChangeText('Fixture'));
    const open = async () => {
      const card = tree.root.findAllByType('Pressable' as any).find(x => x.findAllByType('Text' as any).some(t => t.props.children === 'Fixture project'))!;
      await act(async () => card.props.onPress());
    };
    await open(); assert.equal(state.mounts, 1);
    await act(async () => state.back());
    assert.equal(tree.root.findAllByType('TextInput' as any)[0]!.props.value, 'Fixture');
    await open(); assert.equal(state.mounts, 1);
    assert.equal(state.requests.filter((x: string) => x === '/projects').length, 1);
    const workspace = tree.root.findAllByType('WebView' as any)[0]!;
    assert.equal(workspace.props.automaticallyAdjustContentInsets, false, 'native safe area owns the inset');
    assert.deepEqual(workspace.props.contentInset, { top: 0, bottom: 0, left: 0, right: 0 });
    assert.equal(workspace.props.source.method, undefined, 'a warmed cookie opens the document directly');
    assert.equal(state.handoffs.length, 1, 'one session handoff was performed before opening the canvas');
    assert.deepEqual(workspace.props.injectedJavaScriptObject, { userId: 'fixture-user', locale: 'en-US' });
    assert.equal(JSON.stringify(workspace.props.source).includes('fixture-token'), false);
    let restoration = '';
    state.send = (script: string) => { restoration = script; };
    await act(async () => workspace.props.onMessage({ nativeEvent: { url: workspace.props.source.uri, data: JSON.stringify({ type: 'workspace-ready' }) } }));
    await act(async () => workspace.props.onMessage({ nativeEvent: { url: workspace.props.source.uri, data: JSON.stringify({ type: 'workspace-blocked', status: 'login' }) } }));
    const signIn = tree.root.findAllByType('Pressable' as any).find(x => x.findAllByType('Text' as any).some(t => t.props.children === 'Sign in with new-api'))!;
    await act(async () => signIn.props.onPress());
    assert.equal(state.mounts, 1, 'reauthentication keeps the loaded canvas document and its unsaved state');
    assert.match(restoration, /credentials:'include'/);
    assert.equal(restoration.includes('fresh-token'), false, 'persistent credentials never enter page JavaScript');
  } finally { await act(async () => tree.unmount()); }
});

test('a missing warmed cookie falls back once to the authenticated POST handoff', async () => {
  const App = await loadApp();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  const state = (globalThis as any).__nativeUi;
  try {
    const card = tree.root.findAllByType('Pressable' as any).find(x => x.findAllByType('Text' as any).some(t => t.props.children === 'Fixture project'))!;
    await act(async () => card.props.onPress());
    const before = tree.root.findAllByType('WebView' as any)[0]!;
    assert.equal(before.props.source.method, undefined);
    await act(async () => before.props.onMessage({ nativeEvent: { url: before.props.source.uri, data: JSON.stringify({ type: 'workspace-blocked', status: 'login' }) } }));
    const after = tree.root.findAllByType('WebView' as any)[0]!;
    assert.equal(after.props.source.method, 'POST');
    assert.equal(state.handoffs.length, 2);
    assert.equal(state.logins, 0, 'lost cookies must not reopen OAuth');
    await act(async () => after.props.onMessage({ nativeEvent: { url: after.props.source.uri, data: JSON.stringify({ type: 'workspace-blocked', status: 'login' }) } }));
    assert.equal(state.handoffs.length, 2, 'revoked sessions cannot create a retry loop');
  } finally { await act(async () => tree.unmount()); }
});

test('a confirmed cookie opens the canvas directly while static downloads are still pending', async () => {
  const App = await loadApp(); const state = (globalThis as any).__nativeUi;
  state.holdWarmup = true;
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  try {
    const warm = tree.root.findAllByType('WebView' as any)[0]!;
    await act(async () => warm.props.onMessage({ nativeEvent: { url:warm.props.source.uri, data:JSON.stringify({type:'workspace-cookie-ready',userId:'fixture-user'}) } }));
    assert.equal(tree.root.findAllByType('WebView' as any).length, 1, 'cookie handoff must not cancel pending resource downloads');
    await act(async () => tree.root.findAllByType('Pressable' as any).find(n => n.findAllByType('Text' as any).some(t => t.props.children === 'Fixture project'))!.props.onPress());
    const canvas = tree.root.findAllByType('WebView' as any).find(n => n.props.source.uri.includes('project='))!;
    assert.equal(canvas.props.source.method, undefined);
    assert.equal(state.handoffs.length, 1);
    await act(async () => warm.props.onMessage({ nativeEvent: { url:warm.props.source.uri, data:JSON.stringify({type:'workspace-session-ready',userId:'fixture-user',loaded:1,total:2,failed:['assets/missing.js']}) } }));
    assert.equal(tree.root.findAllByType('WebView' as any).length, 1);
  } finally { await act(async () => tree.unmount()); }
});

test('session expiry preserves the workspace, rejects another account, and explicit logout clears it', async () => {
  const App = await loadApp();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  const state = (globalThis as any).__nativeUi;
  const button = (label: string) => tree.root.findAllByType('Pressable' as any).find(x => x.findAllByType('Text' as any).some(t => t.props.children === label))!;
  try {
    await act(async () => state.expire());
    assert.ok(button('Sign in with new-api'));
    assert.ok(tree.root.findAllByType('Pressable' as any).some(x => x.props.accessibilityRole === 'tab'), 'workspace remains mounted behind login');
    const workspace = tree.root.findAllByType('View' as any).find(x => x.props.importantForAccessibility === 'no-hide-descendants')!;
    assert.equal(workspace.props.pointerEvents, 'none');
    assert.equal(workspace.props.accessibilityElementsHidden, true);
    state.loginUser = 'other-user';
    await act(async () => button('Sign in with new-api').props.onPress());
    assert.ok(tree.root.findAllByType('Text' as any).some(x => x.props.children === 'Account changed'));
    assert.ok(button('Sign in with new-api'));
    await act(async () => button('Sign out').props.onPress());
    assert.equal(state.session, null);
    assert.equal(tree.root.findAllByType('Pressable' as any).filter(x => x.props.accessibilityRole === 'tab').length, 0);
    await act(async () => button('Sign in with new-api').props.onPress());
    assert.equal(state.session.userId, 'other-user');
    assert.ok(tree.root.findAllByType('Pressable' as any).some(x => x.props.accessibilityRole === 'tab'));
  } finally { await act(async () => tree.unmount()); }
});

test('logout failures remain visible and can be retried without a WebView reload', async () => {
  const App = await loadApp();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  const state = (globalThis as any).__nativeUi;
  try {
    await act(async () => tree.root.findAllByType('Pressable' as any).filter(x => x.props.accessibilityRole === 'tab').at(-1)!.props.onPress());
    const logout = () => tree.root.findAllByType('Pressable' as any).find(x => x.findAllByType('Text' as any).some(t => t.props.children === 'Sign out'))!;
    state.failLogout = true;
    await act(async () => logout().props.onPress());
    assert.ok(tree.root.findAllByType('Text' as any).some(x => x.props.children === 'Logout failed'));
    assert.ok(state.session);
    state.failLogout = false;
    await act(async () => logout().props.onPress());
    assert.equal(state.session, null);
    assert.equal(tree.root.findAllByType('WebView' as any).length, 0);
    assert.equal(tree.root.findAllByType('Pressable' as any).filter(x => x.props.accessibilityRole === 'tab').length, 0);
  } finally { await act(async () => tree.unmount()); }
});

test('account settings uses native controls, saves one field, and keeps a failed edit unchanged', async () => {
  const App = await loadApp(); let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  const state = (globalThis as any).__nativeUi;
  try {
    await act(async () => state.navigate('Settings'));
    assert.equal(tree.root.findAllByType('WebView' as any).length, 0);
    const switches = () => tree.root.findAllByType('Switch' as any);
    assert.equal(switches().length, 3); assert.equal(switches()[0]!.props.value, false);
    await act(async () => switches()[0]!.props.onValueChange(true));
    assert.deepEqual(state.writes.at(-1), { path: '/settings/mobile', method: 'PATCH', value: { agentCanRunNodes: true } });
    assert.equal(switches()[0]!.props.value, true);
    state.failSave = true;
    await act(async () => switches()[0]!.props.onValueChange(false));
    assert.equal(switches()[0]!.props.value, true);
    assert.ok(tree.root.findAllByType('Text' as any).some(x => x.props.children === 'Save unavailable'));
  } finally { await act(async () => tree.unmount()); }
});

test('opening an already-read notification refreshes a previously cached feedback thread', async () => {
  const App = await loadApp(); let tree!: ReturnType<typeof create>;
  const state = (globalThis as any).__nativeUi;
  const id = '22222222-2222-4222-8222-222222222222', path = `/feedback/${id}`;
  const item = { id, kind: 'report', status: 'pending', description: 'Original report' };
  state.responses = {
    [path]: { item, replies: [] },
    '/notifications?offset=0&limit=20': { items: [{ id, feedback_id: id, body: 'Fresh notification reply', read_at: '2026-11-18T00:00:00Z', created_at: '2026-11-18T00:00:00Z' }], total: 1, unread: 0 },
  };
  await act(async () => { tree = create(React.createElement(App)); });
  try {
    await act(async () => state.navigate('Feedback', { id }));
    await act(async () => state.goBack());
    state.responses[path] = { item, replies: [{ id, body: 'Current backend reply', created_at: '2026-11-18T00:00:00Z' }] };
    await act(async () => state.navigate('Notifications'));
    const notification = tree.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel?.includes('Fresh notification reply'))!;
    await act(async () => notification.props.onPress());
    assert.deepEqual(state.invalidated, [path]);
    assert.equal(state.requests.filter((value: string) => value === path).length, 2);
    assert.ok(tree.root.findAllByType('Text' as any).some(node => node.props.children === 'Current backend reply'));
  } finally { await act(async () => tree.unmount()); }
});
test('notification acknowledgements update the visible inbox without a second GET, and failures preserve unread state', async () => {
  const App = await loadApp(); const state = (globalThis as any).__nativeUi;
  const path = '/notifications?offset=0&limit=20', asOf = '2026-11-18T00:00:00Z';
  state.responses = { [path]: { items: [1,2,3].map(id => ({ id: String(id), feedback_id: String(id), body: 'Reply '+id, read_at: null, created_at: asOf })), total: 3, unread: 3, asOf } };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  await act(async () => state.navigate('Notifications'));
  const button = (label: string) => tree.root.findAllByType('Pressable' as any).find(n => n.props.accessibilityLabel === label)!;
  const hasText = (text: string) => tree.root.findAllByType('Text' as any).some(n => n.props.children === text);
  try {
    state.beforeRequest = (_path: string, method: string) => { if (method === 'PUT') throw new Error('Save unavailable'); };
    await act(async () => button('Mark as read').props.onPress());
    assert.ok(hasText('3 unread'));
    state.beforeRequest = undefined;
    await act(async () => button('Mark as read').props.onPress());
    assert.ok(hasText('2 unread'));
    assert.equal(state.requests.filter((p: string) => p === path).length, 1);
    await act(async () => button('Mark all as read').props.onPress());
    assert.equal(hasText('2 unread'), false);
    assert.equal(state.requests.filter((p: string) => p === path).length, 1);
    assert.deepEqual(state.writes.at(-1).value, { asOf });
  } finally { await act(async () => tree.unmount()); }
});

test('an older inbox refresh cannot overwrite a confirmed read acknowledgement', async () => {
  const App = await loadApp(); const state = (globalThis as any).__nativeUi;
  const path = '/notifications?offset=0&limit=20', asOf = '2026-11-18T00:00:00Z';
  const snapshot = { items: [{ id:'1', feedback_id:'1', body:'Reply', read_at:null, created_at:asOf }], total:1, unread:1, asOf };
  state.responses = { [path]: snapshot };
  let tree!: ReturnType<typeof create>;
  let finish!: (value: typeof snapshot) => void;
  await act(async () => { tree = create(React.createElement(App)); });
  try {
    await act(async () => state.navigate('Notifications'));
    state.responses[path] = new Promise(resolve => { finish = resolve; });
    await act(async () => tree.root.findAllByType('FlatList' as any).at(-1)!.props.onRefresh());
    await act(async () => tree.root.findAllByType('Pressable' as any).find(n => n.props.accessibilityLabel === 'Mark as read')!.props.onPress());
    await act(async () => finish(snapshot));
    assert.equal(tree.root.findAllByType('Pressable' as any).some(n => n.props.accessibilityLabel === 'Mark as read'), false);
    assert.equal(tree.root.findAllByType('Text' as any).some(n => n.props.children === '1 unread'), false);
  } finally { await act(async () => tree.unmount()); }
});

test('saving an unchanged native skill closes the editor without any request', async () => {
  const App = await loadApp(); const state = (globalThis as any).__nativeUi;
  state.responses = { '/catalog/skills': { skills: [{ id:'story', name:'Story', description:'Plan', instructions:'Outline', category:'text', version:1, enabled:true }] } };
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(React.createElement(App)); });
  try {
    await act(async () => tree.root.findAllByType('Pressable' as any).filter(n => n.props.accessibilityRole === 'tab')[2]!.props.onPress());
    await act(async () => tree.root.findAllByType('Pressable' as any).find(n => n.props.accessibilityLabel === 'Edit skill')!.props.onPress());
    const count = state.requests.length;
    await act(async () => tree.root.findAllByType('Pressable' as any).find(n => n.findAllByType('Text' as any).some(t => t.props.children === 'Save'))!.props.onPress());
    assert.equal(tree.root.findAllByType('Modal' as any).length, 0);
    assert.equal(state.requests.length, count);
    assert.equal(state.writes.length, 0);
  } finally { await act(async () => tree.unmount()); }
});

test('new feedback reuses the confirmed row; a replay with replies still fetches the actual thread', async () => {
  for (const revision of [1,2]) {
    const App = await loadApp(); const state = (globalThis as any).__nativeUi;
    const id = '11111111-1111-4111-8111-111111111111', path = `/feedback/${id}`;
    const item = { id, user_id:'fixture-user', kind:'feedback', description:'Report', reference:'', status:'pending', revision, created_at:'2026-11-18T00:00:00Z', updated_at:'2026-11-18T00:00:00Z' };
    state.writeResponses = { '/feedback': item };
    state.responses = { [path]: { item, replies:[{id:'reply',body:'Existing reply',created_at:item.created_at}] } };
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(App)); });
    await act(async () => state.navigate('Compose'));
    try {
      await act(async () => tree.root.findAllByType('TextInput' as any).find(n => n.props.accessibilityLabel === 'Description')!.props.onChangeText('Report'));
      await act(async () => tree.root.findAllByType('Pressable' as any).find(n => n.props.accessibilityRole === 'button' && n.findAllByType('Text' as any).some(t => t.props.children === 'Submit feedback or report'))!.props.onPress());
      assert.equal(state.writes.filter((write: {path:string}) => write.path === '/feedback').length, 1);
      assert.equal(state.requests.filter((p: string) => p === path).length, revision === 1 ? 0 : 1, JSON.stringify({ revision, requests:state.requests, writes:state.writes }));
      if (revision === 2) assert.ok(tree.root.findAllByType('Text' as any).some(n => n.props.children === 'Existing reply'));
    } finally { await act(async () => tree.unmount()); }
  }
});
