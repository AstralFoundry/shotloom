# 页面、接口与交互耗时审计（2026-11-18）

本轮重新测量最终 Android 0.9.10 / versionCode 11 与当前线上 Web。页面主要慢点仍为首次画布和恢复登录启动；普通原生 Tab 切换已较快。包含逐页面、逐接口、逐交互的原始 CSV/JSON，未把旧包采样冒充本轮结果。

## 版本与测试位置

- APK 固定构建 44290028970；源提交 35666c197dad0c78f89c733f1c37e60246ab5073。
- SHA-256：418e5c420882d426898df608ea9714913e88fb49883a84d84553bf30702c4dde。
- 线上 Web 入口 main-B4ln6X5U.js，与发布 20261118-session-preload-101 对应；健康检查成功。未重新部署服务或修改产品源码。
- Android：GitHub Actions API 35 x86_64 模拟器，750×1624、density 320、系统字体 1.0、动画开启；真实公网 API，无显示响应替身。
- 基础页面运行 44298565356 attempt 2 成功，3 轮 × 56 页面 / 65 API = 168 页面 + 195 API。attempt 1 为模拟器掉线，无有效结果。
- 原生登录页面运行 44298628674 成功，清空应用数据后启动 3 次，未进行真实 OAuth。
- 扩展交互运行 44305807682 成功，测量工具提交 89f75cd，固定同一 APK；3 轮共 152 个原生交互样本、52 种测量操作，另有 195 次 API。工具位于独立分支 codex/page-latency-audit，不重建或修改被测 APK。
- 独立公网探针覆盖 32 种方法＋路径组合（不是全服务路由清单）；Windows 公网接口 172 次，独立隔离账号；服务器 loopback/同机公网接口 60 次；服务器至 Supabase 操作 20 次。
- 浏览器 Chrome CDP：390×844 移动视口；另有一次 1264×569 桌面视口控件补测，表中明确区分。浏览器结果不当作安卓真机结果。

## 计时口径

页面从真实点击或 Activity 启动计时，到目标可见且无加载指示。账号页额外等待余额刷新控件恢复可用。原生 UIAutomator 获取可访问性树本身有成本，25ms 轮询不代表 25ms 精度。画布等待 100% 控件，浏览器启动等待工作区 ready 标记，均不等同于硬件稳定首帧。

“首次观测”是每次进程启动后第一次测到该入口，可能已经由首页预取或命中 HTTP 缓存；不是每页清缓存冷启动。画布首次点击发生在一轮原生页面浏览之后，有预热机会；没有记录本轮预热是否超时/各文件是否命中，不能认定已完成全部预热。没有测“刚打开 APP 就立即点击画布”的独立场景。重复观测包含缓存命中及可能发生的后台刷新。

API 单独计时，包含网络、等待响应头、完整响应体读取；不经过 NativeApi 的内存缓存。Android 独立采样工具使用 HttpURLConnection，与 APP 的 React Native fetch 通信栈不完全相同。这些直接 API 请求不冒称页面点击真实触发的网络瀑布，也不与页面数字相加。浏览器请求清单来自真实页面事件；交互窗口同时发出的自动保存、Agent 同步只能表述为时间上重叠，不能据此证明由该次点击触发。

P95 使用 nearest-rank，即排序后第 ceil(0.95N) 项。N=1/3/5 时 P95 几乎就是最大值，只是本轮样本描述，不代表生产长期 P95。所有单位为毫秒，错误状态单列。

## 每个页面

| 页面 | 条件 | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 恢复已登录首页 | 首次观测 | 3 | 5027 | 11237 | 4562 | 11237 |
| 技能 | 首次观测 | 3 | 1109 | 2859 | 1074 | 2859 |
| 项目库 | 首次观测 | 3 | 126 | 285 | 114 | 285 |
| 我的（余额失败态） | 首次观测 | 3 | 818 | 2286 | 745 | 2286 |
| 通知 | 首次观测 | 3 | 1025 | 2030 | 1002 | 2030 |
| 设置 | 首次观测 | 3 | 677 | 1119 | 675 | 1119 |
| 反馈/举报表单 | 首次观测 | 3 | 664 | 872 | 656 | 872 |
| 我的记录 | 首次观测 | 3 | 878 | 1383 | 848 | 1383 |
| 反馈详情 | 首次观测 | 3 | 824 | 3892 | 781 | 3892 |
| 项目库 | 重复观测 | 42 | 118.5 | 612 | 43 | 1117 |
| 技能 | 重复观测 | 12 | 110.0 | 455 | 97 | 455 |
| 我的（余额失败态） | 重复观测 | 12 | 823.5 | 1805 | 773 | 1805 |
| 通知 | 重复观测 | 12 | 691.0 | 1018 | 671 | 1018 |
| 设置 | 重复观测 | 12 | 689.0 | 917 | 620 | 917 |
| 反馈/举报表单 | 重复观测 | 12 | 674.0 | 844 | 607 | 844 |
| 我的记录 | 重复观测 | 12 | 423.0 | 655 | 118 | 655 |
| 反馈详情 | 重复观测 | 12 | 184.0 | 719 | 109 | 719 |
| 画布 | 首次观测 | 3 | 11649 | 11949 | 10123 | 11949 |
| 画布 | 重复观测 | 12 | 3346.0 | 5481 | 2377 | 5481 |
| 未登录原生登录页 | 清空数据后启动 | 3 | 5137 | 8070 | 4209 | 8070 |

