<template>
  <div class="p-6">
    <h2 class="text-2xl font-bold text-gray-800 mb-6">仪表盘</h2>

    <!-- Stats cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <el-card v-for="stat in statCards" :key="stat.label" shadow="never" class="border">
        <div class="flex items-center gap-3">
          <div :class="['w-10 h-10 rounded-lg flex items-center justify-center text-white', stat.color]">
            <el-icon size="20"><component :is="stat.icon" /></el-icon>
          </div>
          <div>
            <p class="text-2xl font-bold text-gray-800">{{ stat.value }}</p>
            <p class="text-xs text-gray-500">{{ stat.label }}</p>
          </div>
        </div>
      </el-card>
    </div>

    <!-- API Usage Guide -->
    <el-card shadow="never" class="border mb-6">
      <template #header>
        <div class="flex justify-between items-center">
          <span class="font-semibold text-gray-700">🚀 如何使用 LLM Gateway</span>
          <el-button size="small" type="primary" @click="quickCreateKey">
            <el-icon class="mr-1"><Key /></el-icon>快速创建 API Key
          </el-button>
        </div>
      </template>

      <div class="space-y-4 text-sm">
        <!-- API Endpoint -->
        <div>
          <p class="font-medium text-gray-700 mb-2">① API 接入地址</p>
          <div class="flex gap-3 flex-wrap">
            <div class="flex-1 min-w-0">
              <p class="text-xs text-gray-400 mb-1">OpenAI 兼容接口</p>
              <div class="flex items-center gap-2 bg-gray-50 border rounded px-3 py-2">
                <code class="flex-1 text-xs text-gray-700 select-all break-all">{{ apiBase }}/v1</code>
                <el-button size="small" plain @click="copy(apiBase + '/v1')">复制</el-button>
              </div>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs text-gray-400 mb-1">Anthropic 兼容接口</p>
              <div class="flex items-center gap-2 bg-gray-50 border rounded px-3 py-2">
                <code class="flex-1 text-xs text-gray-700 select-all break-all">{{ apiBase }}/anthropic</code>
                <el-button size="small" plain @click="copy(apiBase + '/anthropic')">复制</el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Code examples -->
        <div>
          <p class="font-medium text-gray-700 mb-2">② 调用示例</p>
          <el-tabs v-model="codeTab" size="small">
            <el-tab-pane label="Python (OpenAI SDK)" name="python">
              <pre class="bg-gray-900 text-green-400 text-xs rounded p-3 overflow-x-auto"><code>from openai import OpenAI

client = OpenAI(
    base_url="{{ apiBase }}/v1",
    api_key="sk-gw-your-key-here",
)

response = client.chat.completions.create(
    model="gpt-4",   # 使用虚拟模型名
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)</code></pre>
            </el-tab-pane>
            <el-tab-pane label="curl" name="curl">
              <pre class="bg-gray-900 text-green-400 text-xs rounded p-3 overflow-x-auto"><code>curl {{ apiBase }}/v1/chat/completions \
  -H "Authorization: Bearer sk-gw-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'</code></pre>
            </el-tab-pane>
            <el-tab-pane label="Node.js" name="node">
              <pre class="bg-gray-900 text-green-400 text-xs rounded p-3 overflow-x-auto"><code>import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '{{ apiBase }}/v1',
  apiKey: 'sk-gw-your-key-here',
})

