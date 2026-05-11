<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">上游渠道管理</h2>
      <el-button type="primary" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>添加渠道
      </el-button>
    </div>

    <el-card shadow="never" class="border">
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
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="adminStore.channels.length"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="currentPage = 1"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑渠道' : '添加渠道'"
      width="640px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" @submit.prevent>
        <el-form-item label="渠道名称" prop="name">
          <el-input v-model="form.name" placeholder="渠道名称，如 OpenAI官方" />
        </el-form-item>
        <el-form-item label="类型" prop="provider">
          <el-select v-model="form.provider" class="w-full">
            <el-option label="OpenAI" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="自定义（兼OpenAI应层）" value="custom" />
            <el-option label="自定义（兼Anthropic应层）" value="custom-anthropic" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL" prop="baseUrl">
          <el-input v-model="form.baseUrl" :placeholder="baseUrlPlaceholder" />
          <div class="text-xs text-gray-400 mt-1">{{ baseUrlHint }}</div>
        </el-form-item>
        <el-form-item label="API Key" :prop="editingId ? '' : 'apiKey'">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="editingId ? '修改则填写新 Key，留空保持不变' : '上游 API Key'"
          />
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
                <el-checkbox-group v-model="form.modelTypes[advancedModelName]" size="small">
                  <el-checkbox-button
                    v-for="mt in MODEL_TYPES"
                    :key="mt.value"
                    :value="mt.value"
                    class="!text-xs mb-1"
                  >{{ mt.label }}</el-checkbox-button>
                </el-checkbox-group>
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
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()
const currentPage = ref(1)
const pageSize = ref(20)

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

// Model capability types
const MODEL_TYPES = [
  { value: 'chat', label: '文本' },
  { value: 'vision', label: '视觉' },
  { value: 'function-calling', label: '工具调用' },
  { value: 'reasoning', label: '推理' },
  { value: 'embedding', label: '嵌入' },
  { value: 'image-generation', label: '图像生成' },
  { value: 'audio', label: '语音' },
  { value: 'video-generation', label: '视频生成' },
]

const MODEL_TYPE_COLORS: Record<string, string> = {
  'chat': '#409eff',
  'vision': '#67c23a',
  'function-calling': '#e6a23c',
  'reasoning': '#9b59b6',
  'embedding': '#1abc9c',
  'image-generation': '#e91e63',
  'audio': '#ff5722',
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
  if (!form.apiKey) { ElMessage.warning('测试需要填入 API Key'); return }

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

function hasAdvancedSettings(model: string): boolean {
  if (!model?.trim()) return false
  const adv = form.modelAdvanced[model]
  if (!adv) return false
  return (
    adv.priority !== 1 ||
    adv.weight !== 100 ||
    adv.enabled === false ||
    adv.timeout !== undefined ||
    adv.maxRetries !== undefined ||
    adv.maxTokens !== undefined ||
    adv.contextLength !== undefined ||
    (adv.customHeaders && adv.customHeaders.length > 0)
  )
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