原生登录页清空数据的三次为 8070 / 5137 / 4209；恢复已登录首页为 11237 / 5027 / 4562。登录页没有完成 OAuth，也不依赖已登录账号 API，这说明模拟器上的原生启动/测量开销需要单独分析，不能把全部启动时间归咎于 session。

画布首次三次 10123 / 11949 / 11649；同项目返回 12 次范围 2377–5481，中位数 3346。项目是隔离空工程，没有复杂节点、图片解码、视频渲染或生成任务。普通反馈表单入口没有进入时 API，仍约 670ms，说明原生栈转场与读树开销不能忽略。

## 每个原生交互

点击控制之前的找控件和自动滚动不计入耗时；文本输入采用无障碍 ACTION_SET_TEXT，计量赋值后的 UI 响应，不代表真人键盘输入速度。开关必须观察到忙碌/禁用，再等待请求完成后恢复可用且值改变；不能把 Switch 先行显示的新值当作服务器已经保存。

| 交互 | 测量标识 | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 恢复已登录首页 | startup_authenticated | 3 | 3925 | 9474 | 3737 | 9474 |
| 进入技能页 | skills_enter | 3 | 1438 | 2414 | 1156 | 2414 |
| 搜索不存在的技能 | skills_search_empty | 3 | 69 | 122 | 69 | 122 |
| 清空技能搜索 | skills_search_clear | 3 | 90 | 188 | 75 | 188 |
| 技能全选 | skills_select_all | 3 | 94 | 125 | 86 | 125 |
| 取消技能全选 | skills_deselect_all | 3 | 92 | 303 | 81 | 303 |
| 打开技能编辑器 | skill_editor_open | 3 | 206 | 363 | 167 | 363 |
| 保存既有技能 | skill_save_unchanged | 3 | 1602 | 2710 | 1536 | 2710 |
| 停用技能并保存 | skill_disable_save | 3 | 1683 | 3056 | 1518 | 3056 |
| 启用技能并保存 | skill_enable_save | 3 | 1483 | 2289 | 1434 | 2289 |
| 打开新建技能 | skill_create_open | 3 | 219 | 432 | 177 | 432 |
| 取消新建技能 | skill_create_cancel | 3 | 91 | 398 | 87 | 398 |
| 进入项目库 | projects_enter | 3 | 180 | 577 | 169 | 577 |
| 按名称排序 | projects_sort_name | 3 | 115 | 141 | 97 | 141 |
| 按最近更新排序 | projects_sort_recent | 3 | 109 | 441 | 84 | 441 |
| 搜索不存在的项目 | projects_search_empty | 3 | 93 | 318 | 76 | 318 |
| 清空项目搜索 | projects_search_clear | 3 | 57 | 292 | 46 | 292 |
| 打开新建文件夹 | folder_create_open | 3 | 142 | 158 | 138 | 158 |
| 取消新建文件夹 | folder_create_cancel | 3 | 175 | 699 | 118 | 699 |
| 再次打开新建文件夹 | folder_create_reopen | 3 | 229 | 250 | 221 | 250 |
| 填写文件夹名称 | folder_name_input | 3 | 24 | 60 | 15 | 60 |
| 提交新建文件夹 | folder_create_submit | 3 | 1245 | 3187 | 1200 | 3187 |
| 进入我的 | account_enter | 3 | 861 | 1720 | 839 | 1720 |
| 进入设置 | settings_enter | 3 | 665 | 1112 | 625 | 1112 |
| 切换自动评估并保存 | settings_eval_toggle_save | 3 | 1219 | 1322 | 1180 | 1322 |
| 恢复自动评估并保存 | settings_eval_restore_save | 3 | 1331 | 2795 | 1070 | 2795 |
| 切换自动排版并保存 | settings_layout_toggle_save | 3 | 1490 | 1504 | 1012 | 1504 |
| 恢复自动排版并保存 | settings_layout_restore_save | 3 | 1450 | 1839 | 1086 | 1839 |
| 设置返回我的 | settings_back | 3 | 784 | 888 | 750 | 888 |
| 进入通知 | notifications_enter | 3 | 1062 | 1374 | 972 | 1374 |
| 单条通知已读 | notifications_mark_one | 1 | 2245 | 2245 | 2245 | 2245 |
| 全部通知已读 | notifications_mark_all | 1 | 1841 | 1841 | 1841 | 1841 |
| 从通知打开真实夹具回复 | notification_open_reply | 3 | 856 | 878 | 787 | 878 |
| 回复详情返回通知 | notification_detail_back | 3 | 681 | 731 | 611 | 731 |
| 通知返回我的 | notifications_back | 3 | 847 | 1320 | 829 | 1320 |
| 进入反馈表单 | feedback_enter | 3 | 643 | 652 | 130 | 652 |
| 打开反馈类型选择 | feedback_type_open | 3 | 76 | 465 | 75 | 465 |
| 切换为举报 | feedback_select_report | 3 | 158 | 165 | 132 | 165 |
| 填写举报描述 | feedback_description_input | 3 | 26 | 56 | 8 | 56 |
| 提交举报并显示详情 | feedback_report_submit | 3 | 1678 | 1750 | 1594 | 1750 |
| 提交后返回我的 | feedback_submitted_back | 3 | 813 | 1111 | 689 | 1111 |
| 再次进入反馈表单 | feedback_reenter | 3 | 675 | 736 | 480 | 736 |
| 进入我的记录 | feedback_records_enter | 3 | 1058 | 1070 | 965 | 1070 |
| 进入反馈详情 | feedback_detail_enter | 3 | 752 | 800 | 732 | 800 |
| 反馈详情返回记录 | feedback_detail_back | 3 | 599 | 605 | 554 | 605 |
| 记录返回表单 | feedback_records_back | 3 | 295 | 517 | 60 | 517 |
| 表单返回我的 | feedback_compose_back | 3 | 864 | 886 | 769 | 886 |
| 从我的回项目库 | projects_before_canvas | 3 | 275 | 297 | 117 | 297 |
| 首次进入画布 | canvas_enter | 3 | 8447 | 10460 | 7735 | 10460 |
| 画布返回项目库 | canvas_back | 3 | 1031 | 1156 | 979 | 1156 |
| 返回同一画布 | canvas_return | 3 | 3612 | 3755 | 2530 | 3755 |
| 同一画布再次返回 | canvas_return_back | 3 | 908 | 1657 | 515 | 1657 |

