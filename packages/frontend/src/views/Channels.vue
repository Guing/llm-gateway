<template>
  <div class="p-3 sm:p-6">
    <div class="flex flex-wrap justify-between items-start mb-4 sm:mb-6 gap-3">
      <h2 class="text-xl sm:text-2xl font-bold text-gray-800">上游渠道管理</h2>
      <div class="flex items-center gap-2 flex-wrap">
        <el-button @click="openQuickImport">
          <el-icon class="mr-1"><UploadFilled /></el-icon>快速导入
        </el-button>
        <el-button @click="openExportDialog">
          <el-icon class="mr-1"><Download /></el-icon>导出全部 JSON
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon class="mr-1"><Plus /></el-icon>添加渠道
        </el-button>
      </div>
        <el-dialog
          v-model="exportDialogVisible"
          title="导出全部渠道 JSON"
          width="min(900px, 95vw)"
          :close-on-click-modal="false"
        >
          <div class="space-y-3">
            <el-alert type="info" :closable="false" show-icon>
              <template #title>
                导出格式与快速导入完全兼容，含 $schema 字段。可直接复制、保存或粘贴到导入弹窗。
              </template>
            </el-alert>
            <div class="flex items-center justify-between">
              <div class="text-xs text-gray-500">Schema: {{ CHANNEL_IMPORT_SCHEMA_URL }}</div>
              <div class="flex items-center gap-2">
                <el-button size="small" @click="formatExportJson">格式化</el-button>
                <el-button size="small" @click="copyExportJson">复制 JSON</el-button>
              </div>
            </div>
            <el-input
              v-model="exportJsonText"
              type="textarea"
              :rows="18"
              readonly
              class="font-mono"
            />
          </div>
          <template #footer>
            <el-button @click="exportDialogVisible = false">关闭</el-button>
          </template>
        </el-dialog>
    </div>

    <el-card shadow="never" class="border">
      <div class="overflow-x-auto">
      <el-table :data="paginatedChannels" stripe v-loading="loading" row-key="id">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="px-8 py-3">
              <p class="text-xs font-semibold text-gray-500 mb-2">模型路由列表</p>
              <div v-if="channelModels(row).length === 0" class="text-xs text-gray-400">未配置模型</div>
              <div v-else class="flex flex-wrap gap-2">
                <div
                  v-for="m in channelModels(row)"
                  :key="m.actualModel"
                  class="flex items-center gap-1 border rounded px-2 py-1 text-xs bg-gray-50"
                >
                  <span class="font-mono text-gray-600">{{ m.actualModel }}</span>
                  <span v-if="m.virtualModel !== m.actualModel" class="text-gray-400">→</span>
                  <span v-if="m.virtualModel !== m.actualModel" class="font-mono text-blue-600">{{ m.virtualModel }}</span>
                  <el-tag size="small" :type="m.enabled ? 'success' : 'danger'" class="ml-1">P{{ m.priority }}</el-tag>
                  <el-tag
                    v-for="t in parseRouteTypes(m.types)"
                    :key="t"
                    size="small"
                    :color="MODEL_TYPE_MAP[t]?.color"
                    class="ml-0.5 !border-0"
                    style="color: #fff;"
                  >{{ MODEL_TYPE_MAP[t]?.label ?? t }}</el-tag>
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="baseUrl" label="Base URL" min-width="180" show-overflow-tooltip />
        <el-table-column prop="provider" label="类型" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="providerTagType(row.provider)">{{ providerLabel(row.provider) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="模型数" width="70" align="center">
          <template #default="{ row }">
            <span class="font-semibold text-blue-600">{{ channelModels(row).length }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'danger'" size="small">
              {{ row.enabled ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="140">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button
              size="small"
              :type="row.enabled ? 'warning' : 'success'"
              @click="toggleEnabled(row)"
            >{{ row.enabled ? '禁用' : '启用' }}</el-button>
            <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>
      <div class="mt-4 flex justify-end flex-wrap gap-2">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="adminStore.channels.length"
          layout="total, prev, pager, next"
          background
          class="hidden sm:flex"
          @size-change="currentPage = 1"
        />
        <el-pagination
          v-model:current-page="currentPage"
          :total="adminStore.channels.length"
          layout="prev, pager, next"
          background
          class="sm:hidden"
          @size-change="currentPage = 1"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑渠道' : '添加渠道'"
      width="min(800px, 95vw)"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" @submit.prevent>
        <el-form-item label="渠道名称" prop="name">
          <el-input v-model="form.name" placeholder="渠道名称，如 OpenAI官方" />
        </el-form-item>
        <el-form-item label="类型" prop="provider">
          <el-select v-model="form.provider" class="w-full" @change="handleProviderChange">
            <el-option label="OpenAI" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="Ollama（本地模型）" value="ollama" />
            <el-option label="自定义（兼OpenAI应层）" value="custom" />
            <el-option label="自定义（兼Anthropic应层）" value="custom-anthropic" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL" prop="baseUrl">
          <el-input v-model="form.baseUrl" :placeholder="baseUrlPlaceholder" />
          <div class="text-xs text-gray-400 mt-1">{{ baseUrlHint }}</div>
        </el-form-item>
        <el-form-item label="API Key" :prop="form.provider === 'ollama' ? '' : 'apiKey'">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="form.provider === 'ollama' ? '可选；本地 Ollama 无需填写' : (editingId ? '修改则填写新 Key，留空保持不变' : '上游 API Key')"
          />
          <div v-if="form.provider === 'ollama'" class="text-xs text-gray-400 mt-1">本地 Ollama 默认无需认证；远程或代理服务需要 Bearer Token 时可填写。</div>
        </el-form-item>

        <el-divider content-position="left"><span class="text-xs text-gray-500">模型配置</span></el-divider>

        <el-form-item label="模型列表">
          <div class="w-full space-y-3">
            <div
              v-for="(model, idx) in form.models"
              :key="idx"
              class="border rounded p-2 bg-gray-50 space-y-2"
            >
              <div class="flex items-center gap-2">
                <el-input
                  v-model="form.models[idx]"
                  placeholder="上游模型名，如 gpt-4"
                  class="flex-1"
                  @blur="cleanModel(idx)"
                />
                <el-icon class="text-gray-300 flex-shrink-0"><ArrowRight /></el-icon>
                <el-input
                  v-model="form.aliases[model]"
                  placeholder="重命名（可选）"
                  class="flex-1"
                />
                <el-tooltip
                  :content="testStates[idx]?.message"
                  :disabled="!testStates[idx] || testStates[idx].status === 'idle'"
                  placement="top"
                >
                  <el-button
                    size="small"
                    :type="testBtnType(idx)"
                    plain
                    :loading="testStates[idx]?.loading"
                    :disabled="!form.models[idx]?.trim()"
                    @click="testModel(idx)"
                  >测试</el-button>
                </el-tooltip>
                <el-button
                  size="small"
                  type="danger"
                  plain
                  @click="removeModel(idx)"
                >删除</el-button>
              </div>
              <!-- Model type checkboxes -->
              <div class="flex flex-wrap gap-1 pl-1">
                <span class="text-xs text-gray-400 mr-1 self-center">类型：</span>
                <el-checkbox-group v-model="form.modelTypes[model]" size="small">
                  <el-checkbox-button
                    v-for="mt in MODEL_TYPES"
                    :key="mt.value"
                    :value="mt.value"
                    class="!text-xs"
                  >{{ mt.label }}</el-checkbox-button>
                </el-checkbox-group>
              </div>
              <!-- Advanced settings button -->
              <div class="pl-1">
                <el-button
                  size="small"
                  type="primary"
                  link
                  :disabled="!form.models[idx]?.trim()"
                  @click="openAdvanced(form.models[idx])"
                >
                  <el-icon class="mr-0.5"><Setting /></el-icon>高级设置
                </el-button>
              </div>
            </div>
            <el-button size="small" plain @click="addModel">
              <el-icon class="mr-1"><Plus /></el-icon>添加模型
            </el-button>
            <p class="text-xs text-gray-400">左侧填上游模型名，右侧可选填对外暴露的别名；勾选模型功能类型</p>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="quickImportVisible"
      title="快速导入渠道"
      width="min(900px, 95vw)"
      :close-on-click-modal="false"
    >
      <div class="space-y-3">
        <el-alert type="info" :closable="false" show-icon>
          <template #title>
            支持一次导入多个渠道；请使用 JSON 且不要包含注释。已内置示例，含 <span class="font-mono">$schema</span> 字段。
          </template>
        </el-alert>

        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500">Schema: {{ CHANNEL_IMPORT_SCHEMA_URL }}</div>
          <div class="flex items-center gap-2">
            <el-button size="small" @click="fillImportExample">填充示例</el-button>
            <el-button size="small" @click="formatImportJson">格式化 JSON</el-button>
          </div>
        </div>

        <el-input
          v-model="quickImportText"
          type="textarea"
          :rows="18"
          placeholder="粘贴导入 JSON"
          class="font-mono"
        />

        <el-collapse>
          <el-collapse-item title="查看 JSON Schema" name="schema">
            <el-input
              :model-value="CHANNEL_IMPORT_SCHEMA_TEXT"
              type="textarea"
              :rows="14"
              readonly
              class="font-mono"
            />
          </el-collapse-item>
        </el-collapse>
      </div>
      <template #footer>
        <el-button @click="quickImportVisible = false">取消</el-button>
        <el-button type="primary" :loading="quickImportSaving" @click="submitQuickImport">验证并导入</el-button>
      </template>
    </el-dialog>

    <!-- Advanced Settings Drawer -->
    <el-drawer
      v-model="advancedDrawerVisible"
      :title="`高级设置 — ${advancedModelName}`"
      direction="rtl"
      size="800px"
      :append-to-body="true"
    >
      <template v-if="advancedModelName && form.modelAdvanced[advancedModelName]">
        <div class="space-y-4 pb-4">

          <!-- 路由控制 -->
          <div class="rounded-lg border border-gray-200 overflow-hidden">
            <div class="bg-gray-50 px-4 py-2 border-b border-gray-200">
              <span class="text-xs font-semibold text-gray-500 tracking-wide uppercase">路由控制</span>
            </div>
            <div class="px-4 py-3 space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm text-gray-700">启用路由</div>
                  <div class="text-xs text-gray-400 mt-0.5">关闭后该模型将不参与调度</div>
                </div>
                <el-switch v-model="form.modelAdvanced[advancedModelName].enabled" />
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm text-gray-700">优先级</label>
                  <span class="text-xs text-gray-400">数值越大越优先</span>
                </div>
                <el-input-number
                  v-model="form.modelAdvanced[advancedModelName].priority"
                  :min="1" :max="9999"
                  controls-position="right"
                  class="w-full"
                  size="small"
                />
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm text-gray-700">权重</label>
                  <span class="text-xs text-gray-400">同优先级内随机比例（1-100）</span>
                </div>
                <el-input-number
                  v-model="form.modelAdvanced[advancedModelName].weight"
                  :min="1" :max="100"
                  controls-position="right"
                  class="w-full"
                  size="small"
                />
              </div>
            </div>
          </div>

          <!-- 请求参数 -->
          <div class="rounded-lg border border-gray-200 overflow-hidden">
            <div class="bg-gray-50 px-4 py-2 border-b border-gray-200">
              <span class="text-xs font-semibold text-gray-500 tracking-wide uppercase">请求参数</span>
            </div>
            <div class="px-4 py-3 space-y-4">
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm text-gray-700">超时时间</label>
                  <span class="text-xs text-gray-400">毫秒，留空使用全局默认值</span>
                </div>
                <el-input-number
                  v-model="form.modelAdvanced[advancedModelName].timeout"
                  :min="1000" :max="600000" :step="1000"
                  controls-position="right"
                  placeholder="默认 120000"
                  class="w-full"
                  size="small"
                />
              </div>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm text-gray-700">最大重试次数</label>
                  <span class="text-xs text-gray-400">0 = 不重试，上限 5 次</span>
                </div>
                <el-input-number
                  v-model="form.modelAdvanced[advancedModelName].maxRetries"
                  :min="0" :max="5"
                  controls-position="right"
                  placeholder="默认 0"
                  class="w-full"
                  size="small"
                />
              </div>

              <!-- 自定义请求头 -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-sm text-gray-700">自定义请求头</label>
                  <el-button size="small" plain @click="addCustomHeader">
                    <el-icon class="mr-1"><Plus /></el-icon>添加
                  </el-button>
                </div>
                <div
                  v-if="form.modelAdvanced[advancedModelName].customHeaders.length === 0"
                  class="text-xs text-gray-400 text-center py-3 border border-dashed border-gray-200 rounded-md"
                >
                  暂无自定义请求头
                </div>
                <div v-else class="space-y-2">
                  <div
                    v-for="(header, hIdx) in form.modelAdvanced[advancedModelName].customHeaders"
                    :key="hIdx"
                    class="flex items-center gap-1.5 bg-gray-50 rounded-md px-2 py-1.5 border border-gray-200"
                  >
                    <el-input
                      v-model="header.key"
                      placeholder="Header 名"
                      class="flex-1 !text-xs"
                      size="small"
                    />
                    <span class="text-gray-300 text-xs flex-shrink-0">:</span>
                    <el-input
                      v-model="header.value"
                      placeholder="值"
                      class="flex-1 !text-xs"
                      size="small"
                    />
                    <el-button
                      size="small"
                      text
                      type="danger"
                      class="flex-shrink-0 !px-1"
                      @click="removeCustomHeader(hIdx)"
                    ><el-icon><Close /></el-icon></el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 模型参数 -->
          <div class="rounded-lg border border-gray-200 overflow-hidden">
            <div class="bg-gray-50 px-4 py-2 border-b border-gray-200">
              <span class="text-xs font-semibold text-gray-500 tracking-wide uppercase">模型参数</span>
            </div>
            <div class="px-4 py-3 space-y-4">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-sm text-gray-700">功能类型</label>
                  <span class="text-xs text-gray-400">与外部分类同步</span>
                </div>
                <el-checkbox-group v-model="form.modelTypes[advancedModelName]">
                  <div class="flex flex-wrap gap-x-4 gap-y-2">
                    <el-checkbox
                      v-for="mt in MODEL_TYPES"
                      :key="mt.value"
                      :value="mt.value"
                      class="!items-center"
                    >
                      <span class="text-sm text-gray-700">{{ mt.label }}</span>
                      <el-tooltip :content="mt.degradeDesc" placement="top" :show-after="200">
                        <el-icon class="ml-1 align-middle" style="font-size: 12px; color: #c0c4cc; cursor: help;"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </el-checkbox>
                  </div>
                </el-checkbox-group>
                <!-- Degradation summary -->
                <div class="mt-3 text-xs text-gray-400 bg-gray-50 rounded-md px-3 py-2 border border-gray-100">
                  <span class="font-medium text-gray-500">降级规则：</span>
                  <template v-for="(mt, i) in MODEL_TYPES.filter(t => t.canDegradeTo.length > 0)" :key="mt.value">
                    <span>{{ mt.label }} → {{ MODEL_TYPES.find(t => t.value === mt.canDegradeTo[0])?.label }}</span>
                    <span v-if="i < MODEL_TYPES.filter(t => t.canDegradeTo.length > 0).length - 1" class="mx-1 text-gray-300">｜</span>
                  </template>
                  <span class="ml-2 text-gray-300">·</span>
                  <span class="ml-2">嵌入 / 重排序 / 图像 / 语音 / 视频 需独立端点，不可降级</span>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="text-sm text-gray-700 mb-1">最大上下文</div>
                  <el-input-number
                    v-model="form.modelAdvanced[advancedModelName].contextLength"
                    :min="1" :max="10000000"
                    :controls="false"
                    placeholder="仅作记录"
                    class="w-full"
                    size="small"
                  />
                  <div class="text-xs text-gray-400 mt-1">Token 数，仅作记录</div>
                </div>
                <div>
                  <div class="text-sm text-gray-700 mb-1">最大输出 Token</div>
                  <el-input-number
                    v-model="form.modelAdvanced[advancedModelName].maxTokens"
                    :min="1" :max="1000000"
                    :controls="false"
                    placeholder="仅作记录"
                    class="w-full"
                    size="small"
                  />
                  <div class="text-xs text-gray-400 mt-1">Token 数，仅作记录</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <el-button @click="advancedDrawerVisible = false">关闭</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useAdminStore, type Channel } from '@/stores/admin'
import client from '@/api/client'

const adminStore = useAdminStore()
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const quickImportVisible = ref(false)
const quickImportSaving = ref(false)
const quickImportText = ref('')
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const currentPage = ref(1)
const pageSize = ref(20)
const exportDialogVisible = ref(false)
const exportJsonText = ref('')
function openExportDialog() {
  exportJsonText.value = buildExportJson()
  exportDialogVisible.value = true
}

function buildExportJson(): string {
  // 结构与导入完全一致
  const channels: Record<string, ImportChannelConfig> = {}
  for (const ch of adminStore.channels) {
    const modelRoutes = Array.isArray(ch.modelRoutes) ? ch.modelRoutes : []
    const models: ImportModelConfig[] = modelRoutes.map((r) => {
      let config: any = {}
      try { config = r.config ? JSON.parse(r.config) : {} } catch { config = {} }
      return {
        modelId: r.actualModel,
        alias: r.virtualModel !== r.actualModel ? r.virtualModel : undefined,
        types: parseRouteTypes(r.types),
        priority: r.priority,
        weight: r.weight,
        enabled: r.enabled,
        ...config,
        config,
      }
    })
    channels[ch.name] = {
      baseURL: ch.baseUrl,
      apiKey: ch.apiKey ?? '',
      apiType: ch.provider as ProviderType,
      models,
    }
  }
  const payload: ChannelImportPayload = {
    $schema: CHANNEL_IMPORT_SCHEMA_URL,
    channels,
  }
  return JSON.stringify(payload, null, 2)
}

function formatExportJson() {
  try {
    const parsed = JSON.parse(exportJsonText.value)
    exportJsonText.value = JSON.stringify(parsed, null, 2)
    ElMessage.success('已格式化')
  } catch {
    ElMessage.error('JSON 格式错误，无法格式化')
  }
}

async function copyExportJson() {
  try {
    await navigator.clipboard.writeText(exportJsonText.value)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败')
  }
}

// Advanced settings drawer state
const advancedDrawerVisible = ref(false)
const advancedModelName = ref('')

interface ModelAdvancedConfig {
  priority: number
  weight: number
  enabled: boolean
  timeout?: number
  maxRetries?: number
  maxTokens?: number
  contextLength?: number
  customHeaders: { key: string; value: string }[]
}

type ProviderType = 'openai' | 'anthropic' | 'custom' | 'custom-anthropic' | 'ollama'

interface ImportModelConfig {
  modelId: string
  alias?: string
  types?: string[]
  priority?: number
  weight?: number
  enabled?: boolean
  timeout?: number
  maxRetries?: number
  maxTokens?: number
  contextLength?: number
  customHeaders?: Record<string, string>
  config?: {
    timeout?: number
    maxRetries?: number
    maxTokens?: number
    contextLength?: number
    customHeaders?: Record<string, string>
  }
}

interface ImportChannelConfig {
  baseURL: string
  apiKey?: string
  apiType: ProviderType
  models: ImportModelConfig[]
}

interface ChannelImportPayload {
  $schema?: string
  channels: Record<string, ImportChannelConfig>
}

const CHANNEL_IMPORT_SCHEMA_URL = 'https://llm-gateway.local/schemas/channel-import.schema.json'

const CHANNEL_IMPORT_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: CHANNEL_IMPORT_SCHEMA_URL,
  title: 'LLM Gateway Channel Import',
  type: 'object',
  required: ['channels'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    channels: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['baseURL', 'apiType', 'models'],
        additionalProperties: false,
        allOf: [
          {
            if: { properties: { apiType: { const: 'ollama' } } },
            else: { required: ['apiKey'] },
          },
        ],
        properties: {
          baseURL: { type: 'string', minLength: 1 },
          apiKey: { type: 'string' },
          apiType: { type: 'string', enum: ['openai', 'anthropic', 'custom', 'custom-anthropic', 'ollama'] },
          models: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['modelId'],
              additionalProperties: true,
              properties: {
                modelId: { type: 'string', minLength: 1 },
                alias: { type: 'string' },
                types: { type: 'array', items: { type: 'string' } },
                priority: { type: 'integer', minimum: 1 },
                weight: { type: 'integer', minimum: 1, maximum: 100 },
                enabled: { type: 'boolean' },
                timeout: { type: 'integer', minimum: 1000 },
                maxRetries: { type: 'integer', minimum: 0, maximum: 5 },
                maxTokens: { type: 'integer', minimum: 1 },
                contextLength: { type: 'integer', minimum: 1 },
                customHeaders: { type: 'object', additionalProperties: { type: 'string' } },
                config: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    timeout: { type: 'integer', minimum: 1000 },
                    maxRetries: { type: 'integer', minimum: 0, maximum: 5 },
                    maxTokens: { type: 'integer', minimum: 1 },
                    contextLength: { type: 'integer', minimum: 1 },
                    customHeaders: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

const CHANNEL_IMPORT_EXAMPLE: ChannelImportPayload = {
  $schema: CHANNEL_IMPORT_SCHEMA_URL,
  channels: {
    'channel-name': {
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-xxx',
      apiType: 'openai',
      models: [
        {
          modelId: 'qwen3.6-plus',
          alias: 'default',
          types: ['chat', 'function-calling'],
          priority: 12,
          weight: 100,
          enabled: true,
          contextLength: 196608,
          maxTokens: 8192,
          customHeaders: {
            'X-Provider': 'example',
          },
        },
      ],
    },
  },
}

const CHANNEL_IMPORT_SCHEMA_TEXT = JSON.stringify(CHANNEL_IMPORT_SCHEMA, null, 2)

// Model capability types — with degradation metadata
// canDegradeTo: which base capability this falls back to when the route doesn't declare it
// degradeDesc:  human-readable explanation shown as tooltip in the advanced settings drawer
const MODEL_TYPES = [
  {
    value: 'chat',
    label: '对话',
    canDegradeTo: [] as string[],
    degradeDesc: '基础对话能力（/v1/chat/completions），所有可降级类型的最终降级目标，不可进一步降级',
  },
  {
    value: 'vision',
    label: '视觉理解',
    canDegradeTo: ['chat'],
    degradeDesc: '图像输入理解；路由不支持时自动去除消息中的图片内容并附注说明，降级为纯文本对话',
  },
  {
    value: 'function-calling',
    label: '工具调用',
    canDegradeTo: ['chat'],
    degradeDesc: '工具/函数调用（tools / functions）；路由不支持时自动去除相关参数，降级为纯文本对话',
  },
  {
    value: 'reasoning',
    label: '深度推理',
    canDegradeTo: ['chat'],
    degradeDesc: '扩展推理模式（o1/o3/Claude Thinking）；路由不支持时自动去除 reasoning_effort / thinking 参数，降级为普通对话',
  },
  {
    value: 'embedding',
    label: '文本嵌入',
    canDegradeTo: [] as string[],
    degradeDesc: '文本向量嵌入（/v1/embeddings），需独立端点，不可降级为对话',
  },
  {
    value: 'rerank',
    label: '重排序',
    canDegradeTo: [] as string[],
    degradeDesc: '重排序（RAG 场景，如 Cohere Rerank / BGE-Reranker），需独立端点，不可降级',
  },
  {
    value: 'image-generation',
    label: '图像生成',
    canDegradeTo: [] as string[],
    degradeDesc: '文生图（/v1/images/generations），需独立端点，不可降级为对话',
  },
  {
    value: 'audio',
    label: '语音处理',
    canDegradeTo: [] as string[],
    degradeDesc: '语音合成（TTS）/ 语音识别（STT），需独立的 /audio 端点，不可降级',
  },
  {
    value: 'video-generation',
    label: '视频生成',
    canDegradeTo: [] as string[],
    degradeDesc: '文生视频（如 Sora / Kling），需独立端点，不可降级',
  },
]

const MODEL_TYPE_COLORS: Record<string, string> = {
  'chat':             '#409eff',
  'vision':           '#67c23a',
  'function-calling': '#e6a23c',
  'reasoning':        '#9b59b6',
  'embedding':        '#1abc9c',
  'rerank':           '#00bcd4',
  'image-generation': '#e91e63',
  'audio':            '#ff5722',
  'video-generation': '#795548',
}

const MODEL_TYPE_MAP: Record<string, { label: string; color: string }> = Object.fromEntries(
  MODEL_TYPES.map((t) => [t.value, { label: t.label, color: MODEL_TYPE_COLORS[t.value] ?? '#909399' }])
)

function parseRouteTypes(raw: string[] | string | undefined | null): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) as string[] } catch { return [] }
}

const paginatedChannels = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return adminStore.channels.slice(start, start + pageSize.value)
})

interface FormState {
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  models: string[]
  aliases: Record<string, string>
  modelTypes: Record<string, string[]>
  modelAdvanced: Record<string, ModelAdvancedConfig>
}

const form = reactive<FormState>({
  name: '', provider: 'openai', baseUrl: '', apiKey: '',
  models: [], aliases: {}, modelTypes: {}, modelAdvanced: {},
})

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择类型', trigger: 'change' }],
  baseUrl: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  apiKey: [{ required: true, message: '请输入 API Key', trigger: 'blur' }],
}

const PROVIDERS: Record<string, { label: string; tag: 'primary' | 'warning' | 'info' | 'success' | 'danger' }> = {
  openai: { label: 'OpenAI', tag: 'primary' },
  anthropic: { label: 'Anthropic', tag: 'warning' },
  ollama: { label: 'Ollama', tag: 'success' },
  custom: { label: '自定义(OAI)', tag: 'info' },
  'custom-anthropic': { label: '自定义(Claude)', tag: 'success' },
}

const BASE_URL_CONFIG: Record<string, { placeholder: string; hint: string }> = {
  openai: {
    placeholder: 'https://api.openai.com',
    hint: 'OpenAI 官方接口，填写根地址即可，无需加 /v1',
  },
  anthropic: {
    placeholder: 'https://api.anthropic.com',
    hint: 'Anthropic 官方接口，填写根地址即可，无需加 /v1',
  },
  ollama: {
    placeholder: 'http://localhost:11434',
    hint: 'Ollama 服务根地址，无需加 /v1；网关在 Docker 中运行时请使用 http://host.docker.internal:11434',
  },
  custom: {
    placeholder: 'https://your-openai-compatible-api.com',
    hint: '兼容 OpenAI 格式的自定义接口，填写根地址（不含 /v1/chat/completions），如 https://api.example.com',
  },
  'custom-anthropic': {
    placeholder: 'https://your-anthropic-compatible-api.com',
    hint: '兼容 Anthropic 格式的自定义接口，填写根地址（不含 /v1/messages），如 https://api.example.com',
  },
}

const baseUrlPlaceholder = computed(() => BASE_URL_CONFIG[form.provider]?.placeholder ?? 'https://...')
const baseUrlHint = computed(() => BASE_URL_CONFIG[form.provider]?.hint ?? '')

function providerLabel(p: string) { return PROVIDERS[p]?.label ?? p }
function providerTagType(p: string) { return PROVIDERS[p]?.tag ?? 'info' }

function handleProviderChange(provider: string) {
  if (provider === 'ollama' && !form.baseUrl.trim()) {
    form.baseUrl = 'http://localhost:11434'
  }
  formRef.value?.clearValidate('apiKey')
}

function channelModels(row: Channel) {
  return row.modelRoutes ?? []
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

interface TestState {
  loading: boolean
  status: 'idle' | 'ok' | 'error'
  message: string
}
const testStates = ref<Record<number, TestState>>({})

function testBtnType(idx: number): '' | 'success' | 'danger' {
  const s = testStates.value[idx]
  if (!s || s.status === 'idle') return ''
  return s.status === 'ok' ? 'success' : 'danger'
}

async function testModel(idx: number) {
  const model = form.models[idx]?.trim()
  if (!model) { ElMessage.warning('请先填写模型名'); return }
  if (!form.baseUrl) { ElMessage.warning('请先填写 Base URL'); return }
  if (form.provider !== 'ollama' && !form.apiKey) { ElMessage.warning('测试需要填入 API Key'); return }

  testStates.value[idx] = { loading: true, status: 'idle', message: '' }
  try {
    const res = await client.post('/admin/channels/test', {
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      provider: form.provider,
      model,
    })
    testStates.value[idx] = {
      loading: false,
      status: res.data.success ? 'ok' : 'error',
      message: res.data.message,
    }
    if (res.data.success) {
      ElMessage.success(`${model}：连接成功`)
    } else {
      ElMessage.error(`${model}：${res.data.message}`)
    }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    const msg = e.response?.data?.error ?? '请求失败'
    testStates.value[idx] = { loading: false, status: 'error', message: msg }
    ElMessage.error(msg)
  }
}

function resetForm() {
  form.name = ''
  form.provider = 'openai'
  form.baseUrl = ''
  form.apiKey = ''
  form.models = []
  form.aliases = {}
  form.modelTypes = {}
  form.modelAdvanced = {}
  testStates.value = {}
}

function openCreate() {
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openQuickImport() {
  quickImportVisible.value = true
  if (!quickImportText.value.trim()) {
    quickImportText.value = JSON.stringify(CHANNEL_IMPORT_EXAMPLE, null, 2)
  }
}

function fillImportExample() {
  // 动态生成所有支持的 types
  const allTypes = MODEL_TYPES.map(t => t.value)
  const example = JSON.parse(JSON.stringify(CHANNEL_IMPORT_EXAMPLE))
  if (example.channels && example.channels['channel-name'] && example.channels['channel-name'].models && example.channels['channel-name'].models[0]) {
    example.channels['channel-name'].models[0].types = allTypes
  }
  quickImportText.value = JSON.stringify(example, null, 2)
}

function formatImportJson() {
  try {
    const parsed = JSON.parse(quickImportText.value)
    quickImportText.value = JSON.stringify(parsed, null, 2)
    ElMessage.success('JSON 已格式化')
  } catch {
    ElMessage.error('JSON 格式错误，无法格式化')
  }
}

function parseChannelImportPayload(raw: string): ChannelImportPayload {
  const parsed = JSON.parse(raw) as unknown

  // Backward-compatible normalization for old array style:
  // [ { "channel-name": { ... } } ]
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
      throw new Error('数组格式只支持单元素对象：[{"channel-name": {...}}]')
    }
    return {
      $schema: CHANNEL_IMPORT_SCHEMA_URL,
      channels: parsed[0] as Record<string, ImportChannelConfig>,
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('顶层必须是对象')
  }

  return parsed as ChannelImportPayload
}

function validateChannelImportPayload(payload: ChannelImportPayload): string[] {
  const errors: string[] = []

  if (!payload.channels || typeof payload.channels !== 'object' || Array.isArray(payload.channels)) {
    errors.push('channels 必须是对象，格式为 {"渠道名": {...}}')
    return errors
  }

  const providers = new Set<ProviderType>(['openai', 'anthropic', 'custom', 'custom-anthropic', 'ollama'])

  for (const [channelName, channel] of Object.entries(payload.channels)) {
    const prefix = `channels.${channelName}`
    if (!channelName.trim()) {
      errors.push('渠道名不能为空')
      continue
    }
    if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
      errors.push(`${prefix} 必须是对象`)
      continue
    }

    if (typeof channel.baseURL !== 'string' || !channel.baseURL.trim()) {
      errors.push(`${prefix}.baseURL 必须是非空字符串`)
    }
    if (channel.apiType !== 'ollama' && (typeof channel.apiKey !== 'string' || !channel.apiKey.trim())) {
      errors.push(`${prefix}.apiKey 必须是非空字符串`)
    }
    if (!providers.has(channel.apiType)) {
      errors.push(`${prefix}.apiType 必须是 openai/anthropic/custom/custom-anthropic/ollama 之一`)
    }
    if (!Array.isArray(channel.models) || channel.models.length === 0) {
      errors.push(`${prefix}.models 必须是非空数组`)
      continue
    }

    channel.models.forEach((model, idx) => {
      const modelPrefix = `${prefix}.models[${idx}]`
      if (!model || typeof model !== 'object' || Array.isArray(model)) {
        errors.push(`${modelPrefix} 必须是对象`)
        return
      }
      if (typeof model.modelId !== 'string' || !model.modelId.trim()) {
        errors.push(`${modelPrefix}.modelId 必须是非空字符串`)
      }
      if (model.types !== undefined && (!Array.isArray(model.types) || model.types.some((t) => typeof t !== 'string'))) {
        errors.push(`${modelPrefix}.types 必须是字符串数组`)
      }
      if (model.priority !== undefined && (!Number.isInteger(model.priority) || model.priority < 1)) {
        errors.push(`${modelPrefix}.priority 必须是 >= 1 的整数`)
      }
      if (model.weight !== undefined && (!Number.isInteger(model.weight) || model.weight < 1 || model.weight > 100)) {
        errors.push(`${modelPrefix}.weight 必须是 1-100 的整数`)
      }
      if (model.enabled !== undefined && typeof model.enabled !== 'boolean') {
        errors.push(`${modelPrefix}.enabled 必须是布尔值`)
      }

      const mergedConfig = {
        ...(model.config ?? {}),
        ...(model.timeout !== undefined ? { timeout: model.timeout } : {}),
        ...(model.maxRetries !== undefined ? { maxRetries: model.maxRetries } : {}),
        ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
        ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
      }

      if (mergedConfig.timeout !== undefined && (!Number.isInteger(mergedConfig.timeout) || mergedConfig.timeout < 1000)) {
        errors.push(`${modelPrefix}.timeout 必须是 >= 1000 的整数`)
      }
      if (mergedConfig.maxRetries !== undefined && (!Number.isInteger(mergedConfig.maxRetries) || mergedConfig.maxRetries < 0 || mergedConfig.maxRetries > 5)) {
        errors.push(`${modelPrefix}.maxRetries 必须是 0-5 的整数`)
      }
      if (mergedConfig.maxTokens !== undefined && (!Number.isInteger(mergedConfig.maxTokens) || mergedConfig.maxTokens < 1)) {
        errors.push(`${modelPrefix}.maxTokens 必须是 >= 1 的整数`)
      }
      if (mergedConfig.contextLength !== undefined && (!Number.isInteger(mergedConfig.contextLength) || mergedConfig.contextLength < 1)) {
        errors.push(`${modelPrefix}.contextLength 必须是 >= 1 的整数`)
      }

      const headers = model.customHeaders ?? model.config?.customHeaders
      if (headers !== undefined) {
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
          errors.push(`${modelPrefix}.customHeaders 必须是对象`)
        } else {
          for (const [k, v] of Object.entries(headers)) {
            if (!k.trim()) errors.push(`${modelPrefix}.customHeaders 含空键名`)
            if (typeof v !== 'string') errors.push(`${modelPrefix}.customHeaders.${k} 必须是字符串`) 
          }
        }
      }
    })
  }

  return errors
}