const resp = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
})
console.log(resp.choices[0].message.content)</code></pre>
            </el-tab-pane>
          </el-tabs>
        </div>

        <!-- Quick steps -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="border rounded-lg p-3 bg-blue-50">
            <p class="font-semibold text-blue-700 text-xs mb-1">Step 1 · 配置上游渠道</p>
            <p class="text-gray-500 text-xs">在「上游渠道」中添加 OpenAI / Anthropic 等上游提供商的 API Key 和模型列表。</p>
            <router-link v-if="isAdmin" to="/channels">
              <el-button size="small" class="mt-2" plain>前往配置 →</el-button>
            </router-link>
          </div>
          <div class="border rounded-lg p-3 bg-purple-50">
            <p class="font-semibold text-purple-700 text-xs mb-1">Step 2 · 设置模型优先级</p>
            <p class="text-gray-500 text-xs">在「模型优先级」中调整各渠道模型的调用顺序，高优先级优先使用，同优先级按权重随机。</p>
            <router-link v-if="isAdmin" to="/priorities">
              <el-button size="small" class="mt-2" plain>前往配置 →</el-button>
            </router-link>
          </div>
          <div class="border rounded-lg p-3 bg-green-50">
            <p class="font-semibold text-green-700 text-xs mb-1">Step 3 · 创建 API Key</p>
            <p class="text-gray-500 text-xs">在「API Keys」中生成访问密钥，格式为 <code class="bg-white px-1 rounded">sk-gw-…</code>，用于替换原有的 OpenAI Key。</p>
            <router-link to="/api-keys">
              <el-button size="small" class="mt-2" plain>前往创建 →</el-button>
            </router-link>
          </div>
        </div>
      </div>
    </el-card>

    <!-- Recent logs table -->
    <el-card shadow="never" class="border">
      <template #header>
        <div class="flex justify-between items-center">
          <span class="font-semibold text-gray-700">最近请求</span>
          <router-link to="/logs">
            <el-button size="small" type="primary" plain>查看全部</el-button>
          </router-link>
        </div>
      </template>

      <el-table :data="recentLogs" stripe size="small" v-loading="loading">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatTime(row.requestedAt) }}</template>
        </el-table-column>
        <el-table-column prop="user.email" label="用户" min-width="140" show-overflow-tooltip />
        <el-table-column prop="virtualModel" label="模型" width="140" />
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ row.duration != null ? row.duration + 'ms' : '-' }}</template>
        </el-table-column>
        <el-table-column label="Tokens" width="100">
          <template #default="{ row }">{{ row.completionTokens ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.errorMessage ? 'danger' : 'success'" size="small">
              {{ row.errorMessage ? '失败' : '成功' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="流式" width="60">
          <template #default="{ row }">
            <el-tag v-if="row.isStreaming" type="info" size="small">SSE</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Quick create key dialog -->
    <el-dialog v-model="keyDialogVisible" title="快速创建 API Key" width="360px">
      <el-form ref="keyFormRef" :model="keyForm" :rules="keyRules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="keyForm.name" placeholder="为这个 Key 起个名字" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="keyDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="keyCreating" @click="handleCreateKey">生成</el-button>
      </template>
    </el-dialog>

    <!-- Show newly created key -->
    <el-alert v-if="newKey" type="success" class="mt-4" :closable="false">
      <template #default>
        <p class="font-semibold mb-1">✅ API Key 已生成（请立即保存，之后无法再查看）</p>
        <div class="flex items-center gap-2 bg-gray-100 rounded px-3 py-2">
          <code class="flex-1 text-sm break-all select-all">{{ newKey }}</code>
          <el-button size="small" type="primary" @click="copy(newKey)">复制</el-button>
        </div>
        <el-button size="small" class="mt-2" @click="newKey = ''">我已保存，关闭</el-button>
      </template>
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useAdminStore } from '@/stores/admin'
import { useLogsStore } from '@/stores/logs'
import { useAuthStore } from '@/stores/auth'
import client from '@/api/client'

const adminStore = useAdminStore()
const logsStore = useLogsStore()
const authStore = useAuthStore()
const loading = ref(false)
const isAdmin = computed(() => authStore.isAdmin)

// Detect current API base URL (same host, port 7500 in dev)
const apiBase = computed(() => {
  const url = new URL(window.location.href)
  if (import.meta.env.DEV) {
    return `${url.protocol}//${url.hostname}:7500`
  }
  // Production: use current site URL + port (no port means standard 80/443)
  const port = url.port ? `:${url.port}` : ''
  return `${url.protocol}//${url.hostname}${port}`
})

const codeTab = ref('python')

const statCards = computed(() => [
  { label: '总请求数', value: adminStore.stats.totalRequests, icon: 'DataAnalysis', color: 'bg-blue-500' },
  { label: '注册用户', value: adminStore.stats.totalUsers, icon: 'UserFilled', color: 'bg-green-500' },
  { label: '活跃渠道', value: adminStore.stats.activeChannels, icon: 'Connection', color: 'bg-purple-500' },
  { label: '近24h错误', value: adminStore.stats.recentErrors, icon: 'Warning', color: 'bg-red-500' },
])

const recentLogs = computed(() => logsStore.logs.slice(0, 10))

function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function copy(text: string) {
  navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

// Quick create key
const keyDialogVisible = ref(false)
const keyCreating = ref(false)
const newKey = ref('')
const keyFormRef = ref<FormInstance>()
const keyForm = ref({ name: '' })
const keyRules = { name: [{ required: true, message: '请输入名称', trigger: 'blur' }] }

function quickCreateKey() {
  keyForm.value.name = ''
  newKey.value = ''
  keyDialogVisible.value = true
}

async function handleCreateKey() {
  await keyFormRef.value?.validate(async (valid) => {
    if (!valid) return
    keyCreating.value = true
    try {
      const res = await client.post('/keys', { name: keyForm.value.name })
      newKey.value = res.data.plainKey
      keyDialogVisible.value = false
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      ElMessage.error(e.response?.data?.error ?? '生成失败')
    } finally {
      keyCreating.value = false
    }
  })
}

onMounted(async () => {
  loading.value = true
  try {
    const fetchPromises: Promise<void>[] = [logsStore.fetchLogs({ limit: 10 })]
    if (authStore.isAdmin) {
      fetchPromises.push(adminStore.fetchStats())
    }
    await Promise.all(fetchPromises)
  } finally {
    loading.value = false
  }
})
</script>