### 交互与接口对应关系（源码核对）

| 页面/交互 | 所需接口/本地工作 | 本轮覆盖含义 |
| --- | --- | --- |
| 恢复登录 | /auth/me，并行 /settings/mobile；随后 projects + folders | 整体启动 + 单接口独立计时 |
| 项目搜索/清空、排序 | 本地过滤/排序 | UI 响应，不应算一次接口加载 |
| 新建文件夹 | POST /library-folders，再刷新 projects/folders | 真实隔离账号写入；终点为创建对话框关闭、可用列表出现，可能还有后台刷新 |
| 技能搜索、选择/全选、打开/关闭编辑 | 本地状态 | UI 响应 |
| 技能保存、启用/停用、删除、导入 | 先 GET /catalog/skills 再 PUT /catalog/skills | 保存与启停实测；其余共用调用链但不能冒称 UI 实测 |
| 我的 | /auth/me、/auth/account、/auth/usage、notifications limit=1 | 本轮余额/用量为失败态 |
| 设置进入/刷新 | /settings/mobile 与 /models 并行；无设置缓存/强制刷新时 loading 等两者 | 有设置缓存时先显示，不等待模型返回 |
| 设置语言/开关/模型保存 | PATCH /settings/mobile | 开关 UI 与 PATCH 独立计时；语言/模型另列覆盖限制 |
| 反馈类型选择、填写 | 本地状态 | UI 响应 |
| 反馈/举报提交 | POST /feedback，随后详情 GET | 隔离数据，不使用真实用户内容 |
| 我的记录/详情 | GET /feedback 与 /feedback/:id | 首次与缓存返回分别记录 |
| 通知列表/刷新 | GET /notifications | 本轮有 3 条模拟后台通知的隔离夹具 |
| 单条已读 | PUT /notifications/:id/read，再刷新列表 | 计时包含写入和 UI 更新 |
| 全部已读 | PUT /notifications/read-all，再刷新列表 | 3 条通知后的单次批量场景，低样本 |
| 通知查看回复 | 必要时标记已读，失效对应 feedback 详情缓存，再 GET 详情 | 实际回复文本出现，不只看“Replies”标题 |
| 退出 | POST /auth/logout，再清原生安全存储 | 接口实测；原生点击到登录页未单独计时 |
| 会话预热 | POST /auth/native/workspace-ticket → POST /auth/native/workspace → 静态资源 | 两个接口单独计时；端点返回不等于资源下载完成 |

## 每个接口：Android 公网

| 方法 | 接口 | HTTP | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms | TTFB 中位 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /auth/account | 502 | 15 | 526 | 640 | 492 | 640 | 526 |
| GET | /auth/me | 200 | 15 | 716 | 1439 | 665 | 1439 | 716 |
| GET | /auth/usage?page=1&page_size=10 | 502 | 15 | 516 | 563 | 485 | 563 | 516 |
| GET | /catalog/skills | 200 | 15 | 703 | 909 | 668 | 909 | 703 |
| GET | /feedback/:id | 200 | 15 | 718 | 1427 | 675 | 1427 | 718 |
| GET | /feedback?offset=0&limit=20 | 200 | 15 | 709 | 1151 | 652 | 1151 | 709 |
| GET | /library-folders | 200 | 15 | 692 | 993 | 652 | 993 | 692 |
| GET | /models | 401 | 15 | 918 | 1778 | 869 | 1778 | 918 |
| GET | /notifications?offset=0&limit=1 | 200 | 15 | 703 | 978 | 646 | 978 | 703 |
| GET | /notifications?offset=0&limit=20 | 200 | 15 | 754 | 1005 | 676 | 1005 | 754 |
| GET | /project/:id | 200 | 15 | 749 | 1118 | 680 | 1118 | 749 |
| GET | /projects | 200 | 15 | 709 | 1046 | 658 | 1046 | 709 |
| GET | /settings/mobile | 200 | 15 | 696 | 954 | 662 | 954 | 696 |