async function submitQuickImport() {
  let payload: ChannelImportPayload
  try {
    payload = parseChannelImportPayload(quickImportText.value)
  } catch (err) {
    ElMessage.error(`JSON 解析失败：${(err as Error).message}`)
    return
  }

  const errors = validateChannelImportPayload(payload)
  if (errors.length > 0) {
    ElMessage.error(`JSON 校验失败：${errors[0]}`)
    return
  }

  quickImportSaving.value = true
  const failed: string[] = []
  let successCount = 0

  try {
    for (const [channelName, channel] of Object.entries(payload.channels)) {
      const models = channel.models.map((m) => m.modelId.trim()).filter(Boolean)
      const modelAliases: Record<string, string> = {}
      const modelTypes: Record<string, string[]> = {}
      const modelAdvanced: Record<string, { priority?: number; weight?: number; enabled?: boolean; config?: Record<string, unknown> }> = {}

      for (const model of channel.models) {
        const modelId = model.modelId.trim()
        if (!modelId) continue
        if (model.alias?.trim()) modelAliases[modelId] = model.alias.trim()
        if (Array.isArray(model.types) && model.types.length > 0) {
          modelTypes[modelId] = model.types
        }

        const rawHeaders = model.customHeaders ?? model.config?.customHeaders
        const customHeaders: Record<string, string> = {}
        if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
          for (const [k, v] of Object.entries(rawHeaders)) {
            if (k.trim() && typeof v === 'string') customHeaders[k.trim()] = v
          }
        }

        const mergedConfig: Record<string, unknown> = {}
        const timeout = model.timeout ?? model.config?.timeout
        const maxRetries = model.maxRetries ?? model.config?.maxRetries
        const maxTokens = model.maxTokens ?? model.config?.maxTokens
        const contextLength = model.contextLength ?? model.config?.contextLength
        if (timeout !== undefined) mergedConfig.timeout = timeout
        if (maxRetries !== undefined) mergedConfig.maxRetries = maxRetries
        if (maxTokens !== undefined) mergedConfig.maxTokens = maxTokens
        if (contextLength !== undefined) mergedConfig.contextLength = contextLength
        if (Object.keys(customHeaders).length > 0) mergedConfig.customHeaders = customHeaders

        if (
          model.priority !== undefined ||
          model.weight !== undefined ||
          model.enabled !== undefined ||
          Object.keys(mergedConfig).length > 0
        ) {
          modelAdvanced[modelId] = {
            ...(model.priority !== undefined ? { priority: model.priority } : {}),
            ...(model.weight !== undefined ? { weight: model.weight } : {}),
            ...(model.enabled !== undefined ? { enabled: model.enabled } : {}),
            config: mergedConfig,
          }
        }
      }

      try {
        await client.post('/admin/channels', {
          name: channelName,
          baseUrl: channel.baseURL,
          apiKey: channel.apiKey ?? '',
          provider: channel.apiType,
          models,
          modelAliases,
          modelTypes,
          modelAdvanced,
        })
        successCount += 1
      } catch (err) {
        const e = err as { response?: { data?: { error?: string } } }
        failed.push(`${channelName}: ${e.response?.data?.error ?? '导入失败'}`)
      }
    }

    await adminStore.fetchChannels()

    if (successCount > 0 && failed.length === 0) {
      quickImportVisible.value = false
      ElMessage.success(`导入成功，共 ${successCount} 个渠道`)
      return
    }

    if (successCount > 0) {
      ElMessage.warning(`部分成功：成功 ${successCount} 个，失败 ${failed.length} 个；首个错误：${failed[0]}`)
    } else {
      ElMessage.error(`导入失败：${failed[0] ?? '未知错误'}`)
    }
  } finally {
    quickImportSaving.value = false
  }
}

