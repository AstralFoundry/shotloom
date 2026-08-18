/**
 * ProviderTransport — 声明式模型协议执行接口。
 *
 * 所有 Provider 共用同一个实现，请求字段全部来自 model-catalog-v2.json 的模式声明。
 * Rust 只提供通用安全 HTTP Transport，不解析业务字段。
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
  /** 试跑请求可显式携带未保存的凭据，绕过按 providerId 读取本地设置。 */
  baseUrl?: string;
  apiKey?: string;
  responseEncoding?: 'json' | 'binary';
  contract?: ModelRuntimeContract;
  protocolTemplate?: unknown;
  protocolVariables?: Record<string, unknown>;
  protocolImageRefs?: ResourceRef[];
  protocolVideoRefs?: ResourceRef[];
  protocolAudioRefs?: ResourceRef[];
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface ProviderTransport {
  readonly provider: string;
  compileRequest(context: CompileContext): CompiledProviderRequest;
  submit(request: CompiledProviderRequest): Promise<ProviderTask>;
  poll?(task: ProviderTask, contract: ModelRuntimeContract, signal?: AbortSignal): Promise<ProviderTaskState>;
  cancel?(task: ProviderTask): Promise<void>;
}