/auth/account 与 /auth/usage 的 502、/models 的 401 来自没有真实网关授权的测试身份；这不是有效额度、账单或模型业务成功的耗时。账号 UI 的完成点是错误态可用，不是余额成功出现。

### 扩展原生交互账号的独立 API 复测

以下 195 次请求来自扩展交互账号，数据条数与基础账号不同，单列而不混入前表。它们仍为独立请求探针，不是全部 APP 网络流量追踪。

| 方法 | 接口 | HTTP | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /auth/account | 502 | 15 | 508 | 768 | 483 | 768 |
| GET | /auth/me | 200 | 15 | 688 | 1316 | 641 | 1316 |
| GET | /auth/usage?page=1&page_size=10 | 502 | 15 | 501 | 543 | 460 | 543 |
| GET | /catalog/skills | 200 | 15 | 702 | 1437 | 644 | 1437 |
| GET | /feedback/:id | 200 | 15 | 678 | 780 | 656 | 780 |
| GET | /feedback?offset=0&limit=20 | 200 | 15 | 687 | 746 | 635 | 746 |
| GET | /library-folders | 200 | 15 | 676 | 2428 | 648 | 2428 |
| GET | /models | 401 | 15 | 887 | 1089 | 829 | 1089 |
| GET | /notifications?offset=0&limit=1 | 200 | 15 | 683 | 1185 | 659 | 1185 |
| GET | /notifications?offset=0&limit=20 | 200 | 15 | 696 | 1333 | 645 | 1333 |
| GET | /project/:id | 200 | 15 | 694 | 784 | 648 | 784 |
| GET | /projects | 200 | 15 | 681 | 750 | 667 | 750 |
| GET | /settings/mobile | 200 | 15 | 672 | 1044 | 641 | 1044 |

## 每个接口：Windows 公网补测（包含写入）

| 方法 | 接口 | HTTP | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms | TTFB 中位 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /auth/account | 502 | 5 | 1051 | 3569 | 650 | 3569 | 1051 |
| GET | /auth/login | 302 | 5 | 216 | 254 | 166 | 254 | 216 |
| GET | /auth/me | 200 | 5 | 1342 | 6906 | 901 | 6906 | 1342 |
| GET | /auth/me | 401 | 1 | 1095 | 1095 | 1095 | 1095 | 1095 |
| GET | /auth/topup/options | 401 | 5 | 281 | 300 | 225 | 300 | 281 |
| GET | /auth/usage?page=1&page_size=10 | 502 | 5 | 643 | 1303 | 631 | 1303 | 643 |
| GET | /auth/usage?page=2&page_size=10 | 502 | 5 | 662 | 2259 | 569 | 2259 | 662 |
| GET | /catalog/assets | 200 | 5 | 789 | 2045 | 723 | 2045 | 789 |
| GET | /catalog/recipes | 200 | 5 | 876 | 1300 | 815 | 1300 | 876 |
| GET | /catalog/skills | 200 | 10 | 855.0 | 1226 | 827 | 1226 | 855.0 |
| GET | /feedback/:id | 200 | 5 | 813 | 1201 | 774 | 1201 | 812 |
| GET | /feedback?offset=0&limit=20 | 200 | 5 | 878 | 3932 | 835 | 3932 | 878 |
| GET | /feedback?offset=0&limit=20&kind=report | 200 | 5 | 855 | 916 | 818 | 916 | 855 |
| GET | /feedback?offset=20&limit=20 | 200 | 5 | 820 | 837 | 733 | 837 | 820 |
| GET | /library-folders | 200 | 5 | 933 | 1359 | 908 | 1359 | 933 |
| GET | /models | 401 | 5 | 1017 | 1071 | 979 | 1071 | 1016 |
| GET | /notifications?offset=0&limit=1 | 200 | 5 | 922 | 1737 | 866 | 1737 | 922 |
| GET | /notifications?offset=0&limit=20 | 200 | 10 | 919.0 | 1749 | 813 | 1749 | 919.0 |
| GET | /notifications?offset=20&limit=20 | 200 | 5 | 831 | 1066 | 770 | 1066 | 831 |
| GET | /project/:id | 200 | 5 | 939 | 1327 | 815 | 1327 | 939 |
| GET | /projects | 200 | 5 | 974 | 1443 | 822 | 1443 | 974 |
| GET | /recent | 200 | 5 | 838 | 2978 | 765 | 2978 | 838 |
| GET | /settings | 200 | 5 | 899 | 1203 | 819 | 1203 | 899 |
| GET | /settings/mobile | 200 | 5 | 882 | 1786 | 782 | 1786 | 881 |
| PATCH | /settings/mobile | 200 | 5 | 1016 | 1166 | 931 | 1166 | 1016 |
| POST | /auth/logout | 200 | 1 | 1026 | 1026 | 1026 | 1026 | 1026 |
| POST | /auth/native/workspace | 200 | 5 | 627 | 1988 | 585 | 1988 | 627 |
| POST | /auth/native/workspace-ticket | 200 | 10 | 649.0 | 8322 | 570 | 8322 | 649.0 |
| POST | /feedback | 201 | 5 | 811 | 1145 | 767 | 1145 | 810 |
| POST | /library-folders | 200 | 5 | 911 | 1279 | 805 | 1279 | 911 |
| PUT | /catalog/skills | 200 | 5 | 803 | 1289 | 759 | 1289 | 803 |
| PUT | /notifications/:id/read | 200 | 5 | 817 | 1846 | 746 | 1846 | 817 |
| PUT | /notifications/read-all | 200 | 5 | 851 | 910 | 808 | 910 | 850 |