function openEdit(channel: Channel) {
  editingId.value = channel.id
  form.name = channel.name
  form.provider = channel.provider
  form.baseUrl = channel.baseUrl
  form.apiKey = channel.apiKey ?? ''
  try {
    form.models = JSON.parse(channel.models || '[]')
    form.aliases = JSON.parse(channel.modelAliases || '{}')
    form.modelTypes = JSON.parse(channel.modelTypes || '{}')
  } catch {
    form.models = []
    form.aliases = {}
    form.modelTypes = {}
  }
  // Populate modelAdvanced from existing modelRoutes
  form.modelAdvanced = {}
  const routes = channel.modelRoutes ?? []
  for (const m of form.models) {
    const route = routes.find((r) => r.actualModel === m)
    let parsedConfig: { timeout?: number; maxRetries?: number; customHeaders?: Record<string, string>; maxTokens?: number; contextLength?: number } = {}
    if (route?.config) {
      try { parsedConfig = JSON.parse(route.config) } catch { /* ignore */ }
    }
    form.modelAdvanced[m] = {
      priority: route?.priority ?? 1,
      weight: route?.weight ?? 100,
      enabled: route?.enabled ?? true,
      timeout: parsedConfig.timeout,
      maxRetries: parsedConfig.maxRetries,
      maxTokens: parsedConfig.maxTokens,
      contextLength: parsedConfig.contextLength,
      customHeaders: Object.entries(parsedConfig.customHeaders ?? {}).map(([key, value]) => ({ key, value })),
    }
  }
  dialogVisible.value = true
}

