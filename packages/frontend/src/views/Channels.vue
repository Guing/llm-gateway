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
        <el-table-column label="操作" width="180" fixed="right">
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
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
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
          <el-input v-model="form.baseUrl" placeholder="https://api.openai.com" />
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
          <div class="w-full space-y-2">
            <div
              v-for="(model, idx) in form.models"
              :key="idx"
              class="flex items-center gap-2"
            >
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
            <el-button size="small" plain @click="addModel">
              <el-icon class="mr-1"><Plus /></el-icon>添加模型
            </el-button>
            <p class="text-xs text-gray-400">左侧填上游模型名，右侧可选填对外暴露的别名</p>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
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
}

const form = reactive<FormState>({
  name: '', provider: 'openai', baseUrl: '', apiKey: '',
  models: [], aliases: {},
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
  } catch {
    form.models = []
    form.aliases = {}
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
      for (const m of cleanModels) {
        if (form.aliases[m]?.trim()) {
          cleanAliases[m] = form.aliases[m].trim()
        }
      }

      if (editingId.value) {
        const data: Record<string, unknown> = {
          name: form.name, provider: form.provider, baseUrl: form.baseUrl,
          models: cleanModels, modelAliases: cleanAliases,
        }
        if (form.apiKey) data.apiKey = form.apiKey
        await adminStore.updateChannel(editingId.value, data as Parameters<typeof adminStore.updateChannel>[1])
      } else {
        await adminStore.createChannel({
          name: form.name, baseUrl: form.baseUrl, apiKey: form.apiKey,
          provider: form.provider, models: cleanModels, modelAliases: cleanAliases,
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