仅对隔离账号写入。GET /auth/login 的 302 只是发起授权跳转；没有计入第三方网页、用户授权和回调。POST /auth/native/workspace 返回预热 HTML 的 200，只代表 Cookie 交接端点返回，不代表后续预热下载完成。最后一次 /auth/me 的 401 是退出后的失效验证，和正常 200 分组。

## 服务端与数据库拆分

| 调用位置 | 接口 | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms |
| --- | --- | --- | --- | --- | --- | --- |
| http://127.0.0.1:13030 | /auth/me | 5 | 591 | 2037 | 548 | 2037 |
| http://127.0.0.1:13030 | /feedback?offset=0&limit=20 | 5 | 665 | 1000 | 565 | 1000 |
| http://127.0.0.1:13030 | /notifications?offset=0&limit=20 | 5 | 671 | 970 | 564 | 970 |
| http://127.0.0.1:13030 | /project/:id | 5 | 608 | 1024 | 600 | 1024 |
| http://127.0.0.1:13030 | /projects | 5 | 595 | 1616 | 573 | 1616 |
| http://127.0.0.1:13030 | /settings/mobile | 5 | 615 | 1773 | 588 | 1773 |
| https://shotloom.0xfiang.com | /auth/me | 5 | 893 | 1623 | 575 | 1623 |
| https://shotloom.0xfiang.com | /feedback?offset=0&limit=20 | 5 | 598 | 903 | 582 | 903 |
| https://shotloom.0xfiang.com | /notifications?offset=0&limit=20 | 5 | 584 | 1302 | 578 | 1302 |
| https://shotloom.0xfiang.com | /project/:id | 5 | 612 | 882 | 545 | 882 |
| https://shotloom.0xfiang.com | /projects | 5 | 912 | 1206 | 572 | 1206 |
| https://shotloom.0xfiang.com | /settings/mobile | 5 | 596 | 687 | 581 | 687 |

| 操作 | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms |
| --- | --- | --- | --- | --- | --- |
| loadSession(two sequential remote reads) | 5 | 516 | 611 | 374 | 611 |
| sessions row | 5 | 218 | 265 | 212 | 265 |
| owner tenant check | 5 | 328 | 502 | 196 | 502 |
| auth/me users row | 5 | 266 | 520 | 191 | 520 |

实测 loadSession 中位数 516ms。源码中每个 requireAuth 都会调用 loadSession，后者串行读取 sessions，再读取 users 验证 client_id；/auth/me 之后还再次读取 users 完整行。分别测量的 sessions 读取 218ms、租户归属检查 328ms、users 完整行 266ms。各项来自独立采样，不相加声称精确端到端分解。没有测 SQL 引擎自身执行时间，因此这些数字是服务端至 Supabase API 的往返与处理合计，不能称为“数据库执行了 218ms”。

同机 loopback 仍约 0.6 秒，和同机公网接近；说明外部客户端网络不是全部开销。没有 Server-Timing、SQL EXPLAIN 或生产分布式追踪，暂不能把客户端网络、Supabase 网络和 SQL CPU 精确按百分比归因。

## Web 启动与逐请求

复用 HTTP 缓存的 3 次工作区 ready：15623 / 4363 / 6706ms，中位数 6706ms。第一轮 /auth/me 14003ms，后两轮 1144 / 2454ms。每轮 ready 后还观察后台请求，最长观察 30 秒；表中的后台资源不是全部在首屏阻塞链上。

清空 HTTP 缓存的一次导航在脚本 600 次轮询内未就绪（每次至少 100ms，另有 CDP 开销）；随后页面自己的 ready 标记为 88476ms。资源观测：Antd 63039ms、ReactWorkbench 24866ms、projectStore 34164ms、builtInSkills 41919ms；首个 auth/me 15012ms 后中止，后续重试完成。超时后人工工具检查恢复了默认桌面视口，因此 88476ms 只作为诊断长尾记录，不是严格保持 390×844 条件的可比冷启动样本。这个失败/长尾样本独立保留，不混进缓存复用的中位数。没有成功完成三轮清缓存采样，不能给出可靠的冷启动 P95。Cookie 注入方式用于独立 QA 身份，不代表真实系统浏览器 OAuth 耗时。

### 真实 Web API 请求