function addModel() {
  form.models.push('')
}

function removeModel(idx: number) {
  const removed = form.models[idx]
  form.models.splice(idx, 1)
  if (removed && form.aliases[removed] !== undefined) {
    delete form.aliases[removed]
  }
  if (removed && form.modelTypes[removed] !== undefined) {
    delete form.modelTypes[removed]
  }
  if (removed && form.modelAdvanced[removed] !== undefined) {
    delete form.modelAdvanced[removed]
  }
}

function openAdvanced(model: string) {
  if (!model?.trim()) return
  if (!form.modelAdvanced[model]) {
    form.modelAdvanced[model] = {
      priority: 1,
      weight: 100,
      enabled: true,
      customHeaders: [],
    }
  }
  if (!form.modelTypes[model]) {
    form.modelTypes[model] = []
  }
  advancedModelName.value = model
  advancedDrawerVisible.value = true
}


function addCustomHeader() {
  const adv = form.modelAdvanced[advancedModelName.value]
  if (adv) adv.customHeaders.push({ key: '', value: '' })
}

function removeCustomHeader(idx: number) {
  const adv = form.modelAdvanced[advancedModelName.value]
  if (adv) adv.customHeaders.splice(idx, 1)
}

function cleanModel(idx: number) {
  form.models[idx] = form.models[idx].trim()
}

