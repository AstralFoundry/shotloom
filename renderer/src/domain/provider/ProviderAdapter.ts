/**
 * ProviderAdapter — 一个厂商一个适配器的唯一契约。
 *
 * 厂商是什么、内置接口地址在哪里、请求怎么编译提交轮询，全部由 domain/provider/adapters
 * 下的代码声明；用户数据只提供 API Key 和可选的接口地址覆盖，界面不能新增厂商。
 * 渲染进程只发 providerId 与 endpoint 元信息，地址与密钥都由 Rust 网关按厂商从本机设置读取。
 */

import type { ModelRuntimeContract } from '../catalog/ModelCatalog';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompileContext {
  taskType: 'textGeneration' | 'imageGeneration' | 'videoGeneration' | 'audioGeneration';
  model: string;
  prompt?: string;
  modelContract: ModelRuntimeContract;
  modelInputs?: ModelInputs;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  upstreamContext?: string;
  imageEdit?: ImageEditPayload | null;
  resolution?: string;
  duration?: number;
  aspectRatio?: string;
  ratio?: string;
  inputStrategy?: string;
  style?: string;
  instrumental?: boolean;
  multipart?: boolean;
}

export interface ModelInputs {
  images?: ResourceRef[];
  videos?: ResourceRef[];
  audios?: ResourceRef[];
}

export interface ResourceRef {
  nodeId?: string;
  title?: string;
  resourceType?: string;
  fileName?: string;
  filePath?: string;
  url?: string;
  previewUrl?: string;
  remoteUrl?: string;
  objectKey?: string;
  materialId?: string;
  mimeType?: string;
  inputRole?: string;
  inputSlot?: string;
  required?: boolean;
}

export interface ImageEditPayload {
  mode?: string;
  regions?: unknown[];
  sourceFile?: string;
  maskFile?: string;
}

export interface ProviderTask {
  remoteTaskId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | 'error';
  progress: number;
  result?: unknown;
  error?: string;
  raw?: unknown;
}

export interface ProviderTaskState {
  status: string;
  progress: number;
  result?: unknown;
  error?: string;
}

export interface GenerationResult {
  url?: string;
  videoUrl?: string;
  text?: string;
  files?: GeneratedFile[];
  raw?: unknown;
}

export interface GeneratedFile {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface CompiledProviderRequest {
  taskType?: CompileContext['taskType'];
  endpointPath: string;
  endpointScope: string;
  endpointMethod: string;
  providerId: string;
  body?: unknown;
  multipart?: boolean;
  inputImages?: Array<{ filePath: string; fileName: string; fieldName: string; mimeType?: string }>;
  maskResource?: { filePath: string; fileName: string; mimeType?: string } | null;
  maskField?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  auth?: ModelRuntimeContract['auth'];
  responseEncoding?: 'json' | 'binary';
  contract?: ModelRuntimeContract;
  protocolTemplate?: unknown;
  protocolVariables?: Record<string, unknown>;
  protocolImageRefs?: ResourceRef[];
  protocolVideoRefs?: ResourceRef[];
  protocolAudioRefs?: ResourceRef[];
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly iconId: string;
  /** 内置接口地址；适配器级唯一来源，Rust 侧不再维护任何厂商地址表。 */
  readonly baseUrl: string;
  /** 没有内置地址、必须由用户填写的厂商（如 Qwen 工作空间地址）。 */
  readonly baseUrlRequired?: boolean;
  compileRequest(context: CompileContext): CompiledProviderRequest;
  submit(request: CompiledProviderRequest): Promise<ProviderTask>;
  poll(task: ProviderTask, contract: ModelRuntimeContract, signal?: AbortSignal): Promise<ProviderTaskState>;
  cancel?(task: ProviderTask): Promise<void>;
}