| 方法 | 接口 | HTTP | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/auth/account | 502 | 3 | 1334 | 1872 | 834 | 1872 |
| GET | /api/auth/me | 200 | 6 | 2704.5 | 14003 | 1144 | 14003 |
| GET | /api/catalog/assets | 200 | 3 | 1024 | 2783 | 1020 | 2783 |
| GET | /api/catalog/recipes | 200 | 3 | 1335 | 2234 | 913 | 2234 |
| GET | /api/catalog/skills | 200 | 3 | 1335 | 1381 | 905 | 1381 |
| GET | /api/library-folders | 200 | 3 | 3242 | 5410 | 1889 | 5410 |
| GET | /api/models | 401 | 3 | 1991 | 2234 | 1954 | 2234 |
| GET | /api/notifications | 200 | 3 | 2119 | 2749 | 1399 | 2749 |
| GET | /api/project/:id | 200 | 3 | 1024 | 1096 | 987 | 1096 |
| GET | /api/projects | 200 | 3 | 2012 | 3242 | 1017 | 3242 |
| GET | /api/recent | 200 | 3 | 1021 | 2199 | 1017 | 2199 |
| GET | /api/settings | 200 | 3 | 2151 | 12974 | 974 | 12974 |
| POST | /api/agent/:id/bind | 200 | 2 | 8056.0 | 12016 | 4096 | 12016 |
| POST | /api/agent/:id/message | 200 | 28 | 1315.5 | 5976 | 640 | 6050 |
| POST | /api/agent/connect | 200 | 3 | 1629 | 2001 | 729 | 2001 |
| POST | /api/recent | 200 | 3 | 1721 | 1873 | 1705 | 1873 |
| PUT | /api/project/:id | 200 | 1 | 3031 | 3031 | 3031 | 3031 |

请求路径中的工程/会话 UUID 归一成 :id；浏览器采集只保留 pathname，不保留 query，所以浏览器表不能用于区分分页参数。Android 与独立接口表保留了分页 query。长连接或测量结束时未完成的请求没有“完整响应时长”，不伪造为 0；本表只统计 loadingFinished 的请求。

### 每个静态资源

| 类型 | 资源 | HTTP | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms | 累计传输 bytes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Document | / | 200 | 3 | 288 | 847 | 175 | 847 | 2785 |
| Script | /assets/AntdProvider-yKxd-xyW.js | 200 | 3 | 1 | 1 | 1 | 1 | 0 |
| Stylesheet | /assets/ReactWorkbench-D1r61_km.css | 200 | 3 | 6 | 7 | 6 | 7 | 0 |
| Script | /assets/ReactWorkbench-DPIJ-EOL.js | 200 | 3 | 6 | 6 | 5 | 6 | 0 |
| Script | /assets/SupportCenter-CeBMooX7.js | 200 | 3 | 2 | 6 | 2 | 6 | 0 |
| Script | /assets/UpstreamModels-BCqPLdiV.js | 200 | 3 | 2 | 6 | 2 | 6 | 0 |
| Script | /assets/antd-DbOu5YWA.js | 200 | 3 | 6 | 6 | 5 | 6 | 0 |
| Script | /assets/builtInSkills-DKQanYrx.js | 200 | 3 | 4 | 4 | 4 | 4 | 0 |
| Script | /assets/localAssetLibraryStore-CIVrRiY9.js | 200 | 3 | 2 | 2 | 1 | 2 | 0 |
| Script | /assets/main-B4ln6X5U.js | 200 | 3 | 4 | 4 | 4 | 4 | 0 |
| Stylesheet | /assets/main-DHNrI7Z0.css | 200 | 3 | 1 | 1 | 1 | 1 | 0 |
| Script | /assets/modelPublications-CVckqbly.js | 200 | 3 | 1 | 1 | 1 | 1 | 0 |
| Script | /assets/projectStore-qyf_B38p.js | 200 | 3 | 5 | 5 | 5 | 5 | 0 |
| Stylesheet | /assets/react-BZV40eAE.css | 200 | 3 | 1 | 1 | 1 | 1 | 0 |
| Script | /assets/react-BpLgzVAB.js | 200 | 3 | 2 | 3 | 2 | 3 | 0 |
| Script | /harness/client.js | 200 | 2 | 11212.0 | 13256 | 9168 | 13256 | 5663391 |
| Image | /harness/shotloom-logo.png | 200 | 1 | 3021 | 3021 | 3021 | 3021 | 76420 |
| Other | /icons/icon-192.png | 200 | 3 | 2183 | 12027 | 923 | 12027 | 148047 |
| Manifest | /manifest.webmanifest | 200 | 3 | 1220 | 2028 | 314 | 2028 | 1631 |
| Image | /shotloom-logo.png | 200 | 3 | 1463 | 13227 | 950 | 13227 | 229236 |
| Image | /shotloom-mascot-body.png | 200 | 3 | 1283 | 1422 | 243 | 1422 | 102249 |
| Image | /shotloom-mascot-spark-1.png | 200 | 3 | 1283 | 1819 | 476 | 1819 | 5313 |
| Image | /shotloom-mascot-spark-2.png | 200 | 3 | 1283 | 1422 | 239 | 1422 | 4941 |
| Image | /shotloom-mascot-spark-3.png | 200 | 3 | 1283 | 1422 | 476 | 1422 | 4065 |

资源的累计 bytes 包含 ready 后的延迟模块下载，不能与历史“ready 前脚本大小”直接比较。CDP 时间包含网络等待、排队与下载，不单独等于 JS 执行 CPU。

## Web 每个交互

下表是 CDP 鼠标点击后条件成立并经过两次 requestAnimationFrame 的 DOM 响应，未测实体屏幕出帧或触摸延迟。缩放检查百分比改变；小地图检查 DOM 出现/消失；菜单检查首次可见内容改变，没有核对面板全部业务数据加载完成；菜单/面板行只能当响应指标，不能当完整加载时间。桌面与移动视口分别记录。

