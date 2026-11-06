import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactWorkbench } from './app/ReactWorkbench';
import { AntdProvider } from './app/ui/antd/AntdProvider';
import '../styles/tokens.css';
import '../styles/agent-theme.css';
// styles.css 只放全局基础层；组件样式按界面区域分文件，导入顺序就是层叠顺序，
// 调整这里的先后等于改样式优先级。
import '../styles.css';
import '../styles/app-shell.css';
import '../styles/ui-primitives.css';
import '../styles/antd-theme.css';
import '../styles/project-browser.css';
import '../styles/workbench.css';
import '../styles/agent-session.css';
import '../styles/creation-canvas.css';
import '../styles/dialogs.css';
import '../styles/toast.css';
import '../styles/responsive.css';
import '../styles/settings.css';
import '../styles/canvas.css';
import '../styles/image-recipes.css';
import '../styles/project-materials.css';
import '../styles/media-overlays.css';
import '../styles/creation-view.css';
import '../styles/skills.css';

const container = document.getElementById('app');
if (!container) throw new Error('Shotloom renderer root is missing');
createRoot(container).render(<StrictMode><AntdProvider><ReactWorkbench /></AntdProvider></StrictMode>);