async function toggleEnabled(channel: Channel) {
  await adminStore.updateChannel(channel.id, { enabled: !channel.enabled })
  ElMessage.success('已更新')
}

async function handleSave() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      const cleanModels = form.models.map((m) => m.trim()).filter(Boolean)
      const cleanAliases: Record<string, string> = {}
      const cleanModelTypes: Record<string, string[]> = {}
      const cleanModelAdvanced: Record<string, { priority?: number; weight?: number; enabled?: boolean; config?: Record<string, unknown> }> = {}
      for (const m of cleanModels) {
        if (form.aliases[m]?.trim()) {
          cleanAliases[m] = form.aliases[m].trim()
        }
        if (form.modelTypes[m]?.length) {
          cleanModelTypes[m] = form.modelTypes[m]
        }
        const adv = form.modelAdvanced[m]
        if (adv) {
          const customHeaders: Record<string, string> = {}
          for (const h of (adv.customHeaders ?? [])) {
            if (h.key.trim()) customHeaders[h.key.trim()] = h.value
          }
          const config: Record<string, unknown> = {}
          if (adv.timeout !== undefined) config.timeout = adv.timeout
          if (adv.maxRetries !== undefined) config.maxRetries = adv.maxRetries
          if (adv.maxTokens !== undefined) config.maxTokens = adv.maxTokens
          if (adv.contextLength !== undefined) config.contextLength = adv.contextLength
          if (Object.keys(customHeaders).length > 0) config.customHeaders = customHeaders
          cleanModelAdvanced[m] = {
            priority: adv.priority,
            weight: adv.weight,
            enabled: adv.enabled,
            config,
          }
        }
      }

      if (editingId.value) {
        const data: Record<string, unknown> = {
          name: form.name, provider: form.provider, baseUrl: form.baseUrl,
          models: cleanModels, modelAliases: cleanAliases, modelTypes: cleanModelTypes,
          modelAdvanced: cleanModelAdvanced,
        }
        if (form.apiKey) data.apiKey = form.apiKey
        await adminStore.updateChannel(editingId.value, data as Parameters<typeof adminStore.updateChannel>[1])
      } else {
        await adminStore.createChannel({
          name: form.name, baseUrl: form.baseUrl, apiKey: form.apiKey,
          provider: form.provider, models: cleanModels, modelAliases: cleanAliases,
          modelTypes: cleanModelTypes, modelAdvanced: cleanModelAdvanced,
        })
      }
      dialogVisible.value = false
      ElMessage.success('保存成功')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      ElMessage.error(e.response?.data?.error ?? '保存失败')
    } finally {
      saving.value = false
    }
  })
}

async function handleDelete(id: number) {
  await ElMessageBox.confirm('确认删除该渠道？关联的路由也将被删除。', '删除确认', { type: 'warning' })
  await adminStore.deleteChannel(id)
  ElMessage.success('已删除')
}

onMounted(async () => {
  loading.value = true
  await adminStore.fetchChannels().finally(() => { loading.value = false })
})
</script>