| 环境 | 交互 | N | 中位数 ms | P95 ms | 最短 ms | 最长 ms |
| --- | --- | --- | --- | --- | --- | --- |
| browser-desktop1264x569 | canvas_minimap_restore | 3 | 15 | 15 | 15 | 15 |
| browser-desktop1264x569 | canvas_minimap_toggle | 3 | 12 | 13 | 12 | 13 |
| browser-desktop1264x569 | canvas_settings_close | 1 | 19 | 19 | 19 | 19 |
| browser-desktop1264x569 | canvas_settings_open | 1 | 60 | 60 | 60 | 60 |
| browser-desktop1264x569 | canvas_zoom_in | 3 | 15 | 18 | 15 | 18 |
| browser-desktop1264x569 | canvas_zoom_out | 3 | 15 | 15 | 14 | 15 |
| browser-desktop1264x569 | connection_settings_close | 1 | 15 | 15 | 15 | 15 |
| browser-desktop1264x569 | connection_settings_open | 1 | 15 | 15 | 15 | 15 |
| browser-desktop1264x569 | keyboard_shortcuts_open | 1 | 31 | 31 | 31 | 31 |
| browser-mobile390x844 | Canvas settings_menu_open | 3 | 23 | 23 | 14 | 23 |
| browser-mobile390x844 | Canvas settings_open | 2 | 231.0 | 231 | 231 | 231 |
| browser-mobile390x844 | Connection settings_close | 1 | 557 | 557 | 557 | 557 |
| browser-mobile390x844 | Connection settings_menu_open | 3 | 20 | 23 | 19 | 23 |
| browser-mobile390x844 | Connection settings_open | 3 | 223 | 223 | 223 | 223 |
| browser-mobile390x844 | asset_center_close_explicit | 1 | 23 | 23 | 23 | 23 |
| browser-mobile390x844 | asset_center_open | 1 | 52 | 52 | 52 | 52 |
| browser-mobile390x844 | asset_center_reopen | 1 | 28 | 28 | 28 | 28 |
| browser-mobile390x844 | canvas_pan_mode | 3 | 15 | 15 | 14 | 15 |
| browser-mobile390x844 | canvas_select_mode | 3 | 15 | 15 | 14 | 15 |
| browser-mobile390x844 | canvas_tools_close | 1 | 223 | 223 | 223 | 223 |
| browser-mobile390x844 | canvas_tools_open | 1 | 37 | 37 | 37 | 37 |
| browser-mobile390x844 | canvas_zoom_in | 3 | 18 | 21 | 13 | 21 |
| browser-mobile390x844 | canvas_zoom_out | 3 | 15 | 23 | 14 | 23 |
| browser-mobile390x844 | node_palette_close | 1 | 15 | 15 | 15 | 15 |
| browser-mobile390x844 | node_palette_open | 1 | 19 | 19 | 19 | 19 |

### 未成功完成的交互尝试

| 环境 | 操作 | 未完成原因 |
| --- | --- | --- |
| browser-mobile390x844 | canvas_minimap_toggle_0 | control not visible |
| browser-mobile390x844 | canvas_minimap_restore_0 | control not visible |
| browser-mobile390x844 | canvas_minimap_toggle_1 | control not visible |
| browser-mobile390x844 | canvas_minimap_restore_1 | control not visible |
| browser-mobile390x844 | canvas_minimap_toggle_2 | control not visible |
| browser-mobile390x844 | canvas_minimap_restore_2 | control not visible |
| browser-mobile390x844 | canvas_settings_open | control not visible |
| browser-mobile390x844 | connection_settings_open | control not visible |
| browser-mobile390x844 | keyboard_shortcuts_open | control not visible |
| browser-mobile390x844 | version_history_open | control not visible |
| browser-mobile390x844 | asset_center_close | Escape did not change visible content |
| browser-mobile390x844 | asset_center_close_button | control not visible |
| browser-mobile390x844 | Canvas settings_close_0 | Escape did not change visible content |
| browser-mobile390x844 | Connection settings_close_0 | Escape did not change visible content |
| browser-mobile390x844 | Canvas settings_close_1 | Escape did not change visible content |
| browser-mobile390x844 | Connection settings_close_2 | Escape did not change visible content |
| browser-desktop1264x569 | canvas_select_mode_0 | control not visible |
| browser-desktop1264x569 | canvas_pan_mode_0 | control not visible |
| browser-desktop1264x569 | canvas_select_mode_1 | control not visible |
| browser-desktop1264x569 | canvas_pan_mode_1 | control not visible |
| browser-desktop1264x569 | canvas_select_mode_2 | control not visible |
| browser-desktop1264x569 | canvas_pan_mode_2 | control not visible |
| browser-desktop1264x569 | canvas_tools_open | control not visible |
| browser-desktop1264x569 | keyboard_shortcuts_close | Escape did not change visible content |

control not visible 表示该断点下入口隐藏，不能记成该功能“瞬间完成”或一定不存在；Escape 未改变可见内容也不自动判为产品故障，部分面板需要专用关闭按钮。资产中心后来已用 .canvas-material-close 显式关闭补测。

