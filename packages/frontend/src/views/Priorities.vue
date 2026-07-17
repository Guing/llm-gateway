<template>
  <div class="p-3 sm:p-6">
    <div class="flex flex-wrap justify-between items-start mb-4 sm:mb-6 gap-3">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-gray-800">模型优先级配置</h2>
        <p class="text-sm text-gray-400 mt-1">数字越大优先级越高，相同优先级内按权重随机负载均衡</p>
      </div>
      <el-button type="primary" :loading="saving" @click="saveAll">
        <el-icon class="mr-1"><Check /></el-icon>保存全部
      </el-button>
    </div>

    <!-- Fallback 机制说明 + 配置入口 -->
    <el-card shadow="never" class="mb-6 border border-blue-100 bg-blue-50/40">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-semibold text-blue-700">Fallback 机制说明</span>
          <el-tooltip placement="top" effect="dark">
            <template #content>
              <div class="max-w-xs leading-6">
                <div>优先级高的上游渠道优先使用；同优先级按权重随机分配。</div>
                <div>可重试错误（429 / 限速 / 超时 / 502 / 503 / 500 / 连接失败 / 配额耗尽）会自动切换到下一个渠道。</div>
                <div>非重试错误（400 参数错误 / 401 认证失败 / 404 模型不存在）默认直接返回。</div>
                <div>所有优先级层全部失败后，返回最后一次错误给客户端。</div>
              </div>
            </template>
            <el-icon class="text-blue-500 cursor-help shrink-0"><InfoFilled /></el-icon>
          </el-tooltip>
        </div>
        <el-button type="primary" plain @click="openFallbackDialog">
          <el-icon class="mr-1"><Setting /></el-icon>
          Fallback
        </el-button>
      </div>
      <div class="mt-3 text-sm text-blue-600">
        当前状态：
        <span class="font-medium">{{ fallbackOnAnyError ? '任何错误都触发 Fallback' : '仅可重试错误触发 Fallback' }}</span>
      </div>
    </el-card>

    <el-dialog v-model="fallbackDialogVisible" title="Fallback 配置" width="min(720px, 95vw)" destroy-on-close>
      <div class="space-y-5">
        <div class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <div class="font-medium text-gray-800">任何错误都触发 Fallback</div>
            <div class="text-xs text-gray-500 mt-1">开启后，所有上游错误（包括 400/401/404）均会尝试切换到下一个渠道</div>
          </div>
          <el-switch
            v-model="fallbackOnAnyError"
            :loading="settingsLoading"
            active-text="开启"
            inactive-text="关闭"
          />
        </div>

        <div class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <div class="font-medium text-gray-800">上下文超限时自动截断</div>
            <div class="text-xs text-gray-500 mt-1">关闭时，超长上下文直接透传上游错误；开启后会在代理层预先截断再请求上游</div>
          </div>
          <el-switch
            v-model="fallbackTruncateOnContextExceeded"
            :loading="settingsLoading"
            active-text="开启"
            inactive-text="关闭"
          />
        </div>

        <div>
          <div class="text-sm font-medium text-gray-700 mb-3">Fallback 惩罚参数</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div class="text-xs text-gray-500 mb-1">基础惩罚时长（秒）</div>
              <el-input-number v-model="fallbackPenaltyBaseSec" :min="1" :max="3600" :step="1" class="w-full" />
            </div>
            <div>
              <div class="text-xs text-gray-500 mb-1">惩罚上限（秒）</div>
              <el-input-number v-model="fallbackPenaltyMaxSec" :min="1" :max="7200" :step="1" class="w-full" />
            </div>
            <div>
              <div class="text-xs text-gray-500 mb-1">降权比例（%）</div>
              <el-input-number v-model="fallbackPenaltyWeightPercent" :min="1" :max="100" :step="1" class="w-full" />
            </div>
          </div>
          <div class="text-xs text-gray-400 mt-2">
            失败惩罚采用指数退避：第 N 次连续失败惩罚 = min(上限, 基础时长 × 2^(N-1))；惩罚期内有效权重 = 原权重 × 降权比例。
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="fallbackDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="settingsLoading" @click="savePenaltySettings">保存配置</el-button>
        </div>
      </template>
    </el-dialog>

    <el-card shadow="never" class="mb-6 border">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="font-semibold text-gray-700">路由健康状态</div>
          <el-button size="small" :loading="healthLoading" @click="loadRouteHealth">刷新</el-button>
        </div>
      </template>
      <el-table :data="healthRows" size="small" row-key="id" max-height="320">
        <el-table-column label="虚拟模型" min-width="130" prop="virtualModel" />
        <el-table-column label="渠道/模型" min-width="220">
          <template #default="{ row }">
            <span class="text-gray-700">{{ row.channelName }}</span>
            <span class="text-gray-300 mx-1">/</span>
            <code class="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{{ row.actualModel }}</code>
          </template>
        </el-table-column>
        <el-table-column label="原权重" width="90" prop="weight" />
        <el-table-column label="有效权重" width="90" prop="effectiveWeight" />
        <el-table-column label="连续失败" width="90" prop="consecutiveFailures" />
        <el-table-column label="惩罚剩余" width="120">
          <template #default="{ row }">
            <el-tag :type="row.remainingPenaltyMs > 0 ? 'warning' : 'success'" size="small">
              {{ formatDuration(row.remainingPenaltyMs) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <div v-if="loading" class="text-center py-16 text-gray-400">
      <el-icon class="animate-spin" size="32"><Loading /></el-icon>
      <p class="mt-2">加载中...</p>
    </div>

    <template v-else>
      <!-- Group by virtualModel -->
      <div v-if="groups.length === 0" class="text-center py-16 text-gray-400">
        <el-icon size="48"><Sort /></el-icon>
        <p class="mt-2">暂无路由，请先在「上游渠道」中添加模型</p>
        <router-link to="/channels">
          <el-button class="mt-3" type="primary" plain>前往添加渠道</el-button>
        </router-link>
      </div>

      <div v-else class="space-y-4">
        <el-card
          v-for="group in groups"
          :key="group.virtualModel"
          shadow="never"
          class="border"
        >
          <template #header>
            <div class="flex items-center gap-2">
              <el-icon class="text-blue-500"><Share /></el-icon>
              <span class="font-semibold">虚拟模型：</span>
              <code class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-sm">{{ group.virtualModel }}</code>
              <el-tag size="small" type="info">{{ group.routes.length }} 个上游</el-tag>
            </div>
          </template>

          <el-table :data="group.routes" size="small" row-key="id">
            <el-table-column label="上游渠道" min-width="140">
              <template #default="{ row }">
                <el-tag size="small" :type="providerTagType(row.channelProvider)">{{ row.channelName }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="实际模型名" min-width="160">
              <template #default="{ row }">
                <code class="text-xs bg-gray-100 px-2 py-0.5 rounded">{{ row.actualModel }}</code>
                <el-tag
                  v-for="t in row.types"
                  :key="t"
                  size="small"
                  class="ml-1 !text-xs"
                >{{ MODEL_TYPE_LABELS[t] ?? t }}</el-tag>
                </template>
            </el-table-column>
            <el-table-column label="优先级" width="160">
              <template #default="{ row }">
                <el-input-number
                  v-model="row._priority"
                  :min="1"
                  :max="999"
                  size="small"
                  style="width: 110px"
                />
              </template>
            </el-table-column>
            <el-table-column label="权重" width="160">
              <template #default="{ row }">
                <el-input-number
                  v-model="row._weight"
                  :min="1"
                  :max="100"
                  size="small"
                  style="width: 110px"
                />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="130">
              <template #default="{ row }">
                <el-switch
                  v-model="row._enabled"
                  active-text="启用"
                  inactive-text="禁用"
                  size="small"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  plain
                  @click="deleteRoute(row.id, group.virtualModel)"
                >删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled, Setting } from '@element-plus/icons-vue'
import { useAdminStore } from '@/stores/admin'
import client from '@/api/client'

const adminStore = useAdminStore()
const loading = ref(false)
const saving = ref(false)
const settingsLoading = ref(false)
const healthLoading = ref(false)
const fallbackDialogVisible = ref(false)
const fallbackOnAnyError = ref(false)
const fallbackTruncateOnContextExceeded = ref(false)
const fallbackPenaltyBaseSec = ref(30)
const fallbackPenaltyMaxSec = ref(300)
const fallbackPenaltyWeightPercent = ref(20)

interface RouteRow {
  id: number
  virtualModel: string
  actualModel: string
  channelId: number
  channelName: string
  channelProvider: string
  priority: number
  weight: number
  enabled: boolean
  types: string[]
  // mutable copies for editing
  _priority: number
  _weight: number
  _enabled: boolean
}

interface RouteGroup {
  virtualModel: string
  routes: RouteRow[]
}

interface RouteHealthRow {
  routeId: number
  consecutiveFailures: number
  penaltyUntil: number
  remainingPenaltyMs: number
}

const rows = ref<RouteRow[]>([])
const routeHealthMap = ref<Record<number, RouteHealthRow>>({})
const nowTs = ref(Date.now())
let healthPollTimer: number | undefined
let healthTickTimer: number | undefined

const groups = computed<RouteGroup[]>(() => {
  const map = new Map<string, RouteRow[]>()
  for (const r of rows.value) {
    if (!map.has(r.virtualModel)) map.set(r.virtualModel, [])
    map.get(r.virtualModel)!.push(r)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([virtualModel, routes]) => ({
      virtualModel,
      routes: routes.slice().sort((a, b) => b.priority - a.priority),
    }))
})

const PROVIDERS: Record<string, 'primary' | 'warning' | 'info' | 'success'> = {
  openai: 'primary', anthropic: 'warning', ollama: 'success', custom: 'info', 'custom-anthropic': 'success',
}
function providerTagType(p: string) { return PROVIDERS[p] ?? 'info' }

function openFallbackDialog() {
  fallbackDialogVisible.value = true
}

const MODEL_TYPE_LABELS: Record<string, string> = {
  'chat': '对话',
  'vision': '视觉理解',
  'function-calling': '工具调用',
  'reasoning': '深度推理',
  'embedding': '文本嵌入',
  'rerank': '重排序',
  'image-generation': '图像生成',
  'audio': '语音处理',
  'video-generation': '视频生成',
}

const healthRows = computed(() => rows.value
  .map((r) => {
    const h = routeHealthMap.value[r.id]
    const remaining = h ? Math.max(0, h.penaltyUntil - nowTs.value) : 0
    const ratio = fallbackPenaltyWeightPercent.value / 100
    return {
      ...r,
      consecutiveFailures: h?.consecutiveFailures ?? 0,
      remainingPenaltyMs: remaining,
      effectiveWeight: remaining > 0
        ? Math.max(1, Math.floor(r.weight * ratio))
        : r.weight,
    }
  })
  .sort((a, b) => b.remainingPenaltyMs - a.remainingPenaltyMs || a.virtualModel.localeCompare(b.virtualModel))
)

async function loadRoutes() {
  loading.value = true
  try {
    // Load routes and settings in parallel
    const [, settingsRes] = await Promise.all([
      adminStore.fetchChannels(),
      client.get('/admin/settings').catch(() => null),
    ])
    if (settingsRes) {
      const s = settingsRes.data as {
        fallbackOnAnyError?: boolean
        fallbackTruncateOnContextExceeded?: boolean
        fallbackPenaltyBaseMs?: number
        fallbackPenaltyMaxMs?: number
        fallbackPenaltyWeightRatio?: number
      }
      fallbackOnAnyError.value = !!s.fallbackOnAnyError
      fallbackTruncateOnContextExceeded.value = !!s.fallbackTruncateOnContextExceeded
      fallbackPenaltyBaseSec.value = Math.max(1, Math.round((s.fallbackPenaltyBaseMs ?? 30_000) / 1000))
      fallbackPenaltyMaxSec.value = Math.max(1, Math.round((s.fallbackPenaltyMaxMs ?? 300_000) / 1000))
      fallbackPenaltyWeightPercent.value = Math.max(1, Math.min(100, Math.round((s.fallbackPenaltyWeightRatio ?? 0.2) * 100)))
    }
    const newRows: RouteRow[] = []
    for (const ch of adminStore.channels) {
      for (const r of ch.modelRoutes ?? []) {
        newRows.push({
          id: r.id,
          virtualModel: r.virtualModel,
          actualModel: r.actualModel,
          channelId: ch.id,
          channelName: ch.name,
          channelProvider: ch.provider,
          priority: r.priority,
          weight: r.weight,
          enabled: r.enabled,
          types: (() => {
            const raw = r.types as unknown as string | string[] | undefined
            if (Array.isArray(raw)) return raw
            try { return JSON.parse((raw as string) || '[]') as string[] } catch { return [] }
          })(),
          _priority: r.priority,
          _weight: r.weight,
          _enabled: r.enabled,
        })
      }
    }
    rows.value = newRows
    await loadRouteHealth()
  } finally {
    loading.value = false
  }
}

async function savePenaltySettings() {
  if (fallbackPenaltyBaseSec.value > fallbackPenaltyMaxSec.value) {
    ElMessage.warning('基础惩罚时长不能大于惩罚上限')
    return
  }

  settingsLoading.value = true
  try {
    await client.put('/admin/settings', {
      fallbackOnAnyError: fallbackOnAnyError.value,
      fallbackTruncateOnContextExceeded: fallbackTruncateOnContextExceeded.value,
      fallbackPenaltyBaseMs: fallbackPenaltyBaseSec.value * 1000,
      fallbackPenaltyMaxMs: fallbackPenaltyMaxSec.value * 1000,
      fallbackPenaltyWeightRatio: Number((fallbackPenaltyWeightPercent.value / 100).toFixed(3)),
    })
    ElMessage.success('Fallback 配置已保存')
    fallbackDialogVisible.value = false
    await loadRouteHealth()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error ?? '保存失败')
  } finally {
    settingsLoading.value = false
  }
}

async function loadRouteHealth() {
  healthLoading.value = true
  try {
    const res = await client.get('/admin/routes/health')
    const list = (res.data as RouteHealthRow[]) ?? []
    const next: Record<number, RouteHealthRow> = {}
    for (const item of list) next[item.routeId] = item
    routeHealthMap.value = next
    nowTs.value = Date.now()
  } catch {
    // Best effort only
  } finally {
    healthLoading.value = false
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const sec = Math.ceil(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

async function saveAll() {
  saving.value = true
  try {
    const changed = rows.value.filter(
      (r) => r._priority !== r.priority || r._weight !== r.weight || r._enabled !== r.enabled,
    )
    await Promise.all(
      changed.map((r) =>
        client.put(`/admin/routes/${r.id}`, {
          priority: r._priority,
          weight: r._weight,
          enabled: r._enabled,
        }),
      ),
    )
    // Update local state
    for (const r of changed) {
      r.priority = r._priority
      r.weight = r._weight
      r.enabled = r._enabled
    }
    ElMessage.success(`已保存 ${changed.length} 条路由优先级`)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error ?? '保存失败')
  } finally {
    saving.value = false
  }
}

async function deleteRoute(id: number, virtualModel: string) {
  await ElMessageBox.confirm(
    `确认删除该路由（${virtualModel}）？`,
    '删除确认',
    { type: 'warning' },
  )
  await client.delete(`/admin/routes/${id}`)
  rows.value = rows.value.filter((r) => r.id !== id)
  ElMessage.success('已删除')
}

onMounted(async () => {
  await loadRoutes()
  healthPollTimer = window.setInterval(loadRouteHealth, 5000)
  healthTickTimer = window.setInterval(() => { nowTs.value = Date.now() }, 1000)
})

onBeforeUnmount(() => {
  if (healthPollTimer) window.clearInterval(healthPollTimer)
  if (healthTickTimer) window.clearInterval(healthTickTimer)
})
</script>