Web 交互窗口观测到隔离工程自动保存 PUT /project/:id 返回 409。响应原因未在本轮可靠捕获，不据此认定真实用户普遍保存失败，也不把缩放/菜单打开成功当成保存成功；这条记录需要独立核验工程版本冲突、测试夹具及并发写入。

## 优先排查顺序

1. **画布首次进入与冷资源长尾**：Android 首次中位 11.65s，浏览器一次冷导航约 88.5s。先补资源预热完成率、超时/失败文件、脚本排队与执行、工作区 ready 与实际首帧之间的阶段标记；避免用预热后的快样本替代刚打开 APP 的慢路径。
预热源码使用 Promise.allSettled 后发送 workspace-session-ready，个别资源失败也会发送该消息；原生 cookie-ready 标记本身不能证明所有启动资源都已成功缓存。需要区分 Cookie 交接成功和资源预热完成率。

2. **每请求的服务端鉴权远程读取**：loadSession 约 0.52s，且每个鉴权 API 都重复执行。可研究一次读取合并 session/租户验证，或带退出、账号切换、撤权即时失效的共享缓存。不能直接长时间缓存有效登录状态，牺牲撤销语义。
3. **原生启动本身**：未登录页中位 5.14s、恢复登录首页 5.03s。需要真机原生 startup trace，拆开 Hermes/React 初始化、安全存储、网络和 UI 自动化开销。
4. **核对设置首次加载与强制刷新**：NativeSettings.refresh 在没有设置缓存或强刷时，loading 要等 settings 与 models 都结束；已有设置缓存的普通再次进入不会因此等待模型完成。models 失败没有成功缓存、重新进入会再请求，并可能触发额外 auth/me 验证。本轮设置约 687ms 不能都算作等待 models；有效网关场景仍需复测。
5. **技能写入串行请求**：保存前 GET 再 PUT，两次网络与鉴权串行，UI 保存比纯本地编辑明显慢。任何合并方案都需保留当前并发修改保护。
6. **原生栈转场与测量基准**：反馈表单没有首屏读取但入口约 670ms；不要把所有非 100ms 页面都归因于接口。先用原生帧时间核对转场，再决定是否调整动画。

本轮只审计，不自动修改上述产品逻辑。

## 未覆盖与适用范围

以下项目有明确清单，但没有足够条件给成功业务耗时：真实系统浏览器 OAuth/回调/native exchange；充值下单与付款；有效网关的余额、消费记录、模型选择；付费图像/视频/文本生成及任务恢复；系统文件选择器导入和系统分享导出；大量文件夹/技能/反馈/通知分页；复杂节点拖动、连线、素材上传下载、视频编辑/导出；后台管理员界面回复/审核；iOS、实体 Android、弱网/4G/5G、缓存过期/离线、切换账号/会话过期的完整交互计时。

原生 UI 明确未单独计时的入口：手动下拉刷新、用量翻页、语言切换、模型选择、技能删除/导入/导出、文件夹内进出、Web 管理项目与导入、充值页、退出到登录页。部分接口已有独立计时，不能代替这些 UI 操作的端到端数字。返回账号页的扩展交互以底部“我的”入口及无加载指示出现为终点，不要求滚动到顶部余额；基础账号进入仍等待余额控件恢复可用。页面间回滚到账号顶部的自动滚动可能触发下拉刷新，独立 API 样本不是 APP 全部网络请求数。不能宣称已穷尽 Shotloom 所有节点/编辑器交互；本报告逐项标识已测与未测。

## 原始数据与复核

本机目录 output/page-latency-audit-1010/。page-samples.csv / page-summary.csv、api-samples.csv / api-summary.csv、server-summary.csv、database-summary.csv、native-interaction-samples.csv、web-request-samples.csv / web-request-summary.csv、web-interaction-samples.csv / web-interaction-summary.csv 均可逐行检查。JSON 保留 run/round、HTTP、TTFB、bytes、失败/未测原因；CSV 另含平均值。Web 请求 CSV 提供相对开始时间、DNS/连接/TLS/发送/响应头等待阶段；CDP 未提供的阶段留空。summarize.py 含中位数与 nearest-rank P95 的自检，基础报告验证 3×56 页面与 3×65 API，无测量失败。

扩展交互初始尝试遇到测量工具缺少内部类、过早读取 Switch 本地显示状态、同名 Text 与 Switch 误定位，均为测量工具问题，失败结果分别放在 interactions-attempt1 至 interactions-attempt6，不混入最终成功样本。另有 CI DNS 尚未就绪、返回账号时等待屏幕外余额控件、等待屏幕外新文件夹的问题，均保留相应失败证据；两次已知测量条件有误的运行已取消。所有尝试使用同一已交付 APK，没有为测量更改产品。

测试账号与会话清理完成：3 个隔离账号、会话及其夹具已删除，撤销后 /auth/me 均验证为 401；3 个远程 private.json 已移除；3 个临时 GitHub Actions secrets 已删除并复核。没有修改真实用户数据。

明细附件：`output/page-latency-audit-1010/audit-details.zip`，包含本报告及全部已导出的 CSV/JSON 指标。基础页面含 168 次已登录页面观测及 3 次未登录启动；API 独立公网采样合计 562 次，另有同服务器 60 次、Supabase 操作 20 次；浏览器 145 条已完成请求、72 次交互尝试（48 次完成）。这些计数属于不同测量层级，不相加称为独立用户操作。
